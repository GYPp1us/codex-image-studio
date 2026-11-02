"use strict";
/* One pending operation survives keyed UI refreshes and remains visible on its trigger. */
const StudioFeedback=(()=>{
  const operations=new Map(),saved=new WeakMap();
  const keyFor=el=>el.dataset.pendingKey||`action:${el.dataset.act}:${el.dataset.id||el.dataset.t||el.dataset.b||''}`;
  function mark(el,busy){
    if(busy){
      if(!saved.has(el))saved.set(el,{disabled:el.disabled,busy:el.getAttribute('aria-busy')});
      el.dataset.pending='1';el.setAttribute('aria-busy','true');
      if('disabled' in el)el.disabled=true;
      if(!el.querySelector(':scope > .action-spinner')){const spin=document.createElement('span');spin.className='action-spinner';spin.setAttribute('aria-hidden','true');el.append(spin);}
    }else if(saved.has(el)){
      const old=saved.get(el);saved.delete(el);delete el.dataset.pending;
      if(old.busy===null)el.removeAttribute('aria-busy');else el.setAttribute('aria-busy',old.busy);
      if('disabled' in el)el.disabled=old.disabled;
      el.querySelector(':scope > .action-spinner')?.remove();
    }
  }
  function hydrate(root=document){
    const elements=[...(root.matches?.('[data-act],[data-pending-key]')?[root]:[]),...root.querySelectorAll?.('[data-act],[data-pending-key]')||[]];
    for(const el of elements)mark(el,operations.has(keyFor(el)));
  }
  function run(key,el,fn){
    if(operations.has(key))return operations.get(key);
    if(el){el.dataset.pendingKey=key;mark(el,true);}
    const task=Promise.resolve().then(fn).finally(()=>{operations.delete(key);if(el)mark(el,false);hydrate();});
    operations.set(key,task);hydrate();return task;
  }
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&!node.classList.contains('action-spinner'))hydrate(node);}).observe(document.documentElement,{subtree:true,childList:true});
  return {run,keyFor,busy:key=>operations.has(key),hydrate};
})();
