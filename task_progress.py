"""Read-only execution progress, shared by lists, details and inspectors.

Fractions describe observed work stages, never elapsed time or an ETA.  Writers
retain their checkpoints; projecting a response never changes execution state.
"""
from __future__ import annotations

import copy
import json

CALL_STAGES = ('sending', 'thinking', 'generating', 'receiving')
CALL_LABELS = dict(zip(CALL_STAGES, ('正在传递', '主模型正在思考', '等待生图返回', '正在回传')))
TERMINAL = ('succeeded', 'failed', 'cancelled')


def mapping(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return {}
    return copy.deepcopy(value) if isinstance(value, dict) else {}


def call_stage(label, active=True, previous='sending'):
    if not active:
        return 'queued'
    if label in CALL_STAGES:
        return label
    return next((stage for stage, text in CALL_LABELS.items() if text == label), previous if previous in CALL_STAGES else 'sending')


def call_fraction(item):
    status = item.get('status', item.get('state', 'queued'))
    if status in ('succeeded', 'done'):
        return 1.0
    stage = item.get('stage')
    return (CALL_STAGES.index(stage) + .5) / 4 if stage in CALL_STAGES else 0.0


def restart_detail(job, selection=None):
    """Keep successful checkpoints visible while a retry is queued.

    Invalidated tiles and their downstream phases are reset explicitly. Failed
    calls become queued work, rather than remaining red in the new attempt.
    """
    detail=mapping(job.get('progress_detail'))
    def reset(items, selected=None):
        for item in items:
            invalid=selected is not None and item.get('index',0)-1 in selected
            state=item.get('state',item.get('status'))
            if invalid or state not in ('done','succeeded'):
                key='state' if 'state' in item else 'status'
                item.update({key:'queued','stage':'queued','checkpoint':False,'label':'等待重试'})
                item.pop('error',None)
        return items
    if mapping(job.get('options')).get('stitch'):
        from stitch_engine import PHASES
        states=detail.get('level_states',{})
        for key,state in states.items():
            level=int(key);invalid_level=selection and level>=selection['level']
            if state.get('status')=='succeeded' and not invalid_level:continue
            chosen=set(selection['tiles']) if selection and level==selection['level'] else None
            if selection and level>selection['level']:chosen={t.get('index',0)-1 for t in state.get('tiles',[])}
            state['tiles']=reset(state.get('tiles',[]),chosen)
            phases=state.get('phases',{})
            phases={phase:value for phase,value in phases.items() if value.get('status')=='succeeded' and (not invalid_level or phase in ('base','cutting'))}
            if selection and level>selection['level']:phases={}
            state.update(status='queued',phases=phases)
            state.pop('error',None)
            work=sum(1 for phase in PHASES if phase!='redraw' and phases.get(phase,{}).get('status')=='succeeded')
            work+=sum(call_fraction(t) for t in state['tiles'])/max(1,len(state['tiles']))
            state['fraction']=work/len(PHASES)
        if selection:detail['level']=selection['level']
        current=states.get(str(detail.get('level',1)),{})
        detail.update(children=current.get('tiles',[]),fraction=sum(s.get('fraction',0) for s in states.values())/max(1,detail.get('levels',1)))
    elif mapping(job.get('options')).get('regions'):
        detail['regions']=reset(detail.get('regions',[]));detail['composing']=False
        if detail.get('composition',{}).get('status')!='succeeded':detail['composition']={'status':'queued','done':0,'units':len(detail['regions'])}
    else:return {}
    detail.update(waiting=False,active=0,source='server',stage='checkpoint_wait')
    for key in ('error','substage'):detail.pop(key,None)
    return detail


def project(job, paused=False):
    status = job.get('status', 'queued')
    options, detail = mapping(job.get('options')), mapping(job.get('progress_detail'))
    common = {'status': status, 'complete': status == 'succeeded', 'failed': status == 'failed',
              'source': detail.get('source') or job.get('stage_source') or 'server',
              'updated': detail.get('updated') or job.get('stage_updated') or job.get('created', 0)}
    if options.get('regions'):
        indexed = {item.get('index'): item for item in detail.get('regions', []) if isinstance(item, dict)}
        regions = []
        for index in range(len(options['regions'])):
            item = indexed.get(index, {'index': index, 'status': 'queued', 'label': '等待处理'})
            item['index'] = index
            item_status = item.get('status', 'queued')
            if status == 'succeeded':
                item_status = item['status'] = 'succeeded'
            if item_status == 'succeeded':
                item['stage'] = 'receiving'
            else:
                item['stage'] = item.get('stage') or call_stage(item.get('label'), item_status == 'running')
            item['fraction'] = call_fraction(item)
            regions.append(item)
        done = sum(item['status'] == 'succeeded' for item in regions)
        composition = detail.get('composition') or {'status': 'running' if detail.get('composing') else 'queued', 'done': 0, 'units': len(regions)}
        composition_fraction = 1 if composition.get('status') == 'succeeded' else composition.get('done', 0) / max(1, composition.get('units', len(regions)))
        fraction = 1 if status == 'succeeded' else (sum(item['fraction'] for item in regions) + composition_fraction) / (len(regions) + 1)
        label = '正在合成结果' if detail.get('composing') else f'{done} / {len(regions)} 个区域已完成'
        label = {'succeeded': '区域重绘完成', 'failed': '部分区域失败，已保留完成的区域', 'cancelled': '已取消'}.get(status, label)
        return {**common, 'kind': 'regions', 'regions': regions, 'composition': composition, 'stage': 'composition' if detail.get('composing') else status,
                'label': label, 'step': done, 'total': len(regions), 'fraction': fraction, 'percent': round(fraction * 100), 'indeterminate': status == 'running'}
    if options.get('stitch'):
        from stitch_engine import PHASES, LABELS
        value = {'stage': 'base', 'label': LABELS[0], 'fraction': 0, 'step': 1, 'total': len(PHASES), **detail}
        states = value.pop('level_states', {})
        value['timeline'] = [states[key] for key in sorted(states, key=lambda key: int(key))] if isinstance(states, dict) else []
        value.update(common, kind='upscale', factor=options['stitch'], stitch=True, indeterminate=bool(value.get('waiting')) and status == 'running')
        if status == 'succeeded':
            value.update(fraction=1, label='超分已完成', step=len(PHASES), waiting=False, indeterminate=False)
        elif status in ('failed', 'cancelled', 'queued', 'retrying'):
            value['label'] = {'failed': '超分失败，可从检查点重试', 'cancelled': '已取消', 'queued': '超分等待调度', 'retrying': '等待重试'}[status]
            value.update(waiting=False, indeterminate=False)
        value['percent'] = max(0, min(100, round(value.get('fraction', 0) * 100)))
        return value
    labels = {'queued': '等待调度', 'retrying': '等待重试', 'succeeded': '已完成', 'failed': '生成失败', 'cancelled': '已取消'}
    if status != 'running':
        return {**common, 'kind': 'image', 'stage': status, 'label': labels.get(status, status), 'step': 4 if status == 'succeeded' else 0,
                'total': 4, 'percent': 100 if status == 'succeeded' else 0, 'indeterminate': False}
    stage = job.get('stage') or 'sending'
    if stage == 'call_wait':
        return {**common, 'kind': 'image', 'stage': stage, 'label': '调度已暂停' if paused else '等待并发名额', 'step': 0, 'total': 4, 'percent': 0, 'indeterminate': False}
    if stage not in CALL_STAGES:
        stage = 'sending'
    return {**common, 'kind': 'image', 'stage': stage, 'label': CALL_LABELS[stage], 'step': CALL_STAGES.index(stage) + 1,
            'total': 4, 'percent': None, 'indeterminate': True}
