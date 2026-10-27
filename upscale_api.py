"""Authenticated upscale planning, previews and explicit storage maintenance."""
from __future__ import annotations

import asyncio
import contextlib
import json
import math
import re
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Literal

from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

import image_runtime as imaging
from stitch_engine import save_json
from stitch_planner import Policy, PlanError, progressive_plan, public_plan
from storage_manager import StorageFull, tree_bytes


class ConfirmTrash(BaseModel):
    confirm: Literal['empty-trash']


def root_for(studio,jid):
    if not re.fullmatch('[a-f0-9]{32}',jid):raise HTTPException(404,'任务不存在')
    return studio.DATA/'jobs'/jid/'stitch'


def load_manifest(studio,jid):
    path=root_for(studio,jid)/'progressive.json'
    if path.exists():
        with contextlib.suppress(OSError,ValueError):return json.loads(path.read_text())
    return None


def stage_folder(studio,jid,index):
    manifest=load_manifest(studio,jid)
    if not manifest:raise HTTPException(404,'本级尚未开始')
    stage=next((s for s in manifest['stages'] if s['index']==index),None)
    relative=stage.get('folder','') if stage else ''
    if not re.fullmatch(r'stages/\d{2}-[a-f0-9]{16}',relative):raise HTTPException(404,'本级尚未开始')
    root=root_for(studio,jid).resolve();folder=(root/relative).resolve()
    if not folder.is_relative_to(root):raise HTTPException(404)
    return folder


def plan_payload(studio,jid,job=None):
    manifest=load_manifest(studio,jid)
    if not manifest:
        job=job or studio.query('SELECT * FROM jobs WHERE id=?',(jid,),True)
        options=json.loads(job['options']) if isinstance(job['options'],str) else job['options']
        source=studio.query('SELECT width,height FROM assets WHERE id=?',(options.get('source_asset_id'),),True)
        if not source:return None
        manifest=progressive_plan(source['width'],source['height'],options['stitch'],policy=Policy(max_attempts=job['max_attempts']))
    public=public_plan(manifest)
    for stage in public['stages']:
        index=stage['index'];ready=False
        with contextlib.suppress(HTTPException):ready=(stage_folder(studio,jid,index)/'preview.png').exists()
        stage['preview_url']=f'/api/upscale/jobs/{jid}/stages/{index}/preview' if ready else None
        stage['layout_url']=f'/api/upscale/jobs/{jid}/stages/{index}/layout'
        stage['result_preview']=f'/api/upscale/jobs/{jid}/stages/{index}/result' if stage.get('actual_size') else None
    return public


def register(app,studio):
    pyramids={};pyramid_lock=asyncio.Semaphore(1)
    auth=Depends(studio.require_user)

    @app.exception_handler(StorageFull)
    async def storage_full(request,error):return JSONResponse({'detail':str(error)},status_code=507)

    @app.get('/api/assets/{aid}/upscale-plan')
    def estimate(aid:str,factor:int=4,session=auth):
        source=studio.query('SELECT * FROM assets WHERE id=? AND deleted=0',(aid,),True)
        if not source:raise HTTPException(404,'原图不存在')
        try:plan=progressive_plan(source['width'],source['height'],factor,policy=Policy(max_attempts=studio.setting('max_attempts',3)))
        except PlanError as error:raise HTTPException(400,str(error)) from error
        value=public_plan(plan)
        value['source']=studio.serialize_asset(source)
        for stage in value['stages']:stage['workspace_bytes_estimate']=math.prod(stage['output_size'])*7
        return value

    @app.get('/api/upscale/jobs')
    def jobs(limit:int=30,offset:int=0,session=auth):
        rows=studio.query("SELECT * FROM jobs WHERE COALESCE(json_extract(options,'$.stitch'),0)>0 ORDER BY created DESC LIMIT ? OFFSET ?",(min(100,max(1,limit)),max(0,offset)))
        result=[]
        for row in rows:
            value=studio.serialize_job(row);manifest=load_manifest(studio,row['id'])
            value['upscale_summary']={key:manifest.get(key) for key in ('budget','calls','actual_size','cache_cleared')} if manifest else None
            result.append(value)
        return {'items':result,'total':studio.query("SELECT COUNT(*) AS n FROM jobs WHERE COALESCE(json_extract(options,'$.stitch'),0)>0",one=True)['n']}

    @app.get('/api/upscale/jobs/{jid}')
    def detail(jid:str,session=auth):
        value=studio.get_job(jid,session)
        if not value['options'].get('stitch'):raise HTTPException(400,'该任务不是超分任务')
        value['upscale_plan']=plan_payload(studio,jid,value)
        value['cache_bytes']=tree_bytes(root_for(studio,jid))
        value['cache_clearable']=value['status'] not in ('queued','running','retrying')
        return value

    @app.get('/api/upscale/jobs/{jid}/stages/{index}/{artifact}')
    def stage_artifact(jid:str,index:int,artifact:str,session=auth):
        files={'preview':'preview.png','layout':'layout.png','result':'overview.png','inspection':'inspection.png'}
        if artifact not in files:raise HTTPException(404)
        path=stage_folder(studio,jid,index)/files[artifact]
        if not path.is_file():raise HTTPException(404,'预览尚未生成')
        return FileResponse(path,media_type='image/png',headers={'Cache-Control':'no-store'})

    async def prepare_pyramid(aid,source):
        async with pyramid_lock:
            folder=studio.DATA/'previews'/aid
            if (folder/'ready.json').exists():return
            staging=studio.DATA/'previews'/f'{aid}.building'
            measured=imaging.info(source)
            await asyncio.to_thread(studio.STORAGE.require,measured['width']*measured['height']*2,'准备大图细节预览')
            try:
                if staging.exists():await asyncio.to_thread(studio.STORAGE.remove,staging)
                result=await asyncio.to_thread(imaging.pyramid,source,staging)
                await asyncio.to_thread(studio.STORAGE.require,0,'保存大图预览缓存')
                save_json(staging/'ready.json',result)
                if folder.exists():await asyncio.to_thread(studio.STORAGE.remove,folder)
                staging.replace(folder)
            except BaseException:
                if staging.exists():await asyncio.to_thread(studio.STORAGE.remove,staging)
                raise
            finally:studio.STORAGE.invalidate()

    @app.get('/api/assets/{aid}/tiles/{level}/{x}/{y}')
    async def tile(aid:str,level:int,x:int,y:int,session=auth):
        asset=studio.query('SELECT * FROM assets WHERE id=?',(aid,),True)
        if not asset or not re.fullmatch('[a-f0-9]{32}',aid):raise HTTPException(404)
        maximum=math.ceil(math.log2(max(asset['width'],asset['height'])))
        if not 0<=level<=maximum or min(x,y)<0:raise HTTPException(404)
        divisor=2**(maximum-level)
        if x>=math.ceil(asset['width']/divisor/512) or y>=math.ceil(asset['height']/divisor/512):raise HTTPException(404)
        folder=studio.DATA/'previews'/aid
        if not (folder/'ready.json').exists():
            task=pyramids.get(aid)
            if task is None:
                task=asyncio.create_task(prepare_pyramid(aid,asset['path']));pyramids[aid]=task
                task.add_done_callback(lambda done,key=aid:pyramids.pop(key,None))
            await asyncio.shield(task)
        path=folder/'image_files'/str(level)/f'{x}_{y}.webp'
        if not path.is_file():raise HTTPException(404)
        return FileResponse(path,media_type='image/webp',headers={'Cache-Control':'private, no-store'})

    @app.get('/api/storage')
    def storage_status(session=auth):
        value=studio.STORAGE.usage(True)
        tasks=[]
        for job in studio.query("SELECT id,prompt,status,options,created FROM jobs WHERE COALESCE(json_extract(options,'$.stitch'),0)>0 ORDER BY created DESC"):
            size=tree_bytes(root_for(studio,job['id']))
            if size:tasks.append({'id':job['id'],'prompt':job['prompt'][:80],'status':job['status'],'bytes':size,'clearable':job['status'] not in ('queued','running','retrying')})
        value['tasks']=tasks
        value['trash']={'assets':studio.query('SELECT COUNT(*) AS n FROM assets WHERE deleted=1',one=True)['n'],
                        'collections':studio.query('SELECT COUNT(*) AS n FROM collections WHERE deleted=1',one=True)['n']}
        return value

    def clear_cache(jid):
        with studio.STORAGE.lock:
            job=studio.query('SELECT * FROM jobs WHERE id=?',(jid,),True)
            if not job:raise HTTPException(404,'任务不存在')
            if job['status'] in ('queued','running','retrying'):raise HTTPException(409,'等待或运行中的任务不能清理缓存')
            root=root_for(studio,jid);options=json.loads(job['options'])
            if not options.get('stitch'):raise HTTPException(400,'该任务不是超分任务')
            if (root/'base.png').exists() and not options.get('source_asset_id'):
                asset,_=studio.store_image_path(root/'base.png',f'超分原图-{jid[:8]}.png','generated',jid)
                options['source_asset_id']=asset['id'];studio.write('UPDATE jobs SET options=? WHERE id=?',(json.dumps(options),jid))
            manifest=load_manifest(studio,jid)
            released=0
            if root.exists():
                for item in list(root.iterdir()):
                    if item.name=='progressive.json':continue
                    released+=studio.STORAGE.remove(item)
            # Remove only generated-image folders explicitly named by this job's logs.
            log=studio.DATA/'jobs'/jid/'events.jsonl'
            threads={job.get('thread_id','')}
            if log.exists():
                with log.open(encoding='utf-8',errors='replace') as stream:
                    for line in stream:
                        with contextlib.suppress(ValueError):
                            event=json.loads(line)
                            if event.get('type')=='thread.started':threads.add(event.get('thread_id',''))
            for thread in threads:
                if re.fullmatch('[A-Za-z0-9_-]{10,100}',thread):released+=studio.STORAGE.remove(studio.CODEX_HOME/'generated_images'/thread)
            if manifest:
                manifest.update(cache_cleared=True,cache_cleared_at=time.time())
                save_json(root/'progressive.json',manifest)
            return {'ok':True,'released_bytes':released,'storage':studio.STORAGE.usage(True)}

    @app.post('/api/upscale/jobs/{jid}/clear-cache')
    async def clear_task_cache(jid:str,session=auth):
        root_for(studio,jid)
        return await asyncio.to_thread(clear_cache,jid)

    def purge_trash():
        with studio.STORAGE.lock:
            active=studio.query("SELECT id,refs,options,outputs FROM jobs WHERE status IN ('queued','running','retrying')")
            protected=set(pyramids)
            for job in active:
                protected.update(json.loads(job['refs']));protected.update(json.loads(job['outputs']))
                if source:=json.loads(job['options']).get('source_asset_id'):protected.add(source)
            deleted_groups=studio.query('SELECT id FROM collections WHERE deleted=1')
            group_ids={g['id'] for g in deleted_groups}
            removed_jobs=[j for j in studio.query('SELECT * FROM jobs') if j['collection_id'] in group_ids and j['status'] not in ('queued','running','retrying')]
            removed_job_ids={j['id'] for j in removed_jobs}
            candidates=[a for a in studio.query('SELECT * FROM assets') if a['deleted'] or a['job_id'] in removed_job_ids]
            assets=[a for a in candidates if a['id'] not in protected]
            removed={a['id'] for a in assets};released=0
            # Keep assets used by another live job unless they were explicitly trashed.
            for job in studio.query('SELECT id,refs,options FROM jobs'):
                if job['id'] in removed_job_ids:continue
                refs=set(json.loads(job['refs']));source=json.loads(job['options']).get('source_asset_id')
                for asset in assets:
                    if not asset['deleted'] and (asset['id'] in refs or asset['id']==source):removed.discard(asset['id'])
            assets=[a for a in assets if a['id'] in removed]
            with studio.db() as connection:
                for table in ('templates','prompts'):
                    for row in connection.execute(f'SELECT id,refs FROM {table}').fetchall():
                        refs=[aid for aid in json.loads(row['refs']) if aid not in removed]
                        connection.execute(f'UPDATE {table} SET refs=? WHERE id=?',(json.dumps(refs),row['id']))
                for row in connection.execute('SELECT id,refs,outputs FROM jobs').fetchall():
                    connection.execute('UPDATE jobs SET refs=?,outputs=? WHERE id=?',
                                       (json.dumps([a for a in json.loads(row['refs']) if a not in removed]),
                                        json.dumps([a for a in json.loads(row['outputs']) if a not in removed]),row['id']))
                for asset in assets:connection.execute('DELETE FROM assets WHERE id=?',(asset['id'],))
                for job in removed_jobs:
                    connection.execute('DELETE FROM attempts WHERE job_id=?',(job['id'],));connection.execute('DELETE FROM jobs WHERE id=?',(job['id'],))
                connection.execute('DELETE FROM collections WHERE deleted=1 AND NOT EXISTS(SELECT 1 FROM jobs WHERE jobs.collection_id=collections.id)')
            for asset in assets:
                released+=studio.STORAGE.remove(asset['path'])
                for suffix in ('.webp','-preview.webp'):released+=studio.STORAGE.remove(studio.DATA/'thumbs'/f"{asset['id']}{suffix}")
                released+=studio.STORAGE.remove(studio.DATA/'previews'/asset['id'])
            for job in removed_jobs:released+=studio.STORAGE.remove(studio.DATA/'jobs'/job['id'])
            with sqlite3.connect(studio.DATA/'studio.sqlite3',timeout=20) as connection:
                connection.execute('PRAGMA wal_checkpoint(TRUNCATE)');connection.execute('VACUUM')
            studio.STORAGE.invalidate()
            return {'ok':True,'assets':len(assets),'removed_ids':list(removed),'jobs':len(removed_jobs),'protected_assets':len(candidates)-len(assets),
                    'released_bytes':released,'storage':studio.STORAGE.usage(True)}

    @app.post('/api/storage/empty-trash')
    async def empty_trash(body:ConfirmTrash,session=auth):return await asyncio.to_thread(purge_trash)
