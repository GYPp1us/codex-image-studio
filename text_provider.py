"""Custom language model APIs for prompt polishing and visual inspection."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import time
from dataclasses import asdict, dataclass, replace
from urllib.parse import quote

import httpx
from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from image_backend import BackendError, PolishResult, _clean_fields, _reference_files
from image_provider import ImageProvider, NETWORK_ERROR, parse_profile, public_target, read_config

SETTING = 'text_api'
PROTOCOLS = {'chat': '/v1', 'responses': '/v1', 'messages': '/v1', 'gemini': '/v1beta'}
AUTH_HEADERS = {'bearer': 'Authorization', 'api-key': 'api-key', 'x-api-key': 'x-api-key', 'x-goog-api-key': 'x-goog-api-key', 'none': None}
DEFAULT_AUTH = {'chat': 'bearer', 'responses': 'bearer', 'messages': 'x-api-key', 'gemini': 'x-goog-api-key'}
MODEL_PATTERN = r'[a-zA-Z0-9][a-zA-Z0-9._:/+@-]{0,127}'
MAX_RESPONSE = 2 * 1024 * 1024
ERRORS = {
    'text_profile_changed': '语言模型 API 的地址、协议或鉴权方式已变更或移除，请重新提交任务',
    'text_auth': '语言模型 API 拒绝访问，请检查密钥和模型权限',
    'text_route': '语言模型 API 路径或模型不存在，请检查接口协议和模型 ID',
    'text_parameters': '语言模型 API 拒绝了本次输入，请检查模型和带图能力',
    'text_rate_limit': '语言模型 API 额度不足或请求过于频繁',
    'text_network': NETWORK_ERROR,
    'text_timeout': '语言模型 API 请求超时',
    'text_invalid': '语言模型 API 返回了无效或不完整的文本',
    'text_redirect': '供应商要求跳转，请填写最终 API 地址',
    'text_upstream': '语言模型 API 服务异常，请稍后重试',
}


@dataclass(frozen=True)
class TextProvider(ImageProvider):
    protocol: str = 'chat'
    auth: str = 'bearer'
    vision_model: str = ''
    enabled: bool = True

    @property
    def destination(self):
        return hashlib.sha256(f'{self.base_url}\n{self.protocol}\n{self.auth}'.encode()).hexdigest()

    def frozen(self):
        return {'destination': self.destination, 'model': self.model,
                'vision_model': self.vision_model, 'protocol': self.protocol}


def configured(studio):
    value = studio.setting(SETTING, None)
    return TextProvider(**value) if value else None


def public_settings(provider):
    if not provider:
        return {'configured': False, 'enabled': False}
    return {key: getattr(provider, key) for key in ('base_url', 'model', 'protocol', 'auth', 'vision_model', 'enabled')} | {'configured': True}


def parse(body, current=None):
    protocol = body.get('protocol', 'chat')
    if not isinstance(protocol, str) or protocol not in PROTOCOLS:
        raise ValueError('请选择支持的语言模型 API 协议')
    auth = body.get('auth', 'auto')
    if auth == 'auto':
        auth = DEFAULT_AUTH[protocol]
    if not isinstance(auth, str) or auth not in AUTH_HEADERS:
        raise ValueError('请选择支持的 API 密钥请求头')
    kept = current if current and (current.protocol, current.auth) == (protocol, auth) else None
    base = parse_profile(body, kept, PROTOCOLS[protocol], model_pattern=MODEL_PATTERN, require_key=auth != 'none')
    vision = body.get('vision_model', '')
    enabled = body.get('enabled', True)
    if not isinstance(vision, str) or not isinstance(enabled, bool):
        raise ValueError('请检查视觉模型 ID 和启用状态')
    vision = vision.strip()
    if vision and not re.fullmatch(MODEL_PATTERN, vision):
        raise ValueError('请输入有效的视觉模型 ID')
    return TextProvider(base.base_url, base.model, base.api_key, protocol, auth, vision, enabled)


def for_job(studio, frozen):
    provider = configured(studio)
    if not provider or provider.destination != frozen.get('destination'):
        raise BackendError('text_profile_changed')
    # Existing tasks keep their submitted models even after the default model changes.
    return replace(provider, model=frozen['model'], vision_model=frozen['vision_model'])


def model_for(profile, with_images):
    return (profile.get('vision_model') or profile['model']) if with_images else profile['model']


def request_payload(protocol, model, instructions, prompt, images, test):
    if protocol == 'chat':
        content = ([{'type': 'text', 'text': prompt}] + [
            {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{data}'}} for mime, data in images
        ]) if images else prompt
        return 'chat/completions', {'model': model, 'messages': [
            {'role': 'system', 'content': instructions}, {'role': 'user', 'content': content},
        ]}
    if protocol == 'responses':
        content = [{'type': 'input_text', 'text': prompt}] + [
            {'type': 'input_image', 'image_url': f'data:{mime};base64,{data}'} for mime, data in images
        ]
        return 'responses', {'model': model, 'instructions': instructions, 'store': False,
                             'input': [{'role': 'user', 'content': content}]}
    if protocol == 'messages':
        content = [{'type': 'text', 'text': prompt}] + [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': data}} for mime, data in images
        ]
        return 'messages', {'model': model, 'system': instructions, 'max_tokens': 128 if test else 8192,
                            'messages': [{'role': 'user', 'content': content}]}
    content = [{'text': prompt}] + [{'inlineData': {'mimeType': mime, 'data': data}} for mime, data in images]
    name = quote(model.removeprefix('models/'), safe='')
    return f'models/{name}:generateContent', {'systemInstruction': {'parts': [{'text': instructions}]},
                                             'contents': [{'role': 'user', 'parts': content}]}


def parts_text(parts, kind=None):
    if not isinstance(parts, list):
        return ''
    return ''.join(part['text'] for part in parts if isinstance(part, dict) and isinstance(part.get('text'), str)
                   and not part.get('thought') and (kind is None or part.get('type') == kind))


def extract(protocol, body):
    if protocol == 'chat':
        choice = body['choices'][0]
        if choice.get('finish_reason') not in (None, 'stop'):
            return ''
        content = choice['message']['content']
        return content if isinstance(content, str) else parts_text(content)
    if protocol == 'responses':
        if body.get('status') not in (None, 'completed'):
            return ''
        if isinstance(body.get('output_text'), str):
            return body['output_text']
        return ''.join(parts_text(item.get('content'), 'output_text') for item in body['output']
                       if isinstance(item, dict) and item.get('type') == 'message')
    if protocol == 'messages':
        return parts_text(body['content'], 'text') if body.get('stop_reason') in (None, 'end_turn', 'stop_sequence') else ''
    candidate = body['candidates'][0]
    return parts_text(candidate['content']['parts']) if candidate.get('finishReason') in (None, 'STOP') else ''


def rejected(status):
    if status in (401, 403):
        return 'text_auth'
    if status in (404, 405):
        return 'text_route'
    if status in (400, 415, 422):
        return 'text_parameters'
    if status == 429:
        return 'text_rate_limit'
    if 300 <= status < 400:
        return 'text_redirect'
    return 'text_upstream'


async def complete(provider, instructions, prompt, references=(), *, test=False):
    files = await asyncio.to_thread(_reference_files, references, 8) if references else []
    images = [(mime, base64.b64encode(raw).decode('ascii')) for raw, mime, _ in files]
    model = model_for(provider.frozen(), bool(images))
    path, payload = request_payload(provider.protocol, model, instructions, prompt, images, test)
    try:
        async with asyncio.timeout(18 if test else 180):
            url, headers, extensions = await public_target(provider.base_url + '/' + path)
            if header := AUTH_HEADERS[provider.auth]:
                headers[header] = 'Bearer ' + provider.api_key if provider.auth == 'bearer' else provider.api_key
            if provider.protocol == 'messages':
                headers['anthropic-version'] = '2023-06-01'
            timeout = httpx.Timeout(180, connect=10, write=30)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client:
                async with client.stream('POST', url, headers=headers, extensions=extensions, json=payload) as response:
                    if not response.is_success:
                        raise BackendError(rejected(response.status_code))
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > MAX_RESPONSE:
                            raise BackendError('text_invalid')
    except ValueError:
        raise BackendError('api_address_rejected') from None
    except (TimeoutError, httpx.TimeoutException):
        raise BackendError('text_timeout', ambiguous=True) from None
    except httpx.HTTPError:
        raise BackendError('text_network') from None
    try:
        body = json.loads(content)
        if not isinstance(body, dict):
            raise ValueError()
        text = extract(provider.protocol, body).strip()
        if not text or len(text) > 24000:
            raise ValueError()
    except (AttributeError, KeyError, IndexError, TypeError, ValueError, RecursionError):
        raise BackendError('text_invalid') from None
    reported = _clean_fields(body, ('model', 'modelVersion'))
    actual = reported.get('model') or reported.get('modelVersion')
    def scrub(value):
        return value.replace(provider.api_key, '[redacted]') if provider.api_key else value
    info = {'response_model': scrub(actual)} if isinstance(actual, str) else {}
    return PolishResult(scrub(text), {'response_model': model, 'reference_count': len(images)}, info)


def error_text(error):
    return ERRORS.get(error.code, '语言模型 API 调用失败：' + error.code)


def register(app, studio):
    def response(provider):
        return JSONResponse(public_settings(provider), headers={'Cache-Control': 'no-store'})

    async def read_profile(request):
        body = await read_config(request)
        try:
            return parse(body, configured(studio))
        except ValueError as error:
            raise HTTPException(400, str(error)) from None

    @app.put('/api/settings/text-api')
    async def save(request: Request, session=Depends(studio.require_user)):
        provider = await read_profile(request)
        studio.set_setting(SETTING, asdict(provider))
        return response(provider)

    @app.post('/api/settings/text-api/test')
    async def test_connection(request: Request, session=Depends(studio.require_user)):
        provider = await read_profile(request)
        started = time.monotonic()
        try:
            await complete(provider, 'Return a short plain-text answer.', 'Reply with OK.', test=True)
            result = {'status': 'ok', 'message': '语言模型已返回文本', 'elapsed_ms': round((time.monotonic() - started) * 1000)}
        except BackendError as error:
            result = {'status': 'failed', 'message': error_text(error)}
        return JSONResponse(result, headers={'Cache-Control': 'no-store'})

    @app.delete('/api/settings/text-api')
    def disconnect(session=Depends(studio.require_user)):
        studio.set_setting(SETTING, None)
        return response(None)
