"""Dimension-only prototype; never generates images or touches production.

Every stage retiles the complete previous result and doubles both axes. Prefer
few calls, then landscape 4:3. Full crops must be at most 2:1 in either
orientation and fit the pixel budget including overlap. Offsets are selected
from old seam coordinates; extra edge windows are included in the call budget.
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass


class PlanError(ValueError):
    pass


@dataclass(frozen=True)
class Policy:
    native_pixels: int = 1536 * 1024  # Observed return size, not a model-wide limit.
    overlap: float = .20
    safety: float = .90             # Proposed 10% reserve on each output axis.
    max_aspect: float = 2.0
    preferred_aspect: float = 4 / 3
    max_canvas_pixels: int = 0  # 0 means no application-level image dimension cap.
    max_canvas_edge: int = 0
    max_attempts: int = 3

    def __post_init__(self):
        if (type(self.native_pixels) is not int or self.native_pixels < 4
                or not 0 <= self.overlap < .5 or not 0 < self.safety <= 1
                or self.max_aspect < 1 or self.preferred_aspect <= 0
                or type(self.max_attempts) is not int or self.max_attempts < 1
                or self.max_canvas_pixels < 0 or self.max_canvas_edge < 0):
            raise PlanError('无效的规划参数')

    @property
    def tile_output_limit(self):
        return math.floor(self.native_pixels * self.safety ** 2)


def _span(length, count, overlap):
    return math.ceil(length / (count * (1 - overlap) + overlap) - 1e-10)


def _count(length, maximum_span, overlap):
    if maximum_span < 1:
        raise PlanError('单块像素预算不足')
    count = max(1, math.ceil((length / maximum_span - overlap) / (1 - overlap) - 1e-10))
    while _span(length, count, overlap) > maximum_span:
        count += 1
    return count


def _axis(length, count, overlap, phase=0):
    """Equal-size full crops, with no padding outside the image.

    Ordinary overlap is 20%, subject to pixel rounding. Nonzero offsets add
    edge windows, whose overlaps can be larger than 20%.
    """
    span = _span(length, count, overlap)
    if count == 1 or span == length:
        starts = [0]
    else:
        stride = (length - span) / (count - 1)
        interior = [(i + phase) * stride for i in range(count - 1)] if phase else [i * stride for i in range(1, count - 1)]
        starts = sorted({0, length - span, *(round(x) for x in interior)})
    crops = [[start, start + span] for start in starts]
    cuts = [0] + [(crops[i][1] + crops[i + 1][0]) // 2 for i in range(len(crops) - 1)] + [length]
    if any(cuts[i] >= cuts[i + 1] for i in range(len(cuts) - 1)):
        raise PlanError('图像像素不足以形成不同的核心区')
    ratios = [(crops[i][1] - crops[i + 1][0]) / span for i in range(len(crops) - 1)]
    return {'span': span, 'crops': crops, 'cuts': cuts, 'count': len(crops),
            'base_count': count, 'phase': phase if count > 1 else 0,
            'overlap_range': [min(ratios), max(ratios)] if ratios else None}


def _best_axis(length, count, overlap, old_seams):
    candidates=[]
    for phase in ((0,.25,.5,.75) if old_seams and count>1 else (0,)):
        try:axis=_axis(length,count,overlap,phase)
        except PlanError:continue
        clearance=[max(min(seam-left,right-seam)/axis['span'] for left,right in axis['crops']) for seam in old_seams]
        score=(-sum(x>=.25 for x in clearance),axis['count'],-sum(clearance))
        candidates.append((score,axis))
    if not candidates:raise PlanError('像素取整后没有有效核心区')
    return min(candidates,key=lambda c:c[0])[1]


def _grid(width, height, policy, old_seams):
    input_limit = policy.tile_output_limit // 4
    if input_limit < 1:
        raise PlanError('预留余量后无法规划图块')
    # A constructive near-square cover bounds the minimum-call search.
    side = max(1, min(math.isqrt(input_limit), 2 * min(width, height)))
    upper_x = _count(width,side,policy.overlap)
    upper_y = _count(height,side,policy.overlap)
    upper_calls = (upper_x+int(upper_x>1 and bool(old_seams['x'])))*(upper_y+int(upper_y>1 and bool(old_seams['y'])))
    if upper_calls > 100_000:
        raise PlanError('本次计划超过 10 万次生图，请拆分为多个超分任务')
    small = width * height <= input_limit
    best = None
    for rows in range(1, min(height, upper_calls) + 1):
        crop_height = _span(height, rows, policy.overlap)
        maximum_width = min(input_limit // crop_height, math.floor(crop_height * policy.max_aspect))
        if maximum_width < 1:
            continue
        minimum_columns = _count(width, maximum_width, policy.overlap)
        for columns in (minimum_columns,minimum_columns+1):
            if columns>width or columns*rows>upper_calls or (small and min(columns,rows)>2):continue
            crop_width=_span(width,columns,policy.overlap)
            if crop_height>crop_width*policy.max_aspect:continue
            try:
                ax=_best_axis(width,columns,policy.overlap,old_seams['x'])
                ay=_best_axis(height,rows,policy.overlap,old_seams['y'])
            except PlanError:continue
            calls=ax['count']*ay['count']
            if calls>upper_calls:continue
            coverage=[_seam_coverage(old_seams[key],axis) for key,axis in (('x',ax),('y',ay)) if old_seams[key]]
            covered=sum(c['inside_central_half'] for c in coverage)
            score=(calls,-covered,abs(math.log((crop_width/crop_height)/policy.preferred_aspect)))
            if best is None or score<best[0]:best=score,ax,ay
    if best is None:
        raise PlanError('没有满足比例与原生像素预算的切法')
    return best[1], best[2], small


def _seam_coverage(old_seams, axis):
    if not old_seams:
        return None
    covered = sum(any(min(seam - left, right - seam) >= axis['span'] * .25
                      for left, right in axis['crops']) for seam in old_seams)
    return {'total': len(old_seams), 'inside_central_half': covered,
            'fraction': covered / len(old_seams)}


def stage_layout(width, height, *, policy=Policy(), index=1, old_seams=None):
    old_seams = old_seams or {'x': [], 'y': []}
    ax, ay, small = _grid(width, height, policy, old_seams)
    count = ax['count'] * ay['count']
    warnings = []
    if min(ax['span'], ay['span']) < 48:
        warnings.append('裁图短边小于 48px：几何可切，不保证有足够纹理做稳定配准')
    return {'index': index, 'input_size': [width, height], 'output_size': [width * 2, height * 2],
            'scale': 2, 'small_image_policy': small, 'columns': ax['count'], 'rows': ay['count'],
            'axes': {'x': ax, 'y': ay}, 'tile_count': count,
            'crop_size': [ax['span'], ay['span']], 'tile_output_size': [ax['span'] * 2, ay['span'] * 2],
            'tile_output_pixels': ax['span'] * ay['span'] * 4,
            'tile_output_limit': policy.tile_output_limit,
            'pixel_utilization': ax['span'] * ay['span'] * 4 / policy.native_pixels,
            'old_seam_coverage': {axis: _seam_coverage(old_seams[axis], a) for axis, a in (('x', ax), ('y', ay))},
            'output_seams': {'x': [x * 2 for x in ax['cuts'][1:-1]], 'y': [y * 2 for y in ay['cuts'][1:-1]]},
            'budget': {'images': count, 'reviews': 1, 'calls': count + 1,
                       'max_calls': count * policy.max_attempts + 1}, 'warnings': warnings}


def iter_tiles(stage):
    """Lazy crop coordinates; disjoint cores partition the complete input."""
    ax, ay = stage['axes']['x'], stage['axes']['y']
    for row, (top, bottom) in enumerate(ay['crops']):
        for column, (left, right) in enumerate(ax['crops']):
            yield {'index': row * ax['count'] + column, 'row': row, 'column': column,
                   'box': [left, top, right, bottom],
                   'core': [ax['cuts'][column], ay['cuts'][row], ax['cuts'][column + 1], ay['cuts'][row + 1]],
                   'corner': [left * 2, top * 2], 'size': [(right - left) * 2, (bottom - top) * 2]}


def progressive_plan(width, height, factor, *, policy=Policy()):
    if type(width) is not int or type(height) is not int or min(width, height) < 1:
        raise PlanError('宽高必须是正整数')
    if type(factor) is not int or factor not in (4, 16, 64):
        raise PlanError('面积倍率只支持 4×、16×、64×')
    scale = math.isqrt(factor)
    target = [width * scale, height * scale]
    limits = []
    if policy.max_canvas_pixels and target[0] * target[1] > policy.max_canvas_pixels:
        limits.append(f'结果 {target[0] * target[1]:,} 像素，超过当前 {policy.max_canvas_pixels:,} 像素画布上限')
    if policy.max_canvas_edge and max(target) > policy.max_canvas_edge:
        limits.append(f'结果最长边 {max(target):,}px，超过当前 {policy.max_canvas_edge:,}px 上限')
    stages = []
    current = [width, height]
    seams = {'x': [], 'y': []}
    for index in range(1, {4: 1, 16: 2, 64: 3}[factor] + 1):
        stage = stage_layout(*current, policy=policy, index=index, old_seams=seams)
        stages.append(stage)
        current, seams = stage['output_size'], stage['output_seams']
    total_images = sum(s['tile_count'] for s in stages)
    return {'version':2, 'input_size': [width, height], 'factor': factor, 'output_size': target,
            'policy': asdict(policy), 'executable_with_current_limits': not limits, 'limits': limits,
            'stages': stages, 'budget': {'images': total_images, 'reviews': len(stages),
                                       'calls': total_images + len(stages),
                                       'max_calls': total_images * policy.max_attempts + len(stages)}}


def public_plan(plan):
    value={k:v for k,v in plan.items() if k not in ('stages','active_folder')}
    value['stages']=[]
    for stage in plan['stages']:
        public={k:v for k,v in stage.items() if k not in ('axes','output_seams','tiles','folder','input_sha256')}
        public['cuts']={key:axis['cuts'][1:-1] for key,axis in stage['axes'].items()}
        value['stages'].append(public)
    return value


def execution_plan(stage):
    return {**stage,'width':stage['input_size'][0],'height':stage['input_size'][1],
            'min_native_ratio':.95,'tiles':list(iter_tiles(stage)),'bands':7,'adaptive_splits':[]}


def split_tile(plan,index):
    """Refine just one undersized return; accepted neighbours keep their checkpoints."""
    parent=next(tile for tile in plan['tiles'] if tile['index']==index)
    depth=parent.get('depth',0)
    if depth>=2:raise PlanError('本块已细分两次，工具原生输出仍不足；请查看返回尺寸后重试')
    x0,y0,x1,y1=parent['core']
    if min(x1-x0,y1-y0)<32:raise PlanError('本块已过小，无法继续可靠细分')
    xs=[x0,(x0+x1)//2,x1];ys=[y0,(y0+y1)//2,y1]
    next_index=max(t['index'] for t in plan['tiles'])+1
    children=[];width,height=plan['input_size']
    for row in range(2):
        for col in range(2):
            a,b,c,d=xs[col],ys[row],xs[col+1],ys[row+1]
            hx,hy=math.ceil((c-a)*.125),math.ceil((d-b)*.125)
            left,right=max(0,a-hx),min(width,c+hx);top,bottom=max(0,b-hy),min(height,d+hy)
            # Expand context on the short axis if an edge core became too narrow.
            if right-left>2*(bottom-top):
                extra=math.ceil(((right-left)/2-(bottom-top))/2);top=max(0,top-extra);bottom=min(height,bottom+extra)
            if bottom-top>2*(right-left):
                extra=math.ceil(((bottom-top)/2-(right-left))/2);left=max(0,left-extra);right=min(width,right+extra)
            children.append({'index':next_index+len(children),'parent_index':index,'depth':depth+1,
                             'row':parent['row'],'column':parent['column'],'core':[a,b,c,d],
                             'box':[left,top,right,bottom],'corner':[left*2,top*2],
                             'size':[(right-left)*2,(bottom-top)*2]})
    plan['tiles']=[t for t in plan['tiles'] if t['index']!=index]+children
    plan['tile_count']=len(plan['tiles'])
    plan.setdefault('adaptive_splits',[]).append({'parent':index,'children':[t['index'] for t in children],'core':parent['core']})
    return children


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('width', type=int)
    parser.add_argument('height', type=int)
    parser.add_argument('factor', type=int, choices=(4, 16, 64))
    args = parser.parse_args()
    try:
        print(json.dumps(public_plan(progressive_plan(args.width, args.height, args.factor)), ensure_ascii=False, indent=2))
    except PlanError as error:
        parser.error(str(error))
