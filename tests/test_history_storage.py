"""Regression coverage for history visibility and safe storage maintenance."""
import importlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


class HistoryStorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        base = Path(__file__).resolve().parent.parent / '.build-cache' / 'overhaul' / 'test-data'
        base.mkdir(parents=True, exist_ok=True)
        cls.tmp = tempfile.TemporaryDirectory(prefix='history-storage-', dir=base)
        cls.env = {key: os.environ.get(key) for key in ('STUDIO_DATA', 'STUDIO_SETUP_TOKEN', 'STUDIO_SETUP_TOKEN_FILE', 'CODEX_BIN')}
        os.environ['STUDIO_DATA'] = cls.tmp.name
        os.environ['STUDIO_SETUP_TOKEN'] = 'history-storage-test'
        os.environ.pop('STUDIO_SETUP_TOKEN_FILE', None)
        os.environ['CODEX_BIN'] = str(Path(cls.tmp.name) / 'no-cli')
        import app
        cls.studio = importlib.reload(app)
        cls.client = TestClient(cls.studio.app, base_url='https://history.test')
        cls.client.__enter__()
        response = cls.client.post('/api/auth/setup', json={'username':'admin', 'password':'test-password-long', 'setup_token':'history-storage-test'})
        cls.headers = {'X-CSRF-Token':response.json()['csrf'], 'Origin':'https://history.test'}
        cls.studio.set_setting('paused', True)
        image = io.BytesIO()
        Image.new('RGB', (256, 192), 'white').save(image, 'PNG')
        cls.reference = cls.client.post('/api/assets', files={'file':('ref.png', image.getvalue(), 'image/png')}, headers=cls.headers).json()['asset']

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.tmp.cleanup()
        for key, value in cls.env.items():
            if value is None: os.environ.pop(key, None)
            else: os.environ[key] = value

    def test_history_hide_is_terminal_only_and_retains_provenance(self):
        batch = self.studio.create_jobs(self.studio.JobInput(prompt='history batch', count=2))
        done, active = batch['ids']
        self.studio.write("UPDATE jobs SET status='failed',outputs=? WHERE id=?", (json.dumps([self.reference['id']]), done))
        self.assertEqual(self.client.delete('/api/jobs/' + active, headers=self.headers).status_code, 409)
        self.assertEqual(self.client.delete('/api/batches/' + batch['batch_id'], headers=self.headers).status_code, 409)
        self.assertEqual(self.client.delete('/api/jobs/' + done, headers=self.headers).status_code, 200)
        self.assertGreater(self.studio.query('SELECT history_deleted FROM jobs WHERE id=?', (done,), True)['history_deleted'], 0)
        self.assertEqual([asset['id'] for asset in self.client.get('/api/jobs/' + done).json()['outputs']], [self.reference['id']])
        self.assertEqual(self.client.get('/media/' + self.reference['id']).status_code, 200)
        listed = self.client.get('/api/jobs?limit=100').json()['items']
        self.assertNotIn(done, [row['id'] for row in listed])
        batches = self.client.get('/api/batches?limit=100').json()['items']
        self.assertNotIn(done, [job['id'] for row in batches for job in row['jobs']])
        self.assertEqual(self.client.post('/api/jobs/' + done + '/retry', headers=self.headers).status_code, 200)
        self.assertIn(done, [row['id'] for row in self.client.get('/api/jobs?limit=100').json()['items']])
        self.studio.write("UPDATE jobs SET status='cancelled' WHERE batch_id=?", (batch['batch_id'],))
        self.assertEqual(self.client.delete('/api/batches/' + batch['batch_id'], headers=self.headers).status_code, 200)
        self.assertNotIn(batch['batch_id'], [row['id'] for row in self.client.get('/api/batches?limit=100').json()['items']])
        self.assertEqual(self.client.get('/api/jobs/' + done).status_code, 200)

    def test_bulk_cache_clear_preserves_active_work_outputs_and_logs(self):
        jobs = self.studio.create_jobs(self.studio.JobInput(prompt='cache', count=2, stitch=4, source_asset_id=self.reference['id']))['ids']
        done, active = jobs
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?", (done,))
        paths = []
        for jid in jobs:
            root = self.studio.DATA / 'jobs' / jid
            cache = root / 'stitch' / 'stages' / '01-cache' / 'redraw' / '0.png'
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(b'cached image')
            (root / 'events.jsonl').write_text('{"type":"test"}\n', encoding='utf-8')
            paths.append(cache)
        ref_path = Path(self.studio.query('SELECT path FROM assets WHERE id=?', (self.reference['id'],), True)['path'])
        before = self.client.get('/api/storage').json()
        self.assertTrue({done, active}.issubset({task['id'] for task in before['tasks']}))
        self.assertEqual(self.client.post('/api/storage/clear-cache', json={'confirm':'wrong'}, headers=self.headers).status_code, 422)
        response = self.client.post('/api/storage/clear-cache', json={'confirm':'clear-cache'}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(paths[0].exists())
        self.assertTrue(paths[1].exists())
        self.assertTrue(ref_path.exists())
        self.assertTrue((self.studio.DATA / 'jobs' / done / 'events.jsonl').exists())
        self.assertEqual(self.studio.query('SELECT status FROM jobs WHERE id=?', (active,), True)['status'], 'queued')
        after = self.client.get('/api/storage').json()
        self.assertNotIn(done, [task['id'] for task in after['tasks']])

    def test_storage_breakdown_accounts_for_every_counted_byte_once(self):
        response = self.client.get('/api/storage')
        self.assertEqual(response.status_code, 200, response.text)
        state = response.json()
        breakdown = state['breakdown']
        self.assertEqual(sum(item['bytes'] for item in breakdown), state['bytes'])
        self.assertEqual(len({item['key'] for item in breakdown}), len(breakdown))
        self.assertIn('references', {item['key'] for item in breakdown})
        self.assertTrue(all(item['bytes'] > 0 and item['label'] for item in breakdown))
        ordinary_storage = self.client.get('/api/state').json()['storage']
        self.assertTrue({'breakdown', 'tasks', 'trash'}.isdisjoint(ordinary_storage))




    def test_breakdown_selects_two_largest_collections(self):
        groups = []
        for index, size in enumerate((64, 96, 128)):
            result = self.studio.create_jobs(self.studio.JobInput(prompt=f'group {index}'))
            jid, cid = result['ids'][0], f'fixture-{index}'
            stamp = self.studio.now()
            self.studio.write('INSERT INTO collections(id,name,prompt,created,updated) VALUES (?,?,?,?,?)', (cid, f'Group {index}', '', stamp, stamp))
            self.studio.write("UPDATE jobs SET status='succeeded',collection_id=? WHERE id=?", (cid, jid))
            source = Path(self.tmp.name) / f'fixture-{index}.png'
            Image.effect_noise((size, size), 60).convert('RGB').save(source)
            asset, _ = self.studio.store_image_path(source, f'output-{index}.png', 'generated', jid)
            self.studio.write('UPDATE jobs SET outputs=? WHERE id=?', (json.dumps([asset['id']]), jid))
            groups.append((cid, Path(self.studio.query('SELECT path FROM assets WHERE id=?', (asset['id'],), True)['path']).stat().st_size))
        state = self.client.get('/api/storage').json()
        breakdown = {entry['key']: entry['bytes'] for entry in state['breakdown']}
        ranked = sorted(groups, key=lambda group: group[1], reverse=True)
        for cid, size in ranked[:2]:
            self.assertEqual(breakdown[f'collection:{cid}'], size)
        self.assertNotIn(f'collection:{ranked[2][0]}', breakdown)
        self.assertGreaterEqual(breakdown['other_outputs'], ranked[2][1])
        self.assertEqual(sum(breakdown.values()), state['bytes'])

    def test_cache_clear_preserves_generated_files_shared_with_active_thread(self):
        jobs = self.studio.create_jobs(self.studio.JobInput(prompt='shared thread', count=2, stitch=4, source_asset_id=self.reference['id']))['ids']
        done, active = jobs
        thread = 'shared_thread_123456'
        self.studio.write("UPDATE jobs SET status='failed',thread_id=? WHERE id=?", (thread, done))
        self.studio.write('UPDATE jobs SET thread_id=? WHERE id=?', (thread, active))
        cache = self.studio.DATA / 'jobs' / done / 'stitch' / 'scratch.bin'
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(b'scratch')
        result = self.studio.CODEX_HOME / 'generated_images' / thread / 'return.png'
        result.parent.mkdir(parents=True, exist_ok=True)
        result.write_bytes(b'active return')
        response = self.client.post('/api/storage/clear-cache', json={'confirm':'clear-cache'}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(cache.exists())
        self.assertEqual(result.read_bytes(), b'active return')

    def test_upscale_history_is_hidden_but_remains_addressable(self):
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='hidden upscale', stitch=4, source_asset_id=self.reference['id']))['ids'][0]
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?", (jid,))
        self.assertEqual(self.client.delete('/api/jobs/' + jid, headers=self.headers).status_code, 200)
        self.assertNotIn(jid, [job['id'] for job in self.client.get('/api/upscale/jobs?limit=100').json()['items']])
        self.assertEqual(self.client.get('/api/jobs/' + jid).status_code, 200)

    def test_stage_cache_breakdown_deduplicates_hardlinks_to_assets(self):
        jid = self.studio.create_jobs(self.studio.JobInput(prompt='stage accounting', stitch=4, source_asset_id=self.reference['id']))['ids'][0]
        stage = self.studio.DATA / 'jobs' / jid / 'stitch' / 'stages' / ('01-' + 'a' * 16) / 'redraw'
        stage.mkdir(parents=True)
        (stage / 'unique.bin').write_bytes(b'x' * 1234)
        asset = Path(self.studio.query('SELECT path FROM assets WHERE id=?', (self.reference['id'],), True)['path'])
        (stage / 'linked.png').hardlink_to(asset)
        state = self.client.get('/api/storage').json()
        breakdown = {item['key']: item['bytes'] for item in state['breakdown']}
        self.assertEqual(breakdown['upscale_1'], 1234)
        self.assertEqual(sum(breakdown.values()), state['bytes'])
