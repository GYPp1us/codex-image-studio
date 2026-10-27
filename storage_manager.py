"""Workspace accounting and bounded file operations; no database or UI imports."""
from __future__ import annotations

import contextlib
import os
import shutil
import threading
import time
from pathlib import Path
from stat import S_ISREG,S_ISLNK


class StorageFull(RuntimeError):
    pass


def tree_bytes(path,seen=None):
    seen=seen if seen is not None else set()
    path=Path(path)
    try:metadata=path.lstat()
    except OSError:return 0
    if S_ISLNK(metadata.st_mode):return 0
    if S_ISREG(metadata.st_mode):
        identity=(metadata.st_dev,metadata.st_ino)
        if identity in seen:return 0
        seen.add(identity);return metadata.st_size
    total=0
    for root,dirs,files in os.walk(path,followlinks=False):
        dirs[:]=[d for d in dirs if not (Path(root)/d).is_symlink()]
        for name in files:
            item=Path(root)/name
            with contextlib.suppress(FileNotFoundError,PermissionError):
                if not item.is_symlink():
                    stat=item.stat();identity=(stat.st_dev,stat.st_ino)
                    if identity not in seen:total+=stat.st_size;seen.add(identity)
    return total


class Storage:
    def __init__(self,root,get_limit):
        self.root=Path(root).resolve();self.get_limit=get_limit
        self.lock=threading.RLock();self._cached=None;self._time=0

    def invalidate(self):self._cached=None

    def usage(self,fresh=False):
        with self.lock:
            if not fresh and self._cached and time.monotonic()-self._time<5:
                return {**self._cached,'limit_bytes':self.get_limit()}
            seen=set();groups={name:tree_bytes(self.root/name,seen) for name in ('assets','thumbs','previews','jobs','tmp')}
            groups['database']=sum(tree_bytes(self.root/name) for name in ('studio.sqlite3','studio.sqlite3-wal','studio.sqlite3-shm'))
            groups['runtime_images']=tree_bytes(self.root/'codex'/'generated_images',seen)
            total=sum(groups.values());free=shutil.disk_usage(self.root).free
            value={'bytes':total,'limit_bytes':self.get_limit(),'free_bytes':free,'groups':groups}
            self._cached=value;self._time=time.monotonic()
            return value

    def require(self,additional=0,reason='保存图片'):
        with self.lock:
            value=self.usage(True);limit=value['limit_bytes']
            if limit and value['bytes']+additional>limit:
                raise StorageFull(f'存储限额不足，无法{reason}。请清空回收站、清理任务缓存或调整存储上限。')
            if additional>value['free_bytes']:
                raise StorageFull(f'磁盘可用空间不足，无法{reason}')

    def inside(self,path):
        resolved=Path(path).resolve()
        if resolved==self.root or not resolved.is_relative_to(self.root):
            raise ValueError('拒绝操作存储目录之外的路径')
        return resolved

    def remove(self,path):
        path=Path(path)
        if path.is_symlink():
            # Never follow directory symlinks during recursive cleanup.
            self.inside(path.parent);path.unlink();self.invalidate();return 0
        resolved=self.inside(path);size=tree_bytes(resolved)
        if resolved.is_dir():shutil.rmtree(resolved)
        elif resolved.exists():resolved.unlink()
        self.invalidate();return size
