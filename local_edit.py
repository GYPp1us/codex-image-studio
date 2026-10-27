"""Rectangular edits: contextual AI crop, then an exactly bounded composition."""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageOps
import image_runtime as imaging


def context_box(size, region):
    x,y,w,h=(region[k] for k in ('x','y','width','height'))
    if min(w,h)<16 or min(x,y)<0 or x+w>size[0] or y+h>size[1]:
        raise ValueError('选区必须位于原图内，且宽高至少为 16 像素')
    padding=max(32,min(128,round(max(w,h)*.15)))
    return (max(0,x-padding),max(0,y-padding),min(size[0],x+w+padding),min(size[1],y+h+padding))


def prepare(source, folder, region, prompt):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    measured=imaging.info(source)
    if measured['width']*measured['height']>16_000_000:
        box=context_box((measured['width'],measured['height']),region)
        image=imaging.open_image(source).crop(box[0],box[1],box[2]-box[0],box[3]-box[1])
        preview=image.thumbnail_image(1600,height=1600,size='down')
        preview.pngsave(str(folder/'local-context.png'),compression=2,strip=True)
        imaging.thumbnail(source,folder/'local-full.png',1600)
        mask=Image.new('RGB',(preview.width,preview.height),'black')
        x,y,w,h=(region[k] for k in ('x','y','width','height'));sx,sy=preview.width/image.width,preview.height/image.height
        ImageDraw.Draw(mask).rectangle((round((x-box[0])*sx),round((y-box[1])*sy),max(0,round((x-box[0]+w)*sx)-1),max(0,round((y-box[1]+h)*sy)-1)),fill='white')
        mask.save(folder/'local-selection.png')
        instruction=f'编辑 reference-1.png，仅修改 reference-3.png 白色矩形对应区域，黑色区域保持原样。reference-2.png 只作整图构图参考。保持画幅和边界，只输出编辑后的裁图，不输出整图、示意图或边框。修改要求：\n{prompt}'
        return instruction,[folder/'local-context.png',folder/'local-full.png',folder/'local-selection.png'],(preview.width,preview.height)
    with Image.open(source) as original:
        box=context_box(original.size,region)
        crop=original.crop(box);crop.save(folder/'local-context.png')
        x,y,w,h=(region[k] for k in ('x','y','width','height'))
        local=(x-box[0],y-box[1],x-box[0]+w,y-box[1]+h)
        mask=Image.new('RGB',crop.size,'black')
        ImageDraw.Draw(mask).rectangle((local[0],local[1],local[2]-1,local[3]-1),fill='white')
        mask.save(folder/'local-selection.png')
    instruction=f'''编辑 reference-1.png，输出与它相同画幅的 {crop.width}×{crop.height} 像素图像。
reference-2.png 是完整原图，仅供理解周围画面和保持风格、光照、透视一致。
reference-3.png 是选区示意图：只修改白色矩形内的内容，黑色部分保持原样。示意图不是画面内容，不要把黑白色块或选框画入结果。
修改要求：
{prompt}
保留原有画面边界及未要求改变的内容，让修改自然衔接周围画面。只输出编辑后的 reference-1.png，不输出完整原图、示意图、边框或对比拼图。'''
    return instruction,[folder/'local-context.png',Path(source),folder/'local-selection.png'],(crop.width,crop.height)


def compose(source, generated, region, destination):
    measured=imaging.info(source)
    if measured['width']*measured['height']>16_000_000:
        base=imaging.rgb(imaging.open_image(source));redraw=imaging.rgb(imaging.open_image(generated))
        box=context_box((base.width,base.height),region);cw,ch=box[2]-box[0],box[3]-box[1]
        if base.hasalpha() and not redraw.hasalpha():redraw=redraw.bandjoin(255)
        elif not base.hasalpha() and redraw.hasalpha():redraw=redraw[:3]
        ratio=max(cw/redraw.width,ch/redraw.height)
        patch=redraw.resize(ratio,kernel='lanczos3')
        if patch.width<cw or patch.height<ch:patch=patch.embed(0,0,max(cw,patch.width),max(ch,patch.height),extend='copy')
        patch=patch.crop((patch.width-cw)//2,(patch.height-ch)//2,cw,ch)
        x,y,w,h=(region[k] for k in ('x','y','width','height'))
        patch=patch.crop(x-box[0],y-box[1],w,h);original=base.crop(x,y,w,h)
        xy=imaging.pyvips.Image.xyz(w,h);xx,yy=xy[0],xy[1];feather=min(8,max(1,min(w,h)//8))
        weight=xx.new_from_image(1).cast('float')
        distances=[]
        if x>0:distances.append((xx+1)/(feather+1))
        if x+w<base.width:distances.append((w-xx)/(feather+1))
        if y>0:distances.append((yy+1)/(feather+1))
        if y+h<base.height:distances.append((h-yy)/(feather+1))
        for distance in distances:weight=(distance<weight).ifthenelse(distance,weight)
        selected=(patch*weight+original*(1-weight)).rint().cast('uchar')
        base.insert(selected,x,y,expand=False).pngsave(str(destination),compression=2,strip=True)
        return Path(destination)
    with Image.open(source) as original,Image.open(generated) as redraw:
        box=context_box(original.size,region)
        mode='RGBA' if 'A' in original.getbands() else 'RGB'
        result=original.convert(mode)
        patch=ImageOps.fit(redraw.convert(mode),(box[2]-box[0],box[3]-box[1]),Image.Resampling.LANCZOS)
        x,y,w,h=(region[k] for k in ('x','y','width','height'))
        patch=patch.crop((x-box[0],y-box[1],x-box[0]+w,y-box[1]+h))
        # Feather inward only. No operation touches any pixel outside the rectangle.
        horizontal=Image.new('L',(w,1),255);vertical=Image.new('L',(1,h),255)
        dx=ImageDraw.Draw(horizontal);dy=ImageDraw.Draw(vertical)
        feather=min(8,max(1,min(w,h)//8))
        for inset in range(feather):
            value=round(255*(inset+1)/(feather+1))
            if x>0:dx.point((inset,0),fill=value)
            if x+w<original.width:dx.point((w-inset-1,0),fill=value)
            if y>0:dy.point((0,inset),fill=value)
            if y+h<original.height:dy.point((0,h-inset-1),fill=value)
        mask=ImageChops.darker(horizontal.resize((w,h)),vertical.resize((w,h)))
        selected=Image.composite(patch,result.crop((x,y,x+w,y+h)),mask)
        result.paste(selected,(x,y));result.save(destination,'PNG')
    return Path(destination)
