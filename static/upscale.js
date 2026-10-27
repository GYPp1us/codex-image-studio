"use strict";
(() => {
  const U={source:null,factor:4,plan:null,selected:null,detail:null,jobs:[],limit:30,version:0,busy:false};
  const bytes=n=>n>=1073741824?(n/1073741824).toFixed(2)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';
  const dimensions=a=>Array.isArray(a)?a.map(n=>Number(n).toLocaleString('en-US')).join(' × '):'—';
  const counts=b=>b?`${b.images} 次生图 + ${b.reviews} 次验收`:'原图生成后计算';
  const picture=a=>a?.preview||a?.thumbnail||a?.url||'';
  const set=(id,html)=>{const slot=document.getElementById(id);if(slot)updateHTML(slot,html);};
  function render(){
    $('#page').innerHTML=`<div class="upscale-page"><header class="upscale-heading"><div><span class="eyebrow">PROGRESSIVE STUDIO</span><h1>渐进超分</h1><p>逐级细化，让每一次放大都有足够的像素支撑。</p></div><button class="btn secondary" data-action="upscale-new">${icon('plus')}新建超分</button></header><div class="upscale-workspace"><main class="upscale-main"><section class="upscale-composer"><div id="upscale-source-slot"></div><div class="upscale-choices"><div><span class="section-label">最终面积倍率</span><div class="upscale-factor-picker">${[4,16,64].map(f=>`<button data-action="upscale-factor" data-factor="${f}" class="${U.factor===f?'selected':''}"><strong>${f}×</strong><span>宽高各 ${Math.sqrt(f)} 倍 · ${Math.log(f)/Math.log(4)} 级</span></button>`).join('')}</div></div><div class="upscale-controls">${modelControls('upscale')}<button class="btn primary" id="upscale-submit" data-action="upscale-start">加入超分队列${icon('arrow')}</button></div></div></section><div id="upscale-plan-slot"></div></main><aside class="upscale-history"><div class="section-label"><span>超分任务</span><span id="upscale-job-count"></span></div><div id="upscale-jobs-slot"></div><button class="link-btn" data-action="upscale-more">加载更多</button></aside></div><input type="file" id="upscale-upload" hidden accept="image/png,image/jpeg,image/webp,image/tiff"></div>`;
    paintSource();paintPlan();refresh().catch(error=>toast(error.message));
  }
  function paintSource(){
    const a=U.detail?.source_image||U.source;
    set('upscale-source-slot',a?`<div class="upscale-source-card"><img src="${esc(picture(a))}" alt="超分原图"><div><span class="eyebrow">${U.selected?'任务原图':'SOURCE IMAGE'}</span><h2>${esc(a.name||'超分原图')}</h2><p>${a.width.toLocaleString('en-US')} × ${a.height.toLocaleString('en-US')}<span>原始尺寸</span></p><button class="link-btn" data-action="upscale-choose">更换原图</button></div></div>`:`<button class="upscale-empty-source" data-action="upscale-choose">${icon('layers')}<strong>选择一张图片开始</strong><span>从作品或图库选择，也可以上传原图</span></button>`);
    const button=$('#upscale-submit');if(button){button.disabled=U.busy||!U.source||Boolean(U.selected)||!U.plan;button.textContent=U.selected?'正在查看任务':'加入超分队列 →';}
    document.querySelectorAll('[data-action=upscale-factor]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.factor)===U.factor);b.disabled=Boolean(U.selected);});
  }
  function diagram(stage,source,previous,current){
    const [w,h]=stage.input_size,cuts=stage.cuts||{},splits=stage.adaptive_splits||[];
    const image=current&&stage.preview_url?stage.preview_url:picture(source);
    const lines=(cuts.x||[]).map(x=>`<path d="M${x} 0V${h}"/>`).concat((cuts.y||[]).map(y=>`<path d="M0 ${y}H${w}"/>`)).join('');
    const old=previous?.cuts||{};
    const oldLines=(old.x||[]).map(x=>`<path d="M${x*2} 0V${h}"/>`).concat((old.y||[]).map(y=>`<path d="M0 ${y*2}H${w}"/>`)).join('');
    const refined=splits.map(s=>{const [a,b,c,d]=s.core,x=(a+c)/2,y=(b+d)/2;return `<path d="M${x} ${b}V${d}M${a} ${y}H${c}"/>`;}).join('');
    return `<div class="upscale-cut-preview"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="第${stage.index}级切图，${stage.tile_count}块"><image href="${esc(image)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/><g class="old-cut-lines">${oldLines}</g><g class="cut-lines">${lines}${refined}</g></svg><span class="cut-caption">${stage.columns} 列 × ${stage.rows} 行${splits.length?` · 已细分 ${splits.length} 块`:''}</span></div>`;
  }
  function levelCard(stage,previous,source,current){
    const states={pending:'等待开始',running:'执行中',succeeded:'已通过验收',failed:'未通过',cancelled:'已取消'};
    const calls=stage.calls||{},returns=stage.return_stats;
    const revised=stage.original_budget&&stage.original_budget.images!==stage.budget.images;
    return `<article class="upscale-level ${stage.status||'planned'}"><header><div><span class="level-number">${String(stage.index).padStart(2,'0')}</span><div><h3>第 ${stage.index} 级</h3><span>宽高 ×2</span></div></div><span class="pill ${stage.status==='succeeded'?'green':stage.status==='running'?'amber':''}">${states[stage.status]||'规划'}</span></header>${diagram(stage,source,previous,current)}<dl><div><dt>本级输入</dt><dd>${dimensions(stage.input_size)}</dd></div><div><dt>预期大小</dt><dd>${dimensions(stage.output_size)}</dd></div><div><dt>本级预算</dt><dd>${counts(stage.budget)}</dd></div>${revised?`<div><dt>最初预算</dt><dd>${counts(stage.original_budget)}</dd></div>`:''}<div><dt>已调用</dt><dd>${calls.images||0} 生图 · ${calls.reviews||0} 验收</dd></div>${returns?`<div><dt>原生回传</dt><dd>${returns.count} 张 · 最低 ${(returns.min_pixels/1000000).toFixed(2)} MP</dd></div>`:''}<div class="level-actual"><dt>实际结果</dt><dd>${dimensions(stage.actual_size)}</dd></div></dl>${stage.result_preview&&current?`<button class="link-btn" data-action="upscale-level-preview" data-level="${stage.index}">查看本级结果 ${icon('external')}</button>`:''}</article>`;
  }
  function paintPlan(){
    const plan=U.detail?.upscale_plan||U.plan,source=U.detail?.source_image||U.source,current=Boolean(U.selected&&!plan?.cache_cleared);
    if(!plan){set('upscale-plan-slot',`<div class="upscale-plan-empty">${U.busy?'<span class="spinner"></span> 正在规划各级切图…':'选择原图后，这里会展示切法、每级预算和最终尺寸。'}</div>`);return;}
    const detail=U.detail,calls=plan.calls||{},result=plan.actual_size||detail?.image_dimensions?.result;
    const actual=Array.isArray(result)?result:result?[result.width,result.height]:null;
    const stages=plan.stages||[],workspace=Math.max(...stages.map(s=>s.workspace_bytes_estimate||s.output_size[0]*s.output_size[1]*7));
    let actions='';
    if(detail){
      actions=`<section class="upscale-task-status"><div>${statusPill(detail.status)}<span>${esc(detail.prompt.slice(0,110))}</span></div>${taskProgress(detail,true)}${detail.error?`<p class="notice error">${esc(detail.error)}</p>`:''}<div class="row wrap">${['running','queued','retrying'].includes(detail.status)?`<button class="btn secondary" data-action="upscale-cancel">取消任务</button>`:''}${['failed','cancelled'].includes(detail.status)?'<button class="btn primary" data-action="upscale-retry">从检查点重试</button>':''}${detail.outputs[0]?`<a class="btn primary" href="${esc(detail.outputs[0].url)}?download=1" download>${icon('download')}下载完整结果</a><button class="btn secondary" data-action="image-preview" data-id="${detail.outputs[0].id}">放大查看</button>`:''}<button class="btn secondary" data-action="upscale-new">基于原图新建</button></div></section>`;
    }
    set('upscale-plan-slot',`<div class="upscale-summary-grid"><article><span>预期最终大小</span><strong>${dimensions(plan.output_size)}</strong><small>${plan.factor}× 面积 · ${stages.length} 级</small></article><article><span>预计总预算</span><strong>${plan.budget.images}<em> 次生图</em> + ${plan.budget.reviews}<em> 次验收</em></strong><small>${plan.budget.max_calls} 次调用上限（含本轮重试）${plan.original_budget&&plan.original_budget.images!==plan.budget.images?` · 最初 ${plan.original_budget.images} 次生图`:''}</small></article><article><span>最终实际大小</span><strong>${dimensions(actual)}</strong><small>${detail?`累计已用 ${calls.images||0} 次生图 · ${calls.reviews||0} 次验收`:`临时磁盘估算 ${bytes(workspace)}`}</small></article></div>${actions}<div class="upscale-level-heading"><h2>逐级切图与预算</h2><span><i></i>本级切线 <i class="old"></i>上一级接缝</span></div><div class="upscale-levels">${stages.map((s,i)=>levelCard(s,stages[i-1],source,current)).join('')}</div><p class="upscale-plan-note">预算随实际返回和必要的局部细分更新。每级通过验收后，再将完整结果重新切图。${plan.cache_cleared?' 此任务缓存已清理，原图与最终作品保留。':''}</p>${detail?`<div class="upscale-cache-bar"><span>任务缓存 ${bytes(detail.cache_bytes||0)}</span><button class="link-btn" data-action="upscale-clear-cache" data-id="${detail.id}" ${detail.cache_clearable?'':'disabled'}>清理缓存</button><button class="link-btn" data-action="show-log" data-id="${detail.id}">诊断日志</button></div>`:''}`);
  }
  function paintJobs(){
    set('upscale-job-count',String(U.jobs.length));
    set('upscale-jobs-slot',U.jobs.length?U.jobs.map(j=>`<button class="upscale-history-item ${U.selected===j.id?'selected':''}" data-action="upscale-open" data-id="${j.id}"><span>${j.options.stitch}× ${statusPill(j.status)}</span><strong>${esc(j.prompt.slice(0,45))}</strong><small>${fmtTime(j.created)} · ${esc(j.progress.label)}</small></button>`).join(''):'<p class="empty-list small">还没有超分任务</p>');
  }
  async function refresh(){
    if(S.page!=='upscale')return;
    const data=await api(`/api/upscale/jobs?limit=${U.limit}`);U.jobs=data.items;rememberJobs(U.jobs);paintJobs();
    if(U.selected){const selected=U.selected,detail=await api(`/api/upscale/jobs/${selected}`);if(U.selected!==selected)return;U.detail=detail;U.factor=detail.options.stitch;rememberJobs([detail]);paintSource();paintPlan();}
  }
  async function estimate(){
    if(!U.source)return;const version=++U.version;U.busy=true;U.plan=null;paintSource();paintPlan();
    try{const plan=await api(`/api/assets/${U.source.id}/upscale-plan?factor=${U.factor}`);if(version!==U.version)return;U.plan=plan;}
    catch(error){if(version===U.version)toast(error.message);}
    finally{if(version===U.version){U.busy=false;paintSource();paintPlan();}}
  }
  async function selectSource(id){
    const source=S.assetMap.get(id);if(!source)return;
    U.source=source;U.selected=null;U.detail=null;closeModal();await navigate('upscale');await estimate();
  }
  async function openJob(id){U.selected=id;U.detail=null;if(S.page!=='upscale')await navigate('upscale');else await refresh();}
  async function choose(){
    const data=await api('/api/assets?kind=all&limit=200');rememberAssets(data.items);
    modal('选择超分原图',`<div class="row between"><p class="small muted">选择作品或参考图</p><button class="btn secondary" data-action="upscale-upload">${icon('upload')}上传图片</button></div><div class="upscale-source-library">${data.items.map(a=>`<button data-action="upscale-source" data-id="${a.id}"><img loading="lazy" src="${esc(a.thumbnail)}" alt="${esc(a.name)}"><strong>${esc(a.name)}</strong><small>${a.width} × ${a.height}</small></button>`).join('')||'<p class="empty-list">先上传一张图片。</p>'}</div>`);
  }
  function clearConfirmation(id){
    modal('清理超分任务缓存',`<p>删除补绘检查点、中间图和工作文件，保留原图、最终作品、任务记录与日志。</p><p class="small muted">清理后再次重试，需要重新执行补绘。</p><button class="btn primary" data-action="upscale-clear-confirm" data-id="${esc(id)}">清理此任务缓存</button>`);
  }
  async function action(name,element){
    const id=element.dataset.id;
    if(name==='upscale-choose')await choose();
    else if(name==='upscale-source')await selectSource(id);
    else if(name==='upscale-upload')$('#upscale-upload').click();
    else if(name==='upscale-factor'){if(U.selected)return;U.factor=Number(element.dataset.factor);await estimate();}
    else if(name==='upscale-open')await openJob(id);
    else if(name==='upscale-more'){U.limit+=30;await refresh();}
    else if(name==='upscale-new'){
      let source=U.detail?.source_image||U.source;
      if(source&&!source.id&&source.source_job_id)source=await post(`/api/jobs/${source.source_job_id}/source-asset`);
      if(source){U.source=source;rememberAssets([source]);}
      U.selected=null;U.detail=null;if(S.page!=='upscale')await navigate('upscale');if(U.source)await estimate();else{paintSource();paintPlan();}
    }
    else if(name==='upscale-start'){
      if(!U.source||!U.plan||U.busy)return;element.disabled=true;
      try{const r=await post(`/api/assets/${U.source.id}/upscale`,{factor:U.factor,model:$('#upscale-model').value,effort:$('#upscale-effort').value});await openJob(r.ids[0]);toast('已加入渐进超分队列');}
      finally{if(document.contains(element))element.disabled=false;}
    }
    else if(name==='upscale-cancel'){await post(`/api/jobs/${U.selected}/cancel`);await refresh();}
    else if(name==='upscale-retry'){await post(`/api/jobs/${U.selected}/retry`);await refresh();}
    else if(name==='upscale-level-preview'){
      const stage=U.detail.upscale_plan.stages.find(s=>s.index===Number(element.dataset.level));
      modal(`第 ${stage.index} 级 · ${dimensions(stage.actual_size)}`,`<img class="modal-image" src="${esc(stage.result_preview)}" alt="本级结果预览"><p class="small muted">${dimensions(stage.actual_size)} · 已适配预览显示</p>`);
    }
    else if(name==='upscale-clear-cache')clearConfirmation(id);
    else if(name==='upscale-clear-confirm'){
      element.disabled=true;const result=await post(`/api/upscale/jobs/${id}/clear-cache`);closeModal();toast(`已释放 ${bytes(result.released_bytes)}`);
      if(S.page==='settings')await renderStorage();else await refresh();
    }
  }
  async function upload(file){
    if(!file)return;const body=new FormData();body.append('file',file);toast('正在上传原图…');
    const result=await api('/api/assets',{method:'POST',body});rememberAssets([result.asset]);await selectSource(result.asset.id);
  }
  async function renderStorage(){
    if(!$('#storage-settings')){const section=document.createElement('section');section.id='storage-settings';section.className='settings-card storage-settings';$('#page').append(section);}
    const data=await api('/api/storage'),percent=data.limit_bytes?Math.min(100,data.bytes/data.limit_bytes*100):0;
    set('storage-settings',`<div class="section-label"><h2>存储与清理</h2><span>${bytes(data.bytes)} 已使用</span></div><p class="small muted">统计数据库、图片库、预览及任务缓存。达到上限后停止新增写入。</p><div class="storage-meter"><span style="width:${percent}%"></span></div><div class="storage-limit"><label for="storage-limit-gb">存储上限（GB）</label><input id="storage-limit-gb" type="number" min="0" step="0.1" value="${data.limit_bytes?(data.limit_bytes/1073741824).toFixed(2):0}"><button class="btn secondary" data-action="storage-save">保存上限</button></div><p class="small muted">0 表示不限。当前磁盘可用 ${bytes(data.free_bytes)}。</p><div class="storage-breakdown">${Object.entries({database:'数据库',assets:'原图与作品',jobs:'任务缓存',previews:'大图预览',thumbs:'缩略图',runtime_images:'工具产物',tmp:'临时文件'}).map(([key,label])=>`<span>${label}<strong>${bytes(data.groups[key]||0)}</strong></span>`).join('')}</div><div class="storage-trash"><div><strong>最近删除</strong><p>${data.trash.assets} 张图片 · ${data.trash.collections} 个列表</p></div><button class="btn secondary" data-action="storage-trash">清空回收站</button></div><h3>超分任务缓存</h3><div class="storage-task-list">${data.tasks.map(t=>`<div><button data-action="upscale-open" data-id="${t.id}"><strong>${esc(t.prompt)}</strong><small>${bytes(t.bytes)} · ${esc(labels[t.status]||t.status)}</small></button><button class="link-btn" data-action="upscale-clear-cache" data-id="${t.id}" ${t.clearable?'':'disabled'}>清理缓存</button></div>`).join('')||'<p class="small muted">没有可清理的超分缓存。</p>'}</div>`);
  }
  async function storageAction(name,element){
    if(name==='storage-save'){
      const gb=Number($('#storage-limit-gb').value);if(!Number.isFinite(gb)||gb<0)throw new Error('请输入有效的存储上限');
      await api('/api/settings',{method:'PATCH',body:{storage_limit_bytes:Math.round(gb*1073741824)}});await renderStorage();toast('存储上限已保存');
    }else if(name==='storage-trash'){
      modal('永久清空回收站',`<p>永久删除最近删除中的图片和列表，并释放文件占用。正在被运行任务使用的图片会保留。</p><p class="notice error">此操作无法恢复。</p><button class="btn primary" data-action="storage-trash-confirm">永久清空回收站</button>`);
    }else if(name==='storage-trash-confirm'){
      element.disabled=true;const result=await post('/api/storage/empty-trash',{confirm:'empty-trash'});await StudioImages.clear();S.assetMap.clear();S.refs=S.refs.filter(id=>!(result.removed_ids||[]).includes(id));closeModal();await refresh();await renderStorage();toast(`已释放 ${bytes(result.released_bytes)}${result.protected_assets?'，仍在使用的图片已保留':''}`);
    }
  }
  globalThis.StudioUpscale={render,refresh,selectSource,openJob,action,upload,renderStorage,storageAction};
})();
