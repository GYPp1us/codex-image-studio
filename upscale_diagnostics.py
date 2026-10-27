"""Bounded, deterministic failure previews. Never accepts or publishes AI outputs."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import image_runtime as imaging
from stitch_engine import estimate_affine, registration_mask, save_json,read_bgr

ARTIFACTS=('source','raw','affine','top','center-raw','center-affine')


def fingerprint(folder):
    folder=Path(folder);digest=hashlib.sha256(b'failure-preview-v2')
    paths=[folder/'plan.json',folder/'base.png',*sorted((folder/'redraw').glob('*.png')),
           *sorted((folder/'diagnostics').glob('alignment*.json'))]
    for path in paths:
        if path.exists():
            stat=path.stat();digest.update(f'{path.name}:{stat.st_size}:{stat.st_mtime_ns}'.encode())
    return digest.hexdigest()[:20]


def preview_array(path,width,height):
    source=imaging.rgb(imaging.open_image(path))
    image=source.resize(width/source.width,vscale=height/source.height,kernel='lanczos3')
    return np.array(imaging.to_pil(image).convert('RGB'))[:,:,::-1].copy()


def render(folder):
    folder=Path(folder);version=fingerprint(folder);destination=folder/'diagnostics'/'failure-preview'/version
    if (destination/'report.json').is_file():return json.loads((destination/'report.json').read_text(encoding='utf-8'))
    destination.mkdir(parents=True,exist_ok=True)
    plan=json.loads((folder/'plan.json').read_text(encoding='utf-8'));ow,oh=plan['output_size']
    scale=min(1,1200/ow,1600/oh);pw,ph=max(1,round(ow*scale)),max(1,round(oh*scale))
    original=imaging.open_image(folder/'base.png')
    original=imaging.to_pil(original.resize(pw/original.width,vscale=ph/original.height)).convert('RGB')
    yy,xx=np.indices((ph,pw));checker=((xx//12+yy//12)%2)[:,:,None]
    raw=np.broadcast_to(np.where(checker,222,242),(ph,pw,3)).astype('uint8').copy();aligned=raw.copy();tiles=[]
    for tile in plan['tiles']:
        i=tile['index'];x0,y0,x1,y1=[round(v*2*scale) for v in tile['core']]
        record={'index':i,'number':i+1,'core':tile['core'],'state':'missing','reason':'此块尚未返回','missing_core_pixels':0}
        path=folder/'redraw'/f'{i}.png'
        if not path.is_file():tiles.append(record);continue
        try:
            measured=imaging.info(path);rw,rh=measured['width'],measured['height'];record['actual_size']=[rw,rh]
            bx,by,ex,ey=tile['box'];w,h=ex-bx,ey-by
            native_return=rw*rh<=16_000_000
            proxy=read_bgr(path) if native_return else preview_array(path,w,h)
            crop=read_bgr(folder/'crops'/f'{i}.png')
            tw,th=tile['size'];tx,ty=tile['corner']
            local=[v*2 for v in tile['core']];sx,sy=local[0]-tx,local[1]-ty
            cw,ch=local[2]-local[0],local[3]-local[1]
            # Direct placement uses only the tile's disjoint core.
            direct=cv2.resize(proxy,(tw,th),interpolation=cv2.INTER_LINEAR)[sy:sy+ch,sx:sx+cw]
            raw[y0:y1,x0:x1]=cv2.resize(direct,(x1-x0,y1-y0),interpolation=cv2.INTER_AREA)[:,:,::-1]
            a,metrics=estimate_affine(crop,proxy)
            # A current accepted/rejected checkpoint is authoritative for the diagnostic.
            for name in (f'alignment-{i}.json',f'alignment-rejected-{i}.json'):
                cached=folder/'diagnostics'/name
                if cached.exists() and cached.stat().st_mtime_ns>=path.stat().st_mtime_ns:
                    saved=json.loads(cached.read_text(encoding='utf-8'))
                    if saved.get('generated_dimensions')==[rw,rh] and 'matrix' in saved:
                        a=np.array(saved['matrix']);metrics=saved
                        singular=np.linalg.svd(a[:,:2],compute_uv=False)
                        metrics['accepted']=saved.get('inliers',0)>=8 and saved.get('inlier_ratio',0)>=.25 and saved.get('rms_original_pixels',999)<=2.5 and min(singular)>=.75 and max(singular)<=1.25 and np.linalg.det(a[:,:2])>0 and saved.get('feature_spread',0)>=.035
            transform=a.copy();transform*=2
            if native_return:transform[:,:2]=transform[:,:2]@np.diag([w/rw,h/rh])
            # Both arrays are bounded to the planned crop, irrespective of native return dimensions.
            warped=cv2.warpAffine(proxy,transform,(tw,th),flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_REFLECT_101)
            if rw*rh<=16_000_000:
                native_transform=transform
                valid=cv2.warpAffine(np.full((rh,rw),255,np.uint8),native_transform,(tw,th),flags=cv2.INTER_NEAREST)
            else:valid=cv2.warpAffine(np.full((h,w),255,np.uint8),transform,(tw,th),flags=cv2.INTER_NEAREST)
            mask,_=registration_mask(valid,tile,plan);missing=mask[sy:sy+ch,sx:sx+cw]==0
            native=warped[sy:sy+ch,sx:sx+cw,::-1].copy();my,mx=np.indices(missing.shape);pattern=((mx+my)//12)%2==0
            native[missing&pattern]=[224,51,66];native[missing&~pattern]=[255,186,183]
            aligned[y0:y1,x0:x1]=cv2.resize(native,(x1-x0,y1-y0),interpolation=cv2.INTER_AREA)
            count=int(missing.sum());state='untrusted' if not metrics['accepted'] else 'coverage' if count else 'ready'
            reason=f'特征内点比例 {metrics["inlier_ratio"]:.0%}，匹配不足' if state=='untrusted' else f'配准后核心缺失 {count:,} 像素' if count else '几何检查通过，仍需融合与验收'
            record.update(state=state,reason=reason,missing_core_pixels=count,inlier_ratio=metrics['inlier_ratio'])
        except Exception as error:record.update(state='untrusted',reason=str(error)[:400])
        tiles.append(record)
    images={'source':original,'raw':Image.fromarray(raw),'affine':Image.fromarray(aligned)}
    images['top']=images['affine'].crop((0,0,pw,max(1,min(ph,round(ph*.1)))))
    cx,cy=pw//2,ph//2;dx,dy=min(240,max(1,pw//3)),min(200,max(1,ph//3))
    for key in ('raw','affine'):images['center-'+key]=images[key].crop((max(0,cx-dx),max(0,cy-dy),min(pw,cx+dx),min(ph,cy+dy)))
    for key,image in images.items():image.save(destination/(key+'.webp'),'WEBP',quality=90)
    report={'version':version,'input_size':[plan['width'],plan['height']],'output_size':[ow,oh],
            'preview_size':[pw,ph],'tiles':tiles,'diagnostic_only':True}
    save_json(destination/'report.json',report)
    return report


def invalidate(folder,indices,repair_id):
    """Archive selected AI returns before invalidating only their derived checkpoints."""
    folder=Path(folder);history=folder/'repairs'/repair_id
    history.mkdir(parents=True,exist_ok=True)
    for index in indices:
        source=folder/'redraw'/f'{index}.png'
        if source.exists():
            destination=history/f'{index}.png'
            try:destination.hardlink_to(source)
            except OSError:
                import shutil
                shutil.copyfile(source,destination)
            source.unlink()
        for sub,name in [('registered',f'{index}.png'),('corrected',f'{index}.png'),('masks',f'valid-{index}.png'),
                         ('masks',f'seam-{index}.png'),('diagnostics',f'alignment-{index}.json'),
                         ('diagnostics',f'alignment-rejected-{index}.json'),('diagnostics',f'return-{index}.json')]:
            (folder/sub/name).unlink(missing_ok=True)
    for name in ('candidate.png','inspection.png','overview.png','canvas.rgb','diagnostics/quality.json','diagnostics/visual-review.json'):
        (folder/name).unlink(missing_ok=True)
