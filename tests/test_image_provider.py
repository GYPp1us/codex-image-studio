import asyncio
import base64
import io
import json
import socket
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

import image_provider
from image_backend import Backend, BackendError, ImageRequest


def connection():
    return image_provider.parse_profile({
        'base_url': 'https://relay.example', 'model': 'gpt-image-2-test', 'api_key': 'fake-provider-secret',
    })


def png():
    output = io.BytesIO()
    Image.new('RGB', (4, 3), 'teal').save(output, format='PNG')
    return output.getvalue()


class ProfileTests(unittest.TestCase):
    def test_address_normalization_and_key_reuse_only_for_same_endpoint(self):
        first = connection()
        self.assertEqual(first.base_url, 'https://relay.example/v1')
        changed_model = image_provider.parse_profile({
            'base_url': 'https://RELAY.example/v1/', 'model': 'gpt-image-2', 'api_key': '',
        }, first)
        self.assertEqual(changed_model.destination, first.destination)
        self.assertEqual(changed_model.api_key, first.api_key)
        for address in ('https://relay.example/other', 'https://elsewhere.example/v1'):
            with self.assertRaisesRegex(ValueError, '更换地址'):
                image_provider.parse_profile({'base_url': address, 'model': first.model}, first)
        for address in ('http://relay.example', 'https://10.0.0.1', 'https://[::1]', 'https://127.1',
                        'https://relay.example/v1?token=abc', 'https://user@relay.example', 'https://relay.example/a/../v1'):
            with self.subTest(address=address), self.assertRaisesRegex(ValueError, '公网 HTTPS'):
                image_provider.parse_profile({'base_url': address, 'model': first.model, 'api_key': first.api_key})

    def test_routes_mask_values_even_on_invalid_requests_and_remove_profile(self):
        settings = {}
        app = FastAPI()
        image_provider.register(app, SimpleNamespace(require_user=lambda: True, setting=settings.get, set_setting=settings.__setitem__))
        key = connection().api_key
        payload = {'base_url': 'https://relay.example', 'model': 'gpt-image-2-test', 'api_key': key}
        with TestClient(app) as client:
            response = client.put('/api/settings/image-api', json=payload)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {'configured': True, 'base_url': 'https://relay.example/v1', 'model': 'gpt-image-2-test'})
            self.assertEqual(settings[image_provider.SETTING]['api_key'], key)
            invalid = client.put('/api/settings/image-api', json=[payload])
            self.assertEqual(invalid.status_code, 400)
            self.assertNotIn(key, invalid.text)
            self.assertFalse(client.delete('/api/settings/image-api').json()['configured'])
            self.assertIsNone(settings[image_provider.SETTING])


class DispatchTests(unittest.IsolatedAsyncioTestCase):
    def resolver(self, *hosts):
        loop = asyncio.get_running_loop()
        rows = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (host, 443)) for host in hosts]
        return patch.object(loop, 'getaddrinfo', AsyncMock(return_value=rows))

    async def test_dials_validated_ip_keeps_tls_identity_and_blocks_private_answers(self):
        with self.resolver('8.8.8.8'):
            target, headers, tls = await image_provider.public_target('https://relay.example/v1/models')
        self.assertEqual(str(target), 'https://8.8.8.8/v1/models')
        self.assertEqual(headers['Host'], 'relay.example')
        self.assertEqual(tls['sni_hostname'], 'relay.example')
        with self.resolver('8.8.8.8', '127.0.0.1'), self.assertRaisesRegex(ValueError, '公网 HTTPS'):
            await image_provider.public_target('https://relay.example/v1/models')

    async def test_probe_checks_catalog_and_auth_without_generating(self):
        provider = connection()
        client = httpx.AsyncClient
        requests = []

        def respond(request):
            requests.append(request)
            return (httpx.Response(200, json={'data': [{'id': provider.model}]})
                    if len(requests) == 1 else httpx.Response(401, text=provider.api_key))

        with self.resolver('8.8.8.8'), patch.object(image_provider.httpx, 'AsyncClient', lambda **kw: client(
                transport=httpx.MockTransport(respond), **kw)):
            ok = await image_provider.probe(provider)
            failed = await image_provider.probe(provider)
        self.assertEqual(ok['status'], 'ok')
        self.assertEqual(failed['status'], 'failed')
        self.assertNotIn(provider.api_key, json.dumps(failed))
        self.assertEqual([(r.method, r.url.path) for r in requests], [('GET', '/v1/models')] * 2)

    async def test_api_generation_edit_and_media_download_use_separate_credentials(self):
        provider, raw = connection(), png()
        encoded = base64.b64encode(raw).decode()
        requests = []

        def respond(request):
            requests.append(request)
            if request.method == 'GET':
                return httpx.Response(200, content=raw)
            if request.url.path.endswith('/edits'):
                return httpx.Response(200, json={'data': [{'url': 'https://cdn.example/result.png?sig=fixture'}]})
            return httpx.Response(200, json={'data': [{'b64_json': encoded, 'revised_prompt': provider.api_key}]})

        with tempfile.TemporaryDirectory() as tmp, self.resolver('8.8.8.8'):
            root = Path(tmp)
            backend = Backend(root, lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond)), provider=provider)
            first = await backend.generate(ImageRequest('draw', image_model=provider.model, partial_images=0), root/'draw.png')
            edit = await backend.generate(ImageRequest('edit', image_model=provider.model, partial_images=0,
                                                       reference_paths=(first.output_path, first.output_path)), root/'edit.png')
            self.assertEqual(edit.output_path.read_bytes(), raw)
        create, update, download = requests
        self.assertEqual(create.url.path, '/v1/images/generations')
        self.assertEqual(json.loads(create.content)['model'], provider.model)
        self.assertNotIn('chatgpt-account-id', create.headers)
        self.assertNotIn(provider.api_key, repr(first))
        self.assertEqual(update.url.path, '/v1/images/edits')
        self.assertEqual(update.content.count(b'name="image[]"'), 2)
        self.assertEqual(update.headers['Authorization'], 'Bearer ' + provider.api_key)
        self.assertEqual(download.headers['Host'], 'cdn.example')
        self.assertNotIn('Authorization', download.headers)

    async def test_ambiguous_success_never_triggers_another_generation_request(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={'data': [{'url': 'https://127.0.0.1/image.png'}]})

        with tempfile.TemporaryDirectory() as tmp, self.resolver('8.8.8.8'):
            root = Path(tmp)
            backend = Backend(root, lambda: httpx.AsyncClient(transport=httpx.MockTransport(respond)), provider=connection())
            with self.assertRaises(BackendError) as error:
                await backend.generate(ImageRequest('draw', partial_images=0), root/'out.png')
            self.assertTrue(error.exception.ambiguous)
            self.assertEqual(len(requests), 1)
