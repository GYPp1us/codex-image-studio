"use strict";
(() => {
  const F={job:null,data:null,level:1,selected:new Set(),pane:'affine',token:0,busy:false,injection:'',useCurrent:true,compareToken:0,compareTile:null,compareSide:'output',compareReady:false,compareReport:null,compareScroll:0};
  const dimensions=a=>a.map(n=>n.toLocaleString('en-US')).join(' × ');
  function dialog(){
    let element=document.getElementById('upscale-failure');
    if(!element){element=document.createElement('dialog');element.id='upscale-failure';element.className='upscale-failure-dialog';element.setAttribute('aria-label','超分失败处理');document.body.append(element);element.addEventListener('close',()=>{F.token++;F.compareToken++;F.compareTile=null;F.job=null;F.data=null;});}
    return element;
  }
  function overlay(){
    const [w,h]=F.data.input_size;
    return `<svg class="failure-tile-overlay" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${F.data.tiles.map(t=>{const [a,b,c,d]=t.core;return `<rect class="failure-tile-hit ${F.selected.has(t.index)?'selected':''} ${t.state==='untrusted'?'untrusted':''}" x="${a}" y="${b}" width="${c-a}" height="${d-b}" tabindex="0" role="button" aria-label="选择第 ${t.number} 块重绘" aria-pressed="${F.selected.has(t.index)}" data-action="upscale-diagnostic-toggle" data-tile="${t.index}"/>`;}).join('')}</svg>`;
  }
  function updateSelection(){
    if(!F.data)return;
    const slot=document.getElementById('failure-tile-list');
    updateHTML(slot,F.data.tiles.map(t=>`<div class="failure-tile-row"><button class="failure-tile-option ${F.selected.has(t.index)?'selected':''}" data-action="upscale-diagnostic-toggle" data-tile="${t.index}" aria-pressed="${F.selected.has(t.index)}"><span class="failure-tile-number">${t.number}</span><span><strong>${esc(t.reason)}</strong><small>${t.actual_size?dimensions(t.actual_size):'尚无返回图'}${t.missing_core_pixels?` · 缺失 ${t.missing_core_pixels.toLocaleString('en-US')} px`:''}</small></span><span>${F.selected.has(t.index)?'✓':'+'}</span></button><button class="failure-tile-compare" data-action="upscale-diagnostic-compare" data-tile="${t.index}" aria-label="对比第 ${t.number} 块的输入输出" title="对比输入与输出">对比</button></div>`).join(''));
    document.querySelectorAll('#upscale-failure .failure-overlay-slot').forEach(slot=>updateHTML(slot,overlay()));
    const count=document.getElementById('failure-selected-count');if(count)count.textContent=`已选 ${F.selected.size} 块 · 本级至少 ${F.selected.size} 次生图 + 1 次验收`;
    const remaining=F.data.tiles.filter(t=>t.state!=='ready'&&!F.selected.has(t.index)).length,concurrency=globalThis.S?.config?.concurrency|| (typeof S!=='undefined'?S.config?.concurrency:2)||2;
    const note=document.getElementById('failure-selection-note');if(note)note.innerHTML=`${remaining?`还有 ${remaining} 个问题块未选中，仍可能阻止本级完成。<br>`:''}${F.selected.size>concurrency?`已选块数超过 ${concurrency} 路并发，将分批处理。<button class="link-btn" data-action="settings-section" data-section="queue">调整并发 ›</button><br>`:''}最多 ${F.selected.size*(F.job?.max_attempts||3)} 次本级生图尝试；后续级按工作区预算重新执行。`;
    const submit=document.getElementById('failure-redraw-submit');if(submit)submit.disabled=F.busy||!F.selected.size;
  }
  function paintComparison(){
    const slot=document.getElementById('failure-tile-comparison');if(!slot||!F.compareReport)return;
    slot.querySelectorAll('[data-compare-side]').forEach(img=>img.classList.toggle('hidden',img.dataset.compareSide!==F.compareSide));
    slot.querySelector('#failure-compare-current').textContent=F.compareSide==='output'?'当前：超分输出':'当前：超分输入';
    const button=slot.querySelector('#failure-compare-switch');button.textContent=F.compareReport.output_size?(F.compareSide==='output'?'切换到输入':'切换到输出'):'尚无输出';
    button.disabled=!F.compareReady||!F.compareReport.output_size;
  }
  function closeComparison(){
    F.compareToken++;F.compareTile=null;F.compareReport=null;
    document.getElementById('failure-overview')?.classList.remove('hidden');
    const slot=document.getElementById('failure-tile-comparison');if(slot){slot.classList.add('hidden');slot.innerHTML='';}
    const body=document.getElementById('failure-body');if(body)body.scrollTop=F.compareScroll;
  }
  async function compare(index){
    const tile=F.data?.tiles.find(t=>t.index===index);if(!tile)return;
    const body=document.getElementById('failure-body');if(F.compareTile===null){F.compareScroll=body.scrollTop;if(globalThis.StudioLayers)StudioLayers.push('comparison',closeComparison);}
    const token=++F.compareToken,job=F.job.id,level=F.level;F.compareTile=index;F.compareReady=false;F.compareReport=null;
    const slot=document.getElementById('failure-tile-comparison');document.getElementById('failure-overview').classList.add('hidden');slot.classList.remove('hidden');
    const heading=`<div class="failure-compare-toolbar"><button class="btn secondary" data-action="upscale-diagnostic-compare-back">← 返回诊断</button><h3>第 ${tile.number} 块 · 输入输出对比</h3></div>`;
    slot.innerHTML=heading+'<p class="failure-loading"><span class="spinner"></span> 正在加载图块对比…</p>';body.scrollTop=0;
    try{
      const report=await api(`/api/upscale/jobs/${job}/comparison?level=${level}&tile=${index}`);
      if(token!==F.compareToken||F.job?.id!==job||F.level!==level)return;
      F.compareReport=report;F.compareSide=report.output_size?'output':'input';
      slot.innerHTML=heading+`<div class="failure-compare-status"><strong id="failure-compare-current"></strong><button class="btn primary" id="failure-compare-switch" data-action="upscale-diagnostic-compare-flip" disabled>切换到输入</button></div><div class="failure-compare-frame"><img class="failure-compare-layer" data-compare-side="input" src="${esc(report.images.input)}" alt="第 ${tile.number} 块超分输入">${report.images.output?`<img class="failure-compare-layer" data-compare-side="output" src="${esc(report.images.output)}" alt="第 ${tile.number} 块超分输出">`:''}</div><div class="failure-compare-sizes"><span>输入 ${dimensions(report.input_size)}</span><span>要求输出 ${dimensions(report.expected_size)}</span><span>实际输出 ${report.output_size?dimensions(report.output_size):'暂无'}</span></div><p class="small muted" id="failure-compare-load" role="status">正在加载对比图…</p>`;
      paintComparison();
      const images=[...slot.querySelectorAll('img')];let pending=images.length,failed=false;
      function loaded(error){
        if(token!==F.compareToken)return;
        failed=failed||error;pending--;
        if(failed){slot.querySelector('#failure-compare-load').textContent='图块预览加载失败，请返回后重试。';F.compareReady=false;}
        else if(!pending){F.compareReady=true;slot.querySelector('#failure-compare-load').textContent=report.output_size?'完整输入（含重叠）与模型原始返回，按各自画幅等比显示。':'本块尚无输出，可以先查看输入图块。';}
        paintComparison();
      }
      for(const img of images){
        if(img.complete)loaded(!img.naturalWidth);
        else{img.addEventListener('load',()=>loaded(false),{once:true});img.addEventListener('error',()=>loaded(true),{once:true});}
      }
    }catch(error){if(token===F.compareToken)slot.innerHTML=heading+`<p class="notice error">${esc(error.message)}</p>`;}
  }
  function content(){
    const d=F.data;
    const panels=[['source','原图对照','仅放大显示，比较原始几何'],['raw','按目标大小直接拼接','观察内容偏移与接缝'],['affine','仿射诊断预览','红色＝缺失；橙框＝低可信块']];
    return `<div class="failure-layout"><main class="failure-visuals"><section id="failure-overview"><p class="failure-dimensions">第 ${F.level} 级 · ${dimensions(d.input_size)} → ${dimensions(d.output_size)}</p><div class="failure-panel-tabs">${panels.map(([key,name])=>`<button data-action="upscale-diagnostic-pane" data-pane="${key}" class="${F.pane===key?'active':''}">${name}</button>`).join('')}</div><div class="failure-panels">${panels.map(([key,name,caption])=>`<section class="failure-panel ${F.pane===key?'active':''}" data-pane="${key}"><h3>${name}</h3><p>${caption}</p><div class="failure-image-wrap"><img src="${esc(d.images[key])}" width="${d.preview_size[0]}" height="${d.preview_size[1]}" alt="${name}">${key==='source'?'':'<div class="failure-overlay-slot"></div>'}</div></section>`).join('')}</div><div class="failure-zoom-row"><section><h3>顶部缺边放大</h3><img src="${esc(d.images.top)}" alt="仿射后顶部缺失像素"></section><section><h3>中心接缝放大</h3><div class="failure-center-zooms"><figure><figcaption>直接拼接</figcaption><img src="${esc(d.images['center-raw'])}" alt="直接拼接的中心接缝"></figure><figure><figcaption>仿射诊断</figcaption><img src="${esc(d.images['center-affine'])}" alt="仿射诊断的中心接缝"></figure></div></section></div><p class="small muted">诊断强制预览：未通过的块仍会展示估计位置；尚未执行色调匹配、接缝融合或视觉验收。</p></section><section id="failure-tile-comparison" class="hidden" aria-label="图块输入输出对比"></section></main><aside class="failure-controls"><div class="row between"><h3>选择重绘块</h3><button class="link-btn" data-action="upscale-diagnostic-problems">选择问题块</button></div><p class="small muted">点击图块或列表选择，未选中的返回图会保留。</p><div class="failure-selection-tools"><button class="link-btn" data-action="upscale-diagnostic-all">全选</button><button class="link-btn" data-action="upscale-diagnostic-clear">清除</button></div><div id="failure-tile-list"></div><p id="failure-selection-note" class="failure-selection-note"></p><label for="failure-injection">本任务统一细节与画风约束</label><textarea id="failure-injection" rows="5" maxlength="12000" placeholder="输入统一的线稿、色彩、材质和细节要求…">${esc(F.injection)}</textarea><label class="failure-current-prompt"><input type="checkbox" id="failure-current-prompt" ${F.useCurrent?'checked':''}>使用设置中最新的超分提示词</label><p class="small muted">本级重绘通过后，后续级会基于新结果重新执行。</p></aside></div>`;
  }
  async function load(level){
    const draft=document.getElementById('failure-injection');if(draft)F.injection=draft.value;const current=document.getElementById('failure-current-prompt');if(current)F.useCurrent=current.checked;
    const token=++F.token;F.compareToken++;F.compareTile=null;F.compareReport=null;F.level=level;F.data=null;F.selected.clear();
    document.getElementById('failure-body').innerHTML='<div class="failure-loading"><span class="spinner"></span> 正在渲染检查点诊断图…</div>';
    document.getElementById('failure-redraw-submit').disabled=true;
    try{
      const data=await api(`/api/upscale/jobs/${F.job.id}/diagnostics?level=${level}`);if(token!==F.token||!F.job)return;
      F.data=data;document.getElementById('failure-body').innerHTML=content();updateSelection();
      document.querySelectorAll('#upscale-failure [data-action=upscale-diagnostic-level]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.level)===level));
    }catch(error){if(token===F.token)document.getElementById('failure-body').innerHTML=`<p class="notice error">${esc(error.message)}</p>`;}
  }
  async function open(id){
    const job=await api(`/api/upscale/jobs/${id}`);closeModal();F.job=job;F.busy=false;F.pane='affine';F.injection=job.options.upscale_injection||'';F.useCurrent=true;
    const stages=(job.upscale_plan?.stages||[]).filter(s=>s.diagnostic_available);
    const element=dialog();element.innerHTML=`<header class="failure-head"><div><h2>失败处理 · 选块重绘</h2><p>${esc(job.error||'查看现有检查点')}</p></div><button class="icon-btn" data-action="upscale-diagnostic-close" aria-label="关闭失败处理">${icon('close')}</button></header><nav class="failure-levels" aria-label="选择超分级别">${stages.map(s=>`<button data-action="upscale-diagnostic-level" data-level="${s.index}">第 ${s.index} 级</button>`).join('')}</nav><div id="failure-body" class="failure-body"></div><footer class="failure-footer"><span id="failure-selected-count">选择要重绘的块</span><button class="btn primary" id="failure-redraw-submit" data-action="upscale-diagnostic-submit" disabled>重绘选中块并继续</button></footer>`;
    element.showModal();if(globalThis.StudioLayers)StudioLayers.push('failure',()=>element.close());element.oncancel=event=>{event.preventDefault();if(globalThis.StudioLayers)StudioLayers.close();else element.close();};
    if(!stages.length){document.getElementById('failure-body').innerHTML='<p class="notice">本任务尚无可用的分块检查点，或缓存已清理。</p>';return;}
    const level=stages.find(s=>s.status==='failed')?.index||stages.at(-1).index;await load(level);
  }
  async function action(name,element){
    if(F.busy&&name!=='upscale-diagnostic-close')return;
    if(name==='upscale-diagnostic-open')return await open(element.dataset.id);
    if(name==='upscale-diagnostic-close'){if(globalThis.StudioLayers)StudioLayers.close();else dialog().close();return;}
    if(name==='upscale-diagnostic-level'){if(globalThis.StudioLayers?.top==='comparison')StudioLayers.close('comparison');return await load(Number(element.dataset.level));}
    if(name==='upscale-diagnostic-compare')return await compare(Number(element.dataset.tile));
    if(name==='upscale-diagnostic-compare-back'){if(globalThis.StudioLayers)StudioLayers.close('comparison');else closeComparison();return;}
    if(name==='upscale-diagnostic-compare-flip'){
      if(F.compareReady&&F.compareReport?.output_size){F.compareSide=F.compareSide==='output'?'input':'output';paintComparison();}return;
    }
    if(name==='upscale-diagnostic-toggle'){
      const index=Number(element.dataset.tile);if(!F.data?.tiles.some(t=>t.index===index))return;
      if(F.selected.has(index))F.selected.delete(index);else F.selected.add(index);updateSelection();
    }else if(name==='upscale-diagnostic-problems'){
      F.selected=new Set(F.data.tiles.filter(t=>t.state!=='ready').map(t=>t.index));updateSelection();
    }else if(name==='upscale-diagnostic-all'||name==='upscale-diagnostic-clear'){
      F.selected=new Set(name==='upscale-diagnostic-all'?F.data.tiles.map(t=>t.index):[]);updateSelection();
    }else if(name==='upscale-diagnostic-pane'){
      F.pane=element.dataset.pane;document.querySelectorAll('#upscale-failure [data-pane]').forEach(p=>p.classList.toggle('active',p.dataset.pane===F.pane));
    }else if(name==='upscale-diagnostic-submit'){
      if(!F.selected.size||F.busy)return;F.busy=true;updateSelection();
      try{
        const id=F.job.id;await post(`/api/upscale/jobs/${id}/redraw`,{level:F.level,tiles:[...F.selected],upscale_injection:document.getElementById('failure-injection').value,use_current_prompt:document.getElementById('failure-current-prompt').checked});
        if(globalThis.StudioLayers){if(StudioLayers.top==='comparison')StudioLayers.close('comparison');StudioLayers.close('failure');}else dialog().close();toast('已加入选块重绘队列');await StudioUpscale.openJob(id);
      }catch(error){toast(error.message);}finally{F.busy=false;updateSelection();}
    }
  }
  document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches?.('.failure-tile-hit')){event.preventDefault();action('upscale-diagnostic-toggle',event.target);}});
  globalThis.StudioUpscaleFailure={open,action};
})();
