"""Parallel independent region calls; publish only a complete, bounded composition."""
from __future__ import annotations

import asyncio
import json
import shutil
import time
from pathlib import Path

from local_edit import prepare, compose
from stitch_engine import save_json
from stitch_workflow import cli_call, ensure_active, WorkflowError


async def run(studio, jid):
    job = studio.query('SELECT * FROM jobs WHERE id=?', (jid,), True)
    options = json.loads(job['options'])
    regions = options['regions']
    original = studio.query('SELECT path FROM assets WHERE id=?', (options['source_asset_id'],), True)
    folder = studio.DATA / 'jobs' / jid
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_file = folder / 'regions.json'
    state = {'regions': [{'index': i, 'status': 'queued', 'label': '等待处理'} for i in range(len(regions))]}
    if state_file.exists():
        previous = json.loads(state_file.read_text(encoding='utf-8'))
        for index, item in enumerate(previous.get('regions', [])):
            if index < len(regions) and item.get('status') == 'succeeded' and (folder / 'regions' / str(index) / 'return.png').is_file():
                state['regions'][index] = item
    tasks = []

    def update(index=None, **changes):
        if index is not None:
            state['regions'][index].update(changes)
        save_json(state_file, state)
        studio.write("UPDATE jobs SET progress_detail=? WHERE id=? AND status!='cancelled'", (json.dumps(state), jid))

    async def region_call(index, region):
        if state['regions'][index]['status'] == 'succeeded':
            return
        work = folder / 'regions' / str(index)
        work.mkdir(parents=True, exist_ok=True)
        instruction, references, size = await asyncio.to_thread(prepare, original['path'], work, region, region['prompt'])
        request = {'prompt': instruction, 'refs': json.dumps(['context', 'original', 'selection']), 'options': json.dumps(options)}
        instruction = studio.make_instruction(request, work)
        for attempt in range(1, job['max_attempts'] + 1):
            ensure_active(studio, jid)
            update(index, status='queued', attempt=attempt, error='', label='等待并发名额')
            def report(label, active, source):
                update(index, status='running' if active else 'queued', label=label)
            try:
                studio.STORAGE.require(size[0] * size[1] * 4, '重绘区域')
                result = await cli_call(studio, jid, work, f'region-{index}-{time.time_ns()}-try-{attempt}',
                    instruction, references, options['model'], options['effort'], 'redraw', index, len(regions),
                    on_progress=report, expected_size=size, kind='local_edit')
                ensure_active(studio, jid)
                temporary = work / 'return.tmp'
                await asyncio.to_thread(shutil.copyfile, result, temporary)
                temporary.replace(work / 'return.png')
                update(index, status='succeeded', label='已完成')
                return
            except asyncio.CancelledError:
                raise
            except Exception as error:
                detail = str(getattr(error, 'detail', error))[:2000]
                update(index, status='failed', error=detail, label='区域重绘失败')
                if attempt == job['max_attempts'] or any(token in detail.lower() for token in
                        ('unauthorized', 'authentication', 'unavailable', 'usage limit', 'quota', '401', '403', '登录', '额度')):
                    raise WorkflowError(f'区域 {index + 1}：{detail}') from error
                await asyncio.sleep(min(5 * attempt, 30))

    try:
        number = job['attempt'] + 1
        studio.write("UPDATE jobs SET attempt=?,error='' WHERE id=? AND status='running'", (number, jid))
        studio.write("INSERT INTO attempts(job_id,number,status,started) VALUES (?,?,'running',?)", (jid, number, time.time()))
        save_json(folder / 'request.json', {'kind': 'regions', 'prompt': job['prompt'], 'options': options})
        update()
        tasks = [asyncio.create_task(region_call(i, region)) for i, region in enumerate(regions)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        ensure_active(studio, jid)
        errors = [result for result in results if isinstance(result, BaseException)]
        if errors:
            raise WorkflowError(str(errors[0]))
        state['composing'] = True
        update()
        source = Path(original['path'])
        for index, region in enumerate(regions):
            ensure_active(studio, jid)
            asset = studio.query('SELECT width,height FROM assets WHERE id=?', (options['source_asset_id'],), True)
            studio.STORAGE.require(asset['width'] * asset['height'] * 4, '合成区域结果')
            destination = folder / f'composed-{index}.png'
            await asyncio.to_thread(compose, source, folder / 'regions' / str(index) / 'return.png', region, destination)
            if source.parent == folder and source.name.startswith('composed-'):
                source.unlink(missing_ok=True)
            source = destination
        ensure_active(studio, jid)
        await asyncio.to_thread(studio.record_generated_image, jid, source)
        state['composing'] = False
        update()
    except asyncio.CancelledError:
        for item in state['regions']:
            if item['status'] in ('queued', 'running'):
                item.update(status='cancelled', label='已取消')
        update()
        raise
    except Exception as error:
        detail = str(getattr(error, 'detail', error))[:2000]
        studio.write("UPDATE jobs SET status='failed',error=?,finished=? WHERE id=? AND status!='cancelled'", (detail, time.time(), jid))
        studio.write("UPDATE attempts SET status='failed',error=?,finished=? WHERE job_id=? AND status='running'", (detail, time.time(), jid))
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for process_key in list(studio.PROCESSES):
            if process_key.startswith(jid + ':'):
                await studio.retire_process(process_key)
        if studio.job_cancelled(jid):
            studio.write("UPDATE attempts SET status='cancelled',finished=? WHERE job_id=? AND status='running'", (time.time(), jid))
        studio.STORAGE.invalidate()
        studio.WAKE.set()
