"""Bounded account portraits, separate from reference assets and model inputs."""
from __future__ import annotations

import asyncio
import io
import re

from fastapi import Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD = 12 * 1024 * 1024


def avatar_path(studio, revision):
    return studio.DATA / 'thumbs' / f'avatar-{revision}.webp' if re.fullmatch(r'[a-f0-9]{32}', str(revision)) else None


def avatar_url(studio):
    revision = studio.setting('avatar_revision', '')
    path = avatar_path(studio, revision)
    return f'/api/account/avatar?v={revision}' if path and path.is_file() else ''


def save_avatar(studio, content):
    try:
        with Image.open(io.BytesIO(content)) as source:
            if source.format not in ('PNG', 'JPEG', 'WEBP') or source.width * source.height > 40_000_000:
                raise HTTPException(400, '头像请使用 4000 万像素以内的 PNG、JPEG 或 WebP 图片')
            image = ImageOps.fit(ImageOps.exif_transpose(source).convert('RGBA'), (512, 512), method=Image.Resampling.LANCZOS)
            encoded = io.BytesIO()
            image.save(encoded, 'WEBP', quality=92)
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(400, '无法读取头像，请重新选择有效图片') from error
    with studio.STORAGE.lock:
        studio.STORAGE.require(len(encoded.getvalue()), '保存头像')
        revision = studio.uid()
        path = avatar_path(studio, revision)
        previous = avatar_path(studio, studio.setting('avatar_revision', ''))
        try:
            path.write_bytes(encoded.getvalue())
            studio.set_setting('avatar_revision', revision)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        if previous:
            previous.unlink(missing_ok=True)
        studio.STORAGE.invalidate()
    return {'avatar_url': avatar_url(studio)}


def register(app, studio):
    @app.get('/api/account/avatar')
    def portrait(session=Depends(studio.require_user)):
        path = avatar_path(studio, studio.setting('avatar_revision', ''))
        if not path or not path.is_file():
            raise HTTPException(404, '尚未设置头像')
        return FileResponse(path, media_type='image/webp')

    @app.post('/api/account/avatar')
    async def upload(file: UploadFile = File(...), session=Depends(studio.require_user)):
        content = bytearray()
        try:
            while chunk := await file.read(1024 * 1024):
                if len(content) + len(chunk) > MAX_UPLOAD:
                    raise HTTPException(413, '头像文件不能超过 12 MB')
                content.extend(chunk)
            return await asyncio.to_thread(save_avatar, studio, content)
        finally:
            await file.close()

    @app.delete('/api/account/avatar')
    def remove(session=Depends(studio.require_user)):
        with studio.STORAGE.lock:
            previous = avatar_path(studio, studio.setting('avatar_revision', ''))
            studio.set_setting('avatar_revision', '')
            if previous:
                previous.unlink(missing_ok=True)
            studio.STORAGE.invalidate()
        return {'avatar_url': ''}
