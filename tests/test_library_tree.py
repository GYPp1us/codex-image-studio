"""Directory migration and writes through the same authenticated routes as the browser."""
import hashlib
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
import app as studio


class LibraryTreeTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(studio, "DATA", root))
        self.enterContext(patch.object(studio, "CODEX_HOME", root / "codex"))
        self.enterContext(patch.object(studio, "STORAGE", studio.Storage(root, lambda: 0)))
        studio.initialize()
        self.client = TestClient(studio.app)
        self.addCleanup(self.client.close)
        session = uuid4().hex
        self.client.cookies.set("studio_session", session)
        self.client.headers["X-CSRF-Token"] = "fixture"
        studio.write("INSERT INTO sessions VALUES (?,?,?,?)", (hashlib.sha256(session.encode()).hexdigest(),"fixture",0,studio.now()+3600))

    def op(self, action, status=200, **args):
        args.setdefault("operation_id", uuid4().hex)
        r = self.client.post("/api/library/operations", json={"action":action, **args})
        self.assertEqual(r.status_code, status, r.text)
        return r.json()

    def browse(self, **params):
        r = self.client.get("/api/library", params=params)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def artwork(self, folder, count, origin="A"):
        ids = [uuid4().hex for _ in range(count)]
        with studio.db() as c:
            c.executemany("""INSERT INTO assets(id,kind,name,width,height,bytes,created,folder_id,origin_template_id)
                VALUES (?,'generated','试片',32,32,200,?,?,?)""", ((aid,i,folder,origin) for i,aid in enumerate(ids)))
        return ids

    def test_atomic_selection_receipts_nested_templates_and_provenance(self):
        a = self.op("create", name="A")["folder"]
        template = self.op("recipe", folder=a, text="月色")["template_id"]
        b = self.op("create", name="B")["folder"]
        self.op("recipe", folder=b, text="白昼")
        ids = self.artwork(a, 32, template)
        oid = uuid4().hex
        body = dict(name="抽卡", target=a, assets=ids[:30], expected={aid:a for aid in ids[:30]}, operation_id=oid)
        with ThreadPoolExecutor(max_workers=2) as pool:
            result, replay = list(pool.map(lambda _: self.op("create", **body), range(2)))
        self.assertEqual(result, replay)
        group = result["folder"]
        self.assertEqual(self.client.get("/api/library/operations/"+oid).json(), result)
        self.op("create", status=409, **(body | {"name":"冲突"}))
        self.assertEqual(self.browse(folder=a)["asset_total"], 2)
        self.assertEqual([f["id"] for f in self.browse(folder=a)["folders"]], [group])
        self.assertEqual(self.browse(folder=group)["asset_total"], 30)
        self.op("relocate", folder=group, target=b, status=409)
        self.op("move", assets=ids[:1], target=b, status=409)
        self.op("relocate", folder=a,target=group,status=409)
        child=self.op("recipe", folder=group, refs=[ids[0]], options={"ratio":"3:2"})["template_id"]
        self.assertEqual(self.client.get("/api/templates/"+child).json()["folder_id"], group)
        self.assertEqual([f["id"] for f in self.browse(folder=group)["path"]], [a,group])
        self.op("detach", folder=group, target=None)
        self.assertIsNone(self.browse(folder=group)["path"][-1]["parent_id"])
        self.assertEqual(self.browse(view="origin",origin=template)["asset_total"],32)
        studio.initialize()
        self.assertEqual(self.browse(folder=group)["asset_total"],30)
        self.op("undo", original=oid, status=409)
        self.op("unrecipe",folder=group)
        self.op("dissolve",folder=group)
        self.assertEqual(self.browse(view="inbox")["asset_total"],30)

    def test_undo_conflict_rollback_and_old_source_scope(self):
        first=self.op("create",name="一")["folder"]
        second=self.op("create",name="二")["folder"]
        ids=self.artwork(first,3)
        self.op("move",target=second,assets=[ids[0],"missing"],status=409)
        self.assertEqual(self.browse(folder=first)["asset_total"],3)
        moved=self.op("create",name="合组",assets=ids,target=first)
        self.op("undo",original=moved["operation_id"])
        self.assertEqual({a["id"] for a in self.browse(folder=first)["assets"]},set(ids))
        self.assertEqual(self.browse(folder=first)["folder_total"],0)
        self.op("move",assets=[ids[0]],expected={ids[0]:second},target=second,status=409)
        result=self.op("move",assets=ids,target=second)
        self.op("move",assets=[ids[0]],target=first)
        self.op("undo",original=result["operation_id"],status=409)
        self.op("dissolve",folder=second)
        self.op("move",target=second,assets=[ids[0]],status=404)

    def test_legacy_migration_keeps_custom_names_trash_orphans_and_restart(self):
        with studio.db() as c:
            c.execute("DELETE FROM settings WHERE key='library_migrated'")
            c.execute("DELETE FROM folders")
            c.execute("INSERT INTO collections VALUES ('legacy','自定义','','0','0',0)")
            c.execute("INSERT INTO collections VALUES ('trash','旧回收','','0','0',1)")
            c.execute("INSERT INTO collections VALUES ('untemplated','无模板','','0','0',0)")
            c.execute("""INSERT INTO jobs(id,prompt,options,outputs,collection_id,history_deleted,created)
                VALUES ('j','原文','{}','["asset"]','legacy',1,0)""")
            c.execute("""INSERT INTO assets(id,kind,name,width,height,created) VALUES
                ('asset','reference','旧作品',1,1,0),('orphan','generated','历史已清理',1,1,0)""")
        studio.initialize()
        self.assertEqual(self.browse(folder="legacy")["assets"][0]["id"],"asset")
        self.assertEqual(self.browse(folder="legacy")["path"][0]["name"],"自定义")
        self.assertEqual(self.browse(view="inbox")["assets"][0]["id"],"orphan")
        self.assertEqual(self.client.get("/api/library?folder=trash").status_code,404)
        self.assertEqual(self.browse(folder="untemplated")["path"][0]["name"],"待整理")
        studio.initialize()
        self.assertEqual(self.browse(folder="legacy")["asset_total"],1)

    def test_generation_defaults_explicit_destination_and_lost_reply(self):
        folder=self.op("create",name="深层")["folder"]
        template=self.op("recipe",folder=folder,text="月光")["template_id"]
        dest=self.op("create",name="输出",target=folder)["folder"]
        body={"prompt":"月光","template_id":template,"folder_id":dest,"operation_id":uuid4().hex}
        with patch.object(studio,"command",new=AsyncMock(return_value=(0,"logged in"))):
            result=self.client.post("/api/jobs",json=body)
            self.assertEqual(result.status_code,200,result.text)
            replay=self.client.post("/api/jobs",json=body)
            self.assertEqual(replay.json(),result.json())
            self.assertEqual(self.client.get("/api/jobs/receipts/"+body["operation_id"]).json(),result.json())
            self.assertEqual(self.client.post("/api/jobs",json=body|{"prompt":"不同"}).status_code,409)
            default=self.client.post("/api/jobs",json={"prompt":"默认位置","template_id":template}).json()
        self.assertEqual(studio.query("SELECT COUNT(*) AS n FROM jobs",one=True)["n"],2)
        for job, location in [(result.json()["ids"][0],dest),(default["ids"][0],folder)]:
            studio.write("INSERT INTO assets(id,kind,width,height,job_id) VALUES (?,'generated',1,1,?)",(job,job))
            asset=self.browse(folder=location)["assets"][0]
            self.assertEqual((asset["folder_id"],asset["origin_template_id"]),(location,template))

    def test_paging_summaries_and_search_have_bounded_sql(self):
        with studio.db() as c:
            c.executemany("INSERT INTO folders(id,name,created) VALUES (?,?,?)",((f"f{i}",f"组{i}",i) for i in range(200)))
            c.executemany("""INSERT INTO assets(id,kind,name,width,height,created,folder_id) VALUES
                (?,'generated','图',1,1,?,?)""",((f"a{i}",i,"f"+str(i%200)) for i in range(5000)))
            calls=[]
            c.set_trace_callback(calls.append)
            from library_tree import children
            page,total=children(c,None,0,30)
            self.assertEqual((total,len(page),len(calls)),(201,30,4))
            self.assertTrue(all(f["image_count"]==25 and len(f["covers"])==3 for f in page))
        older=self.browse(part="folders",folder_offset=30)["folders"]
        self.assertFalse(set(f["id"] for f in page)&set(f["id"] for f in older))
        self.assertEqual(self.browse(view="all",part="assets",asset_offset=80,limit=30)["asset_total"],5000)
        self.assertTrue(self.browse(search="组199")["folders"][0]["path"])
