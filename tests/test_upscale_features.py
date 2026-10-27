"""Isolated API/workflow tests. Model calls use a fixture, never a real subscription."""
import asyncio
import importlib
import io
import json
import math
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

import image_runtime as imaging
from storage_manager import Storage,StorageFull
from stitch_planner import execution_plan,progressive_plan,split_tile
from test_stitch_engine import texture


class ReturnContractTests(unittest.TestCase):
    def test_large_rectangular_edit_streams_and_keeps_unselected_pixels(self):
        import local_edit
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'source.png';generated=root/'return.png';output=root/'edited.png'
            imaging.pyvips.Image.black(8001,2201,bands=4).new_from_image([12,24,36,190]).pngsave(str(source))
            region={'x':4000,'y':1000,'width':80,'height':64}
            brief,refs,size=local_edit.prepare(source,root/'work',region,'修改为蓝色')
            self.assertLessEqual(max(size),1600);self.assertEqual(len(refs),3)
            Image.new('RGBA',size,(10,20,230,220)).save(generated)
            local_edit.compose(source,generated,region,output)
            result=imaging.open_image(output)
            self.assertEqual((result.width,result.height),(8001,2201))
            self.assertEqual(result.getpoint(3999,1000),[12,24,36,190])
            self.assertEqual(result.getpoint(8000,2200),[12,24,36,190])
            self.assertGreater(result.getpoint(4040,1030)[2],200)
            del result

    def test_native_size_and_wrong_aspect_are_distinct_decisions(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'return.png'
            for size,decision in (((1100,880),'accept'),((900,720),'split'),((1000,1000),'retry')):
                Image.new('RGB',size).save(path)
                result=imaging.assess_return(path,(1000,800))
                self.assertEqual(result.decision,decision)
                self.assertEqual(list(result.actual),list(size))

    def test_refining_a_tile_keeps_unaffected_neighbours_and_exact_core_coverage(self):
        plan=execution_plan(progressive_plan(1056,1490,4)['stages'][0])
        original=list(plan['tiles']);parent=original[0]
        children=split_tile(plan,parent['index'])
        self.assertEqual(plan['tiles'][:-4],original[1:])
        self.assertEqual(sum((t['core'][2]-t['core'][0])*(t['core'][3]-t['core'][1]) for t in children),
                         (parent['core'][2]-parent['core'][0])*(parent['core'][3]-parent['core'][1]))
        self.assertTrue(all(math.prod(t['size'])<math.prod(parent['size']) for t in children))

    def test_storage_counts_hardlinks_once_and_rejects_paths_outside_root(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'assets').mkdir();(root/'jobs').mkdir();source=root/'assets'/'a';source.write_bytes(b'x'*1024)
            (root/'jobs'/'b').hardlink_to(source)
            storage=Storage(root,lambda:1000)
            self.assertEqual(storage.usage(True)['bytes'],1024)
            with self.assertRaises(StorageFull):storage.require()
            with self.assertRaises(ValueError):storage.remove(root.parent/'outside')


class UpscaleFeatures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary=tempfile.TemporaryDirectory();os.environ['STUDIO_DATA']=cls.temporary.name
        os.environ['STUDIO_SETUP_TOKEN']='isolated-upscale-test'
        os.environ.pop('STUDIO_SETUP_TOKEN_FILE',None)
        import app
        cls.studio=importlib.reload(app)
        cls.client=TestClient(cls.studio.app,base_url='https://image.test')
        cls.client.__enter__()
        response=cls.client.post('/api/auth/setup',json={'username':'admin','password':'test-password-long','setup_token':'isolated-upscale-test'})
        cls.headers={'X-CSRF-Token':response.json()['csrf'],'Origin':'https://image.test'}
        cls.studio.set_setting('paused',True)
        image=io.BytesIO();Image.fromarray(cv2.cvtColor(texture(512,384),cv2.COLOR_BGR2RGB)).save(image,'PNG')
        cls.asset=cls.client.post('/api/assets',files={'file':('source.png',image.getvalue(),'image/png')},headers=cls.headers).json()['asset']

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None,None,None);imaging.pyvips.cache_set_max(0);cls.temporary.cleanup()

    def tearDown(self):self.studio.set_setting('storage_limit_bytes',0)

    def post(self,path,body=None):return self.client.post(path,json=body or {},headers=self.headers)

    def test_plan_endpoint_keeps_all_sizes_and_needs_authentication(self):
        anonymous=TestClient(self.studio.app,base_url='https://image.test')
        self.assertEqual(anonymous.get(f"/api/assets/{self.asset['id']}/upscale-plan").status_code,401);anonymous.close()
        result=self.client.get(f"/api/assets/{self.asset['id']}/upscale-plan?factor=64")
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()['output_size'],[4096,3072])
        self.assertEqual(len(result.json()['stages']),3)
        self.assertEqual(self.client.get(f"/api/assets/{self.asset['id']}/upscale-plan?factor=9").status_code,400)

    def test_quota_setting_does_not_reset_pause_or_concurrency(self):
        self.studio.set_setting('concurrency',4);used=self.studio.STORAGE.usage(True)['bytes']
        response=self.client.patch('/api/settings',json={'storage_limit_bytes':used-1},headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertTrue(self.studio.setting('paused'));self.assertEqual(self.studio.setting('concurrency'),4)
        image=io.BytesIO();Image.new('RGB',(45,67),'purple').save(image,'PNG')
        result=self.client.post('/api/assets',files={'file':('quota.png',image.getvalue(),'image/png')},headers=self.headers)
        self.assertEqual(result.status_code,507)

    def test_upload_and_preview_exceed_previous_pixel_and_edge_caps(self):
        source=Path(self.temporary.name)/'tmp'/'very-wide.png'
        imaging.pyvips.Image.black(40001,1801,bands=3).pngsave(str(source))
        asset,_=self.studio.store_image_path(source,'large.png')
        self.assertGreater(asset['width']*asset['height'],64_000_000)
        self.assertEqual(asset['width'],40001);self.assertTrue(asset['tile_template'])
        preview=self.client.get(asset['preview']);self.assertEqual(preview.status_code,200)
        with Image.open(io.BytesIO(preview.content)) as image:self.assertLessEqual(max(image.size),1600)
        planned=self.client.get(f"/api/assets/{asset['id']}/upscale-plan?factor=4").json()
        self.assertEqual(planned['output_size'],[80002,3602]);self.assertTrue(planned['executable_with_current_limits'])
        source.unlink()

    def test_multipart_upload_exceeds_the_old_20mb_middleware_limit(self):
        payload=io.BytesIO()
        Image.fromarray(np.random.default_rng(4).integers(0,256,(2500,3000,3),dtype=np.uint8)).save(payload,'PNG',compress_level=0)
        self.assertGreater(payload.tell(),21*1024*1024)
        response=self.client.post('/api/assets',files={'file':('large-upload.png',payload.getvalue(),'image/png')},headers=self.headers)
        self.assertEqual(response.status_code,200,response.text[:400])
        self.assertEqual(response.json()['asset']['width'],3000)

    def test_tiles_are_bounded_and_checked_on_every_request(self):
        source=Path(self.temporary.name)/'tmp'/'tiled.png'
        imaging.pyvips.Image.black(4501,3601,bands=3).pngsave(str(source))
        asset,_=self.studio.store_image_path(source,'tiled.png');maximum=math.ceil(math.log2(max(asset['width'],asset['height'])))
        url=f"/api/assets/{asset['id']}/tiles/{maximum}/0/0"
        response=self.client.get(url);self.assertEqual(response.status_code,200)
        with Image.open(io.BytesIO(response.content)) as image:self.assertEqual(image.size,(512,512))
        self.assertIn('no-store',response.headers['cache-control'])
        anonymous=TestClient(self.studio.app,base_url='https://image.test');self.assertEqual(anonymous.get(url).status_code,401);anonymous.close()
        self.assertEqual(self.client.get(f"/api/assets/{asset['id']}/tiles/{maximum}/99999/0").status_code,404)
        source.unlink()

    def run_fixture(self,factor=4,undersize=False,wrong_aspect=False,malformed=False,jid=None):
        import upscale_workflow as workflow
        jid=jid or self.studio.create_jobs(self.studio.JobInput(prompt='Texture enhancement fixture',source_asset_id=self.asset['id'],stitch=factor,max_attempts=2))['ids'][0]
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?",(jid,))
        first=True
        async def fake_cli(studio,jid,folder,name,instruction,references,model,effort,phase,done,units,image=True,on_progress=None,expected_size=None):
            nonlocal first
            recorder=getattr(studio,'record_cli_call',None)
            if recorder:recorder(image)
            if not image:return '{"pass":true,"issues":[]}'
            if on_progress:on_progress('fixture',True,'test')
            destination=Path(folder)/'calls'/name;destination.mkdir(parents=True,exist_ok=True)
            if malformed and first:
                first=False;(destination/'output.png').write_bytes(b'broken image return');return destination/'output.png'
            size=tuple(expected_size)
            if wrong_aspect:size=(size[0],max(1,size[1]//2))
            if undersize and first:size=tuple(round(v*.85) for v in size)
            first=False
            with Image.open(references[0]) as source:source.resize(size,Image.Resampling.BICUBIC).save(destination/'output.png')
            return destination/'output.png'
        with patch.object(workflow,'cli_call',fake_cli):asyncio.run(workflow.run(self.studio,jid))
        return self.client.get('/api/upscale/jobs/'+jid).json()

    def test_two_stages_publish_exact_size_and_expose_budgets(self):
        job=self.run_fixture(16)
        self.assertEqual(job['status'],'succeeded',job['error'])
        self.assertEqual(job['upscale_plan']['actual_size'],[2048,1536])
        self.assertTrue(all(s['status']=='succeeded' for s in job['upscale_plan']['stages']))
        self.assertEqual(job['upscale_plan']['calls']['reviews'],2)

    def test_small_native_return_refines_only_affected_block(self):
        job=self.run_fixture(4,undersize=True)
        self.assertEqual(job['status'],'succeeded',job['error'])
        stage=job['upscale_plan']['stages'][0]
        self.assertEqual(len(stage['adaptive_splits']),1)
        self.assertEqual(stage['tile_count'],4)
        self.assertEqual(job['upscale_plan']['calls']['images'],5)

    def test_wrong_aspect_never_publishes_a_stretched_success(self):
        job=self.run_fixture(4,wrong_aspect=True)
        self.assertEqual(job['status'],'failed');self.assertEqual(job['outputs'],[])
        self.assertIn('画幅',job['error'])

    def test_malformed_return_retries_without_publishing_invalid_bytes(self):
        job=self.run_fixture(malformed=True)
        self.assertEqual(job['status'],'succeeded',job['error'])
        self.assertEqual(job['upscale_plan']['calls']['images'],2)

    def test_retry_after_cache_cleanup_preserves_cumulative_call_counts(self):
        job=self.run_fixture();self.assertEqual(job['status'],'succeeded',job['error'])
        before=job['upscale_plan']['calls']['images']
        self.assertEqual(self.post(f"/api/upscale/jobs/{job['id']}/clear-cache").status_code,200)
        self.studio.write("UPDATE jobs SET status='failed',outputs='[]' WHERE id=?",(job['id'],))
        retried=self.run_fixture(jid=job['id'])
        self.assertEqual(retried['status'],'succeeded',retried['error'])
        self.assertEqual(retried['upscale_plan']['calls']['images'],before*2)

    def test_cache_cleanup_keeps_outputs_original_and_job_and_rejects_active_jobs(self):
        job=self.run_fixture(4);self.assertEqual(job['status'],'succeeded',job['error'])
        output=job['outputs'][0];before=self.client.get(output['url']).content
        response=self.post(f"/api/upscale/jobs/{job['id']}/clear-cache")
        self.assertEqual(response.status_code,200,response.text);self.assertGreater(response.json()['released_bytes'],0)
        self.assertEqual(self.client.get(output['url']).content,before)
        self.assertEqual(self.client.get('/api/jobs/'+job['id']).json()['status'],'succeeded')
        self.assertEqual(self.client.get('/api/upscale/jobs/'+job['id']).json()['upscale_plan']['cache_cleared'],True)
        queued=self.studio.create_jobs(self.studio.JobInput(prompt='Keep active cache',source_asset_id=self.asset['id'],stitch=4))['ids'][0]
        self.assertEqual(self.post(f'/api/upscale/jobs/{queued}/clear-cache').status_code,409)
        self.studio.write("UPDATE jobs SET status='cancelled' WHERE id=?",(queued,))

    def test_empty_trash_is_explicit_and_preserves_live_outputs(self):
        image=io.BytesIO();Image.new('RGB',(91,79),'gold').save(image,'PNG')
        asset=self.client.post('/api/assets',files={'file':('trash.png',image.getvalue(),'image/png')},headers=self.headers).json()['asset']
        self.client.delete('/api/assets/'+asset['id'],headers=self.headers)
        self.assertEqual(self.post('/api/storage/empty-trash').status_code,422)
        response=self.post('/api/storage/empty-trash',{'confirm':'empty-trash'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn(asset['id'],response.json()['removed_ids'])
        self.assertEqual(self.client.get(asset['url']).status_code,404)
        self.assertEqual(self.client.get(self.asset['url']).status_code,200)


if __name__=='__main__':unittest.main()
