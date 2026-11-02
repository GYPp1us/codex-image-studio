"""Progress contracts with isolated data and simulated workers; no real CLI calls."""
import asyncio
import importlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image


class TaskProgressTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_root = Path(__file__).resolve().parent.parent / '.build-cache' / 'overhaul' / 'test-data'
        test_root.mkdir(parents=True, exist_ok=True)
        cls.tmp = tempfile.TemporaryDirectory(prefix='progress-', dir=test_root)
        cls.environment = {k: os.environ.get(k) for k in ('STUDIO_DATA', 'STUDIO_SETUP_TOKEN', 'STUDIO_SETUP_TOKEN_FILE', 'CODEX_BIN')}
        os.environ['STUDIO_DATA'] = cls.tmp.name
        os.environ['CODEX_BIN'] = str(Path(cls.tmp.name) / 'nonexistent-test-cli')
        os.environ['STUDIO_SETUP_TOKEN'] = 'task-progress-fixture'
        os.environ.pop('STUDIO_SETUP_TOKEN_FILE', None)
        import app
        cls.studio = importlib.reload(app)
        cls.client = TestClient(cls.studio.app, base_url='https://progress.test')
        cls.client.__enter__()
        response = cls.client.post('/api/auth/setup', json={'username': 'admin', 'password': 'test-password-long', 'setup_token': 'task-progress-fixture'})
        cls.headers = {'X-CSRF-Token': response.json()['csrf'], 'Origin': 'https://progress.test'}
        cls.studio.set_setting('paused', True)
        image = io.BytesIO()
        Image.new('RGB', (256, 192), 'white').save(image, 'PNG')
        cls.asset = cls.client.post('/api/assets', files={'file': ('fixture.png', image.getvalue(), 'image/png')}, headers=cls.headers).json()['asset']

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.tmp.cleanup()
        for key, value in cls.environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def progress(self, jid):
        row = self.studio.query('SELECT * FROM jobs WHERE id=?', (jid,), True)
        return self.studio.job_progress(dict(row))

    def new_regions(self):
        regions = [{'x': 10, 'y': 10, 'width': 64, 'height': 64, 'prompt': 'blue'},
                   {'x': 120, 'y': 10, 'width': 64, 'height': 64, 'prompt': 'green'}]
        with patch.object(self.studio, 'command', AsyncMock(return_value=(0, 'Logged in using ChatGPT (fixture)'))):
            response = self.client.post(f"/api/assets/{self.asset['id']}/inpaint", json={'regions': regions}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        jid = response.json()['ids'][0]
        self.studio.write("UPDATE jobs SET status='running',max_attempts=1 WHERE id=?", (jid,))
        return jid

    def test_region_callbacks_preserve_parallel_machine_stages_and_terminal_state(self):
        import region_workflow
        jid = self.new_regions()
        observations = []

        async def exercise():
            gates = [asyncio.Event(), asyncio.Event()]
            async def fake_cli(studio, job_id, folder, name, instruction, refs, model, effort, *args, **kwargs):
                index = int(Path(folder).name)
                report = kwargs['on_progress']
                gates[index].set()
                await gates[1-index].wait()
                for label, active, stage in [('等待并发名额', False, 'queued'), ('正在传递', True, 'sending'),
                                              ('主模型正在思考', True, 'thinking'), ('等待生图返回', True, 'generating'),
                                              ('正在回传', True, 'receiving')]:
                    report(label, active, 'cli')
                    observations.append((index, stage, self.progress(jid)))
                    await asyncio.sleep(0)
                output = Path(folder) / 'fixture-return.png'
                Image.new('RGB', tuple(kwargs['expected_size']), 'blue').save(output)
                return output
            with patch.object(region_workflow, 'cli_call', fake_cli):
                await region_workflow.run(self.studio, jid)
        self.client.portal.call(exercise)
        for index, stage, progress in observations:
            region = next(item for item in progress['regions'] if item['index'] == index)
            self.assertEqual(region.get('stage'), stage, (index, stage, progress))
            self.assertEqual(len(progress['regions']), 2)
        # The peer's already-observed stage must not be lost when the other callback writes.
        self.assertTrue(any(all(r.get('stage') in ('sending', 'thinking', 'generating', 'receiving')
                                for r in snapshot['regions']) for _, _, snapshot in observations))
        result = self.client.get('/api/jobs/' + jid).json()
        self.assertEqual(result['status'], 'succeeded', result.get('error'))
        self.assertEqual(result['progress']['percent'], 100)
        self.assertFalse(result['progress']['indeterminate'])
        self.assertTrue(all(r['status'] == 'succeeded' for r in result['progress']['regions']))

    def test_region_failure_retains_successful_peer_checkpoint(self):
        import region_workflow
        jid = self.new_regions()
        async def exercise():
            completed = asyncio.Event()
            async def fake_cli(studio, job_id, folder, name, instruction, refs, model, effort, *args, **kwargs):
                if Path(folder).name == '1':
                    await completed.wait()
                    raise region_workflow.WorkflowError('quota fixture failure')
                output = Path(folder) / 'fixture-return.png'
                Image.new('RGB', tuple(kwargs['expected_size']), 'blue').save(output)
                completed.set()
                return output
            with patch.object(region_workflow, 'cli_call', fake_cli):
                await region_workflow.run(self.studio, jid)
        self.client.portal.call(exercise)
        result = self.client.get('/api/jobs/' + jid).json()
        self.assertEqual(result['status'], 'failed')
        states = {item['index']: item for item in result['progress']['regions']}
        self.assertEqual(states[0]['status'], 'succeeded')
        self.assertEqual(states[1]['status'], 'failed')
        self.assertIn('quota', states[1].get('error', '').lower())
        self.assertTrue((self.studio.DATA / 'jobs' / jid / 'regions' / '0' / 'return.png').is_file())
        self.assertFalse(result['outputs'])
        called = []
        async def retry():
            async def fake_cli(studio, job_id, folder, name, instruction, refs, model, effort, *args, **kwargs):
                called.append(int(Path(folder).name))
                output = Path(folder) / 'retry-return.png'
                Image.new('RGB', tuple(kwargs['expected_size']), 'green').save(output)
                return output
            with patch.object(region_workflow, 'cli_call', fake_cli):
                await region_workflow.run(self.studio, jid)
        self.studio.write("UPDATE jobs SET status='running',error='' WHERE id=?", (jid,))
        self.client.portal.call(retry)
        retried = self.client.get('/api/jobs/' + jid).json()
        self.assertEqual(called, [1], 'retry must reuse the completed peer checkpoint')
        self.assertEqual(retried['status'], 'succeeded', retried.get('error'))
        self.assertTrue(all(r['status'] == 'succeeded' for r in retried['progress']['regions']))
        self.assertEqual(retried['progress']['percent'], 100)

    def test_upscale_phase_changes_preserve_tile_checkpoints(self):
        from stitch_workflow import progress
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='progress fixture', source_asset_id=self.asset['id'], stitch=4))['ids'][0]
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?", (jid,))
        children = [{'index': 1, 'state': 'done', 'label': '已完成'}, {'index': 2, 'state': 'failed', 'label': '失败'}]
        progress(self.studio, jid, 'redraw', 1, 2, children=children)
        progress(self.studio, jid, 'registration', 0, 2)
        progress(self.studio, jid, 'inspection', 0, 1)
        current = self.progress(jid)
        self.assertEqual(current['stage'], 'inspection')
        self.assertEqual(current.get('children'), children)
        self.studio.write("UPDATE jobs SET status='failed',error='fixture failure' WHERE id=?", (jid,))
        failed = self.progress(jid)
        self.assertEqual(failed.get('children'), children)
        self.assertFalse(failed['indeterminate'])
        self.studio.write("UPDATE jobs SET status='succeeded' WHERE id=?", (jid,))
        succeeded = self.progress(jid)
        self.assertEqual(succeeded['percent'], 100)
        self.assertFalse(succeeded['indeterminate'])

    def test_upscale_auth_failure_marks_affected_tile_and_keeps_completed_peer(self):
        import upscale_workflow as workflow
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='failure fixture', source_asset_id=self.asset['id'], stitch=4, max_attempts=1))['ids'][0]
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?", (jid,))
        job = self.studio.query('SELECT * FROM jobs WHERE id=?', (jid,), True)
        options = json.loads(job['options'])
        folder = self.studio.DATA / 'jobs' / jid / 'stitch' / 'test-level'
        folder.mkdir(parents=True)
        tiles = [{'index': i, 'box': [0, 0, 32, 32], 'size': [32, 32]} for i in range(2)]
        stage = {'index': 1}
        manifest = {'stages': [stage]}
        async def exercise():
            peer_done = asyncio.Event()
            async def engine(studio, job_id, directory, phase, *args):
                (directory / 'crops').mkdir(exist_ok=True)
                for i in range(2):
                    Image.new('RGB', (32, 32)).save(directory / 'crops' / f'{i}.png')
                Image.new('RGB', (32, 32)).save(directory / 'reference-full.png')
            async def fake_cli(studio, job_id, directory, name, instruction, refs, model, effort, *args, **kwargs):
                if name.startswith('tile-1-'):
                    await peer_done.wait()
                    # Let the successful peer publish its checkpoint before failing.
                    await asyncio.sleep(0.02)
                    raise workflow.WorkflowError('quota fixture failure')
                output = directory / 'fixture-output.png'
                Image.new('RGB', (32, 32)).save(output)
                peer_done.set()
                return output
            measured = SimpleNamespace(decision='accept', actual=[32, 32], json=lambda: {'actual': [32, 32]})
            with patch.object(workflow, 'execution_plan', return_value={'tiles': tiles}), \
                 patch.object(workflow, 'engine', engine), patch.object(workflow, 'cli_call', fake_cli), \
                 patch.object(workflow.imaging, 'assess_return', return_value=measured):
                with self.assertRaises(workflow.WorkflowError):
                    await workflow.run_level(self.studio, jid, job, options, folder, stage, manifest, folder / 'manifest.json')
        self.client.portal.call(exercise)
        self.studio.write("UPDATE jobs SET status='failed',error='quota fixture failure' WHERE id=?", (jid,))
        progress = self.progress(jid)
        states = {item['index']: item['state'] for item in progress.get('children', [])}
        self.assertEqual(states.get(1), 'done')
        self.assertEqual(states.get(2), 'failed')
        self.assertTrue((folder / 'redraw' / '0.png').is_file())
        self.assertFalse((folder / 'redraw' / '1.png').exists())


    def test_projection_accepts_old_and_decoded_rows_without_mutating_inputs(self):
        import copy
        regions = [{'x': 1, 'y': 1, 'width': 20, 'height': 20, 'prompt': 'blue'},
                   {'x': 40, 'y': 1, 'width': 20, 'height': 20, 'prompt': 'green'}]
        cases = [
            {'status': 'queued', 'options': {'regions': regions}, 'progress_detail': '{}'},
            {'status': 'running', 'options': {'regions': regions}, 'progress_detail': json.dumps({'regions': [
                {'index': 0, 'status': 'succeeded', 'label': '已完成'},
                {'index': 1, 'status': 'running', 'stage': 'generating', 'label': '等待生图返回'}]})},
            {'status': 'failed', 'options': {'stitch': 4}, 'progress_detail': json.dumps({
                'stage': 'redraw', 'fraction': .25, 'children': [
                    {'index': 1, 'state': 'done', 'label': '已完成'},
                    {'index': 2, 'state': 'failed', 'label': '失败'}]})},
            {'status': 'succeeded', 'options': {}, 'progress_detail': '{}'},
        ]
        for original in cases:
            with self.subTest(status=original['status'], options=original['options']):
                for encoded in (False, True):
                    row = copy.deepcopy(original)
                    if encoded:
                        row['options'] = json.dumps(row['options'])
                    before = copy.deepcopy(row)
                    projected = self.studio.job_progress(row)
                    self.assertEqual(row, before, 'read-only projection mutated its input')
                    self.assertIsInstance(projected['label'], str)
                    self.assertIn('indeterminate', projected)
                    if original['options'].get('regions'):
                        self.assertEqual(len(projected['regions']), 2)
                    if original['options'].get('stitch'):
                        self.assertEqual([part['state'] for part in projected['children']], ['done', 'failed'])
                    if original['status'] == 'succeeded':
                        self.assertFalse(projected['indeterminate'])

    def test_all_job_endpoints_project_same_progress_without_writing_state(self):
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='endpoint projection fixture', source_asset_id=self.asset['id'], stitch=4))['ids'][0]
        detail = {'stage': 'redraw', 'label': '第 1 级 · 补绘', 'fraction': .25, 'level': 1,
                  'children': [{'index': 1, 'state': 'done', 'label': '已完成'},
                               {'index': 2, 'state': 'failed', 'label': 'fixture failure'}]}
        self.studio.write("UPDATE jobs SET status='failed',progress_detail=?,error='fixture failure' WHERE id=?", (json.dumps(detail), jid))
        before = self.studio.query('SELECT status,progress_detail,stage,stage_updated,options FROM jobs WHERE id=?', (jid,), True)
        direct = self.client.get('/api/jobs/' + jid)
        listing = self.client.get('/api/jobs', params={'limit': 100})
        batches = self.client.get('/api/batches', params={'limit': 100})
        upscale = self.client.get('/api/upscale/jobs/' + jid)
        upscale_list = self.client.get('/api/upscale/jobs', params={'limit': 100})
        for response in (direct, listing, batches, upscale, upscale_list):
            self.assertEqual(response.status_code, 200, response.text)
        expected = direct.json()['progress']
        by_id = lambda rows: next(item for item in rows if item['id'] == jid)
        self.assertEqual(by_id(listing.json()['items'])['progress'], expected)
        self.assertEqual(by_id([job for batch in batches.json()['items'] for job in batch['jobs']])['progress'], expected)
        self.assertEqual(upscale.json()['progress'], expected)
        self.assertEqual(by_id(upscale_list.json()['items'])['progress'], expected)
        after = self.studio.query('SELECT status,progress_detail,stage,stage_updated,options FROM jobs WHERE id=?', (jid,), True)
        self.assertEqual(dict(after), dict(before), 'GET endpoints changed stored task state')




    def test_upscale_timeline_preserves_completed_level_when_next_level_fails(self):
        from stitch_workflow import progress, finish_progress
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='timeline fixture', source_asset_id=self.asset['id'], stitch=16))['ids'][0]
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?", (jid,))
        first = SimpleNamespace(query=self.studio.query, write=self.studio.write, upscale_progress={'index': 1, 'count': 2})
        second = SimpleNamespace(query=self.studio.query, write=self.studio.write, upscale_progress={'index': 2, 'count': 2})
        completed = [{'index': 1, 'state': 'done', 'checkpoint': True}]
        failed = [{'index': 1, 'state': 'done', 'checkpoint': True}, {'index': 2, 'state': 'failed', 'error': 'fixture'}]
        progress(first, jid, 'redraw', 1, 1, children=completed)
        progress(first, jid, 'receiving', 1, 1)
        progress(second, jid, 'redraw', 1, 2, children=failed)
        finish_progress(self.studio, jid, 'failed', 'fixture')
        self.studio.write("UPDATE jobs SET status='failed',error='fixture' WHERE id=?", (jid,))
        timeline = self.progress(jid)['timeline']
        self.assertEqual([level['index'] for level in timeline], [1, 2])
        self.assertEqual(timeline[0]['status'], 'succeeded')
        self.assertEqual(timeline[0]['tiles'], completed)
        self.assertEqual(timeline[1]['status'], 'failed')
        self.assertEqual(timeline[1]['tiles'], failed)
        self.assertFalse(self.progress(jid)['indeterminate'])

    def test_ordinary_running_progress_reports_observed_stage_without_a_fabricated_percent(self):
        row = {'status': 'running', 'options': {}, 'stage': 'generating', 'stage_source': 'cli', 'progress_detail': '{}'}
        projected = self.studio.job_progress(row)
        self.assertEqual(projected['stage'], 'generating')
        self.assertTrue(projected['indeterminate'])
        self.assertIsNone(projected.get('percent'))
        self.assertIsNone(projected.get('fraction'))

    def test_upscale_retry_keeps_checkpoint_timeline_visible_while_queued(self):
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='retry progress fixture', source_asset_id=self.asset['id'], stitch=16))['ids'][0]
        completed = [{'index': 1, 'state': 'done', 'checkpoint': True}]
        detail = {'stage': 'redraw', 'level': 2, 'levels': 2, 'fraction': .6, 'children': completed,
                  'level_states': {'1': {'index': 1, 'status': 'succeeded', 'tiles': completed, 'phases': {}},
                                   '2': {'index': 2, 'status': 'failed', 'tiles': completed, 'phases': {}}}}
        self.studio.write("UPDATE jobs SET status='failed',progress_detail=? WHERE id=?", (json.dumps(detail), jid))
        from stitch_engine import save_json
        from stitch_planner import progressive_plan
        manifest = progressive_plan(256, 192, 16)
        for stage in manifest['stages']:
            stage['status'] = 'succeeded' if stage['index'] == 1 else 'failed'
            stage['progress'] = detail['level_states'][str(stage['index'])]
        root = self.studio.DATA / 'jobs' / jid / 'stitch'
        root.mkdir(parents=True)
        save_json(root / 'progressive.json', manifest)
        before = self.client.get('/api/jobs/' + jid).json()['progress']
        self.assertEqual(len(before['timeline']), 2)
        response = self.client.post('/api/jobs/' + jid + '/retry', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        queued = self.client.get('/api/jobs/' + jid).json()
        self.assertEqual(queued['status'], 'queued')
        self.assertEqual(queued['progress'].get('children'), completed)
        self.assertEqual([level['index'] for level in queued['progress'].get('timeline', [])], [1, 2])
        recorded = json.loads((root / 'progressive.json').read_text(encoding='utf-8'))
        self.assertEqual([stage['status'] for stage in recorded['stages']], ['succeeded', 'queued'])
        self.assertEqual([stage['progress'] for stage in recorded['stages']], queued['progress']['timeline'])

    def test_selected_redraw_resets_only_selected_tile_and_retains_peer_progress(self):
        from stitch_engine import save_json
        from stitch_planner import progressive_plan, execution_plan
        image = io.BytesIO()
        Image.new('RGB', (1024, 1024), 'white').save(image, 'PNG')
        source = self.client.post('/api/assets', files={'file': ('source-large.png', image.getvalue(), 'image/png')}, headers=self.headers).json()['asset']
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='selected retry fixture', source_asset_id=source['id'], stitch=4))['ids'][0]
        manifest = progressive_plan(1024, 1024, 4)
        stage = manifest['stages'][0]
        stage.update(status='failed', folder='stages/01-' + 'd' * 16)
        plan = execution_plan(stage)
        self.assertGreaterEqual(len(plan['tiles']), 2)
        root = self.studio.DATA / 'jobs' / jid / 'stitch'
        folder = root / stage['folder']
        (folder / 'redraw').mkdir(parents=True)
        (folder / 'diagnostics').mkdir()
        for tile in plan['tiles']:
            Image.new('RGB', (8, 8), 'blue').save(folder / 'redraw' / f"{tile['index']}.png")
        save_json(folder / 'plan.json', plan)
        save_json(root / 'progressive.json', manifest)
        children = [{'index': t['index']+1, 'state': 'done', 'checkpoint': True} for t in plan['tiles']]
        state = {'index': 1, 'status': 'failed', 'tiles': children, 'phases': {'redraw': {'status': 'succeeded'}}}
        detail = {'stage': 'inspection', 'level': 1, 'levels': 1, 'fraction': .8,
                  'children': children, 'level_states': {'1': state}}
        self.studio.write("UPDATE jobs SET status='failed',progress_detail=? WHERE id=?", (json.dumps(detail), jid))
        selected = plan['tiles'][0]['index']
        with patch('upscale_diagnostics.render', return_value={'tiles': [{'index': selected, 'reason': 'fixture'}]}):
            response = self.client.post(f'/api/upscale/jobs/{jid}/redraw', json={'level': 1, 'tiles': [selected], 'repair_request': 'fixture'}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        result = self.client.get('/api/jobs/' + jid).json()
        current = {part['index']: part for part in result['progress']['children']}
        self.assertEqual(current[selected+1]['state'], 'queued')
        self.assertFalse(current[selected+1]['checkpoint'])
        for tile in plan['tiles'][1:]:
            self.assertEqual(current[tile['index']+1]['state'], 'done')
            self.assertTrue(current[tile['index']+1]['checkpoint'])
        self.assertEqual(result['progress']['timeline'][0]['status'], 'queued')
        stored_manifest = json.loads((root / 'progressive.json').read_text(encoding='utf-8'))
        self.assertEqual(stored_manifest['stages'][0]['progress'], result['progress']['timeline'][0])
        self.assertEqual(stored_manifest['stages'][0]['status'], 'pending')

    def test_selecting_an_earlier_level_shows_its_requeued_progress(self):
        from task_progress import restart_detail
        level1 = [{'index': 1, 'state': 'done', 'checkpoint': True}, {'index': 2, 'state': 'done', 'checkpoint': True}]
        level2 = [{'index': 1, 'state': 'done', 'checkpoint': True}]
        detail = {'level': 2, 'levels': 2, 'children': level2, 'level_states': {
            '1': {'index': 1, 'status': 'succeeded', 'tiles': level1, 'phases': {}},
            '2': {'index': 2, 'status': 'failed', 'tiles': level2, 'phases': {}}}}
        job = {'options': {'stitch': 16}, 'progress_detail': json.dumps(detail)}
        queued = restart_detail(job, {'level': 1, 'tiles': [0]})
        self.assertEqual(queued['level'], 1)
        self.assertEqual(queued['children'][0]['state'], 'queued')
        self.assertEqual(queued['children'][1]['state'], 'done')
        self.assertEqual(queued['level_states']['2']['tiles'][0]['state'], 'queued')

    def test_retry_after_clearing_cache_discards_stale_checkpoint_progress(self):
        from stitch_engine import save_json
        from stitch_planner import progressive_plan
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='cleared progress fixture', source_asset_id=self.asset['id'], stitch=4))['ids'][0]
        tiles = [{'index': 1, 'state': 'done', 'checkpoint': True}]
        detail = {'stage': 'redraw', 'level': 1, 'levels': 1, 'fraction': .5, 'children': tiles,
                  'level_states': {'1': {'index': 1, 'status': 'failed', 'tiles': tiles, 'phases': {}}}}
        self.studio.write("UPDATE jobs SET status='failed',progress_detail=? WHERE id=?", (json.dumps(detail), jid))
        root = self.studio.DATA / 'jobs' / jid / 'stitch'
        folder = root / 'stages' / ('01-' + 'e' * 16) / 'redraw'
        folder.mkdir(parents=True)
        Image.new('RGB', (8, 8), 'blue').save(folder / '0.png')
        manifest = progressive_plan(256, 192, 4)
        manifest['stages'][0].update(status='failed', folder='stages/01-' + 'e' * 16, progress=detail['level_states']['1'])
        save_json(root / 'progressive.json', manifest)
        cleared = self.client.post(f'/api/upscale/jobs/{jid}/clear-cache', headers=self.headers)
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertFalse(folder.exists())
        retry = self.client.post(f'/api/jobs/{jid}/retry', headers=self.headers)
        self.assertEqual(retry.status_code, 200, retry.text)
        queued = self.client.get('/api/jobs/' + jid).json()
        self.assertEqual(queued['status'], 'queued')
        self.assertFalse(queued['progress'].get('children'))
        self.assertFalse(queued['progress'].get('timeline'))
        self.assertEqual(queued['progress']['percent'], 0)

    def test_list_jobs_are_lightweight_but_keep_progress_and_task_controls(self):
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='lightweight fixture', source_asset_id=self.asset['id'],
            stitch=4, upscale_requirements='LIGHT-REQUIREMENT'))['ids'][0]
        row = self.studio.query('SELECT options FROM jobs WHERE id=?', (jid,), True)
        options = json.loads(row['options'])
        options['upscale_prompts']['templates']['tile'] += 'LARGE-TEMPLATE-MARKER' * 1000
        options['source_description'] = 'HISTORY-MARKER' * 500
        options['repair_scopes'] = [{'id':'fixture','level':1,'tiles':[0],'request':'REPAIR-SECRET-MARKER'}]
        options['redraw_call_prompt'] = 'REDRAW-PROTOCOL-MARKER' * 500
        self.studio.write('UPDATE jobs SET options=? WHERE id=?', (json.dumps(options), jid))
        detail = self.client.get('/api/jobs/' + jid).json()
        snapshot = self.client.get(f'/api/upscale/jobs/{jid}/prompt-snapshot').json()
        self.assertEqual(detail['options']['upscale_prompts'], options['upscale_prompts'])
        self.assertEqual(snapshot['snapshot'], options['upscale_prompts'])
        self.assertEqual(detail['options']['source_description'], options['source_description'])
        self.assertEqual(detail['options']['repair_scopes'], options['repair_scopes'])
        sources = [self.client.get('/api/jobs?limit=100').json()['items'],
                   [job for batch in self.client.get('/api/batches?limit=100').json()['items'] for job in batch['jobs']],
                   self.client.get('/api/upscale/jobs?limit=100').json()['items']]
        for rows in sources:
            job = next(item for item in rows if item['id'] == jid)
            payload = json.dumps(job, ensure_ascii=False)
            self.assertNotIn('LARGE-TEMPLATE-MARKER', payload)
            self.assertNotIn('HISTORY-MARKER', payload)
            self.assertNotIn('REPAIR-SECRET-MARKER', payload)
            self.assertNotIn('REDRAW-PROTOCOL-MARKER', payload)
            self.assertNotIn('progress_detail', job)
            self.assertEqual(job['progress'], detail['progress'])
            self.assertEqual(job['options']['stitch'], 4)
            self.assertEqual(job['options']['upscale_requirements'], 'LIGHT-REQUIREMENT')
            self.assertEqual(job['options']['upscale_prompt_summary']['revision'], options['upscale_prompts']['revision'])

    def test_legacy_list_remains_light_and_detail_retains_original_fields(self):
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='legacy lightweight fixture', source_asset_id=self.asset['id'], stitch=4))['ids'][0]
        options = json.loads(self.studio.query('SELECT options FROM jobs WHERE id=?', (jid,), True)['options'])
        options.pop('upscale_prompts', None)
        options['stitch_prompt'] = 'LEGACY-SYSTEM-TEMPLATE'
        self.studio.write('UPDATE jobs SET options=? WHERE id=?', (json.dumps(options), jid))
        detail = self.client.get('/api/jobs/' + jid).json()
        listed = next(item for item in self.client.get('/api/jobs?limit=100').json()['items'] if item['id'] == jid)
        snapshot = self.client.get(f'/api/upscale/jobs/{jid}/prompt-snapshot').json()
        self.assertEqual(detail['options']['stitch_prompt'], 'LEGACY-SYSTEM-TEMPLATE')
        self.assertNotIn('stitch_prompt', listed['options'])
        self.assertFalse(snapshot['available'])
        self.assertIsNone(snapshot['snapshot'])
        self.assertEqual(listed['progress'], detail['progress'])
