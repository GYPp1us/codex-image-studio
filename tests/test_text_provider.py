import asyncio
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from PIL import Image

from image_backend import BackendError
from text_provider import parse, complete, public_settings


class LanguageAPITests(unittest.IsolatedAsyncioTestCase):
    def profile(self, **values):
        return parse({'base_url': 'https://relay.example', 'model': 'org/custom-text:stable',
                      'vision_model': 'vendor/vision@202610', 'api_key': 'fixture-private-key', **values})

    async def call(self, provider, payload, ref=None, status=200):
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(status, json=payload)
        client = httpx.AsyncClient
        resolver = AsyncMock(return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))])
        with patch.object(asyncio.get_running_loop(), 'getaddrinfo', resolver), patch('text_provider.httpx.AsyncClient',
                lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs)):
            result = await complete(provider, 'inspect precisely', 'review this tile', [ref] if ref else ())
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].url.host, '8.8.8.8')
        self.assertEqual(requests[0].headers['host'], 'relay.example')
        self.assertEqual(requests[0].extensions['sni_hostname'], 'relay.example')
        return result, requests[0]

    async def test_all_protocols_accept_freeform_vision_model_and_image_input(self):
        shapes = {
            'chat': ('/v1/chat/completions', {'choices': [{'message': {'content': 'OK'}}]}, 'image_url', 'Authorization', 'Bearer fixture-private-key'),
            'responses': ('/v1/responses', {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'OK'}]}]}, 'input_image', 'Authorization', 'Bearer fixture-private-key'),
            'messages': ('/v1/messages', {'content': [{'type': 'thinking', 'text': 'skip'}, {'type': 'text', 'text': 'OK'}]}, 'media_type', 'x-api-key', 'fixture-private-key'),
            'gemini': ('/v1beta/models/vendor%2Fvision%40202610:generateContent', {'candidates': [{'content': {'parts': [{'thought': True, 'text': 'skip'}, {'text': 'OK'}]}}]}, 'inlineData', 'x-goog-api-key', 'fixture-private-key'),
        }
        with tempfile.TemporaryDirectory() as directory:
            ref = Path(directory) / 'tile.png'
            Image.new('RGB', (32, 32), 'blue').save(ref)
            for protocol, (path, payload, field, header, token) in shapes.items():
                with self.subTest(protocol=protocol):
                    provider = self.profile(protocol=protocol)
                    result, request = await self.call(provider, payload, ref)
                    self.assertEqual(request.url.raw_path.decode(), path)
                    self.assertEqual(request.headers[header], token)
                    self.assertIn(field, request.content.decode())
                    self.assertEqual(result.text, 'OK')
                    self.assertEqual(result.requested['response_model'], 'vendor/vision@202610')
                    if protocol == 'messages':
                        self.assertEqual(request.headers['anthropic-version'], '2023-06-01')

    async def test_alternate_header_and_keyless_provider(self):
        payload = {'choices': [{'message': {'content': 'OK'}}]}
        result, request = await self.call(self.profile(auth='api-key'), payload)
        self.assertEqual(result.requested['response_model'], 'org/custom-text:stable')
        self.assertEqual(request.headers['api-key'], 'fixture-private-key')
        self.assertNotIn('Authorization', request.headers)
        result, request = await self.call(self.profile(auth='none', api_key=''), payload)
        self.assertEqual(result.text, 'OK')
        self.assertNotIn('api-key', request.headers)

    async def test_blocks_partial_verdict_and_masks_credentials(self):
        provider = self.profile()
        payload = {'choices': [{'finish_reason': 'length', 'message': {'content': '{"pass":true}'}}]}
        with self.assertRaisesRegex(BackendError, 'text_invalid'):
            await self.call(provider, payload)
        result, _ = await self.call(provider, {'choices': [{'message': {'content': provider.api_key}}], 'model': provider.api_key})
        self.assertNotIn(provider.api_key, repr(result))
        self.assertNotIn(provider.api_key, json.dumps(public_settings(provider)))
        self.assertNotIn(provider.api_key, json.dumps(provider.frozen()))

    def test_credentials_cannot_silently_cross_protocol_or_host(self):
        provider = self.profile()
        body = {'base_url': provider.base_url, 'model': 'same-provider/model-v2'}
        self.assertEqual(parse(body, provider).api_key, provider.api_key)
        for change in ({'protocol': 'messages'}, {'base_url': 'https://other.example'}, {'auth': 'api-key'}):
            with self.assertRaisesRegex(ValueError, 'API 密钥'):
                parse(body | change, provider)
