"""Generate extreme-size or common-aspect comparison tables without image calls."""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from stitch_planner import Policy, progressive_plan

EXTREME_CASES=[('极小方图',32,32),('极小横图',64,16),('极小竖图',16,64),
       ('极瘦横图',8192,64),('极瘦竖图',64,8192),('粉色原图',1056,1490),
       ('蓝色原图',941,1672),('6400万边界',1000,1000),
       ('大正方形',4096,4096),('大横图',8192,2048)]

COMMON_CASES=[('近1:1',1001,997),('近4:3',1365,1024),('近3:4',1024,1365),
              ('近3:2',1535,1023),('近2:3',1023,1535),('近16:9',1673,941),
              ('近9:16',941,1673),('近1:√2',1053,1489),('近16:10',1587,992),
              ('近5:4',1403,1122),('近9:20',843,1873),('近21:9',1917,821)]


def size(value):return '×'.join(map(str,value))
def grid(stage):return f"{stage['columns']}×{stage['rows']}"
def budget(plan):return f"{plan['budget']['images']} 生图＋{plan['budget']['reviews']} 验收"


def seam_text(stage):
    values=[v for v in stage['old_seam_coverage'].values() if v]
    return f"{sum(v['inside_central_half'] for v in values)}/{sum(v['total'] for v in values)}" if values else '—'


def diagram(plan):
    """Compare old and new seam positions on the same normalized full canvas."""
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="530" viewBox="0 0 1000 530">',
           '<rect width="1000" height="530" fill="#f6f5f1"/>',
           '<style>text{font-family:Segoe UI,Microsoft YaHei,sans-serif;fill:#29372e} .new{stroke:#267252;stroke-width:1.4}.old{stroke:#da6d46;stroke-width:1.7;stroke-dasharray:5 4}</style>',
           f'<text x="25" y="30" font-size="20">{size(plan["input_size"])}：每级重新切完整图</text>',
           '<text x="25" y="55" font-size="13">绿色：本级核心边界　橙色虚线：上一级接缝　浅绿色：一个完整裁图（含重叠）</text>']
    old={'x':[],'y':[]}
    for i,stage in enumerate(plan['stages']):
        w,h=stage['input_size'];scale=min(265/w,345/h);left=45+i*325;top=120;dw,dh=w*scale,h*scale
        parts.append(f'<text x="{left}" y="90" font-size="16">第 {i+1} 级 · {grid(stage)} · {stage["tile_count"]} 块</text>')
        parts.append(f'<rect x="{left}" y="{top}" width="{dw}" height="{dh}" fill="#fff" stroke="#c4c9bf"/>')
        ax,ay=stage['axes']['x'],stage['axes']['y'];x0,x1=ax['crops'][len(ax['crops'])//2];y0,y1=ay['crops'][len(ay['crops'])//2]
        parts.append(f'<rect x="{left+x0*scale}" y="{top+y0*scale}" width="{(x1-x0)*scale}" height="{(y1-y0)*scale}" fill="#a8d5b6" fill-opacity=".55"/>')
        for key,axis in (('x',ax),('y',ay)):
            for v in axis['cuts'][1:-1]:
                coords=f'x1="{left+v*scale}" y1="{top}" x2="{left+v*scale}" y2="{top+dh}"' if key=='x' else f'x1="{left}" y1="{top+v*scale}" x2="{left+dw}" y2="{top+v*scale}"'
                parts.append(f'<line class="new" {coords}/>')
            for v in old[key]:
                coords=f'x1="{left+v*scale}" y1="{top}" x2="{left+v*scale}" y2="{top+dh}"' if key=='x' else f'x1="{left}" y1="{top+v*scale}" x2="{left+dw}" y2="{top+v*scale}"'
                parts.append(f'<line class="old" {coords}/>')
        parts.append(f'<text x="{left}" y="485" font-size="12">输入 {size(stage["input_size"])} → 输出 {size(stage["output_size"])}</text>')
        parts.append(f'<text x="{left}" y="507" font-size="12">完整裁图 {size(stage["crop_size"])}；旧缝居中 {seam_text(stage)}</text>')
        old=stage['output_seams']
    parts.append('</svg>')
    return '\n'.join(parts)


def build(output,suite='extreme'):
    cases=COMMON_CASES if suite=='common' else EXTREME_CASES
    policy=Policy();matrix=[]
    for name,w,h in cases:
        for factor in (4,16,64):
            matrix.append({'name':name,**progressive_plan(w,h,factor,policy=policy)})
    output.mkdir(parents=True,exist_ok=True)
    (output/'plans.json').write_text(json.dumps(matrix,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    rows=[]
    for plan in matrix:
        # Prefix stages are identical across final multipliers, so list each once.
        if plan['factor']!=64:continue
        for stage in plan['stages']:
            prefix=next(p for p in matrix if p['input_size']==plan['input_size'] and p['factor']==4**stage['index'])
            rows.append({'case':plan['name'],'original':size(plan['input_size']),
                         'original_ratio':plan['input_size'][0]/plan['input_size'][1],'stage':stage['index'],
                         'factor':4**stage['index'],'input':size(stage['input_size']),
                         'grid':grid(stage),'full_crop':size(stage['crop_size']),
                         'tile_target':size(stage['tile_output_size']),
                         'tile_target_pixels':stage['tile_output_pixels'],
                         'result':size(stage['output_size']),'images':stage['tile_count'],'reviews':1,
                         'cumulative_images':prefix['budget']['images'],
                         'cumulative_reviews':prefix['budget']['reviews'],
                         'max_cumulative_calls':prefix['budget']['max_calls'],
                         'seam_center_coverage':seam_text(stage),
                         'current_limits':'通过' if prefix['executable_with_current_limits'] else '超限',
                         'limit_reason':'；'.join(prefix['limits'])})
    csv_file=io.StringIO(newline='');writer=csv.DictWriter(csv_file,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    (output/'cases.csv').write_text(csv_file.getvalue(),encoding='utf-8-sig')
    text=[f'# 渐进超分：{"常见非整数画幅" if suite=="common" else "极端尺寸"}试算','',
          '仅计算尺寸、切图坐标与调用预算；没有调用模型、处理真实图片或修改线上服务。',
          '', '## 参数与选择顺序','',
          f'- 单次原生返回像素预算暂按 {policy.native_pixels:,}（约157万）计；这是现有链路的观测值。',
          f'- 暂留宽高各10%余量，单块目标最多 {policy.tile_output_limit:,} 像素，含重叠输入最多 {policy.tile_output_limit//4:,} 像素。余量可通过 Policy 调整。',
          '- 每级宽高乘2；4×、16×、64×面积对应1、2、3级。每级重新切完整的上一级结果。',
          '- 所有完整裁图长短边比不超过2；小图不为逼近4:3增加块数。大图允许短方向超过2块。',
          '- 候选切法优先减少调用，同预算优先让更多旧接缝进入新图块中央，再考虑接近横向4:3。',
          '- 常规相邻重叠为完整裁图的20%；像素取整允许小偏差。根据旧缝坐标选择0、1/4、1/2、3/4步偏移，额外首尾窗口会提高边缘重叠，调用数已计入。',
          '- 旧缝“居中”表示落入某张新裁图中央50%区域；它只衡量修复机会，不保证模型能修好。',
          '- 基础预算＝每块1次生图＋每级1次验收；最高预算按每块最多3次尝试计算，不含新原图生成、人工局部修复和再次手动重试。',
          '- 不设单图像素或边长上限，实际执行受总存储限额和可用资源约束。',
          '', f'## {len(cases)}组尺寸与三档倍率','',
          '网格按 **列×行**；箭头表示每一级重新切图。括号内为总生图数＋验收数。',
          '', '| 原图 | 实际宽高比 | 4× | 16× | 64× |', '|---|---|---|---|---|']
    for name,w,h in cases:
        cells=[]
        for factor in (4,16,64):
            plan=next(p for p in matrix if p['input_size']==[w,h] and p['factor']==factor)
            cells.append('→'.join(grid(s) for s in plan['stages'])+f"（{plan['budget']['images']}＋{plan['budget']['reviews']}）"+(' ⚠超限' if not plan['executable_with_current_limits'] else ''))
        text.append(f'| {name} {w}×{h} | {w/h:.5f} | '+' | '.join(cells)+' |')
    text+=['','## 每级尺寸与预算','',
           '完整裁图列已经包含重叠。超限行是数学试算。极小裁图虽满足几何约束，实际配准纹理及生图质量仍未验证。','',
           '| 原图 | 级/累计面积 | 本级输入 | 网格 | 完整裁图→单块目标 | 本级完整结果 | 本级生图＋验收 | 累计生图＋验收 | 最多累计调用 | 旧缝居中 | 当前限额 |',
           '|---|---|---|---|---|---|---|---|---|---|---|']
    for row in rows:
        text.append(f"| {row['original']} | {row['stage']}/{row['factor']}× | {row['input']} | {row['grid']} | {row['full_crop']}→{row['tile_target']} | {row['result']} | {row['images']}＋1 | {row['cumulative_images']}＋{row['cumulative_reviews']} | {row['max_cumulative_calls']} | {row['seam_center_coverage']} | {row['current_limits']} |")
    text+=['','## 观察','']
    if suite=='extreme':
        text+=['- 32×32方图三个阶段都整图处理，没有为了4:3把极小图拆碎。',
               '- 8192×64及其转置受2:1比例约束，第一阶段需要80块，但单块只用约2%的原生像素预算；几何可行，调用效率很差。']
    else:
        text+=['- 样本覆盖近方形、相机横竖画幅、宽屏、纸张、长屏和带状宽屏，使用奇数或不整除的实际尺寸检查取整。',
               '- 全部采用与极端尺寸组相同的20%重叠和10%边长余量，没有针对样本修改算法。',
               '- 横竖转置的调用数可能不同：同预算下仍偏好横向4:3，后续级还会按旧接缝坐标选择网格。']
    text+=['- 大图每级会重新增加图块，而不是把第一轮小块各自持续放大。',
           '- 旧接缝不一定全部进入新块中央，不能把“重新切图”当作已经修复接缝。逐级坐标评分比机械半步偏移更可靠，但仍需要真实图片验证。',
           '', '## 重新切图示意','',
           '下图只画几何网格，没有执行生图；示意图仅用于观察各级切法。','',
           '![每级新旧接缝位置](grids.svg)','',
           '## 复现','', '```powershell',f'python scripts/preview_stitch_plan.py --suite {suite}',
           'python stitch_planner.py 1056 1490 16',
           'python -m unittest discover -s tests -p test_stitch_planner.py -v','```','',
           '[完整坐标与预算 JSON](plans.json) · [每级切法 CSV](cases.csv)']
    (output/'README.md').write_text('\n'.join(text)+'\n',encoding='utf-8')
    illustrated=next(p for p in matrix if p['input_size']==([1053,1489] if suite=='common' else [1056,1490]) and p['factor']==64)
    (output/'grids.svg').write_text(diagram(illustrated),encoding='utf-8')
    print(json.dumps({'examples':len(cases),'combinations':len(matrix),'stage_rows':len(rows),
                      'report':str(output/'README.md'),
                      'max_tile_pixels':max(s['tile_output_pixels'] for p in matrix for s in p['stages']),
                      'limit':policy.tile_output_limit},ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite',choices=('extreme','common'),default='extreme')
    parser.add_argument('--output-dir',type=Path)
    args=parser.parse_args()
    build(args.output_dir or ROOT/'docs'/('common-ratios-prototype' if args.suite=='common' else 'progressive-prototype'),args.suite)
