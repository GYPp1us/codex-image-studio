"""Connection settings for a user-configured, OpenAI-compatible image API."""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import re
import socket
import time
from dataclasses import asdict, dataclass, field
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse


SETTING = 'image_api'
MODEL = 'gpt-image-2'
QUALITY = ('auto', 'low', 'medium', 'high')
NETWORK_ERROR = '无法连接供应商，请检查 API 地址、证书和服务器网络'
ADDRESS_ERROR = '请输入使用公网 HTTPS 的 API 地址'
MAX_MODELS_RESPONSE = 1024 * 1024


@dataclass(frozen=True)
class ImageProvider:
    base_url: str
    model: str
    api_key: str = field(repr=False)

    @property
    def destination(self):
        return hashlib.sha256(self.base_url.encode()).hexdigest()


def configured(studio):
    value = studio.setting(SETTING, None)
    return ImageProvider(**value) if value else None


def public_settings(provider):
    return {'configured': bool(provider), 'base_url': provider.base_url if provider else '',
            'model': provider.model if provider else MODEL}


def parse_profile(body, current=None):
    address, model, key = (body.get(name, '') for name in ('base_url', 'model', 'api_key'))
    if not all(isinstance(value, str) for value in (address, model, key)):
        raise ValueError('请检查 API 地址、模型 ID 和密钥')
    address, model, key = address.strip(), model.strip(), key.strip()
    try:
        parts = urlsplit(address)
        url = httpx.URL(address)
        path = parts.path.rstrip('/')
        if (len(address) > 500 or not re.fullmatch(r'https://[^/?#]+(?:/[^?#]*)?', address, re.IGNORECASE)
                or any(not 33 <= ord(c) <= 126 for c in address) or '\\' in address or '@' in parts.netloc
                or not re.fullmatch(r'(?:/[a-zA-Z0-9._~-]+)*', path)
                or any(segment in ('.', '..') for segment in path.split('/'))):
            raise ValueError()
        validate_host(url)
        address = str(url.copy_with(path=path or '/v1'))
    except (httpx.InvalidURL, ValueError) as error:
        raise ValueError(ADDRESS_ERROR) from error
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}', model):
        raise ValueError('请输入有效的供应商模型 ID')
    if not key and current and address == current.base_url:
        key = current.api_key
    if not re.fullmatch(r'[!-~]{1,2048}', key):
        raise ValueError('请输入供应商的 API 密钥。更换地址时需重新填写')
    return ImageProvider(address, model, key)


def public_ip(host):
    addr = ipaddress.ip_address(host)
    if not addr.is_global or addr.is_multicast:
        return False
    if addr.version == 6:
        # Use global unicast, excluding transition addresses that can map to private IPv4.
        return addr in ipaddress.IPv6Network('2000::/3') and addr.sixtofour is None and addr.teredo is None
    return True


def validate_host(url):
    host = url.raw_host.decode('ascii')
    if url.scheme != 'https' or not host or url.username or url.password or url.port == 0:
        raise ValueError(ADDRESS_ERROR)
    if ':' in host or re.fullmatch(r'[0-9.]+', host):
        if not public_ip(host):
            raise ValueError(ADDRESS_ERROR)
    elif not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?', host):
        raise ValueError(ADDRESS_ERROR)
    return host


async def public_target(url):
    """Connect to the validated IP while verifying TLS for the supplied hostname."""
    url = httpx.URL(url)
    host = validate_host(url)
    try:
        async with asyncio.timeout(5):
            records = await asyncio.get_running_loop().getaddrinfo(host, url.port or 443, type=socket.SOCK_STREAM)
    except (OSError, TimeoutError):
        raise httpx.ConnectError(NETWORK_ERROR) from None
    addresses = {row[4][0] for row in records}
    if not addresses or not all(public_ip(address) for address in addresses):
        raise ValueError(ADDRESS_ERROR)
    # Prefer IPv4 when available. The URL handed to the client contains no hostname to re-resolve.
    address = min(addresses, key=lambda value: (':' in value, value))
    return url.copy_with(host=address), {'Host': url.netloc.decode('ascii')}, {'sni_hostname': host}


async def probe(provider):
    started = time.monotonic()
    try:
        async with asyncio.timeout(12):
            url, headers, extensions = await public_target(provider.base_url + '/models')
            headers.update(Authorization='Bearer ' + provider.api_key, Accept='application/json')
            async with httpx.AsyncClient(trust_env=False, follow_redirects=False) as client:
                async with client.stream('GET', url, headers=headers, extensions=extensions) as response:
                    status = response.status_code
                    if status in (401, 403):
                        return {'status': 'failed', 'message': '供应商拒绝访问，请检查 API 密钥或权限'}
                    if status in (404, 405):
                        return {'status': 'unverified', 'message': '已连接到服务器。此地址未提供模型目录，请核对 API 地址'}
                    if not response.is_success:
                        return {'status': 'failed', 'message': f'供应商返回 HTTP {status}'}
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > MAX_MODELS_RESPONSE:
                            raise ValueError('供应商的模型目录过大')
                    data = json.loads(content)
                    models = data.get('data') if isinstance(data, dict) else None
                    if not isinstance(models, list):
                        raise ValueError('供应商未返回兼容的模型目录，请核对 API 地址')
                    listed = any(isinstance(row, dict) and row.get('id') == provider.model for row in models)
    except (httpx.HTTPError, TimeoutError):
        return {'status': 'failed', 'message': NETWORK_ERROR}
    except (json.JSONDecodeError, UnicodeDecodeError, RecursionError):
        return {'status': 'failed', 'message': '供应商未返回有效的模型目录'}
    except ValueError as error:
        return {'status': 'failed', 'message': str(error)}
    return {'status': 'ok' if listed else 'unverified', 'elapsed_ms': round((time.monotonic() - started) * 1000),
            'message': '连接成功，模型已在目录中找到' if listed else '连接成功，目录中未找到此模型 ID'}


def register(app, studio):
    def connection_response(provider):
        return JSONResponse(public_settings(provider), headers={'Cache-Control': 'no-store'})

    async def read_profile(request):
        # Parse here so validation failures never reflect a submitted secret in a FastAPI error body.
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > 8192:
                raise HTTPException(413, '配置内容过长')
        try:
            body = json.loads(content)
            if not isinstance(body, dict):
                raise ValueError()
        except (ValueError, RecursionError):
            raise HTTPException(400, '配置格式无效') from None
        try:
            return parse_profile(body, configured(studio))
        except ValueError as error:
            raise HTTPException(400, str(error)) from None

    @app.put('/api/settings/image-api')
    async def save(request: Request, session=Depends(studio.require_user)):
        provider = await read_profile(request)
        studio.set_setting(SETTING, asdict(provider))
        return connection_response(provider)

    @app.post('/api/settings/image-api/test')
    async def test_connection(request: Request, session=Depends(studio.require_user)):
        provider = await read_profile(request)
        return JSONResponse(await probe(provider), headers={'Cache-Control': 'no-store'})

    @app.delete('/api/settings/image-api')
    def disconnect(session=Depends(studio.require_user)):
        studio.set_setting(SETTING, None)
        return connection_response(None)
