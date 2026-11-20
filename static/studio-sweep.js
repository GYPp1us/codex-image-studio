"use strict";
globalThis.StudioSweep=(function sweep(){
  let stroke=null,frame,edgeFrame,clickGuard,lastAnchor=null;
  const hit=(x,y)=>document.elementFromPoint?.(x,y)?.closest('#page .tile');
  function snapshot(first){
    const group=first.closest('.grid,.recent')||$('#page');
    const map=new Map();
    for(const el of $$('.tile',group)){const id=el.dataset.id;if(!map.has(id))map.set(id,[]);map.get(id).push(el);}
    return {group,map,order:[...map.keys()]};
  }
  function activate(){
    const s=stroke;if(!s)return;
    s.active=true;s.base=new Set(StudioSelection.chosen());s.add=!s.base.has(s.id);
    Object.assign(s,snapshot(s.el));
    StudioSelection.begin();
    s.el.setPointerCapture?.(s.pointer);
    navigator.vibrate?.(10);apply(s.id);
  }
  function apply(id){
    const s=stroke;if(!s?.active||!id)return;
    if(!s.map.has(id))Object.assign(s,snapshot(s.el));
    const start=s.order.indexOf(s.id),end=s.order.indexOf(id);if(start<0||end<0)return;
    const next=new Set(s.base);
    for(const key of s.order.slice(Math.min(start,end),Math.max(start,end)+1))s.add?next.add(key):next.delete(key);
    StudioSelection.applyRange(next,s.map);lastAnchor=s.id;
  }
  function speed(s){
    if(!s.scroller)return 0;
    const rect=s.scroller.getBoundingClientRect(),bar=$('#selection-toolbar')?.getBoundingClientRect();
    const top=rect.top,bottom=bar&&bar.top>top?Math.min(rect.bottom,bar.top):rect.bottom;
    if(s.y<top+48)return -Math.ceil(16*Math.min(1,(top+48-s.y)/48));
    if(s.y>bottom-48)return Math.ceil(16*Math.min(1,(s.y-bottom+48)/48));
    return 0;
  }
  function scroll(){
    edgeFrame=null;
    const s=stroke;if(!s?.active)return;
    const step=speed(s);if(!step)return;
    const previous=s.scroller.scrollTop;
    s.scroller.scrollTop+=step;
    if(s.scroller.scrollTop!==previous)apply(hit(s.x,s.y)?.dataset.id);
    edgeFrame=requestAnimationFrame(scroll);
  }
  function move(e){
    const s=stroke;if(!s||e.pointerId!==s.pointer)return;
    if(!s.active){if(Math.hypot(s.startX-e.clientX,s.startY-e.clientY)>10)finish(false);return;}
    s.x=e.clientX;s.y=e.clientY;
    if(e.cancelable)e.preventDefault();
    if(frame==null)frame=requestAnimationFrame(()=>{frame=null;if(stroke===s)apply(hit(s.x,s.y)?.dataset.id);});
    if(edgeFrame==null&&speed(s))edgeFrame=requestAnimationFrame(scroll);
  }
  function finish(rollback){
    const s=stroke;if(!s)return;
    stroke=null;clearTimeout(s.timer);cancelAnimationFrame(frame);cancelAnimationFrame(edgeFrame);frame=edgeFrame=null;
    s.el.classList.remove('pressing');
    if(!s.active)return;
    if(rollback)StudioSelection.applyRange(s.base,s.map);
    clickGuard={until:performance.now()+650,pointer:s.pointer};
    try{s.el.releasePointerCapture?.(s.pointer);}catch{}
    globalThis.StudioFolders?.changed();
  }
  app.addEventListener('pointerdown',e=>{
    if(stroke&&e.pointerId!==stroke.pointer){finish(true);return;}
    const el=e.target.closest('#page .tile');
    if(!el||S.tab!=='works'||e.button>0||e.isPrimary===false)return;
    clickGuard=null;el.classList.add('pressing');
    stroke={el,id:el.dataset.id,pointer:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,
      scroller:el.closest('.scroll'),timer:setTimeout(activate,420)};
  });
  app.addEventListener('pointermove',move);
  app.addEventListener('pointerup',e=>{if(stroke?.pointer===e.pointerId){if(stroke.active)apply(hit(e.clientX,e.clientY)?.dataset.id);finish(false);}});
  app.addEventListener('pointercancel',()=>finish(true));
  app.addEventListener('lostpointercapture',e=>{if(stroke?.active&&e.pointerId===stroke.pointer)finish(true);});
  app.addEventListener('touchmove',e=>{if(stroke?.active&&e.cancelable)e.preventDefault();},{passive:false});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish(true);});
  addEventListener('orientationchange',()=>finish(true));
  function click(e,el){
    if(el.dataset.act!=='img'||S.tab!=='works')return false;
    if(clickGuard&&clickGuard.until>=performance.now()&&(e.pointerId==null||e.pointerId===clickGuard.pointer)){
      clickGuard=null;e.preventDefault();return true;
    }
    if(e.ctrlKey||e.metaKey||e.shiftKey){
      const {order,map}=snapshot(el),id=el.dataset.id;
      const existing=new Set(StudioSelection.chosen());StudioSelection.begin();
      if(e.shiftKey&&order.includes(lastAnchor)){
        const a=order.indexOf(lastAnchor),b=order.indexOf(id);for(const value of order.slice(Math.min(a,b),Math.max(a,b)+1))existing.add(value);
      }else{existing.has(id)?existing.delete(id):existing.add(id);lastAnchor=id;}
      StudioSelection.applyRange(existing,map);e.preventDefault();return true;
    }
    lastAnchor=el.dataset.id;return false;
  }
  return {holding:()=>!!stroke?.active,click,canAppend(){
    if(!stroke?.active)return true;
    const ids=globalThis.StudioFolders?.items(stroke.el.dataset.list);
    return !!ids&&stroke.order.every((id,i)=>ids[i]===id);
  }};
})();
