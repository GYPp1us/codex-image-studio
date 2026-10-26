"""Rectangular edits: contextual AI crop, then an exactly bounded composition."""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageOps


def context_box(size, region):
    x,y,w,h=(region[k] for k in ('x','y','width','height'))
    if min(w,h)<16 or min(x,y)<0 or x+w>size[0] or y+h>size[1]:
        raise ValueError('选区必须位于原图内，且宽高至少为 16 像素')
    padding=max(32,min(128,round(max(w,h)*.15)))
    return (max(0,x-padding),max(0,y-padding),min(size[0],x+w+padding),min(size[1],y+h+padding))


def prepare(source, folder, region, prompt):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
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
    with Image.open(source) as original,Image.open(generated) as redraw:
        box=context_box(original.size,region)
        mode='RGBA' if 'A' in original.getbands() else 'RGB'
        result=original.convert(mode)
        patch=ImageOps.fit(redraw.convert(mode),(box[2]-box[0],box[3]-box[1]),Image.Resampling.LANCZOS)
        x,y,w,h=(region[k] for k in ('x','y','width','height'))
        patch=patch.crop((x-box[0],y-box[1],x-box[0]+w,y-box[1]+h))
        # Feather inward only. No operation touches any pixel outside the rectangle.
        mask=Image.new('L',(w,h),255);draw=ImageDraw.Draw(mask)
        feather=min(8,max(1,min(w,h)//8))
        for inset in range(feather):
            draw.rectangle((inset,inset,w-inset-1,h-inset-1),outline=round(255*(inset+1)/(feather+1)))
        selected=Image.composite(patch,result.crop((x,y,x+w,y+h)),mask)
        result.paste(selected,(x,y));result.save(destination,'PNG')
    return Path(destination)
