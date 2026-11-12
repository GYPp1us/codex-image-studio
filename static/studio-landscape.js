"use strict";
/* Landscape is a canvas/inspector workspace, with the existing state and history. */
const StudioLandscape=(()=>{
  const media=matchMedia('(min-width:600px) and (min-aspect-ratio:4/3)');
  let frame=0,settingsObservers=new WeakMap();
  const wide=()=>media.matches;
  function viewport({reference=false,select=false}={}){
    const W=app.offsetWidth,H=viewerHeight(),side=reference?(select?190:0):Math.round(clamp(W*.28,220,320));
    const style=getComputedStyle(app),inset=key=>parseFloat(style.getPropertyValue('--safe-'+key))||0;
    return {left:16+inset('left'),right:W-side-inset('right')-16,top:inset('top')+52,bottom:H-inset('bottom')-16};
  }
  function fit(im,options={}){
    const view=viewport(options),aw=Math.max(1,view.right-view.left),ah=Math.max(1,view.bottom-view.top),ratio=im.w/im.h;
    let w=aw,h=w/ratio;if(h>ah){h=ah;w=h*ratio;}
    return {x:view.left+(aw-w)/2,y:view.top+(ah-h)/2,w,h};
  }
  function parameters(){
    const box=$('#landscape-parameters');if(!box||!wide())return;
    const html=`<div class="landscape-panel-heading"><b>生成参数</b><span>与创作一起调整</span></div>${paramsBody()}`;
    if(box.dataset.html!==html&&!box.contains(document.activeElement)){box.innerHTML=html;box.dataset.html=html;hydrateIcons(box);}
  }
  function overview(){
    const slot=$('#queue-overview');if(!slot||!wide())return;
    const active=S.batches.flatMap(b=>b.tasks.map(t=>({b,t}))).filter(x=>['running','queued'].includes(x.t.status)),running=active.filter(x=>x.t.status==='running'),failed=S.batches.flatMap(b=>b.tasks).filter(t=>t.status==='failed');
    const html=`<div class="landscape-panel-heading"><b>工作概览</b><span>点任务查看详情与日志</span></div><div class="queue-metrics"><div><b>${running.length}</b><span>进行中</span></div><div><b>${active.length-running.length}</b><span>等待调度</span></div><div><b>${failed.length}</b><span>待处理</span></div></div>${active.slice(0,8).map(({b,t})=>`<article class="overview-task"><button data-act="task-info" data-id="${t.id}"><span class="kind ${b.kind}">${KIND[b.kind]}</span><b>${esc(b.prompt.slice(0,90))}</b><span>${esc(taskLabel(t))}</span>${taskBar(t)}</button>${t.up?StudioProgress.html(t,{key:'overview'}):''}</article>`).join('')||'<div class="landscape-empty">当前没有进行中的任务<br><small>左侧保留最近的任务与结果</small></div>'}`;
    if(slot.dataset.html!==html){slot.innerHTML=html;slot.dataset.html=html;hydrateIcons(slot);}StudioProgress.hydrate(slot);
  }
  function settingsNavigation(screen){
    if(!wide()||!screen.classList.contains('settings')||screen.querySelector('.settings-navigation'))return;
    const scroll=screen.querySelector('.set-scroll');if(!scroll)return;
    const nav=document.createElement('nav');nav.className='settings-navigation';nav.setAttribute('aria-label','设置分类');
    const groups=[...scroll.querySelectorAll('.s-group')];
    // The demo's group wrapper is keyed by id; use it even when its class evolves.
    const sections=groups.length?groups:[...scroll.querySelectorAll('[id^="set-"]')];
    nav.innerHTML=sections.map(group=>`<button data-settings-section="${group.id}">${esc(group.querySelector('h2,h3,.g-title')?.textContent||group.id)}</button>`).join('');screen.append(nav);
    nav.onclick=event=>{const button=event.target.closest('[data-settings-section]');if(!button)return;const group=screen.querySelector('#'+button.dataset.settingsSection);if(group){scroll.scrollTo({top:group.offsetTop-scroll.offsetTop-12,behavior:RM?'auto':'smooth'});nav.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===button));}};
    if(typeof IntersectionObserver==='function'){
      const observer=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(visible)nav.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.settingsSection===visible.target.id));},{root:scroll,rootMargin:'0px 0px -60% 0px'});sections.forEach(section=>observer.observe(section));settingsObservers.set(screen,observer);
    }
  }
  function refresh(){
    app.classList.toggle('landscape-workspace',wide());app.dataset.page=S.tab;app.dataset.mode=S.mode;
    app.style.setProperty('--inspector-size',Math.round(clamp(app.offsetWidth*.28,220,320))+'px');
    if(!wide())return;
    parameters();overview();for(const screen of $$('#screens .screen'))settingsNavigation(screen);
  }
  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;refresh();});}
  media.addEventListener?.('change',()=>{StudioReferences.cancel();lpCancel();cancelViewerDrag(true);selCancel();syncSurfaces();syncViewerControls();schedule();});
  addEventListener('resize',schedule);
  new MutationObserver(records=>{for(const record of records){for(const node of record.addedNodes)if(node.nodeType===1&&node.matches?.('.screen.settings'))settingsNavigation(node);for(const node of record.removedNodes)if(node.nodeType===1)settingsObservers.get(node)?.disconnect();}}).observe($('#screens'),{childList:true});
  schedule();return {wide,fit,viewport,refresh,parameters};
})();
