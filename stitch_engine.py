"""Deterministic, bounded-memory stitching. No optical flow or synthetic AI fallback."""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

MAX_PIXELS = 64_000_000
BLOCK = 1536
HALO = 256
BANDS = 7
PHASES = ("base", "cutting", "redraw", "registration", "color", "seams", "blend", "inspection", "receiving")
LABELS = ("准备原图", "带重叠切图", "逐块 AI 补绘", "SIFT + RANSAC 配准", "匹配大范围色调", "Graph Cut 寻找接缝", "7 层拉普拉斯融合", "局部质量检查", "回传超分结果")
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
cv2.setNumThreads(1)
cv2.ocl.setUseOpenCL(False)


class StitchError(RuntimeError):
    pass


def save_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def report(folder, phase, done=0, total=1, **extra):
    index = PHASES.index(phase)
    value = {"stage": phase, "label": LABELS[index], "done": done, "units": total,
             "step": index+1, "total": len(PHASES), "fraction": (index+min(1,done/max(1,total)))/len(PHASES)}
    value.update(extra)
    save_json(Path(folder)/"engine-progress.json", value)
    return value


def layout(width, height, factor):
    if factor not in (4,9,16):
        raise StitchError("拼接倍率只支持 4×、9×、16×")
    grid = math.isqrt(factor)
    if min(width,height) < grid*48:
        raise StitchError("原图过小，无法保留指定重叠和稳定特征")
    if width*height*factor > MAX_PIXELS or max(width,height)*grid >= 32700:
        raise StitchError("目标超过 6400 万像素或单边限制，请降低倍率或使用较小原图；不会静默缩小结果")
    tiles=[]
    for row in range(grid):
        for col in range(grid):
            core=[round(col*width/grid),round(row*height/grid),round((col+1)*width/grid),round((row+1)*height/grid)]
            box=[max(0,core[0]-32),max(0,core[1]-18),min(width,core[2]+32),min(height,core[3]+18)]
            tiles.append({"index":len(tiles),"row":row,"column":col,"box":box,"core":core,
                          "corner":[box[0]*grid,box[1]*grid],"size":[(box[2]-box[0])*grid,(box[3]-box[1])*grid]})
    return {"width":width,"height":height,"factor":factor,"grid":grid,"output_size":[width*grid,height*grid],
            "overlap":[64,36],"bands":BANDS,"tiles":tiles}


def prepare(folder, factor):
    folder=Path(folder)
    with Image.open(folder/"base.png") as image:
        plan=layout(*image.size,factor)
        for name in ("crops","redraw","registered","corrected","masks","diagnostics","calls"):
            (folder/name).mkdir(exist_ok=True)
        report(folder,"cutting",0,factor)
        for tile in plan["tiles"]:
            crop=image.crop(tile["box"])
            features=cv2.SIFT_create(nfeatures=3000,contrastThreshold=.018).detect(cv2.cvtColor(np.array(crop.convert('RGB')),cv2.COLOR_RGB2GRAY),None)
            if len(features)<12:raise StitchError(f"第 {tile['index']+1} 块原图纹理不足，无法可靠执行 SIFT 配准；未开始 AI 补绘")
            crop.save(folder/"crops"/f'{tile["index"]}.png')
            report(folder,"cutting",tile["index"]+1,factor)
        preview=image.copy();preview.thumbnail((640,640));preview.save(folder/"preview.png")
    save_json(folder/"plan.json",plan)
    return plan


def read_bgr(path):
    image=cv2.imdecode(np.fromfile(str(path),dtype=np.uint8),cv2.IMREAD_COLOR)
    if image is None: raise StitchError(f"无法读取工作图像：{Path(path).name}")
    return image


def write_png(path, image):
    ok, data=cv2.imencode(".png",image)
    if not ok: raise StitchError("无法编码拼接工作文件")
    data.tofile(str(path))


def affine_register(original, redraw):
    """One global affine per tile, estimated only from SIFT correspondences."""
    h,w=original.shape[:2]
    reduced=cv2.resize(redraw,(w,h),interpolation=cv2.INTER_AREA)
    sift=cv2.SIFT_create(nfeatures=6000,contrastThreshold=.018)
    target_points,target_desc=sift.detectAndCompute(cv2.cvtColor(original,cv2.COLOR_BGR2GRAY),None)
    source_points,source_desc=sift.detectAndCompute(cv2.cvtColor(reduced,cv2.COLOR_BGR2GRAY),None)
    if source_desc is None or target_desc is None:
        raise StitchError("SIFT 特征不足，补绘块无法可靠配准；请重试该块")
    matches=cv2.BFMatcher(cv2.NORM_L2).knnMatch(source_desc,target_desc,k=2)
    good=[pair[0] for pair in matches if len(pair)==2 and pair[0].distance < .72*pair[1].distance]
    if len(good)<10: raise StitchError(f"SIFT 可靠匹配不足（{len(good)}），拒绝强行拼接")
    source=np.float32([source_points[m.queryIdx].pt for m in good])
    target=np.float32([target_points[m.trainIdx].pt for m in good])
    affine,inliers=cv2.estimateAffine2D(source,target,method=cv2.RANSAC,ransacReprojThreshold=2.5,maxIters=5000,confidence=.995,refineIters=25)
    if affine is None or inliers is None: raise StitchError("RANSAC 未找到稳定的全局仿射变换")
    keep=inliers.ravel().astype(bool);count=int(keep.sum());ratio=count/len(good)
    errors=np.linalg.norm(source[keep]@affine[:,:2].T+affine[:,2]-target[keep],axis=1)
    rms=float(np.sqrt(np.mean(errors**2)))
    scales=np.linalg.svd(affine[:,:2],compute_uv=False)
    spread=cv2.contourArea(cv2.convexHull(source[keep]))/(w*h) if count>=3 else 0
    if count<8 or ratio<.25 or rms>2.5 or min(scales)<.75 or max(scales)>1.25 or np.linalg.det(affine[:,:2])<=0 or spread<.035:
        raise StitchError(f"配准质量不足：内点 {count}、比例 {ratio:.2f}、误差 {rms:.2f}px；保留中间结果供重试")
    return affine,{"method":"SIFT+RANSAC/global_affine","matches":len(good),"inliers":count,"inlier_ratio":ratio,"rms_original_pixels":rms,"feature_spread":spread,"matrix":affine.tolist()}


def register_tile(folder,index):
    folder=Path(folder);plan=json.loads((folder/"plan.json").read_text());tile=plan["tiles"][index]
    original=read_bgr(folder/"crops"/f"{index}.png");redraw=read_bgr(folder/"redraw"/f"{index}.png")
    native_ratio=min(redraw.shape[1]/tile['size'][0],redraw.shape[0]/tile['size'][1])
    if native_ratio<.75:raise StitchError(f"第 {index+1} 块补绘原生尺寸不足目标的 75%，拒绝靠大幅插值冒充超分，请降低倍率或使用较小原图")
    affine,metrics=affine_register(original,redraw)
    metrics.update(generated_dimensions=[redraw.shape[1],redraw.shape[0]],target_dimensions=tile['size'],native_resolution_ratio=native_ratio)
    h,w=original.shape[:2];rh,rw=redraw.shape[:2];scale=plan["grid"]
    transform=affine.copy();transform[:,:2]=affine[:,:2]@np.diag([w/rw,h/rh]);transform*=scale
    size=tuple(tile["size"])
    registered=cv2.warpAffine(redraw,transform,size,flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_REFLECT_101)
    valid=cv2.warpAffine(np.full((rh,rw),255,np.uint8),transform,size,flags=cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT,borderValue=0)
    # A small resampling border uses only redrawn pixels, never low-resolution original detail.
    border=cv2.dilate(valid,np.ones((5,5),np.uint8))
    metrics["resampling_border_pixels"]=2
    metrics["target_matrix"]=transform.tolist()
    write_png(folder/"registered"/f"{index}.png",registered)
    write_png(folder/"masks"/f"valid-{index}.png",border)
    save_json(folder/"diagnostics"/f"alignment-{index}.json",metrics)
    return metrics


def color_match(image, reference, mask):
    """Adjust only low spatial frequencies in Lab; AI supplies the high frequencies."""
    lab=cv2.cvtColor(image.astype(np.float32)/255,cv2.COLOR_BGR2LAB)
    baseline=cv2.cvtColor(reference.astype(np.float32)/255,cv2.COLOR_BGR2LAB)
    sigma=max(12,min(image.shape[:2])/18)
    weights=mask.astype(np.float32)/255
    low_weights=np.maximum(cv2.GaussianBlur(weights,(0,0),sigma),1e-4)[:,:,None]
    low_ai=cv2.GaussianBlur(lab*weights[:,:,None],(0,0),sigma)/low_weights
    low_ref=cv2.GaussianBlur(baseline*weights[:,:,None],(0,0),sigma)/low_weights
    delta=np.clip(low_ref-low_ai,np.array([-18,-14,-14],np.float32),np.array([18,14,14],np.float32))
    corrected=cv2.cvtColor(lab+delta,cv2.COLOR_LAB2BGR)
    return np.clip(corrected*255,0,255).astype(np.uint8)


def compose(folder):
    folder=Path(folder);plan=json.loads((folder/"plan.json").read_text());count=len(plan["tiles"])
    for tile in plan["tiles"]:
        i=tile["index"]
        if not (folder/"diagnostics"/f"alignment-{i}.json").exists():
            report(folder,"registration",i,count);register_tile(folder,i)
    for tile in plan["tiles"]:
        i=tile["index"];report(folder,"color",i,count)
        corrected_path=folder/"corrected"/f"{i}.png"
        if not corrected_path.exists():
            image=read_bgr(folder/"registered"/f"{i}.png")
            reference=cv2.resize(read_bgr(folder/"crops"/f"{i}.png"),tuple(tile["size"]),interpolation=cv2.INTER_CUBIC)
            mask=cv2.imread(str(folder/"masks"/f"valid-{i}.png"),cv2.IMREAD_GRAYSCALE)
            write_png(corrected_path,color_match(image,reference,mask))
    report(folder,"color",count,count)
    width,height=plan["output_size"]
    report(folder,"seams")
    # Graph Cut uses downsampled color/gradient costs. Registration stays affine at full resolution.
    seam_scale=min(1,1600/max(width,height));images=[];masks=[];corners=[];seam_sizes=[]
    for tile in plan["tiles"]:
        i=tile["index"];x,y=tile["corner"]
        corner=(round(x*seam_scale),round(y*seam_scale))
        size=(max(1,round((x+tile["size"][0])*seam_scale)-corner[0]),max(1,round((y+tile["size"][1])*seam_scale)-corner[1]))
        image=cv2.resize(read_bgr(folder/"corrected"/f"{i}.png"),size,interpolation=cv2.INTER_AREA)
        mask=cv2.imread(str(folder/"masks"/f"valid-{i}.png"),cv2.IMREAD_GRAYSCALE)
        images.append(cv2.UMat(image.astype(np.float32)));masks.append(cv2.UMat(cv2.resize(mask,size,interpolation=cv2.INTER_NEAREST)))
        corners.append(corner);seam_sizes.append(size)
    finder=cv2.detail_GraphCutSeamFinder("COST_COLOR_GRAD")
    found=finder.find(images,corners,masks)
    if found is not None: masks=found
    for tile,mask in zip(plan["tiles"],masks):
        i=tile["index"];small=mask.get() if hasattr(mask,"get") else mask
        small=cv2.dilate(small,np.ones((3,3),np.uint8))
        seam=cv2.resize(small,tuple(tile["size"]),interpolation=cv2.INTER_NEAREST)
        valid=cv2.imread(str(folder/"masks"/f"valid-{i}.png"),cv2.IMREAD_GRAYSCALE)
        write_png(folder/"masks"/f"seam-{i}.png",cv2.bitwise_and(seam,valid))
    del finder,found,images,masks
    report(folder,"seams",1,1)
    # A halo wider than 2**7 keeps seven-band block boundaries outside each saved core.
    output=np.memmap(folder/"canvas.rgb",dtype=np.uint8,mode="w+",shape=(height,width,3))
    columns=math.ceil(width/BLOCK);rows=math.ceil(height/BLOCK);total=columns*rows;completed=0
    uncovered=0
    for row in range(rows):
        for col in range(columns):
            report(folder,"blend",completed,total)
            x0=col*BLOCK;y0=row*BLOCK;x1=min(width,x0+BLOCK);y1=min(height,y0+BLOCK)
            bx0=max(0,x0-HALO);by0=max(0,y0-HALO);bx1=min(width,x1+HALO);by1=min(height,y1+HALO)
            blender=cv2.detail_MultiBandBlender(0,BANDS);blender.prepare((bx0,by0,bx1-bx0,by1-by0))
            for tile in plan["tiles"]:
                tx,ty=tile["corner"];tw,th=tile["size"];left=max(tx,bx0);top=max(ty,by0);right=min(tx+tw,bx1);bottom=min(ty+th,by1)
                if right<=left or bottom<=top: continue
                i=tile["index"];image=read_bgr(folder/"corrected"/f"{i}.png")[top-ty:bottom-ty,left-tx:right-tx]
                mask=cv2.imread(str(folder/"masks"/f"seam-{i}.png"),cv2.IMREAD_GRAYSCALE)[top-ty:bottom-ty,left-tx:right-tx]
                blender.feed(image.astype(np.int16),mask,(left,top))
            result,coverage=blender.blend(None,None)
            core=result[y0-by0:y1-by0,x0-bx0:x1-bx0]
            core_coverage=coverage[y0-by0:y1-by0,x0-bx0:x1-bx0]
            uncovered+=int(np.count_nonzero(core_coverage==0))
            output[y0:y1,x0:x1]=np.clip(core[:,:,::-1],0,255).astype(np.uint8)
            completed+=1
            del blender,result,coverage,core
    output.flush();report(folder,"blend",completed,total)
    if uncovered: raise StitchError(f"拼接覆盖检查发现 {uncovered} 个空白像素，拒绝发布结果；请重试补绘")
    result=Image.fromarray(output)
    with Image.open(folder/"base.png") as base:
        if "A" in base.getbands(): result.putalpha(base.getchannel("A").resize((width,height),Image.Resampling.LANCZOS))
    result.save(folder/"candidate.png")
    make_inspection(folder,result,plan)
    alignments=[json.loads((folder/'diagnostics'/f"alignment-{tile['index']}.json").read_text()) for tile in plan['tiles']]
    save_json(folder/"diagnostics"/"quality.json",{"coverage_pixels":width*height,"uncovered_pixels":uncovered,"dimensions":[width,height],"bands":BANDS,"seam":"GraphCut/COST_COLOR_GRAD","warp":"one affine per tile","optical_flow":False,"alignments":alignments,"visual_review":"pending"})
    del result,output
    (folder/"canvas.rgb").unlink(missing_ok=True)
    report(folder,"inspection",0,1)


def make_inspection(folder, image, plan):
    width,height=image.size;panel=512
    sheet=Image.new("RGB",(panel*3,(panel+28)*2),"#faf9f6");draw=ImageDraw.Draw(sheet)
    points=[("Subject",width//2,height//2),("Foreground",width//3,height*4//5),("Background",width*4//5,height//5)]
    grid=plan["grid"]
    points.extend((f"Seam {i+1}",round(width*(i+1)/grid),round(height/grid)) for i in range(min(3,grid-1)))
    while len(points)<6: points.append(("Edge",width-256,height-256))
    for i,(title,x,y) in enumerate(points[:6]):
        left=max(0,min(width-panel,x-panel//2));top=max(0,min(height-panel,y-panel//2))
        crop=image.crop((left,top,min(width,left+panel),min(height,top+panel))).convert("RGB")
        sheet.paste(crop,((i%3)*panel,(i//3)*(panel+28)+28));draw.text(((i%3)*panel+8,(i//3)*(panel+28)+6),title,fill="#30372b")
    sheet.save(Path(folder)/"inspection.png")
    preview=image.copy();preview.thumbnail((1400,1400));preview.save(Path(folder)/"overview.png")


def main():
    parser=argparse.ArgumentParser();parser.add_argument("command",choices=("prepare","register","compose"));parser.add_argument("folder",type=Path);parser.add_argument("--factor",type=int,default=4);parser.add_argument("--tile",type=int,default=0)
    args=parser.parse_args()
    try:
        if args.command=="prepare": prepare(args.folder,args.factor)
        elif args.command=="register": register_tile(args.folder,args.tile)
        else: compose(args.folder)
    except (StitchError,cv2.error,OSError,ValueError) as error:
        print(json.dumps({"error":str(error)},ensure_ascii=False),flush=True);raise SystemExit(1)


if __name__=="__main__": main()
