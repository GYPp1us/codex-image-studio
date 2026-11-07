"""Regressions from PR 11 review, with real local pixels and no model calls."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import cv2
import numpy as np

import image_runtime as imaging
import interaction_api
import stitch_engine as engine
import upscale_diagnostics
import upscale_workflow as workflow
from quick_settings import QuickSetting
from pydantic import ValidationError


def texture(width=320,height=256):
    rng=np.random.default_rng(781)
    image=rng.integers(15,235,(height,width,3),dtype=np.uint8)
    return cv2.GaussianBlur(image,(3,3),.7)


class ReviewRegressionTests(unittest.TestCase):
    def test_valid_v4_sift_checkpoint_remains_current_and_stale_return_does_not(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',texture());plan=engine.prepare(folder,4)
            crop=engine.read_bgr(folder/'crops/0.png')
            engine.write_png(folder/'redraw/0.png',cv2.resize(crop,tuple(plan['tiles'][0]['size']),interpolation=cv2.INTER_CUBIC))
            metrics=engine.register_tile(folder,0)
            self.assertEqual(metrics['method'],'SIFT+RANSAC/global_affine')
            checkpoint=folder/'diagnostics/alignment-0.json';metrics['registration_version']=4
            engine.save_json(checkpoint,metrics)
            self.assertTrue(engine.alignment_current(folder,0),'v4 accepted registration remains valid in v5')
            # A newer AI output must invalidate either version of checkpoint.
            returned=folder/'redraw/0.png';old=checkpoint.stat().st_mtime_ns
            import os
            os.utime(returned,ns=(old+1_000_000_000,old+1_000_000_000))
            self.assertFalse(engine.alignment_current(folder,0))

    def test_failure_diagnostics_respect_current_frame_alignment_checkpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',np.full((256,320,3),128,np.uint8));engine.prepare(folder,4)
            engine.interpolate_tile(folder,0);accepted=engine.register_tile(folder,0)
            self.assertEqual(accepted['geometry_evidence'],'frame_only')
            result=upscale_diagnostics.render(folder)
            first=next(item for item in result['tiles'] if item['index']==0)
            self.assertEqual(first['state'],'ready',first)
            self.assertEqual(first['missing_core_pixels'],0)
            self.assertTrue(all(item['state']=='missing' for item in result['tiles'][1:]))

    def test_stale_frame_checkpoint_does_not_authenticate_a_changed_return(self):
        import os
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',np.full((256,320,3),128,np.uint8));engine.prepare(folder,4)
            engine.interpolate_tile(folder,0);engine.register_tile(folder,0)
            checkpoint=folder/'diagnostics/alignment-0.json';output=folder/'redraw/0.png'
            bad=np.full_like(engine.read_bgr(output),255);engine.write_png(output,bad)
            newer=checkpoint.stat().st_mtime_ns+1_000_000_000;os.utime(output,ns=(newer,newer))
            result=upscale_diagnostics.render(folder)
            first=next(item for item in result['tiles'] if item['index']==0)
            self.assertEqual(first['state'],'untrusted',first)

    def test_smooth_classification_is_reused_only_for_unchanged_crop(self):
        import smooth_background
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);base=np.full((256,320,3),128,np.uint8);engine.write_png(folder/'base.png',base)
            with patch.object(smooth_background,'classify',wraps=smooth_background.classify) as classify:
                plan=engine.prepare(folder,4);self.assertEqual(classify.call_count,4)
                engine.prepare(folder,4);self.assertEqual(classify.call_count,4)
                engine.interpolate_tile(folder,0);self.assertEqual(classify.call_count,4)
                base[20:30,20:30]=0;engine.write_png(folder/'base.png',base)
                updated=engine.prepare(folder,4);self.assertGreater(classify.call_count,4)
                self.assertNotIn('0',updated['smooth_backgrounds'])
                self.assertIn('3',updated['smooth_backgrounds'])

    def test_unavailable_stored_quick_setting_cannot_break_preferences(self):
        pins=[{'key':'quality','value':'high','label':'valid'},
              {'key':'image_model','value':'removed-model','label':'old'},
              {'key':'transport','value':'images','label':'valid second'}]
        studio=SimpleNamespace(setting=lambda key,default=None:pins if key=='quick_settings' else default)
        result=interaction_api.preferences(studio)
        self.assertEqual([pin['label'] for pin in result['quick_settings']],['valid','valid second'])
        with self.assertRaises(ValidationError):QuickSetting(key='image_model',value='removed-model')


class WorkflowRegressions(unittest.TestCase):
    def exercise_fallback(self, failure):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',np.full((256,320,3),128,np.uint8))
            plan=engine.layout(320,256,4);engine.save_json(folder/'plan.json',plan)
            stage={'index':1,'input_size':[320,256],'output_size':[640,512],'review_budget':1}
            manifest={'stages':[stage]};calls=[];failures=[]
            studio=SimpleNamespace(MODEL='fixture',EFFORT='low',DEFAULT_CALL_PROMPT='',CODEX_HOME=folder/'codex',
                STORAGE=SimpleNamespace(require=lambda *args:None),make_instruction=lambda *args:'fixture')
            async def run_engine(proxy,jid,directory,command,*args):
                index=int(args[1]) if args else None
                if command=='prepare':engine.prepare(directory,4)
                elif command=='interpolate':
                    if failure=='interpolate' and index==0 and not failures:
                        failures.append(index);raise workflow.WorkflowError('local interpolation failed')
                    engine.interpolate_tile(directory,index)
                elif command=='register':
                    if failure=='register' and index==0 and not failures:
                        failures.append(index);raise workflow.WorkflowError('local registration failed')
                    engine.register_tile(directory,index)
                elif command=='compose':engine.compose(directory)
                else:raise AssertionError(command)
            async def call(proxy,jid,directory,name,instruction,refs,model,effort,*args,image=True,expected_size=None,**kwargs):
                calls.append((image,name))
                if not image:return '{"pass":true,"issues":[]}'
                crop=engine.read_bgr(refs[0]);output=directory/f'{name}.png'
                engine.write_png(output,cv2.resize(crop,tuple(expected_size),interpolation=cv2.INTER_CUBIC));return output
            async def run():
                with patch.object(workflow,'engine',run_engine),patch.object(workflow,'cli_call',call), \
                     patch.object(workflow,'progress'),patch.object(workflow,'ensure_active'):
                    return await workflow.run_level(studio,'fixture',{'max_attempts':2,'prompt':''},{},folder,
                                                    stage,manifest,folder/'manifest.json')
            result=asyncio.run(run())
            self.assertTrue(result.is_file());self.assertEqual(len(failures),1)
            self.assertEqual(sum(image for image,_ in calls),1,calls)
            self.assertEqual(sum(not image for image,_ in calls),1,calls)
            self.assertEqual(stage['local_tile_count'],3)
            self.assertEqual(stage['budget']['reviews'],1)
            self.assertFalse((folder/'diagnostics/local-0.json').exists())

    def test_actual_coverage_hole_redraws_only_owning_tile_then_composes(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',np.full((256,320,3),128,np.uint8))
            engine.save_json(folder/'plan.json',engine.layout(320,256,4))
            stage={'index':1,'input_size':[320,256],'output_size':[640,512],'review_budget':1};manifest={'stages':[stage]}
            studio=SimpleNamespace(MODEL='fixture',EFFORT='low',DEFAULT_CALL_PROMPT='',CODEX_HOME=folder/'codex',
                STORAGE=SimpleNamespace(require=lambda *args:None),make_instruction=lambda *args:'fixture')
            calls=[];peers={};compose_calls=0
            async def run_engine(proxy,jid,directory,command,*args):
                nonlocal compose_calls
                index=int(args[1]) if args else None
                if command=='prepare':engine.prepare(directory,4)
                elif command=='interpolate':engine.interpolate_tile(directory,index)
                elif command=='register':engine.register_tile(directory,index)
                elif command=='compose':
                    compose_calls+=1
                    if compose_calls==1:
                        for i,local_x in ((0,300),(1,44)):
                            mask_path=directory/'masks'/f'valid-{i}.png';mask=cv2.imread(str(mask_path),0)
                            mask[80:90,local_x:local_x+10]=0;engine.write_png(mask_path,mask)
                        peers.update({i:imaging.file_sha(directory/'redraw'/f'{i}.png') for i in (1,2,3)})
                    try:engine.compose(directory)
                    except engine.StitchError as error:raise workflow.WorkflowError(str(error)) from error
                else:raise AssertionError(command)
            async def call(proxy,jid,directory,name,instruction,refs,model,effort,*args,image=True,expected_size=None,**kwargs):
                calls.append((image,name))
                if not image:return '{"pass":true,"issues":[]}'
                crop=engine.read_bgr(refs[0]);output=directory/f'{name}.png'
                engine.write_png(output,cv2.resize(crop,tuple(expected_size),interpolation=cv2.INTER_CUBIC));return output
            async def run():
                with patch.object(workflow,'engine',run_engine),patch.object(workflow,'cli_call',call), \
                     patch.object(workflow,'progress'),patch.object(workflow,'ensure_active'):
                    return await workflow.run_level(studio,'fixture',{'max_attempts':2,'prompt':''},{},folder,
                                                    stage,manifest,folder/'manifest.json')
            self.assertTrue(asyncio.run(run()).is_file());self.assertEqual(compose_calls,2)
            self.assertEqual(sum(image for image,_ in calls),1,calls)
            self.assertTrue(next(name for image,name in calls if image).startswith('tile-0-'))
            self.assertTrue(all(imaging.file_sha(folder/'redraw'/f'{i}.png')==digest for i,digest in peers.items()))
            quality=json.loads((folder/'diagnostics/quality.json').read_text(encoding='utf-8'))
            self.assertEqual(quality['uncovered_pixels'],0)

    def test_completed_local_repair_is_not_overwritten_by_old_interpolation_hash(self):
        import local_edit
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',np.full((256,320,3),128,np.uint8))
            engine.save_json(folder/'plan.json',engine.layout(320,256,4))
            stage={'index':1,'input_size':[320,256],'output_size':[640,512],'review_budget':1};manifest={'stages':[stage]}
            studio=SimpleNamespace(MODEL='fixture',EFFORT='low',DEFAULT_CALL_PROMPT='',CODEX_HOME=folder/'codex',
                STORAGE=SimpleNamespace(require=lambda *args:None),make_instruction=lambda *args:'fixture',uid=lambda:'a'*32,job_cancelled=lambda jid:False)
            calls=[]
            async def run_engine(proxy,jid,directory,command,*args):
                index=int(args[1]) if args else None
                if command=='prepare':engine.prepare(directory,4)
                elif command=='interpolate':engine.interpolate_tile(directory,index)
                elif command=='register':engine.register_tile(directory,index)
                elif command=='compose':engine.compose(directory)
                else:raise AssertionError(command)
            async def call(proxy,jid,directory,name,instruction,refs,model,effort,*args,image=True,**kwargs):
                calls.append((image,name))
                if not image:return '{"pass":true,"issues":[]}'
                self.assertTrue(name.startswith('local-edit-'),name)
                output=directory/'generated-repair.png';engine.write_png(output,np.full((16,16,3),255,np.uint8));return output
            def edit(source,generated,region,destination):
                image=engine.read_bgr(source);image[10:20,10:20]=240;engine.write_png(destination,image)
            async def run():
                with patch.object(workflow,'engine',run_engine),patch.object(workflow,'cli_call',call), \
                     patch.object(workflow,'progress'),patch.object(workflow,'ensure_active'), \
                     patch.object(local_edit,'prepare',return_value=('brief',[],(16,16))),patch.object(local_edit,'compose',side_effect=edit):
                    return await workflow.run_level(studio,'fixture',{'max_attempts':2,'prompt':''},{},folder,
                                                    stage,manifest,folder/'manifest.json')
            asyncio.run(run());self.assertTrue((folder/'diagnostics/local-0.json').exists())
            engine.save_json(folder/'diagnostics/local-repairs.json',[{'tile':0,'region':{'x':10,'y':10,'width':20,'height':20},'prompt':'repair'}])
            asyncio.run(run())
            self.assertTrue(np.all(engine.read_bgr(folder/'redraw/0.png')[10:20,10:20]==240))
            self.assertFalse((folder/'diagnostics/local-0.json').exists())
            self.assertEqual(sum(image for image,_ in calls),1,calls)
            self.assertEqual(sum(not image for image,_ in calls),1,calls)

    def test_bookkeeping_write_failure_never_deletes_paid_image_checkpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',np.full((256,320,3),128,np.uint8))
            plan=engine.prepare(folder,4)
            for tile in plan['tiles']:
                index=tile['index'];crop=engine.read_bgr(folder/'crops'/f'{index}.png')
                engine.write_png(folder/'redraw'/f'{index}.png',cv2.resize(crop,tuple(tile['size'])))
            before=imaging.file_sha(folder/'redraw/0.png')
            stage={'index':1,'input_size':[320,256],'output_size':[640,512],'review_budget':1};manifest={'stages':[stage]}
            studio=SimpleNamespace(MODEL='fixture',EFFORT='low',DEFAULT_CALL_PROMPT='',CODEX_HOME=folder/'codex',
                STORAGE=SimpleNamespace(require=lambda *args:None),make_instruction=lambda *args:'fixture')
            real_save=workflow.save_json
            def fail_bookkeeping(path,value):
                if Path(path)==folder/'plan.json' and len(value.get('smooth_backgrounds',{}))<4:
                    raise OSError('simulated accounting file lock')
                return real_save(path,value)
            async def run_engine(proxy,jid,directory,command,*args):
                if command=='prepare':engine.prepare(directory,4)
                else:raise AssertionError('unexpected stage '+command)
            async def call(*args,**kwargs):raise AssertionError('paid checkpoint should not cause model call')
            async def run():
                with patch.object(workflow,'engine',run_engine),patch.object(workflow,'cli_call',call), \
                     patch.object(workflow,'save_json',side_effect=fail_bookkeeping),patch.object(workflow,'progress'),patch.object(workflow,'ensure_active'):
                    return await workflow.run_level(studio,'fixture',{'max_attempts':2,'prompt':''},{},folder,
                                                    stage,manifest,folder/'manifest.json')
            with self.assertRaises(OSError):asyncio.run(run())
            self.assertEqual(imaging.file_sha(folder/'redraw/0.png'),before)

    def test_interpolation_failure_falls_back_to_ai_for_only_that_tile(self):
        self.exercise_fallback('interpolate')

    def test_local_registration_failure_falls_back_to_ai_for_only_that_tile(self):
        self.exercise_fallback('register')


class ApiRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_upscale_features import UpscaleFeatures
        cls.fixture_class=UpscaleFeatures;UpscaleFeatures.setUpClass()
        cls.helper=UpscaleFeatures('runTest');cls.studio=UpscaleFeatures.studio;cls.client=UpscaleFeatures.client

    @classmethod
    def tearDownClass(cls):
        cls.fixture_class.tearDownClass()

    def test_partial_backend_override_inherits_current_server_settings(self):
        baseline={'transport':'responses','fallback':False,'image_model':'gpt-image-2.6-sunburst',
                  'quality':'high','partial_images':1}
        self.studio.set_setting('image_backend',baseline)
        for body,expected in [({},baseline),({'image_model':'gpt-image-2.6-flare'},dict(baseline,image_model='gpt-image-2.6-flare'))]:
            payload={'prompt':'Snapshot fixture'}
            if body:payload['image_backend']=body
            with patch.object(self.studio,'command',new=AsyncMock(return_value=(0,'Logged in'))):
                response=self.helper.post('/api/jobs',payload)
            self.assertEqual(response.status_code,200,response.text)
            jid=response.json()['ids'][0];job=self.client.get('/api/jobs/'+jid).json()
            self.assertEqual(job['options']['generation']['image_backend'],expected)
            self.helper.post('/api/jobs/'+jid+'/cancel')
        self.assertEqual(self.studio.setting('image_backend',{}),baseline)

    def test_repairing_earlier_level_does_not_charge_smooth_later_level(self):
        from PIL import Image
        from stitch_planner import execution_plan,progressive_plan
        job=self.studio.create_jobs(self.studio.JobInput(prompt='budget fixture',source_asset_id=self.fixture_class.asset['id'],stitch=16))
        jid=job['ids'][0];self.studio.write("UPDATE jobs SET status='failed' WHERE id=?",(jid,))
        root=self.studio.DATA/'jobs'/jid/'stitch';root.mkdir(parents=True,exist_ok=True)
        manifest=progressive_plan(512,384,16);manifest['status']='failed'
        for stage in manifest['stages']:
            level=stage['index'];relative=f"stages/{level:02d}-"+('a' if level==1 else 'b')*16
            stage['folder']=relative;stage['status']='failed';folder=root/relative
            for sub in ('redraw','crops','diagnostics'):(folder/sub).mkdir(parents=True,exist_ok=True)
            plan=execution_plan(stage)
            plan['smooth_backgrounds']={} if level==1 else {str(t['index']):{'eligible':True} for t in plan['tiles']}
            stage['calls']={'images':0,'reviews':0};workflow.sync_stage(stage,plan,2)
            engine.save_json(folder/'plan.json',plan)
            if level==1:Image.new('RGB',tuple(stage['input_size']),'white').save(folder/'base.png')
        workflow.refresh_totals(manifest);engine.save_json(root/'progressive.json',manifest)
        response=self.helper.post(f'/api/upscale/jobs/{jid}/redraw',{'level':1,'tiles':[0]})
        self.assertEqual(response.status_code,200,response.text)
        updated=json.loads((root/'progressive.json').read_text(encoding='utf-8'))
        later=updated['stages'][1]
        self.assertEqual(later['local_tile_count'],later['tile_count'])
        self.assertEqual(later['budget']['images'],0,later)
        self.assertEqual(later['budget']['reviews'],0,later)


if __name__=='__main__':unittest.main()
