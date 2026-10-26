"use strict";
// Keep unchanged image elements (and decoded pixels) alive across queue polls.
globalThis.StudioDOM = (() => {
  const rendered = new WeakMap();
  const key = n => n.nodeType === 1 ? (n.id || (n.hasAttribute("data-id") ? `${n.tagName}:${n.getAttribute("data-action")||""}:${n.getAttribute("data-id")}` : "")) : "";
  const compatible = (a,b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);
  function morph(current, next) {
    if(current.nodeType !== 1) {if(current.nodeValue !== next.nodeValue) current.nodeValue=next.nodeValue;return;}
    for(const a of [...current.attributes]) if(!next.hasAttribute(a.name)) current.removeAttribute(a.name);
    for(const a of [...next.attributes]) if(current.getAttribute(a.name) !== a.value) current.setAttribute(a.name,a.value);
    children(current,next);
  }
  function children(parent, nextParent) {
    const old=[...parent.childNodes], keyed=new Map(old.map(n=>[key(n),n]).filter(([k])=>k));
    const used=new Set();let cursor=parent.firstChild;
    for(const next of [...nextParent.childNodes]) {
      const k=key(next);
      let node=k?keyed.get(k):cursor && !key(cursor) && !used.has(cursor) && compatible(cursor,next)?cursor:null;
      if(node && (!compatible(node,next)||used.has(node)))node=null;
      if(!node)node=next.cloneNode(true);
      if(node!==cursor)parent.insertBefore(node,cursor);
      morph(node,next);used.add(node);cursor=node.nextSibling;
    }
    for(const n of old)if(!used.has(n)&&n.parentNode===parent)parent.removeChild(n);
  }
  function updateHTML(element, html) {
    if(!element || rendered.get(element) === html)return;
    const template=element.ownerDocument.createElement("template");template.innerHTML=html;
    children(element,template.content);rendered.set(element,html);
  }
  return {updateHTML};
})();
