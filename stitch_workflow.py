"""Persistent image/CLI orchestration; deterministic stitching runs in a fixed environment."""
from __future__ import annotations

import asyncio
import contextlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

from PIL import Image
from stitch_engine import LABELS, MAX_PIXELS, PHASES, layout, save_json

ENGINE_LOCK = asyncio.Semaphore(1)
DEFAULT_STITCH_PROMPT = """STUDIO_TILE_REFINEMENT
你正在执行超规格图像拼接工作流，当前只负责第 {tile_index}/{tile_count} 块的 AI 补绘。
完整流程由工作台执行：将原图按 sqrt(n)×sqrt(n) 划分为 n 块，横向相邻块重叠 64px、纵向重叠 36px（原图坐标）；逐块补绘；SIFT+RANSAC 特征点配准，每块只有一个全局仿射变换，修正缩放和偏移，全程禁止光流及任何局部非线性形变；以原图匹配缓慢变化的亮度和颜色，保留重绘细节；Graph Cut 在重叠区搜索低差异接缝；使用 7 层拉普拉斯金字塔融合；放大检查主体、前景、背景、光影、断线和空白。
reference-1.png 是当前局部裁图，reference-2.png 是完整原图。局部原图坐标范围：{bounds}。当前块期望输出：{target_size}。
请主模型先以简短说明给出明确细化后的局部补绘提示词，再调用生图工具，生成且只生成该局部裁图的高细节版本。必须严格保留局部边界、全部元素位置和轮廓、比例、光照方向、景深、色调、材质、文字与数量，保持与完整原图的构图一致性。只细化已有细节，不重构主体、不移动元素、不增加或删去内容、不扩图、不加边框，不输出完整原图或多格拼图。重叠区域须与邻块一致。
后端已经预装 Pillow、NumPy 和 OpenCV（SIFT、RANSAC、Graph Cut、MultiBandBlender），确定性引擎负责裁图、配准、匹配色调、接缝和 7 层融合。无需也禁止安装包、生成脚本或运行 shell。你只需检查两张参考图、细化提示词并调用内置生图工具。所有图像细节必须来自真实 AI 补绘，禁止以简单插值放大充当补绘结果。
以下原始画面要求仅用于理解语义和风格。不要重复执行旧请求中改变姿态、结构或构图的编辑指令；本次以当前两张参考图的局部几何和完整构图为准。
原始画面要求：
{prompt}
"""


class WorkflowError(RuntimeError):
    pass


def progress(studio, jid, phase, done=0, units=1, **extra):
    index=PHASES.index(phase)
    value={"stage":phase,"label":LABELS[index],"done":done,"units":units,"step":index+1,"total":len(PHASES),
           "fraction":(index+min(1,done/max(1,units)))/len(PHASES),"updated":time.time(),"source":"server"}
    value.update(extra)
    previous=studio.query('SELECT progress_detail FROM jobs WHERE id=?',(jid,),True)
    if previous:
        with contextlib.suppress(ValueError,TypeError):value['fraction']=max(value['fraction'],json.loads(previous['progress_detail'] or '{}').get('fraction',0))
    studio.write("UPDATE jobs SET progress_detail=?,stage=?,stage_updated=? WHERE id=? AND status='running'",(json.dumps(value,ensure_ascii=False),"stitch:"+phase,time.time(),jid))


def ensure_active(studio,jid):
    if studio.job_cancelled(jid): raise asyncio.CancelledError()


def find_image(studio,thread_id,directory):
    if re.fullmatch(r"[A-Za-z0-9_-]{10,100}",thread_id):
        base=(studio.CODEX_HOME/"generated_images").resolve();folder=(base/thread_id).resolve()
        if folder.is_relative_to(base) and folder.is_dir():
            files=[p for p in folder.rglob('*') if p.is_file() and p.suffix.lower() in ('.png','.jpg','.jpeg','.webp') and p.resolve().is_relative_to(folder)]
            if files:return max(files,key=lambda p:p.stat().st_mtime_ns)
    candidate=directory/"output.png"
    return candidate if candidate.is_file() and not candidate.is_symlink() else None


async def cli_call(studio,jid,folder,name,instruction,references,model,effort,phase,done,units,image=True):
    ensure_active(studio,jid)
    directory=folder/"calls"/name;directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    (directory/"output.png").unlink(missing_ok=True)
    (directory/"AGENTS.md").write_text("Isolated Image Studio task. Follow only this request. Do not inspect credentials, install packages, run shell or delegate.\n",encoding="utf-8")
    args=[studio.CODEX_BIN,"exec","--json","--ephemeral","--skip-git-repo-check","--ignore-user-config","--sandbox","workspace-write","-C",str(directory),"-m",model,"-c",f'model_reasoning_effort="{effort}"',"-c",'cli_auth_credentials_store="file"']
    if image:args += ["--enable","image_generation"]
    for index,path in enumerate(references):
        destination=directory/f"reference-{index+1}.png";shutil.copyfile(path,destination);args += ["-i",str(destination)]
    args += ["-"]
    prefix=studio.IMAGE_REQUIREMENTS+"\n" if image and studio.IMAGE_REQUIREMENTS not in instruction else ""
    markers="Before image generation emit exactly [STUDIO_STAGE:image_generation] as a separate commentary. Only after it returns emit [STUDIO_STAGE:receiving]. " if image else ""
    instruction=prefix+markers+instruction
    save_json(directory/"request.json",{"worker_instruction":instruction,"references":[p.name for p in references],"model":model,"effort":effort})
    process=await asyncio.create_subprocess_exec(*args,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT,env=studio.codex_env(),start_new_session=sys.platform!="win32",limit=16*1024*1024)
    studio.PROCESSES[jid]=process;thread_id="";messages=[];errors=[]
    progress(studio,jid,phase,done,units,detail=name,waiting=True,substage="正在传递")
    try:
        process.stdin.write(instruction.encode());await process.stdin.drain();process.stdin.close()
        async def consume():
            nonlocal thread_id
            with (directory/"events.jsonl").open("a",encoding="utf-8") as local_log,(folder.parent/"events.jsonl").open("a",encoding="utf-8") as parent_log:
                parent_log.write(json.dumps({"studio_stitch_call":name,"time":time.time()})+"\n")
                while line:=await process.stdout.readline():
                    text=line.decode(errors="replace");local_log.write(text);local_log.flush();parent_log.write(text);parent_log.flush()
                    try:
                        event=json.loads(text);transition=studio.stage_from_event(event)
                        if transition:
                            progress(studio,jid,phase,done,units,detail=name,waiting=True,substage=studio.STAGES[transition[0]],source=transition[1])
                        if event.get("type")=="thread.started":
                            thread_id=event.get("thread_id","");studio.write("UPDATE jobs SET thread_id=? WHERE id=?",(thread_id,jid))
                        item=event.get("item") or {}
                        if item.get("type")=="agent_message":messages.append(str(item.get("text","")))
                        if event.get("type") in ("error","turn.failed"):errors.append(str(event.get("message") or event.get("error") or "CLI 执行失败"))
                    except (ValueError,AttributeError):pass
                await process.wait()
        await asyncio.wait_for(consume(),900);ensure_active(studio,jid)
        if process.returncode or errors:raise WorkflowError((errors[-1] if errors else "Codex 执行失败："+" ".join(messages)[-1200:])[:2000])
        if not image:return "\n".join(messages)
        generated=find_image(studio,thread_id,directory)
        if not generated:raise WorkflowError("当前补绘会话没有返回真实图片，已保留之前完成的块")
        with Image.open(generated) as check:check.verify()
        return generated
    except asyncio.TimeoutError as error:raise WorkflowError("当前补绘或检查超过 15 分钟") from error
    finally:
        await studio.stop_process(process)
        if studio.PROCESSES.get(jid) is process:studio.PROCESSES.pop(jid,None)
        for path in directory.glob("reference-*.png"):path.unlink(missing_ok=True)


async def engine(studio,jid,folder,command,*args):
    progress_file=folder/"engine-progress.json";last=""
    async with ENGINE_LOCK:
        ensure_active(studio,jid)
        progress_file.unlink(missing_ok=True)
        process=await asyncio.create_subprocess_exec(sys.executable,str(studio.ROOT/"stitch_engine.py"),command,str(folder),*map(str,args),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT,env=studio.codex_env(),start_new_session=sys.platform!="win32")
        studio.PROCESSES[jid]=process
        capture=asyncio.create_task(process.communicate());started=time.monotonic()
        try:
            while not capture.done():
                ensure_active(studio,jid)
                if time.monotonic()-started>900:raise WorkflowError("拼接计算超过 15 分钟，请降低目标尺寸")
                if progress_file.exists():
                    with contextlib.suppress(ValueError,OSError):
                        text=progress_file.read_text()
                        if text!=last:
                            value=json.loads(text);last=text;stage=value.pop("stage");done=value.pop("done");units=value.pop("units")
                            for key in ("step","total","fraction","label"):value.pop(key,None)
                            progress(studio,jid,stage,done,units,**value)
                await asyncio.sleep(.25)
            output,_=await capture
            ensure_active(studio,jid)
            if process.returncode:
                message=output.decode(errors="replace")[-3000:]
                try:message=json.loads(message.strip().splitlines()[-1]).get("error",message)
                except (ValueError,IndexError):pass
                with (folder.parent/'events.jsonl').open('a',encoding='utf-8') as log:log.write(json.dumps({'studio_engine_error':command,'message':message},ensure_ascii=False)+'\n')
                raise WorkflowError(message)
        finally:
            await studio.stop_process(process)
            if not capture.done():await capture
            if studio.PROCESSES.get(jid) is process:studio.PROCESSES.pop(jid,None)


def tile_instruction(options,plan,tile,prompt):
    template=options.get("stitch_prompt",DEFAULT_STITCH_PROMPT)
    values={"tile_index":str(tile['index']+1),"tile_count":str(plan['factor']),"bounds":str(tile['box']),"target_size":f"{tile['size'][0]}x{tile['size'][1]} pixels"}
    for key,value in values.items():template=template.replace('{'+key+'}',value)
    return template.replace("{prompt}",prompt)


async def run(studio,jid):
    job=studio.query("SELECT * FROM jobs WHERE id=?",(jid,),True);options=json.loads(job["options"]);factor=options["stitch"]
    folder=studio.DATA/"jobs"/jid/"stitch";folder.mkdir(parents=True,exist_ok=True,mode=0o700);(folder/"calls").mkdir(exist_ok=True)
    model=options.get("model",studio.MODEL);effort=options.get("effort",studio.EFFORT);maximum=job["max_attempts"]
    studio.write("UPDATE jobs SET attempt=1,error='' WHERE id=? AND status='running'",(jid,))
    studio.write("INSERT INTO attempts(job_id,number,status,started) VALUES (?,1,'running',?)",(jid,time.time()))
    save_json(folder.parent/"request.json",{"worker_instruction":options.get("stitch_prompt",DEFAULT_STITCH_PROMPT),"options":options,"prompt":job['prompt']})
    budgets={};run_token=str(time.time_ns())
    async def generate(name,instruction,refs,phase,done,units):
        match=re.match(r'tile-\d+',name);key=match.group() if match else name
        while budgets.get(key,0)<maximum:
            attempt=budgets.get(key,0)+1;budgets[key]=attempt
            try:return await cli_call(studio,jid,folder,f"{key}-{run_token}-try-{attempt}",instruction,refs,model,effort,phase,done,units)
            except WorkflowError as error:
                if attempt==maximum or re.search(r"unauthorized|authentication|401|403|quota|usage limit|policy|moderation|unavailable|not supported",str(error),re.I):raise
                progress(studio,jid,phase,done,units,detail=f"{name} · 第 {attempt+1}/{maximum} 次",waiting=True,substage="准备重试")
                for _ in range(min(10,attempt*3)):
                    ensure_active(studio,jid);await asyncio.sleep(1)
        raise WorkflowError(f"{key} 已达到 {maximum} 次补绘尝试上限，请查看配准日志后重试")
    try:
        progress(studio,jid,"base")
        base=folder/"base.png"
        if not base.exists():
            source_id=options.get("source_asset_id")
            if source_id:
                source=studio.query("SELECT * FROM assets WHERE id=?",(source_id,),True)
                if not source:raise WorkflowError("原图已不存在")
                shutil.copyfile(source['path'],base)
            else:
                refs=[Path(a['path']) for aid in json.loads(job['refs']) if (a:=studio.query('SELECT * FROM assets WHERE id=?',(aid,),True))]
                result=await generate("base",studio.make_instruction(job,folder.parent),refs,"base",0,1)
                shutil.copyfile(result,base)
        with Image.open(base) as image:layout(*image.size,factor)
        if not (folder/"plan.json").exists():await engine(studio,jid,folder,"prepare","--factor",factor)
        plan=json.loads((folder/"plan.json").read_text())
        for tile in plan['tiles']:
            i=tile['index'];output=folder/"redraw"/f"{i}.png"
            progress(studio,jid,"redraw",i,factor,detail=f"第 {i+1}/{factor} 块")
            if not output.exists():
                result=await generate(f"tile-{i}",tile_instruction(options,plan,tile,job['prompt']),[folder/"crops"/f"{i}.png",base],"redraw",i,factor)
                shutil.copyfile(result,output)
        progress(studio,jid,"redraw",factor,factor)
        for tile in plan['tiles']:
            i=tile['index'];progress(studio,jid,"registration",i,factor,detail=f"第 {i+1}/{factor} 块")
            if (folder/"diagnostics"/f"alignment-{i}.json").exists():continue
            for attempt in range(maximum):
                try:
                    await engine(studio,jid,folder,"register","--tile",i);break
                except WorkflowError:
                    if attempt+1==maximum:raise
                    instruction=tile_instruction(options,plan,tile,job['prompt'])+"\n前一次补绘不能通过全局仿射配准。请更严格地保持所有几何边界和元素位置，只增加细节。"
                    result=await generate(f"tile-{i}-registration-repair-{attempt+1}",instruction,[folder/"crops"/f"{i}.png",base],"registration",i,factor)
                    shutil.copyfile(result,folder/"redraw"/f"{i}.png")
        if not all((folder/name).is_file() for name in ('candidate.png','inspection.png','overview.png','diagnostics/quality.json')):await engine(studio,jid,folder,"compose")
        ensure_active(studio,jid);progress(studio,jid,"inspection",0,1,waiting=True,substage="主模型检查主体、前景、背景与接缝")
        review_file=folder/"diagnostics"/"visual-review.json"
        review=json.loads(review_file.read_text()) if review_file.exists() else None
        if not review or not review.get('pass'):
            prompt="""STUDIO_STITCH_REVIEW
执行局部视觉验收，不调用生图或任何工具。reference-1 是完整原图，reference-2 是拼接结果缩略全图，reference-3 是在结果原生像素上裁切的主体、前景、背景、接缝局部。检查主体和元素是否被移动、断线、硬接缝、重影、空白以及光照景深不一致。不要只依据清晰度判断。只能输出一个 JSON 对象：{"pass": true或false, "issues": [具体问题]}。发现明显问题必须 pass=false。"""
            text=await cli_call(studio,jid,folder,"inspection",prompt,[base,folder/"overview.png",folder/"inspection.png"],model,effort,"inspection",0,1,image=False)
            match=re.search(r"\{[\s\S]*\}",text)
            try:review=json.loads(match.group()) if match else None
            except ValueError:review=None
            if not isinstance(review,dict) or not isinstance(review.get("pass"),bool) or not isinstance(review.get("issues"),list):raise WorkflowError("主模型没有返回可验证的局部检查结论，未发布拼接候选图")
            save_json(review_file,review)
        quality=json.loads((folder/"diagnostics"/"quality.json").read_text());quality["visual_review"]=review;save_json(folder/"diagnostics"/"quality.json",quality)
        if not review['pass']:raise WorkflowError("局部检查未通过："+"；".join(map(str,review['issues']))[:1600])
        ensure_active(studio,jid);progress(studio,jid,"receiving",0,1)
        result,_=await asyncio.to_thread(studio.store_image,(folder/"candidate.png").read_bytes(),f"超分-{factor}x-{jid[:8]}.png","generated",jid,MAX_PIXELS)
        ensure_active(studio,jid)
        studio.write("UPDATE jobs SET status='succeeded',outputs=?,finished=?,error='' WHERE id=? AND status='running'",(json.dumps([result['id']]),time.time(),jid))
        studio.write("UPDATE attempts SET status='succeeded',finished=? WHERE job_id=? AND status='running'",(time.time(),jid))
        progress(studio,jid,"receiving",1,1)
    except asyncio.CancelledError:
        if not studio.job_cancelled(jid):raise
    except Exception as error:
        studio.write("UPDATE jobs SET status='failed',finished=?,error=? WHERE id=? AND status!='cancelled'",(time.time(),str(error)[:2400],jid))
        studio.write("UPDATE attempts SET status='failed',finished=?,error=? WHERE job_id=? AND status='running'",(time.time(),str(error)[:2000],jid))
    finally:
        if process:=studio.PROCESSES.pop(jid,None):await studio.stop_process(process)
        studio.write("UPDATE attempts SET status='cancelled',finished=? WHERE job_id=? AND status='running' AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND status='cancelled')",(time.time(),jid,jid))
        studio.WAKE.set()
