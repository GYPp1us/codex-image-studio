"""Content-addressed public workspace shell. Account data comes from the API."""
import base64
import gzip
import hashlib
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from fastapi import Request, Response


SCRIPTS = re.compile(r'<script src="/static/([\w.-]+\.js)\?[^"]+"(?: defer)?></script>')
STYLES = re.compile(r'<link rel="stylesheet" href="/static/([\w.-]+\.css)\?[^"]+">')


@dataclass(frozen=True)
class Asset:
    content: bytes
    compressed: bytes
    media_type: str

    @classmethod
    def create(cls, content: str, media_type: str):
        raw = content.encode()
        return cls(raw, gzip.compress(raw, compresslevel=6, mtime=0), media_type)

    def response(self, request: Request, **headers):
        encodings = {}
        for item in request.headers.get("accept-encoding", "").lower().split(","):
            coding, _, parameters = item.strip().partition(";")
            try:
                encodings[coding] = float(parameters.strip().removeprefix("q=")) if parameters else 1
            except ValueError:
                encodings[coding] = 0
        body = self.content
        headers["Vary"] = "Accept-Encoding"
        if encodings.get("gzip", encodings.get("*", 0)) > 0:
            body = self.compressed
            headers["Content-Encoding"] = "gzip"
        headers["Content-Length"] = str(len(body))
        return Response(b"" if request.method == "HEAD" else body, media_type=self.media_type, headers=headers)


@dataclass(frozen=True)
class Shell:
    version: str
    inline_csp: str
    html: Asset
    assets: dict[str, Asset]


@cache
def build(static: Path) -> Shell:
    html = (static / "index.html").read_text(encoding="utf-8")
    def read(name):
        return (static / name).read_text(encoding="utf-8")

    # Keep the theme synchronous and start session verification while bundles download.
    early = read("workspace-start.js") + "\n" + read("studio-theme.js")
    inline_csp = base64.b64encode(hashlib.sha256(early.encode()).digest()).decode()
    scripts = ";\n".join(read(name) for name in SCRIPTS.findall(html) if name != "studio-theme.js")
    styles = "\n".join(read(name) for name in STYLES.findall(html))
    fingerprint = hashlib.sha256()
    for part in (html, early, styles, scripts):
        fingerprint.update(hashlib.sha256(part.encode()).digest())
    version = fingerprint.hexdigest()[:24]
    html = SCRIPTS.sub("", STYLES.sub("", html))
    additions = (
        f'<meta name="studio-shell-version" content="{version}">\n'
        f'<script>{early}</script>\n'
        f'<link rel="stylesheet" href="/studio-shell/{version}.css">\n'
        f'<script src="/studio-shell/{version}.js" defer></script>\n'
    )
    html = html.replace("</head>", additions + "</head>", 1)
    return Shell(version, inline_csp, Asset.create(html, "text/html"), {
        "css": Asset.create(styles, "text/css"),
        "js": Asset.create(scripts, "text/javascript"),
    })
