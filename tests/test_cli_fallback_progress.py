import json
import unittest
from pathlib import Path
from unittest.mock import patch

import generation_runtime
import stitch_workflow
import task_progress


class CliFallbackProgressTests(unittest.IsolatedAsyncioTestCase):
    async def test_ordinary_fallback_progress_never_creates_upscale_state(self):
        class Studio:
            def __init__(self): self.stages=[]; self.writes=[]
            def query(self,*args): return {'options':json.dumps({'generation':{'schema':1},'stitch':0})}
            def write(self,sql,args): self.writes.append((sql,args))
            def set_job_stage(self,jid,stage,source): self.stages.append((stage,source))
        studio=Studio()
        async def legacy(*args,**kwargs):
            notify=args[12]
            notify('主模型正在思考',True,'cli')
            notify('generating',True,'worker')
            notify('receiving',True,'worker')
            return Path('synthetic-output.png')
        async def generate(studio,jid,directory,scope,instruction,references,model,effort,expected,changed,fallback,metadata):
            changed('等待并发名额',False,'server')
            return await fallback()
        with patch.object(stitch_workflow,'legacy_cli_call',side_effect=legacy), patch.object(generation_runtime,'generate',side_effect=generate), patch.object(stitch_workflow,'progress') as upscale_progress:
            result=await stitch_workflow.cli_call(studio,'job',Path('.'),'call','synthetic',[],'model','high','base',0,1)
        self.assertEqual(result,Path('synthetic-output.png'))
        self.assertEqual([x[0] for x in studio.stages],['dispatching','generating','receiving'])
        self.assertEqual(len(studio.writes),1)
        self.assertIn("stage='call_wait'",studio.writes[0][0])
        self.assertNotIn('progress_detail',studio.writes[0][0])
        upscale_progress.assert_not_called()

    async def test_cancelled_direct_task_reports_terminal_stage(self):
        job={'id':'job','status':'cancelled','stage':'generating','options':json.dumps({'generation':{'image_backend':{'transport':'images'}}}),'progress_detail':'{}'}
        result=task_progress.project(job)
        self.assertEqual(result['stage'],'cancelled')
        self.assertEqual(result['call_stage'],'generating')
        self.assertFalse(result['indeterminate'])
