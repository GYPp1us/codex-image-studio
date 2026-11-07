"use strict";
/* One pending operation survives keyed UI refreshes and remains visible on its trigger. */
const StudioFeedback=(()=>{
  const operations=new Map(),saved=new WeakMap();
  const keyFor=el=>el.dataset.pendingKey||`action:${el.dataset.act}:${el.dataset.id||el.dataset.t||el.dataset.b||''}`;
  function reveal(el,old){
    for(const node of old.hidden){node.removeAttribute('data-pending-icon');node.removeAttribute('data-pending-content');}
    old.hidden.clear();
    for(const span of old.wrappers)if(span.parentNode){while(span.firstChild)span.before(span.firstChild);span.remove();}
    old.wrappers.clear();
  }
  function visible(node,el){
    for(let p=node;p&&p!==el;p=p.parentElement){if(p.hidden)return false;if(typeof getComputedStyle==='function'){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;}}
    return true;
  }
  function presentation(el,old){
    // Restore before inspecting: our own hidden icon must not look like a business-hidden icon.
    for(const node of old.hidden){node.removeAttribute('data-pending-icon');node.removeAttribute('data-pending-content');}old.hidden.clear();
    const symbol=[...el.querySelectorAll('svg,.switch,[data-ic]:empty')].find(node=>visible(node,el));
    el.dataset.pendingMode=symbol?'icon':'text';
    if(symbol){symbol.setAttribute('data-pending-icon','1');old.hidden.add(symbol);
      const box=el.getBoundingClientRect(),rect=symbol.getBoundingClientRect(),scale=box.width/(el.offsetWidth||box.width)||1;
      el.style.setProperty('--action-x',((rect.left+rect.width/2-box.left)/scale)+'px');el.style.setProperty('--action-y',((rect.top+rect.height/2-box.top)/scale)+'px');
    }else{
      el.style.removeProperty('--action-x');el.style.removeProperty('--action-y');
      for(const node of [...el.childNodes]){
        if(node.nodeType===3&&node.textContent.trim()){const span=document.createElement('span');span.dataset.pendingWrap='1';node.before(span);span.append(node);old.wrappers.add(span);}
      }
      for(const node of el.children)if(!node.classList.contains('action-spinner')){node.setAttribute('data-pending-content','1');old.hidden.add(node);}
    }
  }
  function mark(el,busy){
    if(busy){
      if(!saved.has(el)){const old={disabled:el.disabled,busy:el.getAttribute('aria-busy'),label:el.getAttribute('aria-label'),hidden:new Set(),wrappers:new Set()};saved.set(el,old);if(old.label===null)el.setAttribute('aria-label',el.textContent.trim()||el.title||'正在处理');}
      el.dataset.pending='1';el.setAttribute('aria-busy','true');
      if('disabled' in el)el.disabled=true;
      presentation(el,saved.get(el));
      if(!el.querySelector(':scope > .action-spinner')){const spin=document.createElement('span');spin.className='action-spinner';spin.setAttribute('aria-hidden','true');el.append(spin);}
    }else if(saved.has(el)){
      const old=saved.get(el);saved.delete(el);delete el.dataset.pending;delete el.dataset.pendingMode;reveal(el,old);
      if(old.busy===null)el.removeAttribute('aria-busy');else el.setAttribute('aria-busy',old.busy);
      if('disabled' in el)el.disabled=old.disabled;
      if(old.label===null)el.removeAttribute('aria-label');else el.setAttribute('aria-label',old.label);
      el.style.removeProperty('--action-x');el.style.removeProperty('--action-y');
      el.querySelector(':scope > .action-spinner')?.remove();
    }
  }
  function hydrate(root=document){
    const elements=[...(root.matches?.('[data-act],[data-pending-key]')?[root]:[]),...root.querySelectorAll?.('[data-act],[data-pending-key]')||[]];
    for(const el of elements)mark(el,operations.has(keyFor(el)));
  }
  function run(key,el,fn,{immediate=false}={}){
    if(operations.has(key))return operations.get(key);
    if(el){el.dataset.pendingKey=key;mark(el,true);}
    let start;const action=new Promise((resolve,reject)=>{start=()=>{try{resolve(fn());}catch(error){reject(error);}};});
    const task=action.finally(()=>{operations.delete(key);if(el&&keyFor(el)===key)mark(el,false);hydrate();});
    operations.set(key,task);hydrate();if(immediate)start();else Promise.resolve().then(start);return task;
  }
  new MutationObserver(records=>{const changed=new Set();for(const record of records){const busy=record.target.closest?.('[data-pending="1"]');if(busy&&[...record.addedNodes].some(node=>node.nodeType!==1||!node.classList.contains('action-spinner')&&!node.hasAttribute('data-pending-wrap')))changed.add(busy);for(const node of record.addedNodes)if(node.nodeType===1&&!node.classList.contains('action-spinner')&&!node.hasAttribute('data-pending-wrap'))hydrate(node);}for(const el of changed)mark(el,operations.has(keyFor(el)));}).observe(document.documentElement,{subtree:true,childList:true});
  return {run,keyFor,busy:key=>operations.has(key),hydrate};
})();
