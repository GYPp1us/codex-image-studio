"use strict";
// One history owner for browser/PWA/Android. UI layers never install competing
// popstate handlers. Panel content may change without adding another panel.
globalThis.StudioLayers = (() => {
  const stack=[];let serial=0,pending=0;const queue=[];
  const depth=()=>stack.length;
  function drain(){for(const run of queue.splice(0))run();}
  function push(kind,dispose){
    const add=()=>{const token=++serial;stack.push({kind,dispose,token});history.pushState({...history.state,studioDepth:stack.length,studioLayer:token},'',location.href);};
    if(pending)queue.push(add);else add();
  }
  function close(kind){
    if(!stack.length)return false;
    if(kind&&stack.at(-1).kind!==kind)return false;
    const item=stack.pop();item.dispose();pending++;if(pending===1)history.back();return true;
  }
  function pop(event){
    if(pending){pending--;if(pending){history.back();return;}}
    const target=Math.max(0,Number(event.state?.studioDepth)||0);
    while(stack.length>target)stack.pop().dispose();
    drain();
  }
  function reset(){while(stack.length)stack.pop().dispose();queue.length=0;const replace=()=>history.replaceState({...history.state,studioDepth:0},'',location.href);if(pending)queue.push(replace);else replace();}
  if(typeof window!=='undefined')window.addEventListener('popstate',pop);
  return {push,close,reset,get depth(){return depth();},get top(){return stack.at(-1)?.kind;}};
})();

globalThis.StudioPanels = (() => {
  let clean=null,drag=null,version=0;const paints=new WeakMap();
  function host(){return document.getElementById('modal');}
  function dispose(){version++;const dialog=host();if(dialog?.open)dialog.close();if(typeof S!=='undefined')S.modalJob=null;clean?.();clean=null;}
  function enhance(root){
    // Custom enumerations share native change events so existing controls retain
    // their validation and save paths, without native select sheets in panels.
    root.querySelectorAll('select:not([data-enhanced])').forEach(select=>{
      select.dataset.enhanced='true';
      const wrapper=document.createElement('div');wrapper.className='choice-control';
      wrapper.setAttribute('role','group');wrapper.setAttribute('aria-label',select.getAttribute('aria-label')||select.closest('label')?.textContent||'选择参数');
      const paint=()=>{wrapper.replaceChildren();for(const option of select.options){const button=document.createElement('button');button.type='button';button.textContent=option.textContent;button.className=option.value===select.value?'selected':'';button.setAttribute('aria-pressed',String(option.value===select.value));button.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));paint();};wrapper.append(button);}};
      select.hidden=true;select.after(wrapper);paint();paints.set(select,paint);select.addEventListener('change',paint);
    });
  }
  function show(title,html,{onClose}={}){
    version++;
    const dialog=host(),wasOpen=dialog.open;
    if(wasOpen){clean?.();clean=null;}
    clean=onClose||null;
    dialog.innerHTML=`<div id="modal-content"><div class="modal-head"><span class="panel-grip" aria-hidden="true"></span><h3>${esc(title)}</h3><button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><div class="modal-body">${html}</div></div>`;
    if(!wasOpen){dialog.showModal();StudioLayers.push('panel',dispose);if(!document.documentElement.classList.contains('reduce-motion'))dialog.animate?.([{opacity:0,transform:'translateY(28px)'},{opacity:1,transform:'translateY(0)'}],{duration:280,easing:'cubic-bezier(.32,.72,0,1)'});}
    enhance(dialog);globalThis.StudioImages?.hydrate(dialog);
    dialog.oncancel=event=>{event.preventDefault();StudioLayers.close('panel');};
    const head=dialog.querySelector('.modal-head');
    head.onpointerdown=event=>{if(event.target.closest('button'))return;drag={y:event.clientY};head.setPointerCapture?.(event.pointerId);};
    head.onpointermove=event=>{if(drag){const y=Math.max(0,event.clientY-drag.y);dialog.style.transform=`translateY(${y}px)`;}};
    head.onpointerup=head.onpointercancel=event=>{if(!drag)return;const distance=event.clientY-drag.y;drag=null;dialog.style.transform='';if(distance>90)StudioLayers.close('panel');};
    return dialog;
  }
  return {show,enhance,get version(){return version;},refresh(root){root.querySelectorAll('select[data-enhanced]').forEach(select=>paints.get(select)?.());},close(){if(!StudioLayers.close('panel'))dispose();},dispose};
})();
