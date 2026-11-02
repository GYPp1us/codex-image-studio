from __future__ import annotations

import asyncio
import base64
import binascii
import inspect
import io
import json
import math
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx
from PIL import Image, UnidentifiedImageError

BASE = 'https://chatgpt.com/backend-api/codex/'
MAX_IMAGE = 64 * 1024 * 1024
MAX_RESPONSE = 96 * 1024 * 1024
MAX_EVENT = 90 * 1024 * 1024
MAX_REFERENCE_COUNT = 5
MAX_REFERENCE_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_DIMENSION = 16384

class BackendError(Exception):
    def __init__(self, code: str, *, safe_fallback: bool = False, ambiguous: bool = False, retryable: bool = False):
        super().__init__(code)
        self.code, self.safe_fallback, self.ambiguous, self.retryable = code, safe_fallback, ambiguous, retryable

@dataclass(frozen=True)
class ImageRequest:
    prompt: str
    image_model: str = 'gpt-image-2'
    size: str = 'auto'
    quality: str = 'auto'
    background: str = 'auto'
    reference_paths: tuple = ()
    transport: str = 'images'
    response_model: str | None = None
    effort: str | None = None
    partial_images: int = 2

@dataclass
class BackendResult:
    output_path: Path
    requested: dict = field(default_factory=dict)
    provider_reported: dict = field(default_factory=dict)
    actual_image: dict = field(default_factory=dict)
    usage: dict = field(default_factory=dict)
    ids: dict = field(default_factory=dict)
    revised_prompt: str | None = None

@dataclass
class PolishResult:
    text: str
    requested: dict = field(default_factory=dict)
    provider_reported: dict = field(default_factory=dict)
    usage: dict = field(default_factory=dict)
    ids: dict = field(default_factory=dict)

def _error(code, **kwargs):
    return BackendError(code, **kwargs)

def _image(raw: bytes):
    if not raw or len(raw) > MAX_IMAGE:
        raise _error('invalid_image', ambiguous=True)
    try:
        with Image.open(io.BytesIO(raw)) as im:
            fmt, width, height = im.format, im.width, im.height
            if fmt not in ('PNG', 'JPEG', 'WEBP') or min(width, height) < 1 or max(width, height) > MAX_DIMENSION or width * height > MAX_PIXELS:
                raise ValueError()
            im.verify()
        with Image.open(io.BytesIO(raw)) as im:
            im.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, SyntaxError):
        raise _error('invalid_image', ambiguous=True) from None
    return {'width': width, 'height': height, 'format': fmt.lower(), 'bytes': len(raw)}

def _decode(value):
    if not isinstance(value, str) or len(value) > (MAX_IMAGE * 4 // 3 + 8):
        raise _error('invalid_image', ambiguous=True)
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise _error('invalid_image', ambiguous=True) from None
    return raw, _image(raw)

def _refs(paths):
    if len(paths) > MAX_REFERENCE_COUNT:
        raise _error('too_many_references', safe_fallback=True)
    result, total = [], 0
    for path in paths:
        try:
            with open(path, 'rb') as f:
                raw = f.read(MAX_REFERENCE_BYTES + 1)
        except (OSError, ValueError):
            raise _error('reference_unreadable', safe_fallback=True) from None
        total += len(raw)
        if total > MAX_REFERENCE_BYTES:
            raise _error('references_too_large', safe_fallback=True)
        try:
            meta = _image(raw)
        except BackendError:
            raise _error('invalid_reference', safe_fallback=True) from None
        mime = {'png':'image/png', 'jpeg':'image/jpeg', 'webp':'image/webp'}[meta['format']]
        result.append('data:' + mime + ';base64,' + base64.b64encode(raw).decode('ascii'))
    return result

def _auth(home):
    try:
        path = Path(home) / 'auth.json'
        with path.open('rb') as f:
            content = f.read(1024 * 1024 + 1)
        if len(content) > 1024 * 1024:
            raise ValueError()
        data = json.loads(content)
        tokens = data['tokens']
        token = tokens['access_token']
        account = tokens.get('account_id')
        if not isinstance(token, str) or not token or len(token) > 32768 or any(ord(c) < 33 or ord(c) > 126 for c in token):
            raise ValueError()
        parts = token.split('.')
        if len(parts) != 3:
            raise ValueError()
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
        if not isinstance(payload, dict):
            raise ValueError()
        exp = payload.get('exp')
        if not isinstance(exp, (int, float)) or isinstance(exp, bool) or not math.isfinite(exp) or exp <= time.time():
            raise ValueError()
        claims = payload.get('https://api.openai.com/auth', {})
        account = account or (claims.get('chatgpt_account_id') if isinstance(claims, dict) else None)
        if not isinstance(account, str) or not account or len(account) > 256 or any(ord(c) < 33 or ord(c) > 126 for c in account):
            raise ValueError()
        return token, account
    except (OSError, ValueError, TypeError, KeyError, OverflowError, binascii.Error, UnicodeDecodeError, json.JSONDecodeError):
        raise _error('auth_unavailable', safe_fallback=True) from None

async def _emit(callback, event):
    if callback:
        value = callback(event)
        if inspect.isawaitable(value):
            await value

def _clean_fields(source, keys):
    if not isinstance(source, dict):
        return {}
    return {k: source[k] for k in keys if isinstance(source.get(k), (str, int, float)) and not isinstance(source.get(k), bool) and len(str(source[k])) <= 256}

def _scrub(value, token, account):
    if isinstance(value, str):
        return value.replace(token, '[redacted]').replace(account, '[redacted]')
    if isinstance(value, dict):
        return {k: _scrub(v, token, account) for k, v in value.items()}
    return value

def _scrub_event(value, token, account, key=None):
    if key in ('b64_json', 'partial_image_b64', 'result'):
        return value
    if isinstance(value, dict):
        return {k: _scrub_event(v, token, account, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub_event(v, token, account) for v in value]
    return _scrub(value, token, account)

def _status(status):
    if status == 401:
        return _error('auth_rejected', safe_fallback=True)
    if status in (404, 405, 415, 501):
        return _error('unsupported', safe_fallback=True)
    if status == 429:
        return _error('quota_or_rate_limit')
    return _error('http_error', ambiguous=status >= 500)

async def _prefixed(first, remaining):
    yield first
    async for chunk in remaining:
        yield chunk

async def _sse(chunks):
    buf = bytearray()
    data = []
    event_size = 0
    total = 0
    async for chunk in chunks:
        total += len(chunk)
        if total > MAX_RESPONSE:
            raise _error('response_too_large', ambiguous=True)
        buf.extend(chunk)
        while True:
            n = buf.find(b'\n')
            if n < 0:
                if len(buf) + event_size > MAX_EVENT:
                    raise _error('event_too_large', ambiguous=True)
                break
            line = bytes(buf[:n]).rstrip(b'\r')
            del buf[:n+1]
            event_size += len(line) + 1
            if event_size > MAX_EVENT:
                raise _error('event_too_large', ambiguous=True)
            if not line:
                if data:
                    yield b'\n'.join(data)
                data, event_size = [], 0
            elif line.startswith(b'data:'):
                val = line[5:]
                data.append(val[1:] if val.startswith(b' ') else val)
                if len(data) > 16384:
                    raise _error('event_too_large', ambiguous=True)
    if buf or data:
        raise _error('incomplete_stream', ambiguous=True)

class Backend:
    def __init__(self, codex_home, client_factory=None, deadline=900):
        self.codex_home = Path(codex_home)
        self.client_factory = client_factory or (lambda: httpx.AsyncClient(timeout=httpx.Timeout(60, connect=15), follow_redirects=False, trust_env=False))
        self.deadline = deadline

    async def _call(self, endpoint, payload, callback, mode):
        token, account = _auth(self.codex_home)
        turn = str(uuid.uuid4())
        headers = {'Authorization': 'Bearer ' + token, 'ChatGPT-Account-Id': account, 'session_id': turn, 'x-client-request-id': turn, 'x-codex-image-turn-id': str(uuid.uuid4()), 'originator': 'codex-image-studio', 'OpenAI-Beta': 'responses=experimental', 'Accept': 'text/event-stream, application/json', 'Content-Type': 'application/json'}
        await _emit(callback, {'type':'stage', 'stage':'polishing' if mode == 'polish' else 'sending'})
        try:
            async with asyncio.timeout(self.deadline):
                async with self.client_factory() as client:
                    async with client.stream('POST', BASE + endpoint, headers=headers, json=payload, follow_redirects=False, timeout=httpx.Timeout(connect=15, read=self.deadline, write=60, pool=15)) as response:
                        if response.status_code < 200 or response.status_code >= 300:
                            if response.status_code == 400:
                                body = bytearray()
                                async for chunk in response.aiter_bytes():
                                    body.extend(chunk)
                                    if len(body) > 65536:
                                        break
                                if len(body) <= 65536:
                                    try:
                                        obj = json.loads(body)
                                        error = obj.get('error', {}) if isinstance(obj, dict) else {}
                                        if (isinstance(error, dict) and error.get('code') in ('unsupported_parameter', 'unknown_parameter')
                                                and error.get('type') in (None, 'invalid_request_error')
                                                and set(obj) <= {'error', 'request_id'}):
                                            raise _error('unsupported_parameter', safe_fallback=True)
                                    except (ValueError, UnicodeDecodeError, RecursionError):
                                        pass
                            raise _status(response.status_code)
                        if mode == 'image':
                            await _emit(callback, {'type':'stage', 'stage':'dispatching' if endpoint == 'responses' else 'generating'})
                        chunks = response.aiter_bytes().__aiter__()
                        prefix = bytearray()
                        while not prefix.lstrip():
                            try:
                                part = await chunks.__anext__()
                            except StopAsyncIteration:
                                raise _error('invalid_response', ambiguous=True) from None
                            prefix.extend(part)
                            if len(prefix) > MAX_RESPONSE or (not prefix.lstrip() and len(prefix) > 8192):
                                raise _error('response_too_large', ambiguous=True)
                        # The subscription endpoint can omit Content-Type even for SSE.
                        is_sse = prefix.lstrip()[:1] not in (b'{', b'[')
                        if is_sse:
                            events = []
                            seen_partials = set()
                            event_count = 0
                            responses_generating = False
                            async for item in _sse(_prefixed(bytes(prefix).lstrip(), chunks)):
                                if item == b'[DONE]':
                                    continue
                                try:
                                    obj = json.loads(item)
                                except (ValueError, UnicodeDecodeError):
                                    raise _error('invalid_response', ambiguous=True) from None
                                if not isinstance(obj, dict):
                                    raise _error('invalid_response', ambiguous=True)
                                event_count += 1
                                if event_count > 4096:
                                    raise _error('response_too_large', ambiguous=True)
                                obj = _scrub_event(obj, token, account)
                                typ = obj.get('type')
                                if mode == 'image':
                                    if endpoint == 'responses' and not responses_generating and typ in ('response.image_generation_call.in_progress', 'response.image_generation_call.partial_image'):
                                        await _emit(callback, {'type':'stage', 'stage':'generating'})
                                        responses_generating = True
                                    if typ in ('image_generation.partial_image', 'image_edit.partial_image', 'response.image_generation_call.partial_image'):
                                        await self._partial(obj, callback, seen_partials)
                                        continue
                                events.append(obj)
                            return events
                        body = bytearray(prefix)
                        async for chunk in chunks:
                            body.extend(chunk)
                            if len(body) > MAX_RESPONSE:
                                raise _error('response_too_large', ambiguous=True)
                        try:
                            obj = json.loads(body)
                        except (ValueError, UnicodeDecodeError):
                            raise _error('invalid_response', ambiguous=True) from None
                        if not isinstance(obj, dict):
                            raise _error('invalid_response', ambiguous=True)
                        return [_scrub_event(obj, token, account)]
        except httpx.ConnectError:
            raise _error('connection_failed', safe_fallback=True, retryable=True) from None
        except (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError, TimeoutError):
            raise _error('transport_interrupted', ambiguous=True) from None

    async def _partial(self, obj, callback, seen):
        typ = obj.get('type')
        if typ not in ('image_generation.partial_image', 'image_edit.partial_image', 'response.image_generation_call.partial_image'):
            return
        index = obj.get('partial_image_index', 0)
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            raise _error('invalid_response', ambiguous=True)
        if index in seen:
            return
        if len(seen) >= 3:
            raise _error('too_many_partial_images', ambiguous=True)
        raw, _ = _decode(obj.get('partial_image_b64') if typ.startswith('response.') else obj.get('b64_json'))
        seen.add(index)
        await _emit(callback, {'type':'partial', 'data':raw, 'index':index})

    async def generate(self, request: ImageRequest, output_path, on_event=None):
        try:
            async with asyncio.timeout(self.deadline):
                return await self._generate(request, output_path, on_event)
        except TimeoutError:
            raise _error('deadline_exceeded', ambiguous=True) from None

    async def _generate(self, request: ImageRequest, output_path, on_event=None):
        if request.transport not in ('images', 'responses') or not isinstance(request.prompt, str) or not request.prompt:
            raise _error('invalid_request', safe_fallback=True)
        if not isinstance(request.partial_images, int) or isinstance(request.partial_images, bool) or not 0 <= request.partial_images <= 3:
            raise _error('invalid_request', safe_fallback=True)
        refs = _refs(request.reference_paths)
        requested = {'image_model':request.image_model, 'response_model':request.response_model if request.transport == 'responses' else None, 'quality':request.quality, 'size':request.size, 'background':request.background, 'output_format':'png' if request.transport == 'responses' else None, 'transport':request.transport, 'partial_images':request.partial_images if request.partial_images or request.transport == 'responses' else None, 'effort':request.effort if request.transport == 'responses' else None, 'stream':True if request.transport == 'responses' or request.partial_images else None, 'tool_choice':'image_generation' if request.transport == 'responses' else None, 'reference_count':len(refs)}
        if request.transport == 'images':
            endpoint = 'images/edits' if refs else 'images/generations'
            payload = {'model':request.image_model, 'prompt':request.prompt, 'size':request.size, 'quality':request.quality, 'background':request.background}
            if request.partial_images:
                payload.update(stream=True, partial_images=request.partial_images)
            if refs:
                payload['images'] = [{'image_url':r} for r in refs]
        else:
            if not request.response_model:
                raise _error('invalid_request', safe_fallback=True)
            endpoint = 'responses'
            tool = {'type':'image_generation', 'model':request.image_model, 'size':request.size, 'quality':request.quality, 'background':request.background, 'output_format':'png', 'partial_images':request.partial_images}
            payload = {'model':request.response_model, 'store':False, 'stream':True, 'instructions':'Generate the requested image.', 'input':[{'role':'user', 'content':[{'type':'input_text', 'text':request.prompt}] + [{'type':'input_image', 'image_url':r} for r in refs]}], 'tools':[tool], 'tool_choice':{'type':'image_generation'}}
            if request.effort:
                payload['reasoning'] = {'effort':request.effort}
        events = await self._call(endpoint, payload, on_event, 'image')
        final, info, usage, ids, revised = None, {}, {}, {}, None
        for event in events:
            typ = event.get('type', '')
            if typ in ('error', 'response.failed', 'response.incomplete'):
                raise _error('generation_failed', ambiguous=True)
            response = event.get('response') if isinstance(event.get('response'), dict) else event
            usage.update(_clean_fields(response.get('usage'), ('input_tokens', 'output_tokens', 'total_tokens')))
            ids.update(_clean_fields(response, ('id',)))
            if endpoint == 'responses':
                info.update({'response_model':response['model']} if isinstance(response.get('model'), str) and len(response['model']) <= 256 else {})
                candidates = []
                if typ == 'response.output_item.done':
                    candidates = [event.get('item')]
                elif typ == 'response.image_generation_call.completed' and isinstance(event.get('result'), str):
                    candidates = [dict(event, type='image_generation_call')]
                elif isinstance(response.get('output'), list):
                    candidates = response['output']
                for item in candidates:
                    if isinstance(item, dict) and item.get('type') == 'image_generation_call' and isinstance(item.get('result'), str):
                        final = item['result']
                        info.update(_clean_fields(item, ('size', 'quality', 'background', 'output_format')))
                        if isinstance(item.get('model'), str) and len(item['model']) <= 256:
                            info['image_model'] = item['model']
                        if isinstance(item.get('revised_prompt'), str):
                            revised = item['revised_prompt'][:100000]
            else:
                info.update(_clean_fields(event, ('size', 'quality', 'background', 'output_format')))
                if isinstance(event.get('model'), str) and len(event['model']) <= 256:
                    info['image_model'] = event['model']
                if typ in ('image_generation.completed', 'image_edit.completed') and isinstance(event.get('b64_json'), str):
                    final = event['b64_json']
                if isinstance(event.get('data'), list) and event['data']:
                    item = event['data'][0]
                    if isinstance(item, dict) and isinstance(item.get('b64_json'), str):
                        final = item['b64_json']
                        if isinstance(item.get('revised_prompt'), str):
                            revised = item['revised_prompt'][:100000]
        if final is None:
            raise _error('missing_final_image', ambiguous=True)
        raw, actual = _decode(final)
        await _emit(on_event, {'type':'stage', 'stage':'receiving'})
        await _emit(on_event, {'type':'metadata', 'provider_reported':info, 'actual_image':actual, 'usage':usage, 'ids':ids})
        output_path = Path(output_path)
        temporary = output_path.with_name('.' + output_path.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            with temporary.open('xb') as f:
                f.write(raw)
            temporary.replace(output_path)
        finally:
            temporary.unlink(missing_ok=True)
        return BackendResult(output_path, requested, info, actual, usage, ids, revised)

    async def polish(self, prompt, instructions, refs=(), model='gpt-6.1', effort=None, on_event=None):
        try:
            async with asyncio.timeout(self.deadline):
                return await self._polish(prompt, instructions, refs, model, effort, on_event)
        except TimeoutError:
            raise _error('deadline_exceeded', ambiguous=True) from None

    async def _polish(self, prompt, instructions, refs, model, effort, on_event):
        images = _refs(refs)
        payload = {'model':model, 'store':False, 'stream':True, 'instructions':instructions, 'input':[{'role':'user', 'content':[{'type':'input_text', 'text':prompt}] + [{'type':'input_image', 'image_url':r} for r in images]}]}
        if effort:
            payload['reasoning'] = {'effort':effort}
        events = await self._call('responses', payload, on_event, 'polish')
        pieces, final, info, usage, ids = [], None, {}, {}, {}
        for event in events:
            typ = event.get('type', '')
            if typ in ('error', 'response.failed', 'response.incomplete'):
                raise _error('polish_failed', ambiguous=True)
            if typ == 'response.output_text.delta' and isinstance(event.get('delta'), str):
                pieces.append(event['delta'])
            if typ == 'response.output_text.done' and isinstance(event.get('text'), str):
                final = event['text']
            response = event.get('response') if isinstance(event.get('response'), dict) else event
            if isinstance(response.get('model'), str) and len(response['model']) <= 256:
                info['response_model'] = response['model']
            usage.update(_clean_fields(response.get('usage'), ('input_tokens', 'output_tokens', 'total_tokens')))
            ids.update(_clean_fields(response, ('id',)))
            if isinstance(response.get('output'), list):
                texts = [c.get('text') for item in response['output'] if isinstance(item, dict) for c in item.get('content', []) if isinstance(c, dict) and c.get('type') == 'output_text' and isinstance(c.get('text'), str)]
                if texts:
                    final = ''.join(texts)
        text = final if final is not None else ''.join(pieces)
        if not text:
            raise _error('missing_polish_text', ambiguous=True)
        return PolishResult(text, {'response_model':model, 'reference_count':len(images), 'effort':effort}, info, usage, ids)
