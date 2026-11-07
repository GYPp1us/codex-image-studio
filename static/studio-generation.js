"use strict";
/* Provider observations stay separate from requested settings and real image bytes. */
const StudioGeneration=(()=>{
  const sessions=new Set(),names={images:'图片直连',responses:'Responses 直连',cli:'CLI 兼容'},states={running:'进行中',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
  const val=v=>v===undefined||v===null||v===''?'未回显':String(v),wanted=v=>v===undefined||v===null||v===''?'未设置':String(v);
  const callTitle=call=>call.kind==='polish'?'独立润色':call.kind==='inspection'?'视觉验收':call.scope||'图片';
  const callMeta=call=>[states[call.status]||call.status||'等待',names[call.transport]||call.transport].filter(Boolean).join(' · ');
  const callList=c=>[...c.calls.values()].sort((a,b)=>(b.created||b.updated||0)-(a.created||a.updated||0));
  function logSummary(call){
    const values=spec=>[spec?.image_model,spec?.response_model,spec?.quality&&'质量 '+spec.quality].filter(Boolean).join(' · ');
    const requested=values(call.requested),reported=values(call.provider_reported);
    const detail=[requested&&'请求 '+requested,reported&&'回显 '+reported].filter(Boolean).join('　');
    return [callTitle(call),callMeta(call)].join(' · ')+(detail?'\n  '+detail:'');
  }
  function dismissCallPicker(picker){
    return traverseHistory(()=>layers.at(-1)?.type==='sheet'&&topSheet()===picker?1:0);
  }
  function openCallPicker(c){
    if(c.closed||c.picker||!c.calls.size)return;
    const rows=callList(c).map(call=>{
      const selected=call.id===c.displayCall;
      return `<button type="button" class="generation-choice" data-call-id="${esc(call.id)}" aria-pressed="${selected}"><span class="generation-choice-text"><b>${esc(callTitle(call))}</b><small>${esc(callMeta(call))}</small></span>${selected?icon('check',18):''}</button>`;
    }).join('');
    const picker=openSheet({title:'选择调用记录',cls:'generation-picker',stack:true,html:`<div class="generation-choices">${rows}</div>`});
    c.picker=picker;
    c.trigger.setAttribute('aria-expanded','true');
    picker.cleanup=()=>{
      c.picker=null;
      c.trigger.setAttribute('aria-expanded','false');
      if(!c.closed&&c.trigger.isConnected)c.trigger.focus({preventScroll:true});
    };
    picker.onclick=event=>{
      const button=event.target.closest('[data-call-id]');
      if(c.closed||!button||!c.calls.has(button.dataset.callId))return;
      c.selected=button.dataset.callId;
      paint(c);
      picker.onclick=null;
      dismissCallPicker(picker);
    };
    picker.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();dismissCallPicker(picker);}
    });
    picker.querySelector('[aria-pressed="true"]')?.focus();
  }
  function comparison(call){
    const r=call.requested||{},p=call.provider_reported||{},image=call.actual_image||{};
    const rows=call.kind==='image'?[['图片模型',r.image_model,p.image_model],['图片质量',r.quality,p.quality],['尺寸',r.size,p.size],['背景',r.background,p.background]]:[];
    if(r.response_model||p.response_model)rows.push([call.kind==='polish'?'润色文本模型':'派发 / 验收文本模型',r.response_model,p.response_model]);
    return `<div class="generation-compare"><table><caption>本次请求与服务端回显</caption><thead><tr><th>参数</th><th>请求值</th><th>服务端回显</th></tr></thead><tbody>${rows.map(([k,a,b])=>`<tr><th>${k}</th><td>${esc(wanted(a))}</td><td${b!==undefined&&b!==null&&a!==undefined&&String(a)!==String(b)&&a!=='auto'?' class="generation-different"':''}>${esc(val(b))}</td></tr>`).join('')}</tbody></table></div>
      ${image.width?`<p class="generation-native">实际图片 <b>${image.width} × ${image.height}</b>${image.format?' · '+esc(image.format.toUpperCase()):''}${image.bytes?' · '+fmtBytes(image.bytes):''}</p>`:''}
      <p class="note generation-source">回显是服务端声明，不能证明底层模型身份；缺失字段保留为“未回显”。实际尺寸来自图片本身。</p>
      ${call.fallback?`<p class="generation-warning">已从 ${esc(names[call.fallback.from]||call.fallback.from)} 降级为 ${esc(names[call.fallback.to]||call.fallback.to)} · ${esc(call.fallback.reason)}。原请求值保留，兼容通道不保证支持同一模型或质量。</p>`:''}
      ${call.ambiguous?'<p class="generation-warning">未能确认服务端是否已生成。系统没有自动重发，请核对后决定是否重试。</p>':''}
      ${call.revised_prompt?`<details class="task-disclosure"><summary>服务端生图提示词</summary><div class="prompt-box">${esc(call.revised_prompt)}</div></details>`:''}`;
  }
  function fmtBytes(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';}
  function create(root,job,adapter){
    const c={root,job,adapter,calls:new Map(),selected:null,source:null,closed:false,revision:0,imageToken:0,offset:0,total:0};
    root.innerHTML=`<h2>图像调用</h2><div class="generation-live"><div class="generation-live-head"><span data-generation-label>等待显影帧</span><span data-generation-state></span></div><div class="generation-frame" hidden><img class="generation-image" alt="当前调用的真实显影帧"><span class="generation-frame-badge">显影中 · 非最终作品</span></div><p class="note" data-generation-empty>服务端提供渐进帧时会在这里实时显示；未提供时等待最终图片。</p></div><div class="generation-select" hidden><span>调用记录</span><button type="button" class="generation-trigger" aria-haspopup="dialog" aria-expanded="false"><span class="generation-choice-text"><b data-call-title></b><small data-call-meta></small></span>${icon('chevd',16)}</button></div><div data-generation-observation></div><button class="secondary generation-more" hidden>更早的调用</button>`;
    c.trigger=root.querySelector('.generation-trigger');c.observation=root.querySelector('[data-generation-observation]');c.frame=root.querySelector('.generation-frame');c.image=root.querySelector('img');c.empty=root.querySelector('[data-generation-empty]');c.label=root.querySelector('[data-generation-label]');c.state=root.querySelector('[data-generation-state]');c.more=root.querySelector('.generation-more');
    c.retry=document.createElement('button');c.retry.className='link-btn generation-preview-retry';c.retry.textContent='重试加载显影帧';c.retry.hidden=true;c.root.querySelector('.generation-live').append(c.retry);c.retry.onclick=()=>feedback('generation-preview:'+c.job.id,c.retry,()=>{c.imageURL=null;paint(c);return c.previewLoad?.promise;});
    c.trigger.onclick=()=>openCallPicker(c);
    c.more.onclick=()=>feedback('generation-records:'+c.job.id,c.more,()=>load(c,true));
    const prior=job.generation_calls;
    if(prior){accept(c,prior.items||[]);c.offset=(prior.items||[]).length;c.total=prior.total||0;}
    if(job.generation?.id)accept(c,[job.generation]);
    paint(c);if(!prior)load(c);
    c.visibility=()=>{if(document.hidden){disconnect(c);cancelRead(c);stopPreview(c);c.imageURL=null;++c.imageToken;}else if(!c.closed){load(c);paint(c);connect(c);}};
    document.addEventListener('visibilitychange',c.visibility);sessions.add(c);connect(c);return c;
  }
  function feedback(key,button,work){return typeof StudioFeedback!=='undefined'?StudioFeedback.run(key,button,work):work();}
  function cancelRead(c){++c.revision;c.readController?.abort();c.readController=null;c.loading=false;}
  function stopPreview(c){const p=c.previewLoad;if(!p)return;c.previewLoad=null;if(typeof clearTimeout==='function')clearTimeout(p.timer);p.image.onload=p.image.onerror=null;p.image.removeAttribute?.('src');p.resolve();}
  function accept(c,items){for(const item of items){if(!item.id)continue;const old=c.calls.get(item.id);if(old?.updated&&item.updated&&item.updated<old.updated)continue;const next={...old,...item};if(old?.preview?.revision>(item.preview?.revision??-1))next.preview=old.preview;if(old&&old.status!=='running'&&item.status==='running'&&old.updated>=item.updated)next.status=old.status;c.calls.set(item.id,next);}}
  function paint(c){
    if(c.closed)return;
    const list=callList(c);
    if(c.selected&&!c.calls.has(c.selected))c.selected=null;
    const call=c.calls.get(c.selected)||list[0];
    c.root.querySelector('.generation-select').hidden=!call;c.more.hidden=c.offset>=c.total;c.more.disabled=!!c.loading;
    if(!call){const modern=!!c.job.options?.generation;c.root.querySelector('.generation-live').hidden=!modern;c.observation.innerHTML=modern?'<p class="note">尚未发出调用。开始执行后会保留真实请求和服务端回显。</p>':'<p class="note">旧任务没有结构化请求记录。可查看原始调用日志；系统不会补造模型或质量回显。</p>';c.state.textContent='暂无记录';return;}
    c.trigger.querySelector('[data-call-title]').textContent=callTitle(call);
    c.trigger.querySelector('[data-call-meta]').textContent=callMeta(call);
    c.root.querySelector('.generation-live').hidden=call.kind!=='image';
    if(c.displayCall!==call.id){stopPreview(c);c.displayCall=call.id;c.image.removeAttribute('src');c.frame.hidden=true;c.imageURL=null;++c.imageToken;c.retry.hidden=true;c.empty.textContent='服务端提供渐进帧时会在这里实时显示；未提供时等待最终图片。';}
    const detail=comparison(call);if(c.detailSignature!==detail){c.detailSignature=detail;c.observation.innerHTML=detail;}
    c.label.textContent=(call.kind==='image'?'真实显影 · ':call.kind==='polish'?'独立润色 · ':'视觉验收 · ')+(call.scope||'');
    c.state.textContent=states[call.status]||call.status||'';
    const final=c.job.status==='succeeded'&&call.status==='succeeded'&&call.id===c.job.generation?.id&&!c.job.options?.stitch&&!c.job.options?.regions&&!c.job.options?.region&&call.kind==='image'&&/^image-/.test(call.scope||'')?c.job.outputs?.[0]:null;
    const url=final?(final.preview||final.thumbnail||final.url):call.preview?.url;
    const badge=c.root.querySelector('.generation-frame-badge');badge.textContent=final?'最终作品':call.status==='failed'?'未完成显影 · 非最终作品':call.status==='cancelled'?'已取消 · 非最终作品':'显影帧 · 非最终作品';
    c.empty.hidden=!!url;
    if(!url){stopPreview(c);c.frame.hidden=true;c.retry.hidden=true;c.image.removeAttribute('src');c.imageURL=null;++c.imageToken;return;}
    if(url===c.imageURL||document.hidden)return;stopPreview(c);c.imageURL=url;const token=++c.imageToken,next=new Image();next.decoding='async';
    const p={image:next,timer:null};p.promise=new Promise(resolve=>p.resolve=resolve);c.previewLoad=p;
    const valid=()=>!c.closed&&token===c.imageToken&&c.previewLoad===p;
    c.retry.disabled=true;c.retry.setAttribute('aria-busy','true');
    if(!c.image.getAttribute('src')){c.empty.hidden=false;c.empty.textContent='正在加载显影预览…';}
    const failed=()=>{if(!valid())return;stopPreview(c);c.empty.hidden=false;c.empty.textContent='这张显影帧暂时不可用；任务与最终作品不受影响。';c.frame.hidden=!c.image.getAttribute('src');c.retry.hidden=false;c.retry.disabled=false;c.retry.removeAttribute('aria-busy');c.imageURL=null;};
    if(typeof setTimeout==='function')p.timer=setTimeout(failed,20000);
    next.onload=async()=>{try{await next.decode?.();}catch{failed();return;}if(!valid())return;c.image.src=url;stopPreview(c);c.image.classList.remove('frame-arrived');void c.image.offsetWidth;c.image.classList.add('frame-arrived');c.empty.hidden=true;c.frame.hidden=false;c.retry.hidden=true;c.retry.disabled=false;c.retry.removeAttribute('aria-busy');};
    next.onerror=failed;next.src=url;
  }
  async function load(c,more=false){
    if(c.loading||c.closed)return;c.loading=true;c.more.disabled=true;const revision=++c.revision;
    c.readController=typeof AbortController==='function'?new AbortController():null;
    try{const data=await c.adapter.api(`/api/jobs/${c.job.id}/generation-calls?limit=30&offset=${more?c.offset:0}`,c.readController?{signal:c.readController.signal}:{});if(c.closed||revision!==c.revision)return;accept(c,data.items);c.offset=more?c.offset+data.items.length:Math.max(c.offset,data.items.length);c.total=data.total;paint(c);}
    catch(error){if(!c.closed&&revision===c.revision&&error.name!=='AbortError'){c.state.textContent='记录读取失败';c.more.hidden=false;c.more.textContent='重新读取调用记录';}}
    finally{if(revision===c.revision){c.loading=false;c.readController=null;if(!c.closed)c.more.disabled=false;}}
  }
  function disconnect(c){c.source?.close();c.source=null;}
  function connect(c){
    if(c.closed||c.source||document.hidden||!['running','queued','retrying'].includes(c.job.status)||typeof EventSource==='undefined')return;
    const source=new EventSource(`/api/jobs/${c.job.id}/generation-events`);c.source=source;
    source.onmessage=event=>{if(c.closed||c.source!==source)return;try{const data=JSON.parse(event.data),previous=c.calls.size;if(!['running','queued','retrying'].includes(c.job.status)&&['running','queued','retrying'].includes(data.status))return;c.job={...c.job,status:data.status,generation:data.generation};if(data.generation?.id)accept(c,[data.generation]);paint(c);if(c.calls.size!==previous)load(c);if(!['running','queued','retrying'].includes(data.status)){disconnect(c);load(c);}}catch{}};
    source.onerror=()=>{if(c.closed||c.source!==source)return;c.state.textContent='连接恢复中';};
  }
  function close(c){if(!c||c.closed)return;c.closed=true;if(c.picker)dismissCallPicker(c.picker);cancelRead(c);stopPreview(c);++c.imageToken;disconnect(c);document.removeEventListener('visibilitychange',c.visibility);sessions.delete(c);c.image.removeAttribute('src');}
  function mount(root,job,adapter){if(!root)return;for(const c of sessions)if(c.root===root)close(c);return create(root,job,adapter);}
  function update(root,job){for(const c of sessions)if(c.root===root&&!c.closed){c.job={...c.job,...job};if(job.generation?.id)accept(c,[job.generation]);paint(c);if(!['running','queued','retrying'].includes(job.status))disconnect(c);else connect(c);}}
  new MutationObserver(()=>{for(const c of sessions)if(!c.root.isConnected)close(c);}).observe(document.documentElement,{childList:true,subtree:true});
  return {mount,update,close,comparison,logSummary};
})();
