"use strict";
/* Apply trusted layout values through CSSOM, keeping style-src 'self' intact. */
const StudioLayout=(()=>{
  const applied=new WeakMap();
  function hydrate(root){if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11)return;const elements=[...(root.matches?.('[data-layout]')?[root]:[]),...root.querySelectorAll('[data-layout]')];for(const el of elements){const value=el.getAttribute('data-layout');if(applied.get(el)===value)continue;el.style.cssText=value;applied.set(el,value);}}
  const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')hydrate(record.target);else for(const node of record.addedNodes)hydrate(node);}});
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-layout']});hydrate(document);return {hydrate};
})();
