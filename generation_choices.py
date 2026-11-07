"""Shared value domains for generation defaults, requests and pinned settings."""
from typing import Literal

AspectRatio = Literal['1:1', '3:2', '2:3', '16:9', '9:16', 'auto']
ImageSize = Literal['auto', '1024', '2048', '4096']
UpscaleFactor = Literal[0, 4, 16, 64]
