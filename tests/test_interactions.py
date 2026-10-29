"""Workspace contracts; all image generation is replaced by deterministic fixtures."""
import asyncio
import importlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image


class InteractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        os.environ['STUDIO_DATA'] = cls.temp.name
        os.environ['STUDIO_SETUP_TOKEN'] = 'interaction-test-only'
        os.environ.pop('STUDIO_SETUP_TOKEN_FILE', None)
        import app
        cls.studio = importlib.reload(app)
        cls.client = TestClient(cls.studio.app, base_url='https://image.test')
        cls.client.__enter__()
        result = cls.client.post('/api/auth/setup', json={'username':'admin','password':'test-password-long','setup_token':'interaction-test-only'})
        cls.headers = {'X-CSRF-Token': result.json()['csrf'], 'Origin':'https://image.test'}
        cls.studio.set_setting('paused', True)
        fixture = io.BytesIO()
        y, x = np.indices((337, 501))
        cls.pixels = np.stack((x % 251, y % 241, (x + y) % 239), axis=-1).astype('uint8')
        Image.fromarray(cls.pixels).save(fixture, 'PNG')
        cls.asset = cls.client.post('/api/assets', files={'file':('source.png',fixture.getvalue(),'image/png')},headers=cls.headers).json()['asset']

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.temp.cleanup()

    def post(self, path, data):
        with patch.object(self.studio, 'command', AsyncMock(return_value=(0,'Logged in using ChatGPT (fixture)'))):
            return self.client.post(path, json=data, headers=self.headers)

    def test_preferences_validate_and_patch_without_resetting_queue(self):
        result = self.client.patch('/api/settings', json={'defaults':{'ratio':'3:2','count':3},'motion':False},headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)
        value = self.client.get('/api/settings').json()
        self.assertEqual(value['defaults']['count'],3)
        self.assertEqual(value['defaults']['size'],'auto')
        self.assertFalse(value['motion'])
        self.assertTrue(self.studio.setting('paused'))
        self.assertEqual(self.client.patch('/api/settings',json={'defaults':{'count':21}},headers=self.headers).status_code,422)

    def test_quick_edit_snapshots_exact_source_size_without_modifying_original(self):
        result = self.post(f"/api/assets/{self.asset['id']}/quick-edit", {'prompt':'把背景改为夜晚'})
        self.assertEqual(result.status_code,200,result.text)
        job = self.client.get('/api/jobs/'+result.json()['ids'][0]).json()
        self.assertTrue(job['options']['quick_edit'])
        self.assertEqual(job['options']['requested_size'],[501,337])
        self.assertEqual(job['refs'],[self.asset['id']])
        row = self.studio.query('SELECT * FROM jobs WHERE id=?',(job['id'],),True)
        instruction = self.studio.make_instruction(row,Path(self.temp.name))
        self.assertIn('501x337 pixels',instruction)
        self.assertIn('把背景改为夜晚',instruction)
        self.assertEqual(job['source_image']['id'],self.asset['id'])

    def test_quick_edit_rejects_missing_image_and_blank_prompt(self):
        self.assertEqual(self.post('/api/assets/missing/quick-edit',{'prompt':'change'}).status_code,404)
        self.assertEqual(self.post(f"/api/assets/{self.asset['id']}/quick-edit",{'prompt':'  '}).status_code,400)

    def test_quick_edit_demo_switches_snapshot_real_spec_and_reference_choice(self):
        previous = self.studio.setting('quick', {})
        try:
            for keep_spec in (False, True):
                for use_ref in (False, True):
                    with self.subTest(keep_spec=keep_spec, use_ref=use_ref):
                        response = self.client.patch('/api/settings', json={'quick': {
                            'keep_spec': keep_spec, 'use_ref': use_ref, 'notify': False}}, headers=self.headers)
                        self.assertEqual(response.status_code, 200, response.text)
                        result = self.post(f"/api/assets/{self.asset['id']}/quick-edit", {
                            'prompt': '晚霞映照的山谷', 'spec': {'ratio': '9:16', 'size': '2048'}})
                        self.assertEqual(result.status_code, 200, result.text)
                        job = self.client.get('/api/jobs/' + result.json()['ids'][0]).json()
                        self.assertEqual(job['refs'], [self.asset['id']] if use_ref else [])
                        self.assertEqual(job['options'].get('requested_size'), [501, 337] if keep_spec else None)
                        self.assertEqual(job['options']['ratio'], 'auto' if keep_spec else '9:16')
                        self.assertEqual(job['options']['size'], 'auto' if keep_spec else '2048')
                        self.assertEqual(job['source_image']['id'], self.asset['id'])
                        row = self.studio.query('SELECT * FROM jobs WHERE id=?', (job['id'],), True)
                        instruction = self.studio.make_instruction(row, Path(self.temp.name))
                        if not use_ref:
                            self.assertNotIn('Edit reference-1.png', instruction)
                        if keep_spec:
                            self.assertIn('501x337 pixels', instruction)
        finally:
            self.studio.set_setting('quick', previous)

    def test_motion_mode_roundtrips_without_resetting_legacy_preferences(self):
        for mode in ('system', 'reduce', 'full'):
            response = self.client.patch('/api/settings', json={'motion_mode': mode}, headers=self.headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.client.get('/api/settings').json()['motion_mode'], mode)
            self.assertTrue(self.studio.setting('paused'))
        self.assertEqual(self.client.patch('/api/settings', json={'motion_mode': 'invalid'}, headers=self.headers).status_code, 422)

    def test_quick_edit_provenance_survives_renaming_and_default_effort_matches_its_model(self):
        catalog=self.studio.model_catalog()
        self.studio.set_setting('model_catalog',catalog+[{'id':'gpt-test-fast','name':'Test model','efforts':['low'],'default_effort':'low'}])
        try:
            saved=self.client.patch('/api/settings',json={'quick':{'model':'gpt-test-fast'}},headers=self.headers)
            self.assertEqual(saved.status_code,200,saved.text)
            result=self.post(f"/api/assets/{self.asset['id']}/quick-edit",{'prompt':'evening'})
            jid=result.json()['ids'][0];job=self.client.get('/api/jobs/'+jid).json()
            self.assertEqual(job['effort'],'low')
            path=Path(self.temp.name)/'quick-fixture.png';Image.new('RGB',(40,60),'purple').save(path)
            asset,_=self.studio.store_image_path(path,'unrelated name.png','generated',jid)
            self.client.patch('/api/assets/'+asset['id'],json={'name':'renamed'},headers=self.headers)
            info=self.client.get('/api/assets/'+asset['id']+'/info').json()
            self.assertEqual(info['asset']['operation'],'quick-edit')
            self.assertEqual(info['job']['source_image']['id'],self.asset['id'])
        finally:
            self.studio.set_setting('quick',{})
            self.studio.set_setting('model_catalog',catalog)

    def test_batches_are_not_split_by_pagination_and_filter_returns_complete_batch(self):
        result = self.studio.create_jobs(self.studio.JobInput(prompt='batch pagination',count=20))
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?",(result['ids'][0],))
        data = self.client.get('/api/batches?status=failed&limit=1').json()
        batch = next(item for item in data['items'] if item['id']==result['batch_id'])
        self.assertEqual(len(batch['jobs']),20)
        self.assertEqual(sum(job['status']=='failed' for job in batch['jobs']),1)

    def test_probe_does_not_add_a_work_collection(self):
        result = self.post('/api/setup/probe',{})
        self.assertEqual(result.status_code,200,result.text)
        job = self.client.get('/api/jobs/'+result.json()['ids'][0]).json()
        self.assertEqual(job['collection_id'],'system-probe')
        self.assertTrue(job['options']['system_probe'])
        self.assertNotIn('system-probe',[g['id'] for g in self.client.get('/api/collections').json()['items']])

    def test_generate_then_upscale_publishes_original_and_enqueues_one_child_atomically(self):
        original_template=self.studio.setting('stitch_prompt',self.studio.DEFAULT_STITCH_PROMPT)
        result=self.studio.create_jobs(self.studio.JobInput(prompt='generate then upscale fixture',after_upscale=4,max_attempts=1))
        jid=result['ids'][0]
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?",(jid,))
        self.studio.set_setting('stitch_prompt','new template {prompt} that must not replace the saved snapshot')
        path=Path(self.temp.name)/'after-upscale-original.png';Image.new('RGB',(210,330),(129,184,37)).save(path)
        try:
            asset=self.studio.record_generated_image(jid,path)
            self.studio.record_generated_image(jid,path)
            parent=self.client.get('/api/jobs/'+jid).json()
            child=self.client.get('/api/jobs/'+parent['options']['after_upscale_job_id']).json()
            self.assertEqual(parent['status'],'succeeded')
            self.assertEqual(parent['outputs'][0]['id'],asset['id'])
            self.assertEqual(child['status'],'queued')
            self.assertEqual(child['batch_id'],parent['batch_id'])
            self.assertEqual(child['options']['parent_job_id'],jid)
            self.assertEqual(child['options']['source_asset_id'],asset['id'])
            self.assertEqual(child['options']['stitch'],4)
            self.assertEqual(child['options']['after_upscale'],0)
            self.assertEqual(child['options']['stitch_prompt'],original_template)
            self.assertEqual(child['max_attempts'],1)
            self.assertEqual(self.studio.query('SELECT COUNT(*) AS n FROM jobs WHERE batch_id=?',(result['batch_id'],),True)['n'],2)
        finally:self.studio.set_setting('stitch_prompt',original_template)

    def test_cancelled_original_does_not_enqueue_upscale(self):
        result=self.studio.create_jobs(self.studio.JobInput(prompt='cancelled original fixture',after_upscale=4))
        jid=result['ids'][0];self.studio.write("UPDATE jobs SET status='cancelled' WHERE id=?",(jid,))
        path=Path(self.temp.name)/'cancelled-original.png';Image.new('RGB',(100,80),'orange').save(path)
        self.assertIsNone(self.studio.record_generated_image(jid,path))
        self.assertEqual(self.studio.query('SELECT COUNT(*) AS n FROM jobs WHERE batch_id=?',(result['batch_id'],),True)['n'],1)

    def test_regions_reject_overlap_outside_bounds_and_more_than_six(self):
        url=f"/api/assets/{self.asset['id']}/inpaint"
        region={'x':10,'y':10,'width':80,'height':80}
        for regions in ([region,dict(region,x=60)], [dict(region,x=480)], [dict(region,x=i*20) for i in range(7)]):
            result=self.post(url,{'prompt':'blue','regions':regions})
            self.assertIn(result.status_code,(400,422),result.text)
        self.assertEqual(self.post(url,{'regions':[region]}).status_code,400)
        self.assertEqual(self.post(url,{'prompt':'blue','region':region,'regions':[region]}).status_code,400)

    def region_job(self):
        regions=[{'x':20,'y':30,'width':80,'height':70,'prompt':'blue'},
                 {'x':210,'y':120,'width':90,'height':80,'prompt':'green'}]
        result=self.post(f"/api/assets/{self.asset['id']}/inpaint",{'regions':regions})
        self.assertEqual(result.status_code,200,result.text)
        jid=result.json()['ids'][0]
        self.studio.write("UPDATE jobs SET status='running',max_attempts=1 WHERE id=?",(jid,))
        return jid,regions

    def test_parallel_regions_share_pool_compose_once_and_preserve_every_outside_pixel(self):
        import region_workflow
        jid,regions=self.region_job()
        active=0;peak=0
        async def generate(studio,jid,folder,name,instruction,refs,model,effort,*args,**kwargs):
            nonlocal active,peak
            async with studio.cli_slot(jid,name):
                active+=1;peak=max(peak,active)
                try:
                    await asyncio.sleep(.04)
                    path=folder/'synthetic.png'
                    Image.new('RGB',kwargs['expected_size'],'blue' if '/0' in folder.as_posix() else 'green').save(path)
                    return path
                finally:active-=1
        async def execute():
            self.studio.set_setting('concurrency',2)
            # Exercise permits while the real scheduler stays paused throughout.
            with patch.object(self.studio.CALL_POOL,'get_paused',return_value=False), patch('region_workflow.cli_call',generate):
                await region_workflow.run(self.studio,jid)
        self.client.portal.call(execute)
        self.assertEqual(peak,2)
        self.assertEqual(active,0)
        job=self.client.get('/api/jobs/'+jid).json()
        self.assertEqual(job['status'],'succeeded',job.get('error'))
        self.assertEqual(len(job['outputs']),1)
        self.assertEqual(len(job['progress']['regions']),2)
        result=np.array(Image.open(io.BytesIO(self.client.get(job['outputs'][0]['url']).content)))
        mask=np.ones(result.shape[:2],dtype=bool)
        for r in regions:mask[r['y']:r['y']+r['height'],r['x']:r['x']+r['width']]=False
        np.testing.assert_array_equal(result[mask],self.pixels[mask])
        self.assertGreater(int(result[60,60,2]),200)
        self.assertEqual(self.studio.CALL_POOL.snapshot()['active'],0)

    def test_failed_region_keeps_completed_peer_for_retry_and_publishes_no_partial_result(self):
        import region_workflow
        jid,_=self.region_job();calls=[];fail=True
        async def generate(studio,jid,folder,*args,**kwargs):
            index=int(folder.name);calls.append(index)
            if index==1 and fail:raise RuntimeError('synthetic failed region')
            path=folder/'synthetic.png';Image.new('RGB',kwargs['expected_size'],'blue').save(path);return path
        async def execute():
            with patch('region_workflow.cli_call',generate):await region_workflow.run(self.studio,jid)
        self.client.portal.call(execute)
        job=self.client.get('/api/jobs/'+jid).json()
        self.assertEqual(job['status'],'failed')
        self.assertEqual(job['outputs'],[])
        self.assertTrue((self.studio.DATA/'jobs'/jid/'regions/0/return.png').exists())
        fail=False
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?",(jid,))
        self.client.portal.call(execute)
        self.assertEqual(calls.count(0),1)
        self.assertEqual(calls.count(1),2)
        self.assertEqual(self.client.get('/api/jobs/'+jid).json()['status'],'succeeded')

    def test_cancelled_region_job_releases_all_permits_and_publishes_nothing(self):
        import region_workflow
        jid,_=self.region_job()
        async def execute():
            started=asyncio.Event()
            async def generate(studio,jid,folder,name,*args,**kwargs):
                async with studio.cli_slot(jid,name):
                    started.set()
                    await asyncio.Future()
            with patch.object(self.studio.CALL_POOL,'get_paused',return_value=False),patch('region_workflow.cli_call',generate):
                task=asyncio.create_task(region_workflow.run(self.studio,jid))
                await asyncio.wait_for(started.wait(),2)
                self.studio.write("UPDATE jobs SET status='cancelled' WHERE id=?",(jid,))
                task.cancel()
                await asyncio.gather(task,return_exceptions=True)
        self.client.portal.call(execute)
        self.assertEqual(self.studio.CALL_POOL.snapshot()['active'],0)
        self.assertEqual(self.studio.CALL_POOL.snapshot()['waiting'],0)
        self.assertEqual(self.client.get('/api/jobs/'+jid).json()['outputs'],[])
        state=json.loads((self.studio.DATA/'jobs'/jid/'regions.json').read_text())
        self.assertTrue(all(item['status']=='cancelled' for item in state['regions']))

    def test_new_read_endpoints_require_authentication(self):
        anonymous=TestClient(self.studio.app,base_url='https://image.test')
        try:
            for path in ('/api/settings','/api/batches',f"/api/assets/{self.asset['id']}/info"):
                self.assertEqual(anonymous.get(path).status_code,401)
        finally:anonymous.close()
