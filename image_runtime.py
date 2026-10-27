"""Streaming image I/O and measured tool-return contracts, independent of jobs/UI."""
from __future__ import annotations

import hashlib
import math
import os
from dataclasses import asdict, dataclass
from pathlib import Path

os.environ.setdefault('VIPS_CONCURRENCY','2')
os.environ.setdefault('VIPS_DISC_THRESHOLD','64m')
import pyvips
from PIL import Image

Image.MAX_IMAGE_PIXELS=None
pyvips.cache_set_max_mem(64*1024*1024)
pyvips.cache_set_max(0)  # Release file handles after a pipeline, including on Windows.


def info(path):
    with Image.open(path) as image:
        if image.format not in ('PNG','JPEG','WEBP','TIFF'):
            raise ValueError('请使用 PNG、JPEG、WebP 或 TIFF 图片')
        return {'width':image.width,'height':image.height,'format':image.format,
                'alpha':'A' in image.getbands() or 'transparency' in image.info}


def open_image(path,access='random'):
    kind=info(path)['format']
    options={'access':access,'fail_on':'error'}
    if kind in ('PNG','TIFF'):options['unlimited']=True
    return pyvips.Image.new_from_file(str(path),**options)


def rgb(image):
    image=image.colourspace('srgb') if image.interpretation!='srgb' else image
    return image.cast('uchar')


def normalize(source,destination):
    image=rgb(open_image(source,'sequential').autorot())
    image.pngsave(str(destination),compression=2,strip=True)
    return info(destination)


def thumbnail(source,destination,edge=1600):
    image=rgb(open_image(source,'sequential').autorot())
    image=image.thumbnail_image(edge,height=edge,size='down')
    if str(destination).lower().endswith('.png'):image.pngsave(str(destination),compression=2,strip=True)
    else:image.webpsave(str(destination),Q=85,strip=True)
    return [image.width,image.height]


def crop(source,box,destination):
    x0,y0,x1,y1=box
    rgb(open_image(source).crop(x0,y0,x1-x0,y1-y0)).pngsave(str(destination),compression=2,strip=True)


def to_pil(image):
    image=rgb(image)
    mode='RGBA' if image.hasalpha() else 'RGB'
    return Image.frombytes(mode,(image.width,image.height),image.write_to_memory())


def file_sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


def pyramid(source,folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    image=rgb(open_image(source,'sequential'))
    image.dzsave(str(folder/'image'),tile_size=512,overlap=0,suffix='.webp[Q=85]',depth='onepixel',skip_blanks=-1)
    return {'width':image.width,'height':image.height,'tile_size':512,
            'max_level':math.ceil(math.log2(max(image.width,image.height)))}


def raw_to_png(raw,destination,width,height,alpha_source=None):
    image=pyvips.Image.rawload(str(raw),width,height,3,format='uchar',access='sequential').copy(interpretation='srgb')
    if alpha_source:
        base=open_image(alpha_source,'sequential')
        if base.hasalpha():
            alpha=base[-1].resize(width/base.width,vscale=height/base.height,kernel='lanczos3')
            image=image.bandjoin(alpha)
    image.pngsave(str(destination),compression=2,strip=True)


@dataclass(frozen=True)
class ReturnedImage:
    requested: tuple[int,int]
    actual: tuple[int,int]
    bytes: int
    aspect_error: float
    native_ratio: float
    decision: str
    reason: str

    def json(self):return asdict(self)


def assess_return(path,requested,min_native_ratio=.95,max_aspect_error=.08):
    measured=info(path);w,h=measured['width'],measured['height'];tw,th=requested
    aspect=abs(math.log((w/h)/(tw/th)))
    native=min(w/tw,h/th)
    if aspect>math.log1p(max_aspect_error):
        decision,reason='retry','返回画幅与本块要求不符，不能靠拉伸修正'
    elif native<min_native_ratio:
        decision,reason='split','返回原生像素不足，保留其它块并细分本块'
    else:decision,reason='accept','以实际返回尺寸做一次仿射映射'
    return ReturnedImage(tuple(requested),(w,h),Path(path).stat().st_size,aspect,native,decision,reason)
