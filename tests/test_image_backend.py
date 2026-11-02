import asyncio
import base64
import io
import json
import tempfile
import time
import unittest
from unittest import mock

import image_backend
from pathlib import Path

import httpx
from PIL import Image

from image_backend import Backend, BackendError, ImageRequest, _sse


def png():
    out = io.BytesIO()
    Image.new('RGB', (4, 3), 'red').save(out, format='PNG')
    return out.getvalue()


def b64(data):
    return base64.b64encode(data).decode()


class BackendTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        claims = base64.urlsafe_b64encode(json.dumps({'exp':time.time()+3600}).encode()).decode().rstrip('=')
        self.token = 'header.' + claims + '.secret'
        (self.root / 'auth.json').write_text(json.dumps({'tokens':{'access_token':self.token, 'account_id':'test-account'}}))
        self.output = self.root / 'out.png'
        self.requests = []
        self.events = []

    def tearDown(self):
        self.temp.cleanup()

    def backend(self, handler):
        def wrapped(req):
            self.requests.append(req)
            return handler(req)
        return Backend(self.root, lambda: httpx.AsyncClient(transport=httpx.MockTransport(wrapped)))

    async def test_images_json_and_exact_fixed_endpoint(self):
        raw = png()
        backend = self.backend(lambda req: httpx.Response(200, json={'data':[{'b64_json':b64(raw)}]}))
        result = await backend.generate(ImageRequest('draw'), self.output, self.events.append)
        self.assertEqual(self.output.read_bytes(), raw)
        self.assertEqual(str(self.requests[0].url), 'https://chatgpt.com/backend-api/codex/images/generations')
        self.assertEqual(json.loads(self.requests[0].content)['model'], 'gpt-image-2')
        self.assertEqual(result.actual_image['width'], 4)
        self.assertNotIn('image_model', result.provider_reported)
        self.assertNotIn(self.token, repr(result))

    async def test_reference_edits_and_per_request_ids(self):
        reference = self.root / 'ref.png'
        reference.write_bytes(png())
        backend = self.backend(lambda req: httpx.Response(200, json={'data':[{'b64_json':b64(png())}]}))
        for _ in range(2):
            await backend.generate(ImageRequest('edit', reference_paths=(reference,)), self.output)
        self.assertTrue(str(self.requests[0].url).endswith('/images/edits'))
        self.assertEqual(json.loads(self.requests[0].content)['images'][0]['image_url'], 'data:image/png;base64,' + b64(png()))
        self.assertNotEqual(self.requests[0].headers['x-codex-image-turn-id'], self.requests[1].headers['x-codex-image-turn-id'])
        self.assertNotEqual(self.requests[0].headers['session_id'], self.requests[1].headers['session_id'])

    async def test_responses_sse_partial_dedup_and_final(self):
        raw = png(); encoded = b64(raw)
        evs = [ {'type':'response.image_generation_call.partial_image','partial_image_index':0,'partial_image_b64':encoded}, {'type':'response.image_generation_call.partial_image','partial_image_index':0,'partial_image_b64':encoded}, {'type':'response.output_item.done','item':{'type':'image_generation_call','result':encoded}}, {'type':'response.completed','response':{'id':'resp_1','model':'provider-model','usage':{'total_tokens':3}}} ]
        stream = ''.join('data: ' + json.dumps(e) + '\r\n\r\n' for e in evs)
        backend = self.backend(lambda req: httpx.Response(200, headers={'content-type':'text/event-stream'}, content=stream))
        result = await backend.generate(ImageRequest('draw', transport='responses', response_model='requested'), self.output, self.events.append)
        self.assertEqual(len([x for x in self.events if x['type']=='partial']), 1)
        self.assertEqual(result.provider_reported, {'response_model':'provider-model'})
        self.assertEqual(result.usage['total_tokens'], 3)
        self.assertEqual(json.loads(self.requests[0].content)['tools'][0]['type'], 'image_generation')

    async def test_polish_has_no_tool_and_final_precedes_delta(self):
        evs = [{'type':'response.output_text.delta','delta':'old'}, {'type':'response.output_text.done','text':'new'}]
        body = ''.join('data: '+json.dumps(e)+'\n\n' for e in evs)
        backend = self.backend(lambda req: httpx.Response(200, headers={'content-type':'text/event-stream'}, content=body))
        result = await backend.polish('p', 'i')
        self.assertEqual(result.text, 'new')
        self.assertNotIn('tools', json.loads(self.requests[0].content))

    async def test_redirect_secrets_and_failure_classification(self):
        for status, safe in [(302,False), (401,True), (403,False), (429,False), (500,False)]:
            with self.subTest(status=status):
                backend = self.backend(lambda req: httpx.Response(status, headers={'location':'https://evil.invalid/'}, text=self.token))
                with self.assertRaises(BackendError) as cm:
                    await backend.generate(ImageRequest('draw'), self.output)
                self.assertEqual(cm.exception.safe_fallback, safe)
                self.assertNotIn(self.token, str(cm.exception))
        self.assertFalse(self.output.exists())

    async def test_bad_final_and_reference_limits(self):
        backend = self.backend(lambda req: httpx.Response(200, json={'data':[{'b64_json':b64(b'bad')}]}))
        with self.assertRaises(BackendError) as cm:
            await backend.generate(ImageRequest('draw'), self.output)
        self.assertTrue(cm.exception.ambiguous)
        with self.assertRaises(BackendError) as cm:
            await backend.generate(ImageRequest('draw', reference_paths=tuple('xxxxxx')), self.output)
        self.assertTrue(cm.exception.safe_fallback)
        self.assertFalse(self.output.exists())

    async def test_expired_auth_never_dispatches(self):
        (self.root / 'auth.json').write_text('{}')
        backend = self.backend(lambda req: self.fail('unexpected dispatch'))
        with self.assertRaises(BackendError) as cm:
            await backend.generate(ImageRequest('draw'), self.output)
        self.assertTrue(cm.exception.safe_fallback)
        self.assertEqual(len(self.requests), 0)

    async def test_timeout_disconnect_and_preconnect_are_distinct(self):
        for exception, safe, ambiguous in [(httpx.ConnectError('secret'), True, False), (httpx.ReadTimeout('secret'), False, True), (httpx.ReadError('secret'), False, True)]:
            def handler(req):
                raise exception
            with self.subTest(error=type(exception).__name__):
                with self.assertRaises(BackendError) as cm:
                    await self.backend(handler).generate(ImageRequest('draw'), self.output)
                self.assertEqual((cm.exception.safe_fallback, cm.exception.ambiguous), (safe, ambiguous))
                self.assertNotIn('secret', str(cm.exception))
        self.assertFalse(self.output.exists())

    async def test_scrubs_secrets_in_provider_metadata(self):
        body = {'model':self.token, 'id':'test-account', 'data':[{'b64_json':b64(png()), 'revised_prompt':self.token + ' test-account'}]}
        backend = self.backend(lambda req: httpx.Response(200, json=body))
        result = await backend.generate(ImageRequest('draw'), self.output, self.events.append)
        self.assertNotIn(self.token, repr(result))
        self.assertNotIn('test-account', repr(result))
        self.assertNotIn(self.token, repr(self.events))

    async def test_image_stream_events_never_treat_final_as_partial(self):
        raw = png(); encoded = b64(raw)
        evs = [{'type':'image_generation.partial_image','partial_image_index':1,'b64_json':encoded}, {'type':'image_generation.completed','b64_json':encoded}]
        body = ''.join('data: '+json.dumps(e)+'\n\n' for e in evs)
        backend = self.backend(lambda req: httpx.Response(200, headers={'content-type':'text/event-stream'}, content=body))
        await backend.generate(ImageRequest('draw'), self.output, self.events.append)
        self.assertEqual([x['index'] for x in self.events if x['type']=='partial'], [1])

    async def test_cancellation_closes_stream_and_creates_no_output(self):
        closed = asyncio.Event()
        started = asyncio.Event()
        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                started.set()
                try:
                    await asyncio.Event().wait()
                    yield b''
                finally:
                    closed.set()
            async def aclose(self):
                closed.set()
        backend = self.backend(lambda req: httpx.Response(200, headers={'content-type':'text/event-stream'}, stream=Stream()))
        task = asyncio.create_task(backend.generate(ImageRequest('draw'), self.output))
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(closed.is_set())
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob('*.tmp')), [])

    async def test_response_limits_fail_ambiguously(self):
        backend = self.backend(lambda req: httpx.Response(200, content=b' ' * 100))
        with mock.patch.object(image_backend, 'MAX_RESPONSE', 32):
            with self.assertRaises(BackendError) as cm:
                await backend.generate(ImageRequest('draw'), self.output)
        self.assertEqual(cm.exception.code, 'response_too_large')
        self.assertTrue(cm.exception.ambiguous)
        self.assertFalse(self.output.exists())

    async def test_response_generation_completed_event(self):
        body = 'data: ' + json.dumps({'type':'response.image_generation_call.completed', 'result':b64(png())}) + '\n\n'
        backend = self.backend(lambda req: httpx.Response(200, headers={'content-type':'text/event-stream'}, content=body))
        await backend.generate(ImageRequest('draw', transport='responses', response_model='model'), self.output)
        self.assertEqual(self.output.read_bytes(), png())

    async def test_sse_without_content_type_and_fragmented_prefix(self):
        raw = png()
        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                for chunk in [b'  ', b'd', b'ata: ', json.dumps({'type':'image_generation.completed', 'b64_json':b64(raw)}).encode(), b'\r\n\r\n']:
                    yield chunk
        backend = self.backend(lambda req: httpx.Response(200, stream=Stream()))
        await backend.generate(ImageRequest('draw'), self.output)
        self.assertEqual(self.output.read_bytes(), raw)

    async def test_metadata_reservation_failure_happens_before_output_write(self):
        backend = self.backend(lambda req: httpx.Response(200, json={'data':[{'b64_json':b64(png())}]}))
        def reserve(event):
            if event['type'] == 'metadata':
                self.assertEqual(event['actual_image']['bytes'], len(png()))
                raise RuntimeError('reservation failed')
        with self.assertRaisesRegex(RuntimeError, 'reservation failed'):
            await backend.generate(ImageRequest('draw'), self.output, reserve)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob('*.tmp')), [])

    async def test_images_stream_options_and_json_compatibility(self):
        backend = self.backend(lambda req: httpx.Response(200, json={'data':[{'b64_json':b64(png())}]}))
        await backend.generate(ImageRequest('draw', partial_images=2), self.output)
        payload = json.loads(self.requests[-1].content)
        self.assertEqual((payload['stream'], payload['partial_images']), (True, 2))
        await backend.generate(ImageRequest('draw', partial_images=0), self.output)
        payload = json.loads(self.requests[-1].content)
        self.assertNotIn('stream', payload)
        self.assertNotIn('partial_images', payload)

    async def test_unsupported_parameter_fallback_is_narrow(self):
        for body, safe in [({'error':{'code':'unknown_parameter'}}, True), ({'error':{'code':'unsupported_parameter'}}, True), ({'error':{'code':'insufficient_quota'}}, False), ({'error':{'code':'content_policy_violation'}}, False), ({'error':{'code':'unknown_parameter'}, 'data':[{'b64_json':b64(png())}]}, False)]:
            with self.subTest(body=body):
                backend = self.backend(lambda req: httpx.Response(400, json=body))
                with self.assertRaises(BackendError) as cm:
                    await backend.generate(ImageRequest('draw'), self.output)
                self.assertEqual(cm.exception.safe_fallback, safe)

    async def test_partial_arrives_live_and_receiving_waits_for_verified_final(self):
        for transport in ('images', 'responses'):
            with self.subTest(transport=transport):
                self.events.clear()
                delivered = asyncio.Event()
                release = asyncio.Event()
                partial_type = 'response.image_generation_call.partial_image' if transport == 'responses' else 'image_generation.partial_image'
                partial = {'type':partial_type, 'partial_image_index':0, ('partial_image_b64' if transport == 'responses' else 'b64_json'):b64(png())}
                final = {'type':'response.output_item.done', 'item':{'type':'image_generation_call','result':b64(png())}} if transport == 'responses' else {'type':'image_generation.completed', 'b64_json':b64(png())}
                class Stream(httpx.AsyncByteStream):
                    async def __aiter__(self):
                        yield ('data: '+json.dumps(partial)+'\n\n').encode()
                        await release.wait()
                        yield ('data: '+json.dumps(final)+'\n\n').encode()
                backend = self.backend(lambda req: httpx.Response(200, stream=Stream()))
                def capture(event):
                    self.events.append(event)
                    if event['type'] == 'partial': delivered.set()
                task = asyncio.create_task(backend.generate(ImageRequest('draw', transport=transport, response_model='model'), self.output, capture))
                await asyncio.wait_for(delivered.wait(), 3)
                stages = [e['stage'] for e in self.events if e['type']=='stage']
                self.assertEqual(stages, ['sending', 'dispatching', 'generating'] if transport == 'responses' else ['sending', 'generating'])
                self.assertFalse(task.done())
                self.assertNotIn('receiving', stages)
                release.set()
                await task
                stages = [e['stage'] for e in self.events if e['type']=='stage']
                self.assertEqual(stages[-1], 'receiving')
                self.assertGreater(next(i for i,e in enumerate(self.events) if e.get('stage')=='receiving'), next(i for i,e in enumerate(self.events) if e['type']=='partial'))

    async def test_bad_final_never_emits_receiving(self):
        backend = self.backend(lambda req: httpx.Response(200, json={'data':[{'b64_json':b64(b'bad')}] }))
        with self.assertRaises(BackendError):
            await backend.generate(ImageRequest('draw'), self.output, self.events.append)
        self.assertNotIn('receiving', [e['stage'] for e in self.events if e['type']=='stage'])

    async def test_responses_dispatch_requires_explicit_generation_event(self):
        evs = [{'type':'response.created'}, {'type':'response.output_item.done','item':{'type':'image_generation_call','result':b64(png())}}]
        body = ''.join('data: '+json.dumps(e)+'\n\n' for e in evs)
        backend = self.backend(lambda req: httpx.Response(200, content=body))
        await backend.generate(ImageRequest('draw', transport='responses', response_model='model'), self.output, self.events.append)
        self.assertEqual([e['stage'] for e in self.events if e['type']=='stage'], ['sending','dispatching','receiving'])

    async def test_polish_emits_only_polishing_stage(self):
        backend = self.backend(lambda req: httpx.Response(200, content='data: '+json.dumps({'type':'response.output_text.done','text':'ok'})+'\n\n'))
        await backend.polish('p', 'i', on_event=self.events.append)
        self.assertEqual([e['stage'] for e in self.events if e['type']=='stage'], ['polishing'])

    async def test_more_than_three_distinct_partial_indices_rejected(self):
        evs = [{'type':'image_generation.partial_image','partial_image_index':i,'b64_json':b64(png())} for i in range(4)]
        body = ''.join('data: '+json.dumps(e)+'\n\n' for e in evs)
        backend = self.backend(lambda req: httpx.Response(200, content=body))
        with self.assertRaises(BackendError) as cm:
            await backend.generate(ImageRequest('draw'), self.output, self.events.append)
        self.assertTrue(cm.exception.ambiguous)
        self.assertEqual(len([e for e in self.events if e['type']=='partial']), 3)
        self.assertFalse(self.output.exists())

    async def test_sse_split_crlf_multiline(self):
        async def chunks():
            for piece in [b'da', b'ta: {"a":\r', b'\ndata: 1}\r\n\r', b'\n']:
                yield piece
        self.assertEqual([json.loads(x) async for x in _sse(chunks())], [{'a':1}])

if __name__ == '__main__':
    unittest.main()
