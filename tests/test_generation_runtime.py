import asyncio
import contextlib
import io
import importlib
import os
import time
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

import generation_runtime as runtime
from image_backend import BackendError, BackendResult, PolishResult


def image_bytes():
    out = io.BytesIO()
    Image.new('RGB', (32, 24), 'blue').save(out, format='PNG')
    return out.getvalue()


class Storage:
    def __init__(self):
        self.requests = []
        self.fail = False
        self.on_require = None
    def require(self, size, reason):
        self.requests.append((size, reason))
        if self.on_require:
            self.on_require()
        if self.fail:
            raise RuntimeError('storage full')


class Studio:
    def __init__(self, root, transport='images', fallback=True):
        self.DATA = root
        self.CODEX_HOME = root / 'fake-auth'
        self.STORAGE = Storage()
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("CREATE TABLE jobs (id TEXT PRIMARY KEY, attempt INTEGER, status TEXT, options TEXT, polished_prompt TEXT, polish_source TEXT, max_attempts INTEGER DEFAULT 2)")
        self.db.execute("CREATE TABLE attempts (job_id TEXT, status TEXT, polished_prompt TEXT, polish_source TEXT)")
        self.db.execute("CREATE TABLE sessions (token TEXT, expires REAL)")
        runtime.initialize(self.db)
        settings = {'image_backend':{'transport':transport, 'fallback':fallback, 'image_model':'gpt-image-2', 'quality':'auto', 'partial_images':2}, 'polish_text_prompt':'Improve: {prompt}'}
        self.db.execute('INSERT INTO jobs(id,attempt,status,options) VALUES(?,?,?,?)', ('job1', 1, 'running', json.dumps({'generation':settings, 'ratio':'auto', 'size':'auto'})))
        self.db.execute("INSERT INTO attempts(job_id,status) VALUES('job1','running')")
        self.db.commit()
        self.counter = 0
    def uid(self):
        self.counter += 1
        return f'{self.counter:032x}'
    def query(self, sql, args=(), one=False):
        cur = self.db.execute(sql, args)
        return cur.fetchone() if one else cur.fetchall()
    def write(self, sql, args=()):
        cur = self.db.execute(sql, args)
        self.db.commit()
        return cur.rowcount
    def job_cancelled(self, jid):
        return self.query('SELECT status FROM jobs WHERE id=?', (jid,), True)['status'] == 'cancelled'
    def cancel(self):
        self.write("UPDATE jobs SET status='cancelled' WHERE id='job1'")
    def set_job_stage(self, *args):
        pass
    @contextlib.asynccontextmanager
    async def cli_slot(self, *args):
        yield
    def require_user(self):
        return True
    def latest(self):
        return json.loads(self.query('SELECT detail FROM generation_calls ORDER BY rowid DESC LIMIT 1', (), True)['detail'])


class GenerationRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.studio = Studio(self.root)
        self.output_dir = self.root / 'jobs' / 'job1' / 'call'
    def tearDown(self):
        self.studio.db.close()
        self.temp.cleanup()
    async def generate(self, legacy=None):
        return await runtime.generate(self.studio, 'job1', self.output_dir, 'base', 'image brief', [], 'outer-model', 'high', legacy=legacy)

    async def test_direct_call_keeps_requested_provider_and_actual_separate(self):
        seen = []
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def generate(self, request, output, event):
                seen.append(request)
                await event({'type':'metadata', 'provider_reported':{'image_model':'provider-model'}, 'actual_image':{'bytes':len(image_bytes()), 'width':32, 'height':24}})
                output.write_bytes(image_bytes())
                return BackendResult(output, {'image_model':request.image_model, 'size':'auto'}, {'image_model':'provider-model'}, {'bytes':len(image_bytes()), 'width':32, 'height':24})
        with patch.object(runtime, 'Backend', Backend):
            result = await self.generate()
        row = self.studio.latest()
        self.assertEqual(result.read_bytes(), image_bytes())
        self.assertEqual(row['requested']['image_model'], 'gpt-image-2')
        self.assertEqual(row['provider_reported']['image_model'], 'provider-model')
        self.assertEqual(row['actual_image']['width'], 32)
        self.assertTrue(any(size == len(image_bytes()) for size, _ in self.studio.STORAGE.requests))
        self.assertEqual(len(seen), 1)

    async def test_safe_failure_falls_back_once_and_never_claims_provider_model(self):
        counts = {'direct':0, 'legacy':0}
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def generate(self, *args):
                counts['direct'] += 1
                raise BackendError('auth_unavailable', safe_fallback=True)
        async def legacy():
            counts['legacy'] += 1
            path = self.root / 'cli.png'; path.write_bytes(image_bytes()); return path
        with patch.object(runtime, 'Backend', Backend):
            await self.generate(legacy)
        row = self.studio.latest()
        self.assertEqual(counts, {'direct':1, 'legacy':1})
        self.assertEqual(row['fallback']['reason'], 'auth_unavailable')
        self.assertEqual(row['provider_reported'], {})
        self.assertEqual(row['status'], 'succeeded')

    async def test_ambiguous_failure_never_retries_or_falls_back(self):
        calls = []
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def generate(self, *args):
                calls.append('direct'); raise BackendError('transport_interrupted', ambiguous=True)
        async def legacy():
            calls.append('legacy')
        with patch.object(runtime, 'Backend', Backend):
            with self.assertRaises(runtime.GenerationFailure) as cm:
                await self.generate(legacy)
        self.assertTrue(cm.exception.ambiguous)
        self.assertEqual(calls, ['direct'])
        self.assertEqual(self.studio.latest()['status'], 'failed')

    async def test_ambiguous_failure_cannot_fallback_even_if_flagged_safe(self):
        calls = []
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def generate(self, *args):
                calls.append('direct')
                raise BackendError('inconsistent_failure', safe_fallback=True, ambiguous=True)
        async def legacy():
            calls.append('legacy')
        with patch.object(runtime, 'Backend', Backend):
            with self.assertRaises(runtime.GenerationFailure):
                await self.generate(legacy)
        self.assertEqual(calls, ['direct'])

    async def test_polish_result_is_used_for_image_prompt(self):
        seen = []
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def polish(self, prompt, instruction, **kwargs):
                seen.append(('polish', prompt, instruction)); return PolishResult(' polished text ', {'response_model':'outer'}, {}, {}, {})
            async def generate(self, request, output, event):
                seen.append(('image', request.prompt)); output.write_bytes(image_bytes())
                return BackendResult(output, {}, {}, {'width':32,'height':24})
        async def legacy(*args): self.fail('unexpected fallback')
        with patch.object(runtime, 'Backend', Backend):
            text = await runtime.polish(self.studio, 'job1', self.root / 'polish', 'original', [], 'outer', 'high', legacy)
            self.output_dir.mkdir(parents=True, exist_ok=True)
            await runtime.generate(self.studio, 'job1', self.output_dir, 'base', runtime.image_brief({}, text), [], 'outer', 'high', legacy=legacy)
        self.assertEqual(text, 'polished text')
        self.assertIn('polished text', seen[1][1])
        self.assertEqual(self.studio.query("SELECT polished_prompt FROM jobs WHERE id='job1'", (), True)['polished_prompt'], 'polished text')

    async def test_run_job_passes_dedicated_polish_output_to_image(self):
        import stitch_workflow
        for column, definition in [('stage','TEXT'),('error','TEXT'),('finished','REAL'),('refs','TEXT'),('prompt','TEXT')]:
            self.studio.db.execute(f'ALTER TABLE jobs ADD COLUMN {column} {definition}')
        for column, definition in [('number','INTEGER'),('started','REAL'),('finished','REAL'),('error','TEXT')]:
            self.studio.db.execute(f'ALTER TABLE attempts ADD COLUMN {column} {definition}')
        row = self.studio.query('SELECT options FROM jobs WHERE id=?', ('job1',), True)
        options = json.loads(row['options'])
        options.update(polish=True, model='outer', effort='high')
        self.studio.write("UPDATE jobs SET options=?,refs='[]',prompt='original' WHERE id='job1'", (json.dumps(options),))
        self.studio.PROCESSES = {}
        self.studio.WAKE = asyncio.Event()
        self.studio.STORAGE.invalidate = lambda: None
        published, seen = [], []
        self.studio.record_generated_image = lambda jid, output: published.append((jid, output))
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def polish(self, prompt, instructions, **kwargs):
                seen.append(('polish', prompt, instructions))
                return PolishResult('polished visual brief', {}, {}, {}, {})
        async def cli_call(studio, jid, directory, scope, instruction, *args, **kwargs):
            seen.append(('image', instruction))
            path = directory / 'output.png'; path.write_bytes(image_bytes()); return path
        with patch.object(runtime, 'Backend', Backend), patch.object(stitch_workflow, 'cli_call', cli_call):
            await runtime.run_job(self.studio, 'job1')
        self.assertEqual(seen[0][0], 'polish')
        self.assertIn('polished visual brief', seen[1][1])
        self.assertEqual(len(published), 1)

    async def test_inspection_text_call_keeps_scope_references_and_polish_untouched(self):
        seen, stages = [], []
        reference = self.root / 'ref.png'; reference.write_bytes(image_bytes())
        self.studio.write("UPDATE jobs SET polished_prompt='existing' WHERE id='job1'")
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def polish(self, prompt, instructions, **kwargs):
                seen.append((prompt, instructions, kwargs))
                await kwargs['on_event']({'type':'stage','stage':'polishing'})
                return PolishResult('{"pass":true}', {'response_model':'outer'}, {'response_model':'observed'}, {}, {})
        async def legacy(): self.fail('unexpected fallback')
        with patch.object(runtime, 'Backend', Backend):
            text = await runtime.text_call(self.studio, 'job1', self.root / 'inspect', 'final-inspection', 'inspect', [reference], 'outer', 'high', legacy, lambda *args: stages.append(args))
        self.assertEqual(json.loads(text), {'pass':True})
        self.assertEqual(seen[0][2]['refs'], (reference,))
        self.assertNotIn('tools', seen[0][2])
        self.assertEqual(self.studio.latest()['kind'], 'inspection')
        self.assertEqual(self.studio.latest()['scope'], 'final-inspection')
        self.assertEqual(self.studio.latest()['provider_reported'], {'response_model':'observed'})
        self.assertEqual(self.studio.latest()['stage'], 'inspecting')
        self.assertTrue(stages)
        self.assertNotIn('polishing', [stage[0] for stage in stages])
        self.assertEqual(self.studio.query("SELECT polished_prompt FROM jobs WHERE id='job1'", (), True)['polished_prompt'], 'existing')

    async def test_inspection_safe_fallback_once_and_ambiguous_never_falls_back(self):
        for safe, ambiguous, expected in [(True, False, 1), (False, True, 0), (True, True, 0)]:
            with self.subTest(safe=safe, ambiguous=ambiguous):
                calls = []
                class Backend:
                    def __init__(self, *args, **kwargs): pass
                    async def polish(self, *args, **kwargs): raise BackendError('failure', safe_fallback=safe, ambiguous=ambiguous)
                async def legacy(): calls.append('cli'); return '{"pass":true}'
                with patch.object(runtime, 'Backend', Backend):
                    if expected:
                        self.assertEqual(await runtime.text_call(self.studio, 'job1', self.root / 'inspect', 'inspection', 'inspect', [], 'outer', 'low', legacy), '{"pass":true}')
                        self.assertEqual(self.studio.latest()['provider_reported'], {})
                    else:
                        with self.assertRaises(runtime.GenerationFailure):
                            await runtime.text_call(self.studio, 'job1', self.root / 'inspect', 'inspection', 'inspect', [], 'outer', 'low', legacy)
                        self.assertEqual(self.studio.latest()['status'], 'failed')
                self.assertEqual(len(calls), expected)

    async def test_inspection_late_completion_cancelled_without_publishing(self):
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def polish(inner, *args, **kwargs):
                self.studio.cancel()
                return PolishResult('{"pass":true}', {}, {}, {}, {})
        async def legacy(): self.fail('unexpected fallback')
        with patch.object(runtime, 'Backend', Backend):
            with self.assertRaises(asyncio.CancelledError):
                await runtime.text_call(self.studio, 'job1', self.root / 'inspect', 'scope', 'inspect', [], 'outer', 'low', legacy)
        self.assertEqual(self.studio.latest()['status'], 'cancelled')
        job = self.studio.query("SELECT generation_detail,polished_prompt FROM jobs WHERE id='job1'", (), True)
        self.assertEqual(json.loads(job['generation_detail'])['status'], 'cancelled')
        self.assertIsNone(job['polished_prompt'])

    async def test_log_summary_is_bounded_chronological_and_omits_sensitive_fields(self):
        secret = 'eyJpayload.secret.signature'
        for index in range(55):
            detail = {'kind':'image', 'scope':f'image-{index}', 'transport':'images', 'status':'failed', 'prompt':secret, 'base64':secret,
                      'requested':{'image_model':'gpt-image-2','quality':'high'}, 'provider_reported':{'image_model':secret},
                      'fallback':{'from':'images','to':'cli','reason':'auth_unavailable'}, 'ambiguous':True}
            self.studio.write('INSERT INTO generation_calls(id,job_id,attempt,scope,kind,status,created,updated,detail,prompt) VALUES(?,?,?,?,?,?,?,?,?,?)',
                              (f'{index:032x}', 'job1', 1, 'image', 'image', 'failed', index, index, json.dumps(detail), secret))
        text = runtime.log_text(self.studio, 'job1')
        lines = [json.loads(line) for line in text.splitlines()]
        self.assertEqual(len(lines), 50)
        self.assertEqual([x['time'] for x in lines], list(range(5,55)))
        self.assertNotIn(secret, text)
        self.assertNotIn('base64', text)
        self.assertIsNone(lines[0]['message']['provider_reported']['image_model'])
        self.assertEqual(lines[0]['message']['requested']['image_model'], 'gpt-image-2')
        self.assertTrue(lines[0]['message']['ambiguous'])

    async def test_event_stream_heartbeats_and_revoked_session_closes(self):
        self.studio.write('INSERT INTO sessions(token,expires) VALUES(?,?)', ('digest', time.time()+30))
        app = FastAPI()
        runtime.register(app, self.studio)
        endpoint = next(route.endpoint for route in app.routes if route.path.endswith('/generation-events'))
        response = await endpoint('job1', session={'token':'digest'})
        iterator = response.body_iterator
        with patch.object(runtime, 'EVENT_HEARTBEAT_SECONDS', .02), patch.object(runtime, 'EVENT_POLL_SECONDS', .005):
            first = await asyncio.wait_for(anext(iterator), 1)
            self.assertTrue(first.startswith('data: '))
            heartbeat = await asyncio.wait_for(anext(iterator), 1)
            self.assertEqual(heartbeat, ': keep-alive\n\n')
            self.assertNotIn('digest', first + heartbeat)
            self.studio.write('DELETE FROM sessions WHERE token=?', ('digest',))
            with self.assertRaises(StopAsyncIteration):
                await asyncio.wait_for(anext(iterator), 1)

    async def test_event_stream_terminal_state_is_final(self):
        self.studio.write("UPDATE jobs SET status='succeeded' WHERE id='job1'")
        app = FastAPI()
        runtime.register(app, self.studio)
        endpoint = next(route.endpoint for route in app.routes if route.path.endswith('/generation-events'))
        iterator = (await endpoint('job1', session={'token':'digest'})).body_iterator
        self.assertIn('succeeded', await anext(iterator))
        with self.assertRaises(StopAsyncIteration):
            await anext(iterator)

    async def test_queued_cancel_does_not_create_attempt_or_dispatch(self):
        self.studio.cancel()
        before = self.studio.query('SELECT COUNT(*) AS n FROM attempts', (), True)['n']
        with patch.object(runtime, 'Backend', side_effect=AssertionError('unexpected dispatch')):
            await runtime.run_job(self.studio, 'job1')
        self.assertEqual(self.studio.query('SELECT COUNT(*) AS n FROM attempts', (), True)['n'], before)
        self.assertEqual(self.studio.query('SELECT COUNT(*) AS n FROM generation_calls', (), True)['n'], 0)

    async def test_cancelled_late_result_not_marked_success(self):
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def polish(inner, *args, **kwargs):
                self.studio.cancel()
                return PolishResult('late text', {}, {}, {}, {})
        async def legacy(*args): self.fail('unexpected fallback')
        with patch.object(runtime, 'Backend', Backend):
            with self.assertRaises(asyncio.CancelledError):
                await runtime.polish(self.studio, 'job1', self.root / 'polish', 'original', [], 'outer', 'high', legacy)
        row = self.studio.latest()
        self.assertEqual(row['status'], 'cancelled')
        self.assertIsNone(self.studio.query("SELECT polished_prompt FROM jobs WHERE id='job1'", (), True)['polished_prompt'])

    async def test_failed_reservation_cannot_publish_or_succeed(self):
        self.studio.STORAGE.fail = True
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def generate(self, request, output, event):
                await event({'type':'metadata', 'actual_image':{'bytes':len(image_bytes())}})
                output.write_bytes(image_bytes())
        with patch.object(runtime, 'Backend', Backend):
            with self.assertRaisesRegex(RuntimeError, 'storage full'):
                await self.generate()
        self.assertFalse((self.output_dir / 'output.png').exists())
        self.assertEqual(self.studio.latest()['status'], 'failed')

    async def test_partial_preview_persisted_in_call_directory_and_invalid_url_404(self):
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def generate(self, request, output, event):
                await event({'type':'partial', 'index':1, 'data':image_bytes()})
                output.write_bytes(image_bytes())
                return BackendResult(output, {}, {}, {'width':32,'height':24})
        with patch.object(runtime, 'Backend', Backend):
            await self.generate()
        value = self.studio.latest()
        preview = self.root / 'jobs' / 'job1' / 'generation-previews' / value['id'] / 'preview.webp'
        self.assertTrue(preview.is_file())
        with Image.open(preview) as image:
            image.load()
            self.assertLessEqual(max(image.size), 1024)
        app = FastAPI()
        runtime.register(app, self.studio)
        with TestClient(app) as client:
            self.assertEqual(client.get(value['preview']['url']).status_code, 200)
            self.assertEqual(client.get('/api/jobs/job1/generation-preview/../../invalid').status_code, 404)
            preview.unlink()
            self.assertEqual(client.get(value['preview']['url']).status_code, 404)

    async def test_cancel_during_preview_write_does_not_replace_published_frame(self):
        call = runtime.Call(self.studio, 'job1', self.output_dir, 'base', 'image', 'brief', 'images')
        await call.event({'type':'partial', 'index':0, 'data':image_bytes()})
        path = call.preview_directory / 'preview.webp'
        initial = path.read_bytes()
        started, release = threading.Event(), threading.Event()
        original = runtime.save_preview
        def blocked(studio, directory, raw):
            started.set()
            release.wait(5)
            original(studio, directory, raw)
        other = io.BytesIO()
        Image.new('RGB', (32, 24), 'yellow').save(other, format='PNG')
        with patch.object(runtime, 'save_preview', blocked):
            task = asyncio.create_task(call.event({'type':'partial', 'index':1, 'data':other.getvalue()}))
            self.assertTrue(await asyncio.to_thread(started.wait, 5))
            self.studio.cancel()
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(path.read_bytes(), initial)
        self.assertEqual(self.studio.latest()['preview']['index'], 0)

    async def test_partial_preview_not_published_after_cancel(self):
        class Backend:
            def __init__(self, *args, **kwargs): pass
            async def generate(inner, request, output, event):
                self.studio.cancel()
                await event({'type':'partial', 'index':0, 'data':image_bytes()})
        with patch.object(runtime, 'Backend', Backend):
            with self.assertRaises(asyncio.CancelledError):
                await self.generate()
        self.assertNotIn('preview', self.studio.latest())
        self.assertEqual(self.studio.latest()['status'], 'cancelled')

class APITaskTests(unittest.TestCase):
    def test_real_sqlite_api_task_with_mock_backend(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'STUDIO_DATA':temp, 'STUDIO_SETUP_TOKEN':'api-test-secret', 'STUDIO_SETUP_TOKEN_FILE':''}):
            import app
            studio = importlib.reload(app)
            class Backend:
                image_calls = 0
                polish_calls = 0
                def __init__(self, *args, **kwargs): pass
                async def polish(self, prompt, instructions, **kwargs):
                    Backend.polish_calls += 1
                    return PolishResult('safe retry polished', {}, {}, {}, {})
                async def generate(self, request, output, on_event):
                    if 'safe retry polished' in request.prompt:
                        Backend.image_calls += 1
                        if Backend.image_calls == 1:
                            raise BackendError('connection_failed', safe_fallback=True, retryable=True)
                    if 'cancel retry' in request.prompt:
                        raise BackendError('connection_failed', safe_fallback=True, retryable=True)
                    if 'simulated failure' in request.prompt:
                        raise BackendError('transport_interrupted', ambiguous=True)
                    raw = image_bytes()
                    await on_event({'type':'stage','stage':'generating'})
                    await on_event({'type':'partial','index':0,'data':raw})
                    await on_event({'type':'metadata','provider_reported':{'image_model':'observed'},'actual_image':{'bytes':len(raw),'width':32,'height':24,'format':'png'}})
                    output.write_bytes(raw)
                    return BackendResult(output, {'image_model':request.image_model}, {'image_model':'observed'}, {'bytes':len(raw),'width':32,'height':24,'format':'png'})
            async def fake_command(*args, **kwargs): return (0, 'Logged in using ChatGPT')
            with patch.object(runtime, 'Backend', Backend), patch.object(studio, 'command', fake_command), TestClient(studio.app, base_url='https://image.example.com') as client:
                setup = client.post('/api/auth/setup', json={'username':'admin','password':'test-password-long','setup_token':'api-test-secret'})
                self.assertEqual(setup.status_code, 200, setup.text)
                headers = {'X-CSRF-Token':setup.json()['csrf'], 'Origin':'https://image.example.com'}
                response = client.post('/api/jobs', json={'prompt':'test real sqlite task'}, headers=headers)
                self.assertEqual(response.status_code, 200, response.text)
                jid = response.json()['ids'][0]
                deadline = time.monotonic() + 12
                while time.monotonic() < deadline:
                    job_response = client.get('/api/jobs/' + jid)
                    self.assertEqual(job_response.status_code, 200)
                    job = job_response.json()
                    if job['status'] in ('succeeded','failed','cancelled'): break
                    time.sleep(.05)
                self.assertEqual(job['status'], 'succeeded', job)
                self.assertTrue(job['outputs'])
                history = client.get(f'/api/jobs/{jid}/generation-calls')
                self.assertEqual(history.status_code, 200)
                call = history.json()['items'][0]
                self.assertEqual(call['status'], 'succeeded')
                self.assertEqual(call['provider_reported']['image_model'], 'observed')
                self.assertEqual(call['actual_image']['width'], 32)
                self.assertEqual(client.get(call['preview']['url']).status_code, 200)
                log = client.get(f'/api/jobs/{jid}/log')
                self.assertEqual(log.status_code, 200)
                records = [json.loads(line) for line in log.json()['text'].splitlines()]
                self.assertEqual(records[0]['type'], 'generation_call_summary')
                self.assertEqual(records[0]['message']['status'], 'succeeded')
                self.assertNotIn('test real sqlite task', log.json()['text'])
                self.assertNotIn('api-test-secret', log.json()['text'])
                call_dir = Path(temp) / 'jobs' / jid / 'calls' / 'image-1'
                self.assertTrue((call_dir / 'request.json').is_file())
                self.assertTrue((call_dir / 'output.png').is_file())
                dbrow = studio.query('SELECT status, detail FROM generation_calls WHERE job_id=?', (jid,), True)
                self.assertEqual(dbrow['status'], 'succeeded')
                self.assertNotIn('api-test-secret', dbrow['detail'])
                failed = client.post('/api/jobs', json={'prompt':'simulated failure'}, headers=headers)
                self.assertEqual(failed.status_code, 200, failed.text)
                failure_id = failed.json()['ids'][0]
                deadline = time.monotonic() + 12
                while time.monotonic() < deadline:
                    failure = client.get('/api/jobs/' + failure_id).json()
                    if failure['status'] in ('succeeded','failed','cancelled'): break
                    time.sleep(.05)
                self.assertEqual(failure['status'], 'failed', failure)
                failure_calls = client.get(f'/api/jobs/{failure_id}/generation-calls').json()['items']
                self.assertEqual(len(failure_calls), 1)
                self.assertEqual(failure_calls[0]['status'], 'failed')
                self.assertTrue(failure_calls[0]['ambiguous'])
                self.assertEqual(studio.query('SELECT COUNT(*) AS n FROM attempts WHERE job_id=?', (failure_id,), True)['n'], 1)
                studio.set_setting('image_backend', {'transport':'images', 'fallback':False, 'image_model':'gpt-image-2', 'quality':'auto', 'partial_images':2})
                retried = client.post('/api/jobs', json={'prompt':'safe retry', 'polish':True, 'max_attempts':2}, headers=headers)
                self.assertEqual(retried.status_code, 200, retried.text)
                retry_id = retried.json()['ids'][0]
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    retry_job = client.get('/api/jobs/' + retry_id).json()
                    if retry_job['status'] in ('succeeded','failed','cancelled'): break
                    time.sleep(.05)
                self.assertEqual(retry_job['status'], 'succeeded', retry_job)
                self.assertEqual((Backend.polish_calls, Backend.image_calls), (1, 2))
                retry_calls = client.get(f'/api/jobs/{retry_id}/generation-calls').json()['items']
                self.assertEqual(len([x for x in retry_calls if x['kind']=='image']), 2)
                self.assertEqual(sorted(x['status'] for x in retry_calls if x['kind']=='image'), ['failed','succeeded'])
                self.assertEqual(studio.query('SELECT COUNT(*) AS n FROM attempts WHERE job_id=?', (retry_id,), True)['n'], 2)
                pending = client.post('/api/jobs', json={'prompt':'cancel retry', 'max_attempts':2}, headers=headers)
                self.assertEqual(pending.status_code, 200, pending.text)
                pending_id = pending.json()['ids'][0]
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    pending_job = client.get('/api/jobs/' + pending_id).json()
                    if pending_job['status'] == 'retrying': break
                    time.sleep(.05)
                self.assertEqual(pending_job['status'], 'retrying', pending_job)
                self.assertEqual(client.post(f'/api/jobs/{pending_id}/cancel', headers=headers).status_code, 200)
                self.assertEqual(client.get('/api/jobs/' + pending_id).json()['status'], 'cancelled')
                self.assertEqual(studio.query('SELECT COUNT(*) AS n FROM attempts WHERE job_id=?', (pending_id,), True)['n'], 1)
                studio.set_setting('paused', True)
                queued = client.post('/api/jobs', json={'prompt':'queued cancel'}, headers=headers)
                self.assertEqual(queued.status_code, 200, queued.text)
                queued_id = queued.json()['ids'][0]
                cancelled = client.post(f'/api/jobs/{queued_id}/cancel', headers=headers)
                self.assertEqual(cancelled.status_code, 200, cancelled.text)
                self.assertEqual(client.get('/api/jobs/' + queued_id).json()['status'], 'cancelled')
                self.assertEqual(studio.query('SELECT COUNT(*) AS n FROM generation_calls WHERE job_id=?', (queued_id,), True)['n'], 0)


if __name__ == '__main__': unittest.main()
