"""V2 upscale prompt contracts. Local deterministic fixtures only; no real CLI."""
import copy
import importlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image
from stitch_planner import execution_plan, progressive_plan


class UpscalePromptV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parent.parent / '.build-cache' / 'overhaul' / 'test-data'
        root.mkdir(parents=True, exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix='prompts-', dir=root)
        keys = ('STUDIO_DATA', 'STUDIO_SETUP_TOKEN', 'STUDIO_SETUP_TOKEN_FILE', 'CODEX_BIN')
        cls.environment = {key: os.environ.get(key) for key in keys}
        os.environ['STUDIO_DATA'] = cls.temp.name
        os.environ['STUDIO_SETUP_TOKEN'] = 'upscale-prompts-test-only'
        os.environ['CODEX_BIN'] = str(Path(cls.temp.name) / 'nonexistent-test-cli')
        os.environ.pop('STUDIO_SETUP_TOKEN_FILE', None)
        import app
        cls.studio = importlib.reload(app)
        cls.client = TestClient(cls.studio.app, base_url='https://prompts.test')
        cls.client.__enter__()
        result = cls.client.post('/api/auth/setup', json={'username': 'admin', 'password': 'test-password-long', 'setup_token': 'upscale-prompts-test-only'})
        cls.headers = {'X-CSRF-Token': result.json()['csrf'], 'Origin': 'https://prompts.test'}
        cls.studio.set_setting('paused', True)
        image = io.BytesIO()
        Image.new('RGB', (128, 96), 'white').save(image, 'PNG')
        cls.asset = cls.client.post('/api/assets', files={'file': ('source.png', image.getvalue(), 'image/png')}, headers=cls.headers).json()['asset']
        stage = progressive_plan(128, 96, 4)['stages'][0]
        cls.plan = execution_plan(stage)
        cls.tile = cls.plan['tiles'][0]

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.temp.cleanup()
        for key, value in cls.environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def post(self, path, body):
        with patch.object(self.studio, 'command', AsyncMock(return_value=(0, 'Logged in using ChatGPT (fixture)'))):
            return self.client.post(path, json=body, headers=self.headers)

    def new_task(self, **kwargs):
        request = self.studio.JobInput(prompt='HISTORY-MARKER original request', source_asset_id=self.asset['id'], stitch=4, **kwargs)
        jid = self.studio.create_jobs(request)['ids'][0]
        job = self.client.get('/api/jobs/' + jid).json()
        return jid, job

    @staticmethod
    def assert_compiled(test, result):
        test.assertIsInstance(result, dict)
        test.assertIsInstance(result.get('worker_instruction'), str)
        test.assertTrue(result['worker_instruction'].strip())
        test.assertIn('components', result)
        test.assertTrue(result.get('snapshot_revision'))
        return result['worker_instruction']

    def compile_image(self, options, source='HISTORY-MARKER original request', level=1, tile=None, feedback=''):
        import upscale_prompts
        before = copy.deepcopy(options)
        result = upscale_prompts.compile_image(options, self.plan, tile or self.tile, source, level=level, feedback=feedback)
        self.assertEqual(options, before, 'compiling must not mutate the task snapshot')
        return result

    def options(self, *, include_source=False, append_system=True, requirements='FIXED-MARKER preserve fine ink {level}'):
        import upscale_prompts
        return {'stitch': 16, 'model': 'fixture-model', 'effort': 'high', 'transparent': False,
                'upscale_requirements': requirements, 'upscale_injection': requirements,
                'upscale_prompts': upscale_prompts.snapshot(self.studio, {'append_system': append_system, 'include_source_context': include_source})}

    def test_source_description_is_explicit_opt_in_and_requirements_are_literal(self):
        options = self.options()
        default = self.compile_image(options)
        instruction = self.assert_compiled(self, default)
        self.assertNotIn('HISTORY-MARKER', instruction)
        self.assertIn('FIXED-MARKER preserve fine ink {level}', instruction)
        enabled = self.options(include_source=True)
        included = self.compile_image(enabled)
        instruction = self.assert_compiled(self, included)
        self.assertIn('HISTORY-MARKER', instruction)
        self.assertIn('FIXED-MARKER preserve fine ink {level}', instruction)
        self.assertIn('语义', instruction)

    def test_system_switch_omits_tile_but_keeps_protocol_and_discloses_disabled_component(self):
        options = self.options(append_system=False)
        result = self.compile_image(options)
        instruction = self.assert_compiled(self, result)
        components = {component['key']: component for component in result['components']}
        self.assertFalse(components['tile']['enabled'])
        self.assertNotIn(components['tile']['text'], instruction)
        self.assertIn('FIXED-MARKER', instruction)
        self.assertIn('first reference image', instruction)
        self.assertEqual(result['snapshot_revision'], options['upscale_prompts']['revision'])

    def test_selected_repair_and_call_feedback_do_not_leak_to_other_tiles_or_levels(self):
        options = self.options()
        options['repair_scopes'] = [{'id': 'repair-one', 'level': 1, 'tiles': [self.tile['index']],
                                     'request': 'LOCAL-MARKER repair just this {prompt}', 'source': 'task_snapshot'}]
        selected = self.compile_image(options, feedback='FEEDBACK-MARKER wrong edge')
        self.assertIn('LOCAL-MARKER repair just this {prompt}', selected['worker_instruction'])
        self.assertIn('FIXED-MARKER', selected['worker_instruction'])
        self.assertIn('FEEDBACK-MARKER', selected['worker_instruction'])
        self.assertEqual(selected['scope']['repair_id'], 'repair-one')
        peer = copy.deepcopy(self.tile)
        peer['index'] += 1
        other = self.compile_image(options, tile=peer)
        later = self.compile_image(options, level=2)
        for result in (other, later):
            self.assertNotIn('LOCAL-MARKER', result['worker_instruction'])
            self.assertNotIn('FEEDBACK-MARKER', result['worker_instruction'])
            self.assertIn('FIXED-MARKER', result['worker_instruction'])
            self.assertIsNone(result['scope']['repair_id'])

    def test_review_uses_its_own_template_and_only_this_level_repairs(self):
        import upscale_prompts
        options = self.options()
        options['repair_scopes'] = [
            {'id': 'repair-one', 'level': 1, 'tiles': [self.tile['index']], 'request': 'LEVEL-ONE-MARKER'},
            {'id': 'repair-two', 'level': 2, 'tiles': [self.tile['index']], 'request': 'LEVEL-TWO-MARKER'},
        ]
        old = copy.deepcopy(options)
        first = upscale_prompts.compile_review(options, self.plan, 'HISTORY-MARKER', level=1)
        second = upscale_prompts.compile_review(options, self.plan, 'HISTORY-MARKER', level=2)
        self.assertEqual(options, old)
        self.assertIn('LEVEL-ONE-MARKER', first['worker_instruction'])
        self.assertNotIn('LEVEL-TWO-MARKER', first['worker_instruction'])
        self.assertIn('LEVEL-TWO-MARKER', second['worker_instruction'])
        self.assertNotIn('LEVEL-ONE-MARKER', second['worker_instruction'])
        for result in (first, second):
            self.assertNotIn('HISTORY-MARKER', result['worker_instruction'])
            self.assertIn('FIXED-MARKER', result['worker_instruction'])
            self.assertEqual(result['snapshot_revision'], options['upscale_prompts']['revision'])

    def test_snapshots_are_immutable_across_settings_changes_and_legacy_requirement_is_readable(self):
        import upscale_prompts
        options = self.options()
        first = self.compile_image(options)
        old = self.studio.setting('upscale_system_prompts', {})
        try:
            templates = copy.deepcopy(old)
            templates['tile'] = 'CUSTOM-CHANGED-TEMPLATE {target_size}'
            self.studio.set_setting('upscale_system_prompts', templates)
            self.assertEqual(self.compile_image(options)['worker_instruction'], first['worker_instruction'])
            newer = self.options()
            self.assertNotEqual(newer['upscale_prompts']['revision'], options['upscale_prompts']['revision'])
            self.assertIn('CUSTOM-CHANGED-TEMPLATE', self.compile_image(newer)['worker_instruction'])
            legacy = copy.deepcopy(options)
            legacy.pop('upscale_requirements')
            self.assertIn('FIXED-MARKER', self.compile_image(legacy)['worker_instruction'])
        finally:
            self.studio.set_setting('upscale_system_prompts', old)


    def test_snapshot_preserves_every_system_template_and_setting_changes_revision(self):
        import upscale_prompts
        old = self.studio.setting('upscale_system_prompts', {})
        try:
            edited = {key: f'CUSTOM-{key}-MARKER\n{value}' for key, value in upscale_prompts.DEFAULTS.items()}
            upscale_prompts.validate_templates(edited)
            self.studio.set_setting('upscale_system_prompts', edited)
            options = self.options(include_source=True)
            frozen = options['upscale_prompts']
            self.assertEqual(frozen['schema'], 3)
            self.assertEqual(frozen['templates'], edited)
            image = self.compile_image(options, feedback='RETRY-FEEDBACK')
            for key in ('image_call', 'tile', 'requirements', 'source_context', 'retry'):
                self.assertIn(f'CUSTOM-{key}-MARKER', image['worker_instruction'])
            scoped = copy.deepcopy(options)
            scoped['repair_scopes'] = [{'id': 'repair-editable', 'level': 1, 'tiles': [self.tile['index']], 'request': 'repair this'}]
            self.assertIn('CUSTOM-repair-MARKER', self.compile_image(scoped)['worker_instruction'])
            review = upscale_prompts.compile_review(options, self.plan, 'HISTORY-MARKER', level=1)
            self.assertIn('CUSTOM-review-MARKER', review['worker_instruction'])
            self.assertEqual(review['snapshot_revision'], frozen['revision'])
        finally:
            self.studio.set_setting('upscale_system_prompts', old)

    def test_schema_two_frozen_image_template_remains_unchanged(self):
        import upscale_prompts
        options = self.options()
        options['upscale_prompts']['schema'] = 2
        options['upscale_prompts']['templates']['image_call'] = upscale_prompts.LEGACY_IMAGE_CALL
        frozen = copy.deepcopy(options['upscale_prompts'])
        result = self.compile_image(options)
        self.assertEqual(options['upscale_prompts'], frozen)
        self.assertEqual(result['worker_instruction'], upscale_prompts.render(upscale_prompts.LEGACY_IMAGE_CALL, result['variables']))
        self.assertIn('reference-1.png', result['worker_instruction'])

    def test_template_validation_rejects_missing_required_and_unknown_variables(self):
        import upscale_prompts
        for key, required in upscale_prompts.REQUIRED.items():
            with self.subTest(key=key, problem='missing'):
                templates = copy.deepcopy(upscale_prompts.DEFAULTS)
                templates[key] = templates[key].replace('{' + required[0] + '}', 'removed')
                with self.assertRaises(ValueError):
                    upscale_prompts.validate_templates(templates)
            with self.subTest(key=key, problem='unknown'):
                templates = copy.deepcopy(upscale_prompts.DEFAULTS)
                templates[key] += '\n{not_a_supported_variable}'
                with self.assertRaises(ValueError):
                    upscale_prompts.validate_templates(templates)

    def test_legacy_unversioned_job_does_not_invent_historical_instruction(self):
        import upscale_prompts
        with self.assertRaises(ValueError):
            upscale_prompts.compile_image({'stitch': 4, 'upscale_injection': 'legacy'}, self.plan, self.tile, 'HISTORY-MARKER')

    def test_settings_endpoint_edits_each_template_and_rejects_invalid_patch_atomically(self):
        import upscale_prompts
        response = self.client.get('/api/settings')
        self.assertEqual(response.status_code, 200)
        original = response.json()['upscale_system_prompts']
        edited = {key: f'EDIT-{key}-MARKER\n{text}' for key, text in original.items()}
        try:
            response = self.client.patch('/api/settings', json={'upscale_system_prompts': edited}, headers=self.headers)
            self.assertEqual(response.status_code, 200, response.text)
            actual = self.client.get('/api/settings').json()['upscale_system_prompts']
            self.assertEqual(actual, edited)
            invalid = {'tile': 'Invalid template without the mandatory variable'}
            response = self.client.patch('/api/settings', json={'upscale_system_prompts': invalid}, headers=self.headers)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(self.client.get('/api/settings').json()['upscale_system_prompts'], edited)
        finally:
            response = self.client.patch('/api/settings', json={'upscale_system_prompts': original}, headers=self.headers)
            self.assertEqual(response.status_code, 200, response.text)

    def test_preview_submission_revision_and_immutable_requirement_alias(self):
        source = self.asset['id']
        payload = {'factor': 4, 'upscale_requirements': 'FIXED-API-MARKER', 'source_description': 'SOURCE-API-MARKER',
                   'upscale_policy': {'append_system': False, 'include_source_context': False}}
        preview = self.post(f'/api/assets/{source}/upscale-prompt-preview', payload)
        self.assertEqual(preview.status_code, 200, preview.text)
        displayed = preview.json()
        self.assertIn('FIXED-API-MARKER', displayed['worker_instruction'])
        self.assertNotIn('SOURCE-API-MARKER', displayed['worker_instruction'])
        self.assertFalse(next(c for c in displayed['components'] if c['key'] == 'tile')['enabled'])
        body = {**payload, 'expected_prompt_revision': displayed['snapshot_revision']}
        submitted = self.post(f'/api/assets/{source}/upscale', body)
        self.assertEqual(submitted.status_code, 200, submitted.text)
        jid = submitted.json()['ids'][0]
        job = self.client.get('/api/jobs/' + jid).json()
        self.assertEqual(job['options']['upscale_requirements'], 'FIXED-API-MARKER')
        self.assertEqual(job['options']['upscale_injection'], 'FIXED-API-MARKER')
        self.assertEqual(job['options']['upscale_prompts']['revision'], displayed['snapshot_revision'])
        snap = self.client.get(f'/api/upscale/jobs/{jid}/prompt-snapshot').json()
        self.assertEqual(snap['snapshot']['revision'], displayed['snapshot_revision'])
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?", (jid,))
        locked = self.client.patch(f'/api/upscale/jobs/{jid}/injection', json={'upscale_injection': 'changed'}, headers=self.headers)
        self.assertEqual(locked.status_code, 409)
        self.assertEqual(self.client.get('/api/jobs/' + jid).json()['options']['upscale_requirements'], 'FIXED-API-MARKER')
        rejected = self.post(f'/api/assets/{source}/upscale', {**body, 'expected_prompt_revision': '0' * 64})
        self.assertEqual(rejected.status_code, 409)
        anonymous = TestClient(self.studio.app, base_url='https://prompts.test')
        try:
            self.assertEqual(anonymous.get(f'/api/upscale/jobs/{jid}/prompt-snapshot').status_code, 401)
            self.assertEqual(anonymous.get(f'/api/upscale/jobs/{jid}/calls').status_code, 401)
        finally:
            anonymous.close()

    def test_repair_request_is_scoped_and_never_overwrites_task_requirements(self):
        from stitch_engine import save_json
        from stitch_planner import progressive_plan, execution_plan
        source = self.asset['id']
        response = self.post(f'/api/assets/{source}/upscale', {'factor': 4, 'upscale_requirements': 'FIXED-REPAIR-TEST'})
        self.assertEqual(response.status_code, 200, response.text)
        jid = response.json()['ids'][0]
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?", (jid,))
        manifest = progressive_plan(128, 96, 4)
        stage = manifest['stages'][0]
        stage.update(status='failed', folder='stages/01-' + 'a' * 16)
        root = self.studio.DATA / 'jobs' / jid / 'stitch'
        folder = root / stage['folder']
        (folder / 'redraw').mkdir(parents=True)
        (folder / 'diagnostics').mkdir()
        plan = execution_plan(stage)
        save_json(folder / 'plan.json', plan)
        save_json(root / 'progressive.json', manifest)
        original_tile = plan['tiles'][0]['index']
        with patch('upscale_diagnostics.render', return_value={'tiles': [{'index': original_tile, 'reason': 'fixture error'}]}):
            result = self.post(f'/api/upscale/jobs/{jid}/redraw', {'level': 1, 'tiles': [original_tile],
                               'repair_request': 'REPAIR-ONLY-MARKER', 'append_system': False})
        self.assertEqual(result.status_code, 200, result.text)
        options = self.client.get('/api/jobs/' + jid).json()['options']
        self.assertEqual(options['upscale_requirements'], 'FIXED-REPAIR-TEST')
        self.assertEqual(options['upscale_injection'], 'FIXED-REPAIR-TEST')
        scope = options['repair_scopes'][-1]
        self.assertEqual(scope['request'], 'REPAIR-ONLY-MARKER')
        self.assertEqual(scope['tiles'], [original_tile])
        self.assertEqual(scope['level'], 1)
        self.assertFalse(scope['append_system'])
        compiled = self.compile_image(options, tile=plan['tiles'][0])
        self.assertIn('REPAIR-ONLY-MARKER', compiled['worker_instruction'])
        self.assertIn('FIXED-REPAIR-TEST', compiled['worker_instruction'])
        self.assertNotIn('REPAIR-ONLY-MARKER', self.compile_image(options, tile=plan['tiles'][0], level=2)['worker_instruction'])


    def test_actual_call_records_exact_sent_instruction_and_snapshot_metadata(self):
        import asyncio
        from contextlib import asynccontextmanager
        import stitch_workflow
        jid, job = self.new_task(upscale_requirements='SENT-REQUIREMENT-MARKER')
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?", (jid,))
        options = job['options']
        compiled = self.compile_image(options)
        root = self.studio.DATA / 'jobs' / jid / 'stitch'
        folder = root / 'stages' / ('01-' + 'b' * 16)
        folder.mkdir(parents=True)
        reference = folder / 'reference.png'
        Image.new('RGB', (32, 32), 'white').save(reference)
        sent = []
        class FakeInput:
            def write(self, data): sent.append(data.decode('utf-8'))
            async def drain(self): pass
            def close(self): pass
        class FakeOutput:
            async def readline(self): return b''
        class FakeProcess:
            stdin = FakeInput()
            stdout = FakeOutput()
            returncode = 0
            async def wait(self): return 0
        async def fake_subprocess(*args, **kwargs):
            directory = Path(args[args.index('-C') + 1])
            Image.new('RGB', (32, 32), 'blue').save(directory / 'output.png')
            return FakeProcess()
        @asynccontextmanager
        async def fake_slot(job_id, name):
            yield job_id + ':' + name
        async def execute():
            with patch.object(self.studio, 'cli_slot', fake_slot), patch.object(asyncio, 'create_subprocess_exec', fake_subprocess):
                try:
                    await stitch_workflow.cli_call(self.studio, jid, folder, 'fixture-call', compiled['worker_instruction'],
                        [reference], options['model'], options['effort'], 'redraw', 0, 1, expected_size=[32, 32], prompt_metadata=compiled)
                finally:
                    self.studio.PROCESSES.pop(jid + ':fixture-call', None)
        self.client.portal.call(execute)
        self.assertEqual(len(sent), 1)
        self.assertTrue(sent[0].endswith(compiled['worker_instruction']))
        self.assertIn('built-in image-generation tool', sent[0])
        calls = self.client.get(f'/api/upscale/jobs/{jid}/calls')
        self.assertEqual(calls.status_code, 200, calls.text)
        self.assertEqual(calls.json()['total'], 1)
        item = calls.json()['items'][0]
        detail = self.client.get(f"/api/upscale/jobs/{jid}/calls/{item['id']}").json()
        self.assertEqual(detail['worker_instruction'], sent[0])
        self.assertEqual(detail['prompt_metadata']['snapshot_revision'], options['upscale_prompts']['revision'])
        self.assertEqual(detail['prompt_metadata']['scope'], compiled['scope'])
        self.assertEqual(detail['prompt_metadata']['components'], compiled['components'])

    def test_workflow_sends_compiled_metadata_and_reuses_only_matching_checkpoint(self):
        import asyncio
        from types import SimpleNamespace
        import upscale_workflow as workflow
        jid, task = self.new_task(upscale_requirements='CACHE-ORIGINAL-MARKER', max_attempts=1)
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?", (jid,))
        job = self.studio.query('SELECT * FROM jobs WHERE id=?', (jid,), True)
        options = copy.deepcopy(task['options'])
        folder = self.studio.DATA / 'jobs' / jid / 'stitch' / 'test-cache'
        folder.mkdir(parents=True)
        tile = {'index': 0, 'box': [0, 0, 32, 32], 'size': [32, 32]}
        plan = {'tiles': [tile]}
        stage = {'index': 1}
        manifest = {'stages': [stage]}
        sent = []
        async def engine(studio, job_id, directory, phase, *args):
            if phase == 'register':
                raise RuntimeError('stop after generation fixture')
            (directory / 'crops').mkdir(exist_ok=True)
            Image.new('RGB', (32, 32), 'white').save(directory / 'crops' / '0.png')
            Image.new('RGB', (32, 32), 'white').save(directory / 'reference-full.png')
        async def fake_cli(studio, job_id, directory, name, instruction, refs, model, effort, *args, **kwargs):
            sent.append((instruction, kwargs.get('prompt_metadata')))
            output = directory / 'fixture-result.png'
            Image.new('RGB', (32, 32), 'blue').save(output)
            return output
        measured = SimpleNamespace(decision='accept', actual=[32, 32], json=lambda: {'actual': [32, 32]})
        async def execute():
            with patch.object(workflow, 'execution_plan', return_value=copy.deepcopy(plan)), \
                 patch.object(workflow, 'engine', engine), patch.object(workflow, 'cli_call', fake_cli), \
                 patch.object(workflow.imaging, 'assess_return', return_value=measured):
                with self.assertRaisesRegex(RuntimeError, 'stop after generation'):
                    await workflow.run_level(self.studio, jid, job, options, folder, stage, manifest, folder / 'manifest.json')
        self.client.portal.call(execute)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][0], sent[0][1]['worker_instruction'])
        self.assertIn('CACHE-ORIGINAL-MARKER', sent[0][0])
        self.assertEqual(sent[0][1]['snapshot_revision'], options['upscale_prompts']['revision'])
        provenance = json.loads((folder / 'redraw' / '0.prompt.json').read_text(encoding='utf-8'))
        self.assertEqual(provenance['snapshot_revision'], options['upscale_prompts']['revision'])
        self.client.portal.call(execute)
        self.assertEqual(len(sent), 1, 'matching checkpoint should be reused')
        options['upscale_requirements'] = 'CACHE-CHANGED-MARKER'
        options['upscale_injection'] = options['upscale_requirements']
        self.client.portal.call(execute)
        self.assertEqual(len(sent), 2, 'different instruction identity must regenerate')
        self.assertIn('CACHE-CHANGED-MARKER', sent[-1][0])

    def test_preview_context_matches_the_submitted_task_when_opted_in(self):
        source = self.asset['id']
        payload = {'factor': 4, 'upscale_requirements': 'CONSISTENCY-FIXED', 'source_description': 'CONSISTENCY-CONTEXT',
                   'upscale_policy': {'append_system': True, 'include_source_context': True}}
        preview = self.post(f'/api/assets/{source}/upscale-prompt-preview', payload)
        self.assertEqual(preview.status_code, 200, preview.text)
        expected = preview.json()
        self.assertIn('CONSISTENCY-CONTEXT', expected['worker_instruction'])
        result = self.post(f'/api/assets/{source}/upscale', {**payload, 'expected_prompt_revision': expected['snapshot_revision']})
        self.assertEqual(result.status_code, 200, result.text)
        job = self.client.get('/api/jobs/' + result.json()['ids'][0]).json()
        actual = self.compile_image(job['options'], source=job['options'].get('source_description', ''))
        self.assertEqual(actual['worker_instruction'], expected['worker_instruction'])

    def test_generate_then_upscale_child_inherits_snapshot_and_requirements(self):
        request = self.studio.JobInput(prompt='PARENT-CONTEXT', after_upscale=4,
            upscale_requirements='PARENT-FIXED', upscale_policy={'append_system': True, 'include_source_context': True})
        jid = self.studio.create_jobs(request)['ids'][0]
        before = self.client.get('/api/jobs/' + jid).json()['options']
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?", (jid,))
        old = self.studio.setting('upscale_system_prompts', {})
        try:
            templates = copy.deepcopy(old)
            import upscale_prompts
            templates['tile'] = 'CHANGED-AFTER-SUBMISSION\n' + upscale_prompts.DEFAULTS['tile']
            self.studio.set_setting('upscale_system_prompts', templates)
            path = Path(self.temp.name) / 'parent-result.png'
            Image.new('RGB', (128, 96), 'blue').save(path)
            self.studio.record_generated_image(jid, path)
            parent = self.client.get('/api/jobs/' + jid).json()
            child = self.client.get('/api/jobs/' + parent['options']['after_upscale_job_id']).json()
            self.assertEqual(child['options']['upscale_prompts'], before['upscale_prompts'])
            self.assertEqual(child['options']['upscale_requirements'], 'PARENT-FIXED')
            self.assertEqual(child['options']['upscale_injection'], 'PARENT-FIXED')
            self.assertEqual(child['options']['source_description'], 'PARENT-CONTEXT')
            compiled = self.compile_image(child['options'], source=child['options']['source_description'])
            self.assertIn('PARENT-CONTEXT', compiled['worker_instruction'])
            self.assertIn('PARENT-FIXED', compiled['worker_instruction'])
            self.assertNotIn('CHANGED-AFTER-SUBMISSION', compiled['worker_instruction'])
        finally:
            self.studio.set_setting('upscale_system_prompts', old)

    def test_generated_asset_preview_and_submit_share_polished_history(self):
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='RAW-CONTEXT'))['ids'][0]
        self.studio.write("UPDATE jobs SET status='running',polished_prompt='POLISHED-CONTEXT' WHERE id=?", (jid,))
        path = Path(self.temp.name) / 'polished-parent.png'
        Image.new('RGB', (128, 96), 'red').save(path)
        asset = self.studio.record_generated_image(jid, path)
        payload = {'factor': 4, 'upscale_policy': {'append_system': True, 'include_source_context': True}}
        preview = self.post(f"/api/assets/{asset['id']}/upscale-prompt-preview", payload)
        self.assertEqual(preview.status_code, 200, preview.text)
        result = self.post(f"/api/assets/{asset['id']}/upscale", {**payload, 'expected_prompt_revision': preview.json()['snapshot_revision']})
        self.assertEqual(result.status_code, 200, result.text)
        options = self.client.get('/api/jobs/' + result.json()['ids'][0]).json()['options']
        actual = self.compile_image(options, source=options.get('source_description', ''))
        self.assertIn('POLISHED-CONTEXT', preview.json()['worker_instruction'])
        self.assertEqual(actual['worker_instruction'], preview.json()['worker_instruction'])

    def test_legacy_task_exposes_only_recorded_instructions_without_inventing_a_snapshot(self):
        from stitch_engine import save_json
        jid, job = self.new_task(upscale_requirements='legacy requirement')
        options = copy.deepcopy(job['options'])
        options.pop('upscale_prompts')
        options.pop('upscale_requirements')
        self.studio.write('UPDATE jobs SET options=? WHERE id=?', (json.dumps(options), jid))
        directory = self.studio.DATA / 'jobs' / jid / 'stitch' / 'stages' / ('01-'+'c'*16) / 'calls' / 'legacy-call'
        directory.mkdir(parents=True)
        save_json(directory / 'request.json', {'kind': 'redraw', 'worker_instruction': 'ACTUALLY-RECORDED-LEGACY', 'created': 1})
        snapshot = self.client.get(f'/api/upscale/jobs/{jid}/prompt-snapshot').json()
        self.assertFalse(snapshot['available'])
        self.assertIsNone(snapshot['snapshot'])
        self.assertTrue(snapshot['legacy_message'])
        calls = self.client.get(f'/api/upscale/jobs/{jid}/calls').json()
        self.assertEqual(calls['total'], 1)
        record = self.client.get(f"/api/upscale/jobs/{jid}/calls/{calls['items'][0]['id']}").json()
        self.assertEqual(record['worker_instruction'], 'ACTUALLY-RECORDED-LEGACY')
        self.assertIsNone(record['prompt_metadata'])

    def test_explicit_empty_and_omitted_history_match_preview_and_submission(self):
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='ORIGINAL-HISTORY'))['ids'][0]
        self.studio.write("UPDATE jobs SET status='running',polished_prompt='POLISHED-HISTORY' WHERE id=?", (jid,))
        path = Path(self.temp.name) / 'empty-source-parent.png'
        Image.new('RGB', (128, 96), 'purple').save(path)
        asset = self.studio.record_generated_image(jid, path)
        base = {'factor': 4, 'upscale_policy': {'append_system': True, 'include_source_context': True}}
        for value in (None, ''):
            body = dict(base)
            if value is not None: body['source_description'] = value
            with self.subTest(source=value):
                preview = self.post(f"/api/assets/{asset['id']}/upscale-prompt-preview", body)
                self.assertEqual(preview.status_code, 200, preview.text)
                submitted = self.post(f"/api/assets/{asset['id']}/upscale", {**body, 'expected_prompt_revision': preview.json()['snapshot_revision']})
                self.assertEqual(submitted.status_code, 200, submitted.text)
                options = self.client.get('/api/jobs/' + submitted.json()['ids'][0]).json()['options']
                actual = self.compile_image(options, source=options.get('source_description', ''))
                self.assertEqual(actual['worker_instruction'], preview.json()['worker_instruction'])
                self.assertEqual('POLISHED-HISTORY' in actual['worker_instruction'], value is None)
