"""Application-owned image calls. Transport, prompts and published assets are separate."""
from __future__ import annotations

import asyncio
import contextlib
import io
import json
import re
import time
from dataclasses import asdict
from pathlib import Path
from typing import Literal

from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image
from pydantic import BaseModel, Field

from image_backend import Backend, BackendError, ImageRequest

EVENT_HEARTBEAT_SECONDS = 15
EVENT_POLL_SECONDS = .5

DEFAULT_IMAGE_PROMPT = '''Create one image following this brief:
{prompt}
Requested composition/aspect ratio: {ratio}. Requested native dimensions: {size}.
Background transparency: {transparent}. Use the supplied images as visual references; preserve content not explicitly changed.'''
DEFAULT_POLISH_PROMPT = '''Rewrite the user's image brief into one clear, self-contained image prompt. Preserve the intended subject, identities, count, composition, text and requested edits. Add useful visual details without inventing new requirements. Treat reference images as visual context. Do not generate an image, invoke tools, describe your process, or add a preface. Return only the rewritten prompt, in the user's language.
Original brief:
{prompt}'''


class ImageSettings(BaseModel):
    transport: Literal['images', 'responses', 'cli'] = 'images'
    fallback: bool = True
    image_model: Literal['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'] = 'gpt-image-2.5-sunburst'
    quality: Literal['auto', 'low', 'medium', 'high', 'xhigh', 'max'] = 'max'
    partial_images: int = Field(default=2, ge=0, le=3)


class GenerationFailure(RuntimeError):
    retryable = False
    def __init__(self, message, *, ambiguous=False, retryable=False):
        super().__init__(message)
        self.ambiguous = ambiguous
        self.retryable = bool(retryable and not ambiguous)


ERRORS = {
    'auth_missing': '直连订阅未登录', 'auth_expired': '订阅凭据需要刷新',
    'too_many_references': '直连通道的参考图数量超出能力',
    'invalid_image': '返回的图片未通过完整性检查',
}


def initialize(connection):
    connection.execute('''CREATE TABLE IF NOT EXISTS generation_calls(
        id TEXT PRIMARY KEY,job_id TEXT NOT NULL,attempt INTEGER NOT NULL,scope TEXT NOT NULL,
        kind TEXT NOT NULL,status TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,
        detail TEXT NOT NULL,prompt TEXT NOT NULL DEFAULT '')''')
    connection.execute('CREATE INDEX IF NOT EXISTS generation_calls_job ON generation_calls(job_id,created,id)')
    if 'generation_detail' not in {r[1] for r in connection.execute('PRAGMA table_info(jobs)')}:
        connection.execute("ALTER TABLE jobs ADD COLUMN generation_detail TEXT NOT NULL DEFAULT '{}'")


def settings_payload(studio):
    return {'image_backend': ImageSettings(**studio.setting('image_backend', {})).model_dump(),
            'image_prompt': studio.setting('image_prompt', DEFAULT_IMAGE_PROMPT),
            'polish_text_prompt': studio.setting('polish_text_prompt', DEFAULT_POLISH_PROMPT),
            'default_image_prompt': DEFAULT_IMAGE_PROMPT, 'default_polish_text_prompt': DEFAULT_POLISH_PROMPT}


def snapshot(studio):
    values = settings_payload(studio)
    return {'schema': 1, **{key: values[key] for key in ('image_backend', 'image_prompt', 'polish_text_prompt')}}


def image_size(options, expected=None):
    if expected:
        return f'{int(expected[0])}x{int(expected[1])}'
    if options.get('quick_keep_spec') and options.get('requested_size'):
        return image_size({}, options['requested_size'])
    ratio, edge = options.get('ratio', 'auto'), options.get('size', 'auto')
    if ratio == 'auto':
        return 'auto'
    a, b = map(int, ratio.split(':'))
    edge = int(edge) if edge != 'auto' else (1024 if a == b else 1536)
    return f'{max(16, round(edge*a/max(a,b)/16)*16)}x{max(16, round(edge*b/max(a,b)/16)*16)}'


def render(template, values):
    return re.sub(r'\{(prompt|ratio|size|transparent|references)\}', lambda m: str(values.get(m[1], '')), template)


def image_brief(options, prompt, expected=None):
    frozen = options.get('generation', {})
    return render(frozen.get('image_prompt', DEFAULT_IMAGE_PROMPT),
                  {'prompt': prompt, 'ratio': options.get('ratio', 'auto'), 'size': image_size(options, expected),
                   'transparent': str(options.get('transparent', False)), 'references': 'attached visual references'})


def active(studio, jid):
    if studio.job_cancelled(jid):
        raise asyncio.CancelledError()


def summary(value):
    return {k: value[k] for k in ('schema', 'id', 'scope', 'kind', 'status', 'transport', 'stage', 'updated',
        'requested', 'provider_reported', 'actual_image', 'fallback', 'preview', 'error', 'ambiguous') if k in value}


def calls(studio, jid, limit=30, offset=0):
    rows = studio.query('SELECT detail FROM generation_calls WHERE job_id=? ORDER BY created DESC,id DESC LIMIT ? OFFSET ?',
                        (jid, max(1, min(limit, 100)), max(0, offset)))
    count = studio.query('SELECT COUNT(*) AS n FROM generation_calls WHERE job_id=?', (jid,), True)['n']
    return {'items': [json.loads(r['detail']) for r in rows], 'total': count, 'offset': offset}


def log_text(studio, jid):
    """Summarize observed calls; this is not a replay of individual stage events."""
    rows = studio.query('SELECT created,detail FROM generation_calls WHERE job_id=? ORDER BY created DESC,id DESC LIMIT 50', (jid,))
    def label(value):
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', value):
            return None
        if value.startswith(('sk-', 'eyJ')):
            return None
        return value
    def model(value):
        value = label(value)
        return value if value and re.match(r'^(?:gpt-|o[0-9])', value) else None
    def quality(value):
        return value if value in ('auto', 'low', 'medium', 'high', 'xhigh', 'max') else None
    lines = []
    for row in reversed(rows):
        try:
            detail = json.loads(row['detail'])
        except (ValueError, TypeError):
            continue
        if not isinstance(detail, dict):
            continue
        requested = detail.get('requested') if isinstance(detail.get('requested'), dict) else {}
        reported = detail.get('provider_reported') if isinstance(detail.get('provider_reported'), dict) else {}
        fallback = detail.get('fallback') if isinstance(detail.get('fallback'), dict) else None
        message = {
            'kind': detail.get('kind') if detail.get('kind') in ('image', 'inspection', 'polish') else None, 'scope': label(detail.get('scope')),
            'transport': detail.get('transport') if detail.get('transport') in ('images', 'responses', 'cli') else None,
            'status': detail.get('status') if detail.get('status') in ('running', 'succeeded', 'failed', 'cancelled') else None,
            'requested': {'image_model':model(requested.get('image_model')), 'response_model':model(requested.get('response_model')), 'quality':quality(requested.get('quality'))},
            'provider_reported': {'image_model':model(reported.get('image_model')), 'response_model':model(reported.get('response_model')), 'quality':quality(reported.get('quality'))},
            'ambiguous': detail.get('ambiguous') is True,
            'fallback': ({'from':fallback.get('from') if fallback.get('from') in ('images','responses','cli') else None, 'to':fallback.get('to') if fallback.get('to') in ('images','responses','cli') else None,
                          'reason':fallback.get('reason') if fallback.get('reason') in ('auth_unavailable','auth_rejected','unsupported','unsupported_parameter','connection_failed','too_many_references','invalid_reference','cli_selected') else None} if fallback is not None else None),
        }
        lines.append(json.dumps({'type':'generation_call_summary', 'time':row['created'], 'message':message}, ensure_ascii=False))
    return '\n'.join(lines)


def save_preview(studio, directory, raw):
    with Image.open(io.BytesIO(raw)) as image:
        image.load()
        image.thumbnail((1024, 1024))
        data = io.BytesIO()
        image.save(data, format='WEBP', quality=86, method=2)
    content = data.getvalue()
    studio.STORAGE.require(len(content) * 2, '显影预览')
    return content


class Call:
    def __init__(self, studio, jid, directory, scope, kind, prompt, transport):
        self.studio, self.jid, self.directory = studio, jid, Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        job = studio.query('SELECT attempt FROM jobs WHERE id=?', (jid,), True)
        self.value = {'schema': 1, 'id': studio.uid(), 'scope': scope, 'kind': kind,
                      'transport': transport, 'stage': 'sending', 'status': 'running', 'created': time.time(),
                      'requested': {}, 'provider_reported': {}, 'actual_image': {}}
        self.revision = 0
        self.preview_directory = studio.DATA / 'jobs' / jid / 'generation-previews' / self.value['id']
        self.preview_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        studio.write('INSERT INTO generation_calls(id,job_id,attempt,scope,kind,status,created,updated,detail,prompt) VALUES(?,?,?,?,?,?,?,?,?,?)',
                     (self.value['id'], jid, job['attempt'], scope, kind, 'running', self.value['created'], self.value['created'], '{}', prompt))
        self.persist()

    def persist(self):
        self.value['updated'] = time.time()
        self.studio.write('UPDATE generation_calls SET status=?,updated=?,detail=? WHERE id=?',
                          (self.value['status'], self.value['updated'], json.dumps(self.value), self.value['id']))
        self.studio.write("UPDATE jobs SET generation_detail=? WHERE id=? AND (status!='cancelled' OR ?='cancelled')",
                          (json.dumps(summary(self.value)), self.jid, self.value['status']))

    async def event(self, event, changed=None):
        active(self.studio, self.jid)
        if event['type'] == 'stage':
            stage = event.get('stage', 'sending')
            self.value['stage'] = stage
            if changed:
                changed(stage, True, 'backend')
            else:
                self.studio.set_job_stage(self.jid, stage, 'backend')
        elif event['type'] == 'partial':
            content = await asyncio.to_thread(save_preview, self.studio, self.preview_directory, event['data'])
            active(self.studio, self.jid)
            temporary = self.preview_directory / 'preview.tmp'
            temporary.write_bytes(content)
            temporary.replace(self.preview_directory / 'preview.webp')
            self.revision += 1
            self.value['preview'] = {'url': f'/api/jobs/{self.jid}/generation-preview/{self.value["id"]}?v={self.revision}',
                                     'revision': self.revision, 'index': event.get('index'), 'partial': True}
        elif event['type'] == 'metadata':
            for key in ('requested', 'provider_reported', 'actual_image', 'usage', 'ids', 'revised_prompt'):
                if key in event:
                    self.value[key] = event[key]
            if event.get('actual_image', {}).get('bytes'):
                self.studio.STORAGE.require(event['actual_image']['bytes'], '图片结果')
        self.persist()

    def failure(self, error):
        self.value['status'] = 'cancelled' if isinstance(error, asyncio.CancelledError) or self.studio.job_cancelled(self.jid) else 'failed'
        if self.value.get('preview'):
            self.value['preview']['retained'] = True
            self.value['preview']['partial'] = True
        self.persist()

    def result(self, result, stage='receiving'):
        value = asdict(result)
        value.pop('output_path', None)
        value.pop('text', None)
        self.value.update(value, status='succeeded', stage=stage)
        self.persist()


async def generate(studio, jid, directory, scope, instruction, references, model, effort,
                   expected_size=None, changed=None, legacy=None, prompt_metadata=None):
    job = studio.query('SELECT * FROM jobs WHERE id=?', (jid,), True)
    options = json.loads(job['options'])
    frozen = options['generation']
    config = ImageSettings(**frozen['image_backend'])
    call = Call(studio, jid, directory, scope, 'image', instruction, config.transport)
    size = image_size(options, expected_size)
    call.value['requested'] = {'image_model': config.image_model, 'quality': config.quality, 'size': size,
                               'background': 'transparent' if options.get('transparent') else 'auto',
                               'partial_images': config.partial_images, 'response_model': model if config.transport == 'responses' else None}
    call.value['prompt_metadata'] = prompt_metadata
    call.persist()
    try:
        (Path(directory) / 'request.json').write_text(json.dumps({'job_id':jid, 'kind':'redraw' if expected_size else 'image', 'expected_size':expected_size, 'worker_instruction':instruction, 'references':[Path(p).name for p in references], 'model':model, 'effort':effort, 'created':time.time(), 'prompt_metadata':prompt_metadata, 'generation_schema':1}, ensure_ascii=False), encoding='utf-8')
    except BaseException as error:
        call.failure(error)
        raise
    if config.transport != 'cli':
        try:
            if changed: changed('等待并发名额', False, 'server')
            async with studio.cli_slot(jid, scope):
                active(studio, jid)
                if recorder := getattr(studio, 'record_cli_call', None): recorder(True)
                request = ImageRequest(prompt=instruction, image_model=config.image_model, size=size, quality=config.quality,
                    background='transparent' if options.get('transparent') else 'auto', reference_paths=tuple(references),
                    transport=config.transport, response_model=model, effort='low', partial_images=config.partial_images)
                result = await Backend(studio.CODEX_HOME).generate(request, Path(directory) / 'output.png',
                    lambda event: call.event(event, changed))
            active(studio, jid)
            call.result(result)
            return result.output_path
        except BackendError as error:
            call.value.update(error=error.code, ambiguous=error.ambiguous)
            if not (config.fallback and error.safe_fallback and not error.ambiguous and legacy):
                call.failure(error)
                message = ERRORS.get(error.code, '图片直连请求失败：' + error.code)
                if error.ambiguous: message += '。服务端可能已生成，未自动重发；请检查后手动重试。'
                raise GenerationFailure(message, ambiguous=error.ambiguous, retryable=error.safe_fallback and error.retryable) from None
            call.value['fallback'] = {'from': config.transport, 'to': 'cli', 'reason': error.code, 'image_model': None, 'quality': None}
            call.value.update(transport='cli', stage='fallback'); call.persist()
        except BaseException as error:
            call.failure(error)
            raise
    try:
        active(studio, jid)
        if not legacy: raise GenerationFailure('没有可用的 CLI 降级通道')
        result = await legacy()
        active(studio, jid)
        with Image.open(result) as image:
            call.value['actual_image'] = {'width': image.width, 'height': image.height, 'format': image.format.lower()}
        # The CLI's outer text model is not evidence of its image model or quality.
        call.value.update(status='succeeded', stage='receiving', provider_reported={})
        call.persist()
        return result
    except BaseException as error:
        call.failure(error)
        raise


async def polish(studio, jid, directory, prompt, references, model, effort, legacy):
    job = studio.query('SELECT options FROM jobs WHERE id=?', (jid,), True)
    frozen = json.loads(job['options'])['generation']
    config = ImageSettings(**frozen['image_backend'])
    instruction = render(frozen['polish_text_prompt'], {'prompt': prompt})
    call = Call(studio, jid, directory, 'polish', 'polish', instruction, 'responses')
    call.value.update(stage='polishing', requested={'response_model': model, 'effort': effort})
    call.persist(); studio.set_job_stage(jid, 'polishing', 'server')
    try:
        try:
            if config.transport == 'cli': raise BackendError('cli_selected', safe_fallback=True)
            async with studio.cli_slot(jid, 'polish'):
                result = await Backend(studio.CODEX_HOME, deadline=180).polish(prompt, instruction,
                    refs=tuple(references), model=model, effort=effort, on_event=lambda event: call.event(event))
            active(studio, jid)
            text = result.text.strip(); call.result(result)
            source = 'dedicated_responses'
        except BackendError as error:
            if not ((config.fallback or config.transport == 'cli') and error.safe_fallback and not error.ambiguous):
                raise GenerationFailure('独立润色失败：' + error.code, ambiguous=error.ambiguous) from None
            call.value.update(transport='cli', fallback={'from': 'responses', 'to': 'cli', 'reason': error.code})
            text = (await legacy(instruction)).strip(); source = 'dedicated_cli'
        active(studio, jid)
        if not text or len(text) > 24000: raise GenerationFailure('润色未返回有效的图片提示词')
        studio.write("UPDATE jobs SET polished_prompt=?,polish_source=? WHERE id=? AND status!='cancelled'", (text, source, jid))
        studio.write("UPDATE attempts SET polished_prompt=?,polish_source=? WHERE job_id=? AND status='running'", (text, source, jid))
        call.value.update(status='succeeded', stage='receiving'); call.persist()
        return text
    except BaseException as error:
        call.failure(error)
        raise


async def text_call(studio, jid, directory, scope, instruction, references, model, effort, legacy, changed=None):
    """Run an inspection with a text-only Responses call, or the supplied text-only CLI."""
    job = studio.query('SELECT options FROM jobs WHERE id=?', (jid,), True)
    frozen = json.loads(job['options'])['generation']
    config = ImageSettings(**frozen['image_backend'])
    call = Call(studio, jid, directory, scope, 'inspection', instruction, 'responses')
    call.value.update(stage='inspecting', requested={'response_model': model, 'effort': effort, 'reference_count':len(references)})
    call.persist()

    async def event(value):
        active(studio, jid)
        if value.get('type') == 'stage':
            call.value['stage'] = 'inspecting'
            if changed:
                changed('\u6b63\u5728\u9a8c\u6536', True, 'backend')
            call.persist()
        else:
            await call.event(value, changed)

    try:
        try:
            if config.transport == 'cli':
                raise BackendError('cli_selected', safe_fallback=True)
            async with studio.cli_slot(jid, scope):
                active(studio, jid)
                result = await Backend(studio.CODEX_HOME, deadline=180).polish(
                    instruction, 'Inspect the supplied references and follow the user instruction. Return only the requested text. Do not generate an image or use tools.',
                    refs=tuple(references), model=model, effort=effort, on_event=event)
            active(studio, jid)
            text = result.text.strip()
            if not text or len(text) > 24000:
                raise GenerationFailure('Inspection returned invalid text')
            call.result(result, stage='inspecting')
        except BackendError as error:
            if not ((config.fallback or config.transport == 'cli') and error.safe_fallback and not error.ambiguous and legacy):
                call.value.update(error=error.code, ambiguous=error.ambiguous)
                raise GenerationFailure('Inspection failed: ' + error.code, ambiguous=error.ambiguous) from None
            call.value.update(transport='cli', fallback={'from':'responses', 'to':'cli', 'reason':error.code})
            call.persist()
            active(studio, jid)
            text = (await legacy()).strip()
            active(studio, jid)
            if not text or len(text) > 24000:
                raise GenerationFailure('Inspection returned invalid text')
            call.value.update(status='succeeded', stage='inspecting', provider_reported={})
            call.persist()
        return text
    except BaseException as error:
        call.failure(error)
        raise


async def run_job(studio, jid):
    from stitch_workflow import cli_call, legacy_cli_call
    job = studio.query('SELECT * FROM jobs WHERE id=?', (jid,), True)
    if not job or job['status'] == 'cancelled':
        return
    options = json.loads(job['options']); directory = studio.DATA / 'jobs' / jid
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    number = job['attempt'] + 1
    if not studio.write("UPDATE jobs SET attempt=?,status='running',stage='sending',error='' WHERE id=? AND status!='cancelled'", (number, jid)):
        return
    studio.write("INSERT INTO attempts(job_id,number,status,started) VALUES(?,?,'running',?)", (jid, number, time.time()))
    references = [Path(asset['path']) for aid in json.loads(job['refs']) if (asset := studio.query('SELECT path FROM assets WHERE id=?', (aid,), True))]
    expected, prompt = None, job['prompt']
    try:
        if options.get('region'):
            from local_edit import prepare
            original = studio.query('SELECT path FROM assets WHERE id=?', (options['source_asset_id'],), True)
            prompt, references, expected = await asyncio.to_thread(prepare, original['path'], directory, options['region'], prompt)
        if options.get('polish'):
            prompt = await polish(studio, jid, directory / 'polish', prompt, references, options['model'], options['effort'],
                lambda instruction: legacy_cli_call(studio, jid, directory, f'polish-{number}', instruction, references,
                    options['model'], options['effort'], 'base', 0, 1, image=False, kind='polish'))
        instruction = image_brief(options, prompt, expected)
        (directory / 'request.json').write_text(json.dumps({'kind': 'image', 'worker_instruction': instruction,
            'generation_schema': 1, 'prompt': job['prompt']}, ensure_ascii=False), encoding='utf-8')
        while True:
            try:
                output = await cli_call(studio, jid, directory, f'image-{number}', instruction, references,
                    options['model'], options['effort'], 'base', 0, 1, expected_size=expected,
                    kind='local_edit' if options.get('region') else None)
                break
            except GenerationFailure as error:
                if not error.retryable or error.ambiguous or number >= job['max_attempts']:
                    raise
                active(studio, jid)
                studio.write("UPDATE attempts SET status='failed',error=?,finished=? WHERE job_id=? AND number=? AND status='running'", (str(error), time.time(), jid, number))
                studio.write("UPDATE jobs SET status='retrying',error=? WHERE id=? AND status!='cancelled'", (str(error), jid))
                await asyncio.sleep(min(60, 5 * 2 ** (number - 1)))
                active(studio, jid)
                number += 1
                if not studio.write("UPDATE jobs SET attempt=?,status='running',stage='sending',error='' WHERE id=? AND status!='cancelled'", (number, jid)):
                    raise asyncio.CancelledError()
                studio.write("INSERT INTO attempts(job_id,number,status,started) VALUES(?,?,'running',?)", (jid, number, time.time()))
        active(studio, jid)
        studio.set_job_stage(jid, 'saving', 'server')
        await asyncio.to_thread(studio.record_generated_image, jid, output)
    except asyncio.CancelledError:
        raise
    except Exception as error:
        message = str(getattr(error, 'detail', error))[:2000]
        studio.write("UPDATE jobs SET status='failed',error=?,finished=? WHERE id=? AND status!='cancelled'", (message, time.time(), jid))
        studio.write("UPDATE attempts SET status='failed',error=?,finished=? WHERE job_id=? AND number=? AND status='running'", (message, time.time(), jid, number))
    finally:
        for key in list(studio.PROCESSES):
            if key == jid or key.startswith(jid + ':'): await studio.retire_process(key)
        if studio.job_cancelled(jid):
            studio.write("UPDATE attempts SET status='cancelled',finished=? WHERE job_id=? AND status='running'", (time.time(), jid))
        studio.STORAGE.invalidate(); studio.WAKE.set()


def register(app, studio):
    @app.get('/api/jobs/{jid}/generation-calls')
    def history(jid: str, limit: int = 30, offset: int = 0, session=Depends(studio.require_user)):
        if not studio.query('SELECT id FROM jobs WHERE id=?', (jid,), True): raise HTTPException(404)
        return calls(studio, jid, limit, offset)

    @app.get('/api/jobs/{jid}/generation-preview/{cid}')
    def preview(jid: str, cid: str, session=Depends(studio.require_user)):
        row = studio.query('SELECT detail FROM generation_calls WHERE id=? AND job_id=?', (cid, jid), True)
        if not row: raise HTTPException(404)
        value = json.loads(row['detail'])
        # Fixed app-generated call identifiers only; paths never come from a provider.
        if not re.fullmatch('[a-f0-9]{32}', cid): raise HTTPException(404)
        path = studio.DATA / 'jobs' / jid / 'generation-previews' / cid / 'preview.webp'
        if not path.is_file(): raise HTTPException(404, '尚无显影帧')
        return FileResponse(path, media_type='image/webp', headers={'Cache-Control': 'private, no-store'})

    @app.get('/api/jobs/{jid}/generation-events')
    async def events(jid: str, session=Depends(studio.require_user)):
        if not studio.query('SELECT id FROM jobs WHERE id=?', (jid,), True): raise HTTPException(404)
        async def stream():
            previous = None
            heartbeat_at = time.monotonic() + EVENT_HEARTBEAT_SECONDS
            while True:
                job = studio.query('SELECT status,generation_detail FROM jobs WHERE id=?', (jid,), True)
                if not job: return
                version = job['generation_detail'] + job['status']
                if version != previous:
                    previous = version
                    yield 'data: ' + json.dumps({'status': job['status'], 'generation': json.loads(job['generation_detail'])}) + '\n\n'
                if job['status'] in ('succeeded', 'failed', 'cancelled'): return
                if time.monotonic() >= heartbeat_at:
                    if not studio.query('SELECT token FROM sessions WHERE token=? AND expires>?', (session['token'], time.time()), True):
                        return
                    yield ': keep-alive\n\n'
                    heartbeat_at = time.monotonic() + EVENT_HEARTBEAT_SECONDS
                await asyncio.sleep(EVENT_POLL_SECONDS)
        return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})
