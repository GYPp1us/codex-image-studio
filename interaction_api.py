"""Workspace preferences and image operations, separate from CLI scheduling."""
from __future__ import annotations

import json
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field


class GenerationDefaults(BaseModel):
    ratio: Literal['1:1', '3:2', '2:3', '16:9', '9:16', 'auto'] = '1:1'
    size: Literal['auto', '1024', '2048', '4096'] = 'auto'
    count: int = Field(default=1, ge=1, le=20)
    transparent: bool = False
    polish: bool = False
    stitch: Literal[0, 4, 16, 64] = 0


class QuickDefaults(BaseModel):
    model: str | None = Field(default=None, max_length=100)
    effort: str | None = Field(default=None, max_length=20)
    use_source_template: bool = True
    polish: bool = False


class UpscaleDefaults(BaseModel):
    auto_select: bool = True
    factor: Literal[4, 16, 64] = 4
    default_injection: str = Field(default='', max_length=12000)


def preferences(studio):
    return {key: model(**studio.setting(key, {})).model_dump() for key, model in
            (('defaults', GenerationDefaults), ('quick', QuickDefaults), ('upscale', UpscaleDefaults))} | {
                'motion': studio.setting('motion', True), 'notify': studio.setting('notify', False)}


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
             'parent_job_id': parent['id'], 'polish': False, 'ratio': 'auto', 'size': 'auto'}
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
        return await studio.add_jobs(studio.JobInput(prompt=body.prompt, refs=[aid], source_asset_id=aid,
            quick_edit=True, ratio='auto', size='auto', polish=config.polish,
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
        predicate, args = (' WHERE status=?', [status]) if status else ('', [])
        key = "COALESCE(NULLIF(batch_id,''),id)"
        identities = studio.query(f'SELECT {key} AS id,MAX(created) AS created FROM jobs{predicate} '
            f'GROUP BY {key} ORDER BY created DESC,id DESC LIMIT ? OFFSET ?', (*args, max(1, min(limit, 100)), max(0, offset)))
        items = []
        for identity in identities:
            jobs = studio.query(f'SELECT * FROM jobs WHERE {key}=? ORDER BY created,id', (identity['id'],))
            items.append(identity | {'prompt': jobs[0]['prompt'], 'jobs': [studio.serialize_job(job) for job in jobs]})
        total = studio.query(f'SELECT COUNT(DISTINCT {key}) AS n FROM jobs{predicate}', args, True)['n']
        return {'items': items, 'total': total}
