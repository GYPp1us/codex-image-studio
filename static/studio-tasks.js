"use strict";
/* One task, one detail screen. Recovery tools share one inspector. */
const StudioTasks=(()=>{
  let current=null;
  const alive=c=>c.el?.isConnected&&c.el.style.pointerEvents!=='none';
  const header=sub=>`<header class="top scr-top"><button class="icon-btn" data-act="scr-back" aria-label="返回">${icon('back')}</button><div class="ct"><h1>任务详情</h1>${sub?`<span>${esc(sub)}</span>`:''}</div><span class="grow"></span><button class="icon-btn" data-task-refresh aria-label="刷新任务">${icon('refresh',19)}</button></header>`;
  const status=j=>`<span class="task-status ${j.status==='failed'?'error':''}">${esc(j.progress?.label||({succeeded:'已完成',failed:'失败',cancelled:'已取消',queued:'等待调度',running:'进行中',retrying:'重试中'})[j.status]||j.status)}</span>`;
  function progressHTML(j,a){
    const t=a.task(j);if(t.up)return StudioProgress.html(t,{all:true,key:'task-detail'});
    if(!['queued','running','retrying','failed'].includes(j.status))return '';
    return `<ol class="task-stage-list">${(j.progress?.steps||[]).map(s=>`<li data-state="${esc(s.state||'pending')}"><span></span>${esc(s.label||s.key||'')}</li>`).join('')}</ol>`;
  }
  function errorHTML(message){
    if(!message)return '';
    return message.length>100?`<div class="task-error"><p class="task-error-summary">${esc(message)}</p><details><summary>查看完整错误</summary><pre>${esc(message)}</pre></details></div>`:`<p class="task-error">${esc(message)}</p>`;
  }
  function detailsHTML(j,a){
    const stopped=['failed','cancelled'].includes(j.status),upscale=!!j.options.stitch;
    const source=j.source_image||a.asset(j.options.source_asset_id),plan=j.upscale_plan;
    const stage=plan?.stages?.find(s=>s.status==='running'||s.status==='failed')||plan?.stages?.at(-1);
    const preview=stage?.layout_url||stage?.preview_url||source?.preview||source?.thumbnail||source?.url;
    return `${header(fmtTime(j.created*1000))}<nav class="task-jumpbar" aria-label="任务详情分区"><button data-task-jump="task-overview">概览</button><button data-task-jump="task-calls">图像调用</button><button data-task-jump="task-logs">日志</button></nav>
      <div class="scroll task-work-scroll"><main class="task-detail-main">
      <section class="task-section task-overview" id="task-overview"><div data-task-status>${status(j)}</div><div data-task-board>${progressHTML(j,a)}</div>${errorHTML(j.error)}
      ${stopped?`<button class="secondary task-recovery-entry" data-act="${upscale?'failure-job':'retry-job'}" data-id="${j.id}">${icon(upscale?'grid':'refresh',16)}${upscale?'处理失败与检查点':'重新执行任务'}</button>`:''}</section>
      ${j.outputs?.length?`<section class="task-section"><h2>结果</h2><div class="task-outputs">${j.outputs.map(im=>`<button data-act="img" data-id="${im.id}" data-list="batch:${j.batch_id}" aria-label="查看结果"><img src="${esc(im.thumbnail||im.url)}" alt=""><span>${im.width} × ${im.height}</span></button>`).join('')}</div></section>`:''}
      <section class="task-section"><h2>${upscale?'任务统一要求':'提示词'}</h2><div class="prompt-box">${esc(upscale?(j.options.upscale_requirements||j.options.upscale_injection||'按原图保真增强'):j.prompt)}</div>${j.polished_prompt?`<details class="task-disclosure"><summary>润色后的提示词</summary><div class="prompt-box">${esc(j.polished_prompt)}</div></details>`:''}</section>
      ${upscale&&!stopped?`<details class="task-section task-plan" id="task-plan"><summary>尺寸、切法与预算</summary>${preview?`<img class="up-check-image" src="${esc(preview)}" alt="本级输入与切图方案">`:''}${a.planHTML(source,j.options.stitch+'×',plan)}<p class="note">已调用 ${a.budget(plan?.calls)} · 缓存 ${a.bytes(j.cache_bytes||0)}</p></details>`:''}
      <section class="task-section generation-workspace" id="task-calls" data-generation-workspace></section>
      <section class="task-section" id="task-logs"><h2>执行日志</h2><div data-task-log><pre class="prompt-box task-log" data-log-content>正在读取日志…</pre><button class="secondary" data-log-refresh>${icon('refresh',15)}刷新日志</button><details class="task-disclosure"><summary>原始 JSONL</summary><pre class="prompt-box task-log" data-log-raw></pre></details></div></section></main>
      <aside class="task-detail-side"><section class="task-section"><h2>任务参数</h2><dl class="kv"><dt>文本模型</dt><dd>${esc(a.modelName(j.model))} · ${esc(j.effort)}</dd><dt>尝试</dt><dd>${j.attempt} / ${j.max_attempts}</dd><dt>创建</dt><dd>${fmtTime(j.created*1000)}</dd><dt>任务 ID</dt><dd class="task-id">${esc(j.id)}</dd></dl></section><section class="task-section" data-task-prompts></section></aside></div>`;
  }
  async function readLog(c,button){
    if(!alive(c)||c.logPending)return;const holder=c.el.querySelector('[data-log-content]');if(!holder)return;c.logPending=true;c.lastLog=Date.now();
    try{await StudioFeedback.run('task-log:'+c.id,button||c.el.querySelector('[data-log-refresh]'),async()=>{
      const log=await c.adapter.api(`/api/jobs/${c.id}/log`);if(!alive(c))return;
      const raw=String(log.text||'');c.el.querySelector('[data-log-raw]').textContent=raw;
      holder.textContent=raw.split('\n').map(line=>{try{const event=JSON.parse(line);if(!event||typeof event!=='object')return line;const time=event.timestamp||event.time||event.ts||'',kind=event.type||event.event||event.level||(event.studio_attempt?`第 ${event.studio_attempt} 次尝试`:''),message=event.message||event.msg||event.text||event.error||event.item?.text||event.item?.message||event.item?.error||event.item?.type||'';return [time,kind,typeof message==='string'?message:JSON.stringify(message)].filter(Boolean).join(' · ')||line;}catch{return line;}}).join('\n')||'暂无日志';
    });}catch(error){if(alive(c))holder.textContent=error.message;}finally{c.logPending=false;}
  }
  function jump(c,target){const section=c.el.querySelector('#'+target);if(section)section.scrollIntoView({block:'start',behavior:RM?'auto':'smooth'});}
  function mount(c,showLog){
    const a=c.adapter;if(c.generation&&typeof StudioGeneration!=='undefined')StudioGeneration.close(c.generation);
    c.el.innerHTML=detailsHTML(c.job,a);hydrateIcons(c.el);StudioProgress.hydrate(c.el);
    c.el.querySelector('[data-task-refresh]').onclick=()=>reload(c).catch(a.report);
    c.el.querySelectorAll('[data-task-jump]').forEach(b=>b.onclick=()=>jump(c,b.dataset.taskJump));
    if(typeof StudioGeneration!=='undefined')c.generation=StudioGeneration.mount(c.el.querySelector('[data-generation-workspace]'),c.job,a);
    readLog(c);c.el.querySelector('[data-log-refresh]').onclick=e=>readLog(c,e.currentTarget);
    if(showLog)requestAnimationFrame(()=>jump(c,'task-logs'));
    if(typeof StudioUpscalePrompts!=='undefined'&&c.job.options.stitch)StudioUpscalePrompts.mountTask(c.el.querySelector('[data-task-prompts]'),c.job,a.api);
  }
  async function fetchJob(c){const j=await c.adapter.api('/api/jobs/'+c.id);return j.options?.stitch?c.adapter.api('/api/upscale/jobs/'+c.id):j;}
  async function reload(c){
    if(!alive(c))return;
    return StudioFeedback.run('task-refresh:'+c.id,c.el.querySelector('[data-task-refresh]'),async()=>{
      const job=await fetchJob(c);if(!alive(c))return;
      c.job=job;c.adapter.accept(job);const position=c.el.querySelector('.scroll')?.scrollTop||0;mount(c,false);c.el.querySelector('.scroll').scrollTop=position;
    });
  }
  async function open(id,adapter,{showLog=false}={}){
    if(current&&alive(current)&&current.id===id){if(showLog)jump(current,'task-logs');return current.el;}
    const previous=current,c={id,adapter,job:null,el:null,logPending:false,lastLog:0};
    const el=openScreen(`${header('')}<div class="scroll"><p class="boot-state"><span class="spin"></span>正在读取任务…</p></div>`,{cls:'task-workspace task-details-workspace',onClose:()=>{if(c.generation&&typeof StudioGeneration!=='undefined')StudioGeneration.close(c.generation);if(current===c)current=previous&&alive(previous)?previous:null;}});
    c.el=el;el.dataset.taskId=id;current=c;
    try{const j=await fetchJob(c);if(!alive(c))return;c.job=j;adapter.accept(j);mount(c,showLog);}
    catch(error){if(alive(c)){$('.scroll',el).innerHTML=`<p class="form-err">${esc(error.message)}</p><button class="secondary" data-task-retry>重新读取</button>`;$('[data-task-retry]',el).onclick=()=>reload(c).catch(adapter.report);}}
    return el;
  }
  function update(){
    const c=current;if(!c?.job||!alive(c))return;const latest=c.adapter.latest(c.id);if(!latest)return;
    const previous=c.job.status;c.job={...c.job,...latest,options:{...c.job.options,...latest.options}};
    if(typeof StudioGeneration!=='undefined')StudioGeneration.update(c.el.querySelector('[data-generation-workspace]'),c.job);
    const holder=c.el.querySelector('[data-task-status]');if(holder)holder.innerHTML=status(c.job);
    const board=c.el.querySelector('[data-task-board]');if(board){setHTML(board,progressHTML(c.job,c.adapter));StudioProgress.hydrate(board);}
    if(previous!==c.job.status){reload(c).catch(c.adapter.report);return;}
    if(['queued','running','retrying'].includes(c.job.status)&&Date.now()-c.lastLog>8000)readLog(c);
  }
  return {open,update};
})();
