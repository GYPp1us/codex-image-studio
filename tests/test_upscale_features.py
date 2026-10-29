"""Isolated API/workflow tests. Model calls use a fixture, never a real subscription."""
import asyncio
import importlib
import io
import json
import math
import os
import shutil
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

    def comparison_fixture(self):
        from stitch_engine import save_json
        source=Path(self.temporary.name)/'tmp'/'compare-source.png'
        Image.fromarray(cv2.cvtColor(texture(960,768),cv2.COLOR_BGR2RGB)).save(source)
        asset,_=self.studio.store_image_path(source,'compare-source.png')
        jid=self.studio.create_jobs(self.studio.JobInput(prompt='Tile comparison fixture',source_asset_id=asset['id'],stitch=4))['ids'][0]
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?",(jid,))
        manifest=progressive_plan(960,768,4);stage=manifest['stages'][0];stage['folder']='stages/01-'+'c'*16
        folder=self.studio.DATA/'jobs'/jid/'stitch'/stage['folder']
        (folder/'crops').mkdir(parents=True);(folder/'redraw').mkdir()
        shutil.copyfile(source,folder/'base.png');plan=execution_plan(stage);save_json(folder/'plan.json',plan)
        save_json(folder.parent.parent/'progressive.json',manifest)
        imaging.crop(source,plan['tiles'][0]['box'],folder/'crops/0.png')
        Image.new('RGB',(2201,1651),'blue').save(folder/'redraw/0.png')
        return jid,folder,plan['tiles'][0]

    def test_comparison_shows_complete_input_and_native_output_as_private_bounded_previews(self):
        jid,folder,tile=self.comparison_fixture();before={p:p.read_bytes() for p in (folder/'crops/0.png',folder/'redraw/0.png')}
        url=f'/api/upscale/jobs/{jid}/comparison?level=1&tile=0';response=self.client.get(url)
        self.assertEqual(response.status_code,200,response.text);data=response.json()
        self.assertEqual(data['input_size'],[tile['box'][2]-tile['box'][0],tile['box'][3]-tile['box'][1]])
        self.assertNotEqual(data['input_size'],[tile['core'][2]-tile['core'][0],tile['core'][3]-tile['core'][1]])
        self.assertEqual(data['output_size'],[2201,1651]);self.assertEqual(data['expected_size'],tile['size'])
        for image_url in data['images'].values():
            preview=self.client.get(image_url);self.assertEqual(preview.status_code,200)
            with Image.open(io.BytesIO(preview.content)) as image:self.assertLessEqual(max(image.size),1600)
            self.assertIn('no-store',preview.headers['cache-control'])
        self.assertTrue(all(p.read_bytes()==value for p,value in before.items()))
        anonymous=TestClient(self.studio.app,base_url='https://image.test')
        self.assertEqual(anonymous.get(url).status_code,401)
        self.assertEqual(anonymous.get(data['images']['input']).status_code,401);anonymous.close()
        Image.new('RGB',(1001,777),'red').save(folder/'redraw/0.png')
        refreshed=self.client.get(url).json();self.assertNotEqual(refreshed['version'],data['version'])
        self.assertEqual(refreshed['output_size'],[1001,777])

    def test_comparison_missing_or_rejected_output_and_invalid_tile_are_handled(self):
        jid,folder,_=self.comparison_fixture();url=f'/api/upscale/jobs/{jid}/comparison?level=1&tile=0'
        (folder/'redraw/0.png').rename(folder/'redraw/rejected-0.png')
        rejected=self.client.get(url).json();self.assertEqual(rejected['output_kind'],'rejected');self.assertTrue(rejected['images']['output'])
        (folder/'redraw/rejected-0.png').unlink()
        missing=self.client.get(url).json();self.assertIsNone(missing['output_size']);self.assertIsNone(missing['images']['output'])
        self.assertEqual(self.client.get(url.replace('tile=0','tile=-1')).status_code,404)
        self.assertEqual(self.client.get(url.replace('tile=0','tile=99999')).status_code,404)
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?",(jid,))
        self.assertEqual(self.client.get(url).status_code,409)
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?",(jid,))

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

    def run_fixture(self,factor=4,undersize=False,wrong_aspect=False,malformed=False,jid=None,instructions=None):
        import upscale_workflow as workflow
        jid=jid or self.studio.create_jobs(self.studio.JobInput(prompt='Texture enhancement fixture',source_asset_id=self.asset['id'],stitch=factor,max_attempts=2))['ids'][0]
        self.studio.write("UPDATE jobs SET status='running' WHERE id=?",(jid,))
        first=True
        async def fake_cli(studio,jid,folder,name,instruction,references,model,effort,phase,done,units,image=True,on_progress=None,expected_size=None):
            nonlocal first
            if instructions is not None:instructions.append(instruction)
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
        import upscale_workflow as workflow
        with patch.object(workflow.time,'time_ns',return_value=1793264013831838877):
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

    def test_failure_diagnostic_is_bounded_marks_missing_pixels_and_stays_private(self):
        import upscale_api
        from stitch_engine import read_bgr,write_png
        job=self.run_fixture();folder=upscale_api.stage_folder(self.studio,job['id'],1)
        image=read_bgr(folder/'redraw/0.png')
        moved=cv2.warpAffine(image,np.array([[1,0,0],[0,1,-80]],np.float64),(image.shape[1],image.shape[0]),borderMode=cv2.BORDER_REFLECT_101)
        write_png(folder/'redraw/0.png',moved)
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?",(job['id'],))
        response=self.client.get(f"/api/upscale/jobs/{job['id']}/diagnostics?level=1")
        self.assertEqual(response.status_code,200,response.text[:300]);report=response.json()
        self.assertEqual(report['tiles'][0]['state'],'coverage');self.assertGreater(report['tiles'][0]['missing_core_pixels'],1000)
        for url in report['images'].values():
            response=self.client.get(url);self.assertEqual(response.status_code,200)
            with Image.open(io.BytesIO(response.content)) as preview:self.assertLessEqual(max(preview.size),1600)
        anonymous=TestClient(self.studio.app,base_url='https://image.test')
        self.assertEqual(anonymous.get(report['images']['raw']).status_code,401);anonymous.close()

    def test_selected_redraw_preserves_peers_and_passes_new_template_and_injection(self):
        import upscale_api
        job=self.run_fixture(16);folder=upscale_api.stage_folder(self.studio,job['id'],2)
        peers={p:p.read_bytes() for p in (folder/'redraw').glob('*.png') if p.name!='0.png'}
        before=job['upscale_plan']['calls']['images']
        self.studio.write("UPDATE jobs SET status='failed',outputs='[]' WHERE id=?",(job['id'],))
        old=self.studio.setting('stitch_prompt',None)
        self.studio.set_setting('stitch_prompt','CUSTOM SUPERSAMPLING {target_size}\n{prompt}\n{injection}')
        try:
            response=self.post(f"/api/upscale/jobs/{job['id']}/redraw",{'level':2,'tiles':[0],'upscale_injection':'Ink details {prompt} remain literal.','use_current_prompt':True})
            self.assertEqual(response.status_code,200,response.text)
            self.assertTrue(all(p.read_bytes()==content for p,content in peers.items()))
            self.assertFalse((folder/'redraw/0.png').exists());self.assertTrue(list((folder/'repairs').glob('*/0.png')))
            prompts=[];resumed=self.run_fixture(jid=job['id'],instructions=prompts)
            self.assertEqual(resumed['status'],'succeeded',resumed['error'])
            self.assertEqual(resumed['upscale_plan']['calls']['images'],before+1)
            self.assertGreaterEqual(resumed['upscale_plan']['budget']['images'],resumed['upscale_plan']['calls']['images'])
            self.assertGreaterEqual(resumed['upscale_plan']['budget']['reviews'],resumed['upscale_plan']['calls']['reviews'])
            self.assertTrue(all(p.read_bytes()==content for p,content in peers.items()))
            self.assertTrue(any('CUSTOM SUPERSAMPLING' in p and 'Ink details {prompt} remain literal.' in p and '上次返回不符合要求' in p for p in prompts))
        finally:
            if old is None:self.studio.write("DELETE FROM settings WHERE key='stitch_prompt'")
            else:self.studio.set_setting('stitch_prompt',old)

    def test_selected_redraw_invalidates_later_stages_and_rejects_active_and_invalid_tiles(self):
        import upscale_api
        job=self.run_fixture(16);later=upscale_api.stage_folder(self.studio,job['id'],2)
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?",(job['id'],))
        self.assertEqual(self.post(f"/api/upscale/jobs/{job['id']}/redraw",{'level':1,'tiles':[99999]}).status_code,400)
        response=self.post(f"/api/upscale/jobs/{job['id']}/redraw",{'level':1,'tiles':[0]})
        self.assertEqual(response.status_code,200,response.text)
        self.assertFalse(list((later/'redraw').glob('*.png')));self.assertFalse((later/'candidate.png').exists())
        self.assertEqual(self.post(f"/api/upscale/jobs/{job['id']}/redraw",{'level':1,'tiles':[0]}).status_code,409)
        self.studio.write("UPDATE jobs SET status='cancelled' WHERE id=?",(job['id'],))

    def test_task_injection_is_saved_but_cannot_change_an_active_task(self):
        jid=self.studio.create_jobs(self.studio.JobInput(prompt='Injection snapshot',source_asset_id=self.asset['id'],stitch=4,upscale_injection='Keep ink'))['ids'][0]
        path=f'/api/upscale/jobs/{jid}/injection'
        self.assertEqual(self.client.patch(path,json={'upscale_injection':'new'},headers=self.headers).status_code,409)
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?",(jid,))
        self.assertEqual(self.client.patch(path,json={'upscale_injection':'Precise lines'},headers=self.headers).status_code,200)
        self.assertEqual(json.loads(self.studio.query('SELECT options FROM jobs WHERE id=?',(jid,),True)['options'])['upscale_injection'],'Precise lines')

    def test_unselected_bad_peer_is_reported_without_a_hidden_redraw_call(self):
        import upscale_api
        job=self.run_fixture(16);folder=upscale_api.stage_folder(self.studio,job['id'],2)
        peer=folder/'redraw/1.png'
        with Image.open(peer) as image:size=image.size
        Image.new('RGB',size,'white').save(peer);retained=peer.read_bytes()
        self.studio.write("UPDATE jobs SET status='failed' WHERE id=?",(job['id'],))
        response=self.post(f"/api/upscale/jobs/{job['id']}/redraw",{'level':2,'tiles':[0]})
        self.assertEqual(response.status_code,200,response.text)
        result=self.run_fixture(jid=job['id'])
        self.assertEqual(result['status'],'failed')
        self.assertIn('未选中',result['error']);self.assertEqual(peer.read_bytes(),retained)
        self.assertEqual(result['upscale_plan']['calls']['images'],job['upscale_plan']['calls']['images']+1)


if __name__=='__main__':unittest.main()
