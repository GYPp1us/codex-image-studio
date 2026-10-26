"""Application contract tests; fake CLI outputs are never production proof."""
import importlib
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


class StudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        os.environ["STUDIO_DATA"] = cls.temp.name
        os.environ["STUDIO_SETUP_TOKEN"] = "test-setup-secret"
        os.environ.pop("STUDIO_SETUP_TOKEN_FILE", None)
        import app
        cls.appmod = importlib.reload(app)
        fake = Path(cls.temp.name) / "fake-codex"
        fake.write_text(f"#!{sys.executable}\n" + '''
import sys, time, json, os, re
from pathlib import Path
from PIL import Image
if '--version' in sys.argv:
    print('codex-cli test-fake')
elif 'login' in sys.argv:
    print('Logged in using ChatGPT (test double)')
elif 'exec' in sys.argv:
    directory = Path(sys.argv[sys.argv.index('-C')+1])
    prompt = sys.stdin.read()
    print(json.dumps({'type':'thread.started','thread_id':'test-'+directory.name}), flush=True)
    if 'STUDIO_STITCH_REVIEW' in prompt:
        print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':json.dumps({'pass':True,'issues':[]})}}),flush=True)
        sys.exit(0)
    if 'STUDIO_TILE_REFINEMENT' in prompt:
        slow_marker=directory.parent.parent/'.test-slow-once'
        slow='TEST_SLOW' in prompt and not slow_marker.exists()
        if slow:slow_marker.touch()
        time.sleep(30 if slow else 0.2)
        reference=Path(sys.argv[sys.argv.index('-i')+1])
        size=re.search(r'([0-9]+)x([0-9]+) pixels',prompt)
        with Image.open(reference) as image:image.resize((int(size[1]),int(size[2])),Image.Resampling.BICUBIC).save(directory/'output.png')
        print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'Synthetic test-only refinement fixture'}}),flush=True)
        sys.exit(0)
    if 'TEST_PERMANENT_FAILURE' in prompt:
        print(json.dumps({'type':'error','message':'image generation tool unavailable'}), flush=True)
        sys.exit(1)
    if 'TEST_TRANSIENT_FAILURE' in prompt and not (directory/'retried').exists():
        (directory/'retried').touch()
        print(json.dumps({'type':'error','message':'temporary upstream connection reset'}), flush=True)
        sys.exit(1)
    time.sleep(30 if 'TEST_SLOW' in prompt else 0.5)
    Image.new('RGB',(96,96),(len(prompt)%255,20,30)).save(directory/'output.png')
    print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'Test image contract completed'}}),flush=True)
''', encoding="utf-8")
        fake.chmod(0o700)
        cls.appmod.CODEX_BIN = str(fake)
        cls.client = TestClient(cls.appmod.app, base_url="https://image.example.com")
        cls.client.__enter__()
        r = cls.client.post("/api/auth/setup", json={"username":"admin","password":"test-password-long","setup_token":"test-setup-secret"})
        assert r.status_code == 200, r.text
        assert "HttpOnly" in r.headers["set-cookie"] and "Secure" in r.headers["set-cookie"]
        cls.headers = {"X-CSRF-Token": r.json()["csrf"], "Origin":"https://image.example.com"}

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.temp.cleanup()

    def post(self, path, body=None):
        return self.client.post(path, json=body or {}, headers=self.headers)

    def wait_job(self, jid, statuses=("succeeded","failed","cancelled"), timeout=12):
        deadline = time.time() + timeout
        while time.time() < deadline:
            job = self.client.get("/api/jobs/"+jid).json()
            if job["status"] in statuses:
                return job
            time.sleep(.1)
        self.fail("Job did not reach expected state: "+str(job))

    def test_01_auth_boundaries(self):
        anonymous = TestClient(self.appmod.app, base_url="https://image.example.com")
        self.assertEqual(anonymous.get("/api/state").status_code,401)
        self.assertEqual(anonymous.get("/media/unknown").status_code,401)
        anonymous.close()
        self.assertEqual(self.client.post("/api/jobs",json={"prompt":"x"}).status_code,403)
        self.assertEqual(self.client.post("/api/settings",json={},headers={**self.headers,"Origin":"https://evil.test"}).status_code,403)
        self.assertEqual(self.post("/api/auth/setup",{"username":"x2","password":"test-password-long","setup_token":"test-setup-secret"}).status_code,409)

    def test_02_asset_validation_cache_and_privacy(self):
        data = io.BytesIO()
        Image.new("RGB",(32,48),"red").save(data,"PNG")
        first=self.client.post("/api/assets",files={"file":("sample.png",data.getvalue(),"image/png")},headers=self.headers)
        self.assertEqual(first.status_code,200,first.text)
        second=self.client.post("/api/assets",files={"file":("different-name.png",data.getvalue(),"image/png")},headers=self.headers)
        self.assertTrue(second.json()["cached"])
        self.assertEqual(first.json()["asset"]["id"],second.json()["asset"]["id"])
        self.assertNotIn("path",first.json()["asset"])
        self.assertEqual(self.client.post("/api/assets",files={"file":("bad.png",b"not an image","image/png")},headers=self.headers).status_code,400)
        self.assertEqual(self.client.get(first.json()["asset"]["url"]).headers["content-type"],"image/png")

    def test_03_queue_reference_snapshot_and_prompt_cache(self):
        refs=self.client.get("/api/assets").json()["items"]
        r=self.post("/api/jobs",{"prompt":"A test image contract","refs":[refs[0]["id"]],"count":2,"ratio":"3:2"})
        self.assertEqual(r.status_code,200,r.text)
        jobs=[self.wait_job(j) for j in r.json()["ids"]]
        self.assertTrue(all(j["status"]=="succeeded" for j in jobs))
        self.assertNotEqual(jobs[0]["thread_id"],jobs[1]["thread_id"])
        self.assertEqual(jobs[0]["refs"],[refs[0]["id"]])
        self.assertEqual(len(jobs[0]["outputs"]),1)
        self.assertEqual(self.client.delete("/api/assets/"+refs[0]["id"],headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/media/'+refs[0]['id']).status_code,200)
        self.assertEqual(self.post('/api/assets/'+refs[0]['id']+'/restore').status_code,200)
        prompts=self.client.get("/api/prompts").json()
        self.assertEqual(sum(p["text"]=="A test image contract" for p in prompts),0)
        self.assertEqual(self.post("/api/jobs",{"prompt":"x","refs":["missing"]}).status_code,400)

    def test_04_permanent_failure_does_not_repeat(self):
        jid=self.post("/api/jobs",{"prompt":"TEST_PERMANENT_FAILURE","max_attempts":3}).json()["ids"][0]
        job=self.wait_job(jid)
        self.assertEqual(job["status"],"failed")
        self.assertEqual(job["attempt"],1)
        self.assertEqual(job["outputs"],[])
        self.assertIn("unavailable",job["error"])

    def test_05_retry_and_cancellation(self):
        jid=self.post("/api/jobs",{"prompt":"TEST_TRANSIENT_FAILURE","max_attempts":2}).json()["ids"][0]
        job=self.wait_job(jid,timeout=15)
        self.assertEqual(job["status"],"succeeded",job)
        self.assertEqual(job["attempt"],2)
        jid=self.post("/api/jobs",{"prompt":"TEST_SLOW","max_attempts":1}).json()["ids"][0]
        self.wait_job(jid,("running",))
        time.sleep(.3)
        self.assertEqual(self.post(f"/api/jobs/{jid}/cancel").status_code,200)
        self.assertEqual(self.wait_job(jid)["status"],"cancelled")
        time.sleep(.3)
        self.assertNotIn(jid,self.appmod.PROCESSES)

    def test_06_pause_and_concurrency(self):
        def config(paused):
            return self.client.patch("/api/settings",json={"paused":paused,"concurrency":1,"max_attempts":1},headers=self.headers)
        self.assertEqual(config(True).status_code,200)
        ids=self.post("/api/jobs",{"prompt":"TEST_SLOW concurrency","count":2}).json()["ids"]
        time.sleep(1.2)
        self.assertTrue(all(self.client.get("/api/jobs/"+j).json()["status"]=="queued" for j in ids))
        config(False)
        time.sleep(1.5)
        states=[self.client.get("/api/jobs/"+j).json()["status"] for j in ids]
        self.assertEqual(states.count("running"),1)
        self.assertEqual(states.count("queued"),1)
        for jid in ids:
            self.post(f"/api/jobs/{jid}/cancel")

    def test_07_path_traversal_and_settings_limits(self):
        self.assertEqual(self.client.get("/api/jobs/not-a-uuid/log").status_code,404)
        self.assertEqual(self.client.patch("/api/settings",json={"concurrency":50},headers=self.headers).status_code,422)
        r=self.client.get("/")
        self.assertEqual(r.status_code,200)
        self.assertIn("frame-ancestors 'none'",r.headers["content-security-policy"])

    def test_08_browser_callback_is_pinned_and_checks_state(self):
        previous = dict(self.appmod.LOGIN)
        self.appmod.LOGIN.update(running=True, mode="browser", url="https://auth.openai.com/oauth/authorize?state=expected")
        try:
            for url in ("http://evil.test:1455/auth/callback?code=x&state=expected", "http://localhost:1455/auth/callback?code=x&state=wrong", "http://localhost:8788/auth/callback?code=x&state=expected", "http://localhost:1455/auth/callback?state=expected"):
                self.assertEqual(self.post("/api/setup/callback", {"url":url}).status_code, 400)
        finally:
            self.appmod.LOGIN.clear()
            self.appmod.LOGIN.update(previous)

    def test_09_model_effort_are_validated_and_snapshotted(self):
        previous = self.appmod.model_catalog()
        self.appmod.set_setting("model_catalog", previous + [{"id":"gpt-6-luna","name":"Luna","efforts":["low","high"],"default_effort":"low"}])
        try:
            settings = {"paused":True,"concurrency":1,"max_attempts":1,"model":"gpt-6-luna","effort":"high"}
            self.assertEqual(self.client.patch("/api/settings",json=settings,headers=self.headers).status_code,200)
            jid=self.post("/api/jobs",{"prompt":"Model snapshot test"}).json()["ids"][0]
            settings.update(model="gpt-6.1-sol",effort="low")
            self.assertEqual(self.client.patch("/api/settings",json=settings,headers=self.headers).status_code,200)
            job=self.client.get("/api/jobs/"+jid).json()
            self.assertEqual((job["model"],job["effort"]),("gpt-6-luna","high"))
            self.assertEqual(self.post("/api/jobs",{"prompt":"Invalid effort","model":"gpt-6-luna","effort":"ultra"}).status_code,400)
            self.post("/api/jobs/"+jid+"/cancel")
        finally:
            self.appmod.set_setting("model_catalog",previous)
            self.client.patch("/api/settings",json={"paused":False,"concurrency":2,"max_attempts":3,"model":"gpt-6.1-sol","effort":"xhigh"},headers=self.headers)

    def test_10_generated_images_are_collected_by_exact_thread(self):
        self.client.patch("/api/settings",json={"paused":True},headers=self.headers)
        jid=self.post("/api/jobs",{"prompt":"Thread-specific collection test"}).json()["ids"][0]
        self.appmod.write("UPDATE jobs SET thread_id=? WHERE id=?",("thread-right-1234567890",jid))
        base=self.appmod.CODEX_HOME/"generated_images"
        wrong=base/"thread-wrong-1234567890"
        right=base/"thread-right-1234567890"
        wrong.mkdir(parents=True)
        right.mkdir(parents=True)
        Image.new("RGB",(10,10),"red").save(wrong/"wrong.png")
        directory=self.appmod.DATA/"jobs"/jid
        self.assertIsNone(self.appmod.find_generated_image(jid,directory))
        Image.new("RGB",(10,10),"blue").save(right/"correct.png")
        self.assertEqual(self.appmod.find_generated_image(jid,directory),right/"correct.png")
        self.post("/api/jobs/"+jid+"/cancel")
        self.client.patch("/api/settings",json={"paused":False},headers=self.headers)

    def test_11_presets_save_references_and_protect_their_files(self):
        image = io.BytesIO()
        Image.new("RGB", (23, 31), "purple").save(image, "PNG")
        asset = self.client.post("/api/assets",files={"file":("preset-reference.png",image.getvalue(),"image/png")},headers=self.headers).json()["asset"]
        saved = self.post("/api/prompts", {"text":"A saved prompt with references", "refs":[asset["id"]], "options":{"ratio":"16:9","transparent":True,"model":"gpt-6.1-sol","effort":"xhigh"}})
        self.assertEqual(saved.status_code,200,saved.text)
        preset = saved.json()
        self.assertEqual(preset["refs"], [asset["id"]])
        self.assertEqual(preset["references"][0]["id"], asset["id"])
        listed = next(p for p in self.client.get("/api/prompts").json() if p["id"]==preset["id"])
        self.assertEqual(listed["options"]["ratio"],"16:9")
        self.assertEqual(self.client.delete("/api/assets/"+asset["id"],headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/media/'+asset['id']).status_code,200)
        self.assertEqual(self.post('/api/assets/'+asset['id']+'/restore').status_code,200)

    def test_12_collections_use_template_identity_and_keep_custom_names(self):
        self.client.patch("/api/settings",json={"paused":True},headers=self.headers)
        ids=[]
        try:
            template=self.post("/api/templates",{"text":"A reusable base","title":"我的模板"}).json()
            for prompt in ("A reusable base with a red object","A reusable base with a blue object"):
                ids.extend(self.post("/api/jobs",{"prompt":prompt,"template_id":template['id']}).json()["ids"])
            jobs=[self.client.get("/api/jobs/"+jid).json() for jid in ids]
            self.assertEqual(jobs[0]["collection_id"],jobs[1]["collection_id"])
            digest='tpl-'+template['id']
            self.assertEqual(jobs[0]["collection_id"],digest)
            self.assertEqual(self.client.patch("/api/collections/"+digest,json={"name":"我的图集"},headers=self.headers).status_code,200)
            ids.extend(self.post("/api/jobs",{"prompt":"Yet another creative suffix","template_id":template['id']}).json()["ids"])
            group=next(g for g in self.client.get("/api/collections").json()["items"] if g["id"]==digest)
            self.assertEqual((group["name"],group["job_count"]),("我的图集",3))
            self.assertEqual(self.client.get("/api/jobs?collection="+digest).json()["total"],3)
        finally:
            for jid in ids:self.post("/api/jobs/"+jid+"/cancel")
            self.client.patch("/api/settings",json={"paused":False},headers=self.headers)

    def test_13_call_prompt_is_validated_snapshotted_and_not_recursively_expanded(self):
        self.client.patch("/api/settings",json={"paused":True},headers=self.headers)
        jid=None
        try:
            template="Generate a real image. Ratio: {ratio}. References: {references}. Prompt: {prompt}"
            self.assertEqual(self.client.patch("/api/settings",json={"paused":True,"call_prompt":template},headers=self.headers).status_code,200)
            jid=self.post("/api/jobs",{"prompt":"Literal {ratio} inside creative text"}).json()["ids"][0]
            self.client.patch("/api/settings",json={"paused":True,"call_prompt":"Another worker request with {prompt}"},headers=self.headers)
            job=self.client.get("/api/jobs/"+jid).json()
            self.assertEqual(job["options"]["call_prompt"],template)
            raw=self.appmod.query("SELECT * FROM jobs WHERE id=?",(jid,),True)
            rendered=self.appmod.make_instruction(raw,self.appmod.DATA/"jobs"/jid)
            self.assertIn("Ratio: 1:1",rendered)
            self.assertIn("Literal {ratio} inside creative text",rendered)
            self.assertEqual(self.client.patch("/api/settings",json={"call_prompt":"A template without the required variable"},headers=self.headers).status_code,400)
        finally:
            if jid:self.post("/api/jobs/"+jid+"/cancel")
            self.client.patch("/api/settings",json={"paused":False,"call_prompt":self.appmod.DEFAULT_CALL_PROMPT},headers=self.headers)

    def test_14_migration_preserves_independent_batches(self):
        self.client.patch("/api/settings",json={"paused":True},headers=self.headers)
        jid=self.post("/api/jobs",{"prompt":"Legacy grouping migration"}).json()["ids"][0]
        job=self.client.get("/api/jobs/"+jid).json()
        digest='request-'+job['batch_id']
        self.appmod.write("UPDATE jobs SET collection_id='' WHERE id=?",(jid,))
        self.appmod.write("DELETE FROM collections WHERE id=?",(digest,))
        self.appmod.initialize()
        self.assertEqual(self.client.get("/api/jobs/"+jid).json()["collection_id"],digest)
        self.post("/api/jobs/"+jid+"/cancel")
        self.client.patch("/api/settings",json={"paused":False},headers=self.headers)

    def test_15_account_and_other_session_controls(self):
        account=self.client.get("/api/account").json()
        self.assertEqual(account["username"],"admin")
        self.assertEqual(self.client.patch("/api/account",json={"username":"changed","current_password":"wrong-password"},headers=self.headers).status_code,400)
        other=TestClient(self.appmod.app,base_url="https://image.example.com")
        self.assertEqual(other.post("/api/auth/login",json={"username":"admin","password":"test-password-long"}).status_code,200)
        self.assertEqual(self.post("/api/account/revoke-sessions").status_code,200)
        self.assertEqual(other.get("/api/state").status_code,401)
        self.assertEqual(self.client.get("/api/state").status_code,200)
        other.close()

    def test_16_detached_templates_are_independent_and_edits_keep_identity(self):
        self.client.patch("/api/settings",json={"paused":True},headers=self.headers)
        ids=[]
        try:
            first=self.post("/api/templates",{"text":"A shared base","title":"Base A"}).json()
            second=self.post("/api/templates",{"text":"A shared base","title":"Base B"}).json()
            self.assertNotEqual(first['id'],second['id'])
            one=self.post("/api/jobs",{"prompt":"Identical final text","template_id":first['id']}).json()
            two=self.post("/api/jobs",{"prompt":"Identical final text","template_id":second['id']}).json()
            detached=self.post("/api/jobs",{"prompt":"Identical final text","template_id":None,"count":2}).json()
            independent=self.post("/api/jobs",{"prompt":"Identical final text"}).json()
            ids=one['ids']+two['ids']+detached['ids']+independent['ids']
            self.assertEqual(len({one['collection_id'],two['collection_id'],detached['collection_id'],independent['collection_id']}),4)
            self.assertEqual(self.client.get('/api/jobs?collection='+detached['collection_id']).json()['total'],2)
            changed=self.client.put('/api/templates/'+first['id'],json={"text":"Shorter base","title":"Edited base","refs":[]},headers=self.headers)
            self.assertEqual(changed.status_code,200,changed.text)
            self.assertEqual(changed.json()['id'],first['id'])
            self.assertEqual(self.client.get('/api/jobs/'+one['ids'][0]).json()['prompt'],'Identical final text')
            self.assertEqual(self.post('/api/jobs',{"prompt":"x","template_id":"does-not-exist"}).status_code,400)
        finally:
            for jid in ids:self.post('/api/jobs/'+jid+'/cancel')
            self.client.patch("/api/settings",json={"paused":False},headers=self.headers)

    def test_17_reference_only_templates_and_subset_edits(self):
        assets=self.client.get('/api/assets').json()['items']
        saved=self.post('/api/templates',{"title":"Reference only","text":"","refs":[a['id'] for a in assets[:2]]})
        self.assertEqual(saved.status_code,200,saved.text)
        template=saved.json()
        changed=self.client.put('/api/templates/'+template['id'],json={"title":"Partial template","text":"Only the reusable part","refs":template['refs'][:1]},headers=self.headers)
        self.assertEqual(changed.status_code,200,changed.text)
        self.assertEqual(len(changed.json()['refs']),1)
        for aid in template['refs']:
            self.assertEqual(self.client.get('/media/'+aid).status_code,200)


    def test_18_polish_size_and_template_snapshots(self):
        self.client.patch('/api/settings',json={'paused':True},headers=self.headers)
        ids=[]
        try:
            original="Keep the user's brief verbatim: {prompt}. Ratio {ratio}."
            enhanced='Act as an art director and design composition, light and style. Brief: {prompt}. Size: {size}.'
            r=self.client.patch('/api/settings',json={'paused':True,'call_prompt':original,'polish_prompt':enhanced},headers=self.headers)
            self.assertEqual(r.status_code,200,r.text)
            saved=self.post('/api/templates',{'text':'A moonlit scene','options':{'polish':True,'size':'2048'}}).json()
            self.assertEqual(saved['options'],{'polish':True,'size':'2048'})
            for polish in (False,True):
                result=self.post('/api/jobs',{'prompt':'Keep literal {size} and {ratio}','polish':polish,'size':'2048'})
                self.assertEqual(result.status_code,200,result.text)
                jid=result.json()['ids'][0];ids.append(jid)
                job=self.client.get('/api/jobs/'+jid).json()
                self.assertEqual(job['options']['call_prompt'],enhanced if polish else original)
                self.assertEqual(job['options']['polish'],polish)
                raw=self.appmod.query('SELECT * FROM jobs WHERE id=?',(jid,),True)
                instruction=self.appmod.make_instruction(raw,self.appmod.DATA/'jobs'/jid)
                self.assertIn('2048 pixels on the long edge',instruction)
                self.assertIn('Keep literal {size} and {ratio}',instruction)
            self.client.patch('/api/settings',json={'paused':True,'polish_prompt':'A changed art director instruction: {prompt}'},headers=self.headers)
            self.assertEqual(self.client.get('/api/jobs/'+ids[1]).json()['options']['call_prompt'],enhanced)
            self.assertEqual(self.post('/api/jobs',{'prompt':'x','size':'99999'}).status_code,422)
            self.assertIn('GPT-Image-2.5 Sunburst',instruction)
            self.assertIn('requested reasoning effort max',instruction)
            self.assertIn('gpt-image-2.5-sunburst',job['options']['image_requirements'])
            self.assertEqual(self.client.patch('/api/settings',json={'polish_prompt':'No creative variable included here'},headers=self.headers).status_code,400)
        finally:
            for jid in ids:self.post('/api/jobs/'+jid+'/cancel')
            self.client.patch('/api/settings',json={'paused':False,'call_prompt':self.appmod.DEFAULT_CALL_PROMPT,'polish_prompt':self.appmod.DEFAULT_POLISH_PROMPT},headers=self.headers)

    def test_19_deleted_images_and_collections_are_recoverable(self):
        job=next(j for j in self.client.get('/api/jobs').json()['items'] if j['outputs'])
        asset=job['outputs'][0];cid=job['collection_id']
        job_count=self.client.get('/api/jobs?collection='+cid).json()['total']
        self.assertEqual(self.client.delete('/api/assets/'+asset['id'],headers=self.headers).status_code,200)
        self.assertNotIn(asset['id'],[a['id'] for a in self.client.get('/api/assets?kind=all').json()['items']])
        self.assertIn(asset['id'],[a['id'] for a in self.client.get('/api/assets?kind=all&deleted=true').json()['items']])
        self.assertEqual(self.client.get(asset['url']).status_code,200)
        self.assertEqual(self.post('/api/assets/'+asset['id']+'/restore').status_code,200)
        self.assertIn(asset['id'],[a['id'] for a in self.client.get('/api/jobs/'+job['id']).json()['outputs']])
        self.assertEqual(self.client.delete('/api/collections/'+cid,headers=self.headers).status_code,200)
        self.assertNotIn(cid,[g['id'] for g in self.client.get('/api/collections').json()['items']])
        self.assertIn(cid,[g['id'] for g in self.client.get('/api/collections?deleted=true').json()['items']])
        self.assertEqual(self.client.get('/api/jobs?collection='+cid).json()['total'],job_count)
        self.assertEqual(self.post('/api/collections/'+cid+'/restore').status_code,200)
        self.assertIn(cid,[g['id'] for g in self.client.get('/api/collections').json()['items']])

    def test_20_installable_app_files_and_private_cache_boundaries(self):
        anonymous=TestClient(self.appmod.app,base_url='https://image.example.com')
        manifest=anonymous.get('/static/manifest.webmanifest')
        self.assertEqual(manifest.status_code,200)
        self.assertEqual(manifest.json()['display'],'standalone')
        self.assertEqual(manifest.json()['orientation'],'portrait-primary')
        for icon in manifest.json()['icons']:
            self.assertEqual(anonymous.get(icon['src']).status_code,200)
        worker=anonymous.get('/sw.js')
        self.assertEqual(worker.headers['service-worker-allowed'],'/')
        self.assertEqual(worker.headers['cache-control'],'no-cache')
        self.assertNotIn('/api/',worker.text)
        self.assertNotIn('/media/',worker.text)
        self.assertEqual(anonymous.get('/api/assets?deleted=true').status_code,401)
        self.assertEqual(anonymous.post('/api/assets/unknown/restore').status_code,401)
        anonymous.close()


    def test_21_progress_uses_cli_events_and_explicit_worker_reports(self):
        stage=self.appmod.stage_from_event
        self.assertEqual(stage({'type':'thread.started'}),('thinking','cli'))
        self.assertEqual(stage({'type':'item.completed','item':{'type':'agent_message','text':'[STUDIO_STAGE:image_generation]'}}),('generating','worker'))
        self.assertEqual(stage({'type':'item.completed','item':{'type':'agent_message','text':'[STUDIO_STAGE:receiving]'}}),('receiving','worker'))
        self.assertEqual(stage({'type':'turn.completed'}),('receiving','cli'))
        self.assertIsNone(stage({'type':'item.completed','item':{'type':'agent_message','text':'I might generate something later'}}))
        self.assertIsNone(stage({'type':'item.started','item':{'type':'mcp_tool_call','tool':'unrelated_tool'}}))
        self.assertEqual(stage({'type':'item.started','item':{'type':'image_generation'}}),('generating','cli'))
        self.assertEqual(stage({'type':'item.completed','item':{'type':'image_generation'}}),('receiving','cli'))
        p=self.appmod.job_progress({'status':'running','stage':'generating','stage_source':'worker','stage_updated':100})
        self.assertEqual((p['label'],p['step'],p['indeterminate']),('等待生图返回',3,True))
        self.assertNotIn('percent',p)
        self.assertEqual(self.appmod.job_progress({'status':'succeeded'})['indeterminate'],False)
        self.client.patch('/api/settings',json={'paused':True},headers=self.headers)
        jid=self.post('/api/jobs',{'prompt':'Progress regression'}).json()['ids'][0]
        try:
            self.appmod.write("UPDATE jobs SET status='running',stage='sending' WHERE id=?",(jid,))
            self.appmod.set_job_stage(jid,'generating','worker')
            self.appmod.set_job_stage(jid,'thinking','cli')
            self.assertEqual(self.client.get('/api/jobs/'+jid).json()['progress']['stage'],'generating')
            self.post('/api/jobs/'+jid+'/cancel')
            self.appmod.set_job_stage(jid,'receiving')
            self.assertEqual(self.client.get('/api/jobs/'+jid).json()['progress']['stage'],'cancelled')
        finally:
            self.post('/api/jobs/'+jid+'/cancel')
            self.client.patch('/api/settings',json={'paused':False},headers=self.headers)


    def test_22_stitch_pipeline_and_asset_send_to_upscale(self):
        import cv2
        from test_stitch_engine import texture
        fixture=io.BytesIO();Image.fromarray(cv2.cvtColor(texture(320,256),cv2.COLOR_BGR2RGB)).save(fixture,'PNG')
        asset=self.client.post('/api/assets',files={'file':('stitch-fixture.png',fixture.getvalue(),'image/png')},headers=self.headers).json()['asset']
        self.assertEqual(self.post('/api/assets/'+asset['id']+'/upscale',{'factor':5}).status_code,422)
        request=self.post('/api/assets/'+asset['id']+'/upscale',{'factor':4})
        self.assertEqual(request.status_code,200,request.text)
        jid=request.json()['ids'][0]
        job=self.wait_job(jid,timeout=75)
        self.assertEqual(job['status'],'succeeded',job['error'])
        self.assertEqual((job['outputs'][0]['width'],job['outputs'][0]['height']),(640,512))
        self.assertEqual(job['progress']['percent'],100)
        self.assertEqual(job['options']['source_asset_id'],asset['id'])
        report=self.client.get('/api/jobs/'+jid+'/stitch/report').json()
        self.assertEqual(report['uncovered_pixels'],0)
        self.assertEqual(report['bands'],7)
        self.assertTrue(report['visual_review']['pass'])
        self.assertEqual(self.client.get('/api/jobs/'+jid+'/stitch/inspection').status_code,200)
        self.assertEqual(self.client.get('/api/jobs/'+jid+'/stitch/not-allowed').status_code,404)
        anonymous=TestClient(self.appmod.app,base_url='https://image.example.com')
        self.assertEqual(anonymous.get('/api/jobs/'+jid+'/stitch/preview').status_code,401)
        anonymous.close()
        saved=self.post('/api/templates',{'text':'stitch preset','options':{'stitch':16}}).json()
        self.assertEqual(saved['options']['stitch'],16)

    def test_23_stitch_cancellation_preserves_checkpoints(self):
        import cv2
        from test_stitch_engine import texture
        fixture=io.BytesIO();Image.fromarray(cv2.cvtColor(texture(320,256),cv2.COLOR_BGR2RGB)).save(fixture,'PNG')
        asset=self.client.post('/api/assets',files={'file':('TEST_SLOW-stitch.png',fixture.getvalue(),'image/png')},headers=self.headers).json()['asset']
        # Duplicate normalized pixels reuse the prior asset, so put the trigger in this job's brief.
        r=self.post('/api/jobs',{'prompt':'TEST_SLOW checkpoint cancellation','refs':[asset['id']],'source_asset_id':asset['id'],'stitch':4})
        self.assertEqual(r.status_code,200,r.text);jid=r.json()['ids'][0]
        deadline=time.time()+15
        while time.time()<deadline:
            job=self.client.get('/api/jobs/'+jid).json()
            if job['progress']['stage']=='redraw':break
            time.sleep(.2)
        self.assertEqual(self.post('/api/jobs/'+jid+'/cancel').status_code,200)
        cancelled=self.wait_job(jid)
        self.assertEqual(cancelled['status'],'cancelled')
        self.assertFalse(cancelled['progress']['indeterminate'])
        time.sleep(.5)
        self.assertNotIn(jid,self.appmod.PROCESSES)
        self.assertTrue((self.appmod.DATA/'jobs'/jid/'stitch'/'base.png').exists())
        base=self.appmod.DATA/'jobs'/jid/'stitch'/'base.png';stamp=base.stat().st_mtime_ns
        self.assertEqual(self.post('/api/jobs/'+jid+'/retry').status_code,200)
        resumed=self.wait_job(jid,timeout=75)
        self.assertEqual(resumed['status'],'succeeded',resumed['error'])
        self.assertEqual(base.stat().st_mtime_ns,stamp)


if __name__=="__main__":
    unittest.main()
