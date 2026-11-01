"use strict";
/* Task details own logs; the upscale inspector owns dimensions, budget and repair. */
const StudioTasks=(()=>{
  let current=null;
  const alive=c=>c.el.isConnected&&c.el.style.pointerEvents!=='none';
  const header=(title,sub='')=>`<header class="top scr-top"><button class="icon-btn" data-act="scr-back" aria-label="返回">${icon('back')}</button><div class="ct"><h1>${title}</h1>${sub?`<span>${esc(sub)}</span>`:''}</div><span class="grow"></span><button class="icon-btn" data-task-refresh aria-label="刷新任务">${icon('refresh',19)}</button></header>`;
  const status=j=>`<span class="task-status ${j.status==='failed'?'error':''}">${esc(j.progress?.label||j.status)}</span>`;
  function detailsHTML(j,a){
    return `${header('任务详情',fmtTime(j.created*1000))}<div class="scroll task-work-scroll"><main class="task-detail-main"><div data-task-status>${status(j)}</div><section class="task-section"><h2>提示词</h2><div class="prompt-box">${esc(j.prompt)}</div>${j.polished_prompt?`<details class="task-disclosure"><summary>润色后的提示词</summary><div class="prompt-box">${esc(j.polished_prompt)}</div></details>`:''}</section>
      ${j.outputs?.length?`<section class="task-section"><h2>结果</h2><div class="task-outputs">${j.outputs.map(im=>`<button data-act="img" data-id="${im.id}" data-list="batch:${j.batch_id}" aria-label="查看结果"><img src="${esc(im.thumbnail||im.url)}" alt=""><span>${im.width} × ${im.height}</span></button>`).join('')}</div></section>`:''}
      <section class="task-section"><h2>执行日志</h2><details class="task-disclosure" data-task-log><summary>查看日志 <span class="muted small">${j.status==='running'?'持续更新':'保留原始执行记录'}</span></summary><pre class="prompt-box task-log" data-log-content>展开后读取日志…</pre><button class="secondary" data-log-refresh>刷新日志</button></details></section></main>
      <aside class="task-detail-side"><section class="task-section"><h2>任务参数</h2><dl class="kv"><dt>模型</dt><dd>${esc(a.modelName(j.model))} · ${esc(j.effort)}</dd><dt>尝试</dt><dd>${j.attempt} / ${j.max_attempts}</dd><dt>创建</dt><dd>${fmtTime(j.created*1000)}</dd><dt>任务 ID</dt><dd class="task-id">${esc(j.id)}</dd></dl>${j.error?`<p class="form-err">${esc(j.error)}</p>`:''}${j.options.stitch?`<button class="secondary" data-act="up-detail" data-id="${j.id}">${icon('grid',16)}超分检查 · 尺寸、预算与修复</button>`:''}</section><section class="task-section" data-task-prompts></section></aside></div>`;
  }
  function upscaleHTML(j,a){
    const t=a.task(j),im=j.source_image||a.asset(j.options.source_asset_id),plan=j.upscale_plan;
    const stage=plan?.stages?.find(s=>s.index===t.up?.cur+1)||plan?.stages?.[0];
    return `${header('超分检查',`${j.options.stitch}× 面积 · ${plan?.stages?.length||0} 级`)}<div class="scroll task-work-scroll upscale-inspector"><main class="up-work-main"><div data-task-status>${status(j)}</div><section class="task-section" data-task-board>${t.up?StudioProgress.html(t,{all:true,key:'inspector'}):'<p class="note">正在准备切图计划</p>'}</section><section class="task-section"><h2>本级输入与切法</h2>${stage?.preview_url?`<img class="up-check-image" src="${esc(stage.layout_url||stage.preview_url)}" alt="本级输入与切图方案">`:im?`<img class="up-check-image" src="${esc(im.preview||im.thumbnail||im.url)}" alt="超分原图">`:'<p class="note">原图生成后显示切图</p>'}${stage?.result_preview?`<h2>本级结果</h2><img class="up-check-image" src="${esc(stage.result_preview)}" alt="本级超分结果">`:''}</section></main>
      <aside class="up-work-side"><section class="task-section"><h2>尺寸与调用预算</h2>${a.planHTML(im,j.options.stitch+'×',plan)}<p class="note">已调用 ${a.budget(plan?.calls)} · 缓存 ${a.bytes(j.cache_bytes||0)}</p></section><section class="task-section"><h2>任务统一要求</h2><p class="prompt-box">${esc(j.options.upscale_requirements||j.options.upscale_injection||'按原图保真增强')}</p><div class="btn-row"><button class="secondary" data-act="task-info" data-id="${j.id}">详情与日志</button>${['failed','cancelled'].includes(j.status)?`<button class="secondary" data-act="retry-job" data-id="${j.id}">从检查点重试</button>`:''}</div>${j.cache_clearable?`<button class="secondary" data-act="clear-task-cache" data-id="${j.id}">清理任务缓存</button>`:''}</section><section class="task-section" data-task-prompts></section></aside></div>`;
  }
  async function readLog(c,button){
    if(!alive(c)||c.logPending)return;c.logPending=true;
    const holder=c.el.querySelector('[data-log-content]');if(!holder)return;
    try{await StudioFeedback.run('task-log:'+c.id,button||c.el.querySelector('[data-log-refresh]'),async()=>{const log=await c.adapter.api(`/api/jobs/${c.id}/log`);if(alive(c))holder.textContent=log.text;});}
    catch(error){if(alive(c))holder.textContent=error.message;}finally{c.logPending=false;}
  }
  function mount(c,showLog){
    const a=c.adapter;c.el.innerHTML=c.mode==='upscale'?upscaleHTML(c.job,a):detailsHTML(c.job,a);hydrateIcons(c.el);StudioProgress.hydrate(c.el);
    c.el.querySelector('[data-task-refresh]').onclick=()=>reload(c);
    const disclosure=c.el.querySelector('[data-task-log]');
    if(disclosure){disclosure.addEventListener('toggle',()=>{if(disclosure.open)readLog(c);});c.el.querySelector('[data-log-refresh]').onclick=e=>readLog(c,e.currentTarget);if(showLog){disclosure.open=true;requestAnimationFrame(()=>disclosure.scrollIntoView({block:'start',behavior:RM?'auto':'smooth'}));}}
    if(typeof StudioUpscalePrompts!=='undefined'&&c.job.options.stitch)StudioUpscalePrompts.mountTask(c.el.querySelector('[data-task-prompts]'),c.job,a.api);
  }
  async function reload(c){
    if(!alive(c))return;
    await StudioFeedback.run('task-refresh:'+c.id,c.el.querySelector('[data-task-refresh]'),async()=>{
      const job=await c.adapter.api((c.mode==='upscale'?'/api/upscale/jobs/':'/api/jobs/')+c.id);if(!alive(c))return;
      c.job=job;c.adapter.accept(job);const scroll=c.el.querySelector('.scroll'),position=scroll?.scrollTop||0,logOpen=!!c.el.querySelector('[data-task-log]')?.open;mount(c,logOpen);c.el.querySelector('.scroll').scrollTop=position;
    }).catch(c.adapter.report);
  }
  async function open(id,adapter,{mode='details',showLog=false,inspectOnly=false}={}){
    if(current&&alive(current)&&current.id===id&&current.mode===mode){if(showLog){const d=current.el.querySelector('[data-task-log]');if(d){d.open=true;d.scrollIntoView({block:'start'});}}return current.el;}
    const previous=current,c={id,adapter,mode,job:null,el:null,logPending:false};
    const el=openScreen(`${header(mode==='upscale'?'超分检查':'任务详情')}<div class="scroll"><p class="boot-state"><span class="spin"></span>正在读取任务…</p></div>`,{cls:'task-workspace '+(mode==='upscale'?'upscale-workspace':'task-details-workspace'),onClose:()=>{if(current===c)current=previous&&alive(previous)?previous:null;}});c.el=el;el.dataset.taskId=id;current=c;
    try{const j=await adapter.api((mode==='upscale'?'/api/upscale/jobs/':'/api/jobs/')+id);if(!alive(c))return;
      if(mode==='upscale'&&!inspectOnly&&['failed','cancelled'].includes(j.status)){await back();return adapter.openFailure(id);}
      c.job=j;adapter.accept(j);mount(c,showLog);
    }catch(error){if(alive(c)){$('.scroll',el).innerHTML=`<p class="form-err">${esc(error.message)}</p><button class="secondary" data-task-retry>重新读取</button>`;$('[data-task-retry]',el).onclick=()=>reload(c);}}
    return el;
  }
  function update(){
    const c=current;if(!c||!c.job||!alive(c))return;const latest=c.adapter.latest(c.id);if(!latest)return;
    const previous=c.job.status;c.job={...c.job,...latest,options:{...c.job.options,...latest.options}};
    const holder=c.el.querySelector('[data-task-status]');if(holder)holder.innerHTML=status(c.job);
    if(c.mode==='upscale'){
      const board=c.el.querySelector('[data-task-board]'),t=c.adapter.task(c.job);if(board&&t.up){setHTML(board,StudioProgress.html(t,{all:true,key:'inspector'}));StudioProgress.hydrate(board);}
    }
    if(previous!==c.job.status)reload(c);
    if(c.el.querySelector('[data-task-log]')?.open)readLog(c);
  }
  return {open,update};
})();
