"""Workspace preferences and image operations, separate from CLI scheduling."""
from __future__ import annotations

import json
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from quick_settings import QuickSetting
from generation_choices import AspectRatio,ImageSize,UpscaleFactor


class GenerationDefaults(BaseModel):
    ratio: AspectRatio = '1:1'
    size: ImageSize = 'auto'
    count: int = Field(default=1, ge=1, le=20)
    transparent: bool = False
    polish: bool = False
    stitch: UpscaleFactor = 0


class QuickDefaults(BaseModel):
    model: str | None = Field(default=None, max_length=100)
    effort: str | None = Field(default=None, max_length=20)
    use_source_template: bool = True
    polish: bool = False
    keep_spec: bool = True
    use_ref: bool = True
    notify: bool = True


class QuickEditSpec(BaseModel):
    ratio: AspectRatio = '1:1'
    size: ImageSize = 'auto'


class UpscaleDefaults(BaseModel):
    auto_select: bool = True
    factor: Literal[4, 16, 64] = 4
    default_injection: str = Field(default='', max_length=12000)
    append_system: bool = True
    include_source_context: bool = False


class Appearance(BaseModel):
    mode: Literal['system', 'light', 'dark'] = 'system'
    accent: str = Field(default='#5d7350', pattern=r'^#[0-9a-fA-F]{6}$')


def preferences(studio):
    pins=[]
    for pin in studio.setting('quick_settings', []) or []:
        try:pins.append(QuickSetting.model_validate(pin).model_dump())
        except (ValueError,TypeError):continue
    return {key: model(**studio.setting(key, {})).model_dump() for key, model in
            (('defaults', GenerationDefaults), ('quick', QuickDefaults), ('upscale', UpscaleDefaults), ('appearance', Appearance))} | {
                'motion': studio.setting('motion', True),
                'motion_mode': studio.setting('motion_mode', 'system'), 'notify': studio.setting('notify', False),
                'quick_settings': pins}


def validate_regions(size, regions):
    from local_edit import context_box
    for index, region in enumerate(regions):
        context_box(size, region)
        for previous in regions[:index]:
            if (max(region['x'], previous['x']) < min(region['x'] + region['width'], previous['x'] + previous['width'])
                    and max(region['y'], previous['y']) < min(region['y'] + region['height'], previous['y'] + previous['height'])):
                raise ValueError('重绘区域不能重叠；边缘相接的区域可以分别处理')


class QuickEditInput(BaseModel):
    prompt: str = Field(min_length=1, max_length=24000)
    spec: QuickEditSpec | None = None


def quick_model(studio, config, model=None, effort=None):
    model = config.model or model or studio.setting('model', studio.MODEL)
    item = next((item for item in studio.model_catalog() if item['id'] == model), None)
    effort = config.effort or effort or studio.setting('effort', studio.EFFORT)
    if item and config.effort is None and effort not in item['efforts']:
        effort = item.get('default_effort', item['efforts'][0])
    studio.validate_model_choice(model, effort)
    return model, effort


def enqueue_after_upscale(studio, connection, parent, asset):
    """Called in the same transaction that publishes the original image."""
    options = json.loads(parent['options'])
    factor = options.get('after_upscale', 0)
    if not factor or options.get('after_upscale_job_id'):
        return
    jid = studio.uid()
    child = {**options, 'after_upscale': 0, 'stitch': factor, 'source_asset_id': asset['id'],
             'parent_job_id': parent['id'], 'polish': False, 'ratio': 'auto', 'size': 'auto',
             'source_description': parent.get('polished_prompt') or parent['prompt']}
    for key in ('regions', 'region', 'quick_edit', 'requested_size'):
        child.pop(key, None)
    connection.execute("INSERT INTO jobs(id,batch_id,prompt,refs,options,status,max_attempts,created,collection_id,template_id) "
        "VALUES (?,?,?,?,?,'queued',?,?,?,?)", (jid, parent['batch_id'], parent['prompt'], json.dumps([asset['id']]),
        json.dumps(child), parent['max_attempts'], studio.now(), parent['collection_id'], parent['template_id']))
    options['after_upscale_job_id'] = jid
    connection.execute('UPDATE jobs SET options=? WHERE id=?', (json.dumps(options), parent['id']))


def register(app, studio):
    @app.get('/api/settings')
    def workspace_settings(session=Depends(studio.require_user)):
        return preferences(studio) | studio.call_settings(session)

    @app.post('/api/assets/{aid}/quick-edit')
    async def quick_edit(aid: str, body: QuickEditInput, session=Depends(studio.require_user)):
        asset = studio.query('SELECT * FROM assets WHERE id=? AND deleted=0', (aid,), True)
        if not asset:
            raise HTTPException(404, '原图不存在')
        config = QuickDefaults(**studio.setting('quick', {}))
        origin = studio.query('SELECT * FROM jobs WHERE id=?', (asset['job_id'],), True) if asset['job_id'] else None
        template = origin.get('template_id') if origin and config.use_source_template else None
        if template and not studio.query('SELECT id FROM templates WHERE id=?', (template,), True):
            template = None
        model, effort = quick_model(studio, config)
        spec = body.spec or QuickEditSpec(**studio.setting('defaults', {}))
        return await studio.add_jobs(studio.JobInput(prompt=body.prompt, refs=[aid] if config.use_ref else [], source_asset_id=aid,
            quick_edit=True, quick_keep_spec=config.keep_spec, quick_use_ref=config.use_ref,
            ratio='auto' if config.keep_spec else spec.ratio, size='auto' if config.keep_spec else spec.size, polish=config.polish,
            transparent=bool(json.loads(origin['options']).get('transparent')) if origin else False,
            model=model, effort=effort, template_id=template), session)

    @app.get('/api/assets/{aid}/info')
    def image_info(aid: str, session=Depends(studio.require_user)):
        asset = studio.query('SELECT * FROM assets WHERE id=? AND deleted=0', (aid,), True)
        if not asset:
            raise HTTPException(404, '图片不存在或已删除')
        job = studio.get_job(asset['job_id'], session) if asset['job_id'] else None
        return {'asset': studio.serialize_asset(asset), 'job': job}

    @app.get('/api/batches')
    def batches(status: str = '', limit: int = 30, offset: int = 0, session=Depends(studio.require_user)):
        # Page batch identities first, then fetch all of their jobs. A page boundary
        # must never turn a 20-image batch into two incomplete cards.
        predicate, args = (' WHERE history_deleted=0 AND status=?', [status]) if status else (' WHERE history_deleted=0', [])
        key = "COALESCE(NULLIF(batch_id,''),id)"
        with studio.db() as connection:
            connection.execute('BEGIN')
            identities = connection.execute(f'SELECT {key} AS id,MAX(created) AS created FROM jobs{predicate} '
                f'GROUP BY {key} ORDER BY created DESC,id DESC LIMIT ? OFFSET ?', (*args, max(1, min(limit, 100)), max(0, offset))).fetchall()
            rows = [(dict(identity), connection.execute(f'SELECT * FROM jobs WHERE {key}=? AND history_deleted=0 ORDER BY created,id', (identity['id'],)).fetchall()) for identity in identities]
            total = connection.execute(f'SELECT COUNT(DISTINCT {key}) FROM jobs{predicate}', args).fetchone()[0]
            revision = connection.execute('SELECT COUNT(*),COALESCE(MAX(history_deleted),0) FROM jobs WHERE history_deleted>0').fetchone()
        items = [identity | {'prompt': jobs[0]['prompt'], 'jobs': [studio.serialize_job(job) for job in jobs]} for identity,jobs in rows]
        return {'items': items, 'total': total, 'history_revision': f'{revision[0]}:{revision[1]}'}

    def delete_history(predicate, identity):
        with studio.db() as connection:
            connection.execute('BEGIN IMMEDIATE')
            jobs = connection.execute(f'SELECT id,status,history_deleted FROM jobs WHERE {predicate}', (identity,)).fetchall()
            if not jobs:
                raise HTTPException(404, '任务记录不存在')
            visible = [job for job in jobs if not job['history_deleted']]
            if any(job['status'] not in ('succeeded', 'failed', 'cancelled') for job in visible):
                raise HTTPException(409, '只能删除已结束的任务记录')
            removed = [job['id'] for job in visible]
            revision = connection.execute('SELECT COUNT(*),COALESCE(MAX(history_deleted),0) FROM jobs WHERE history_deleted>0').fetchone()
            marker = max(int(studio.now()*1_000_000), revision[1]+1)
            connection.executemany('UPDATE jobs SET history_deleted=? WHERE id=?', ((marker, jid) for jid in removed))
            return {'ok': True, 'removed_ids': removed, 'previous_history_revision': f'{revision[0]}:{revision[1]}',
                    'history_revision': f'{revision[0]+len(removed)}:{marker if removed else revision[1]}'}

    @app.delete('/api/jobs/{jid}')
    def delete_job_record(jid: str, session=Depends(studio.require_user)):
        return delete_history('id=?', jid)

    @app.delete('/api/batches/{bid}')
    def delete_batch_records(bid: str, session=Depends(studio.require_user)):
        return delete_history("COALESCE(NULLIF(batch_id,''),id)=?", bid)
