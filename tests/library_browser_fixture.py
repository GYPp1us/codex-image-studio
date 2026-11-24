"""Run the real workbench on loopback with disposable gallery data for browser QA."""
import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image
import uvicorn


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18788)
    parser.add_argument("--rc2", action="store_true")
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    with tempfile.TemporaryDirectory(prefix="studio-library-qa-") as temp:
        os.environ["STUDIO_DATA"] = temp
        os.environ["CODEX_BIN"] = "image-studio-qa-unavailable"
        import app as studio
        if args.rc2:
            async def probe(provider):
                if provider.api_key != "fixture-provider-key":
                    return {"status": "failed", "message": "供应商拒绝访问，请检查 API 密钥或权限"}
                return {"status": "ok", "message": "连接成功，模型已在目录中找到", "elapsed_ms": 162}
            studio.image_provider.probe = probe
        studio.initialize()
        studio.set_setting("paused",True)
        image = Path(temp)/"assets"/"fixture.png"
        Image.new("RGB",(112,140),(66,105,121)).save(image)
        with studio.db() as c:
            c.execute("INSERT INTO users VALUES (1,'qa','unused',0)")
            c.execute("INSERT INTO sessions VALUES (?,?,0,?)",(hashlib.sha256(b'fixture-local-session').hexdigest(),'fixture-csrf',studio.now()+86400))
            for t in ("A","B"):
                c.execute("INSERT INTO templates(id,title,text,created,updated) VALUES (?,?,?,1000,1000)",(t,t,"配方 "+t))
            c.executemany("INSERT INTO folders(id,name,created) VALUES (?,?,?)",((f"g{i}",f"目录 {i}",i) for i in range(197)))
            c.execute("""INSERT INTO jobs(id,batch_id,status,collection_id,template_id,prompt,refs,options,created)
                VALUES ('source','batch','succeeded','tpl-A','A','月色','[]',?,0)""",(json.dumps({"stitch":0,"ratio":"1:1","template_title":"A"}),))
            for i in range(5000):
                folder='tpl-A' if i<150 else 'g'+str(i%197)
                c.execute("""INSERT INTO assets(id,kind,path,name,width,height,bytes,created,job_id,folder_id,origin_template_id)
                    VALUES (?,'generated',?,?,112,140,?,?,?, ?,?)""",
                    (f"{i+1:032x}",str(image),f"a{i+1}",image.stat().st_size,5000-i,'source' if i<150 else None,folder,'A' if i<150 else ''))
        uvicorn.run(studio.app,host="127.0.0.1",port=args.port,log_level="error")


if __name__=="__main__":
    main()
