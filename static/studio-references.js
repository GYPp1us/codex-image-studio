"use strict";
/* Shared reference strip: order is the order sent to the model. */
const StudioReferences=(()=>{
  const bindings=new WeakMap(),cancellations=new Set();
  function render(box,options){
    if(!box)return;let binding=bindings.get(box);
    if(!binding){binding={options,drag:null,suppress:false};bindings.set(box,binding);bind(box,binding);}binding.options=options;
    if(binding.drag)return;
    const ids=options.read();
    syncList(box,[...ids.map(id=>({id})),{id:'__add'}],x=>x.id,x=>x.id==='__add'?`<button class="ref-add" data-reference="add" aria-label="添加参考图">${icon('plus',22)}</button>`:`<div class="ref" data-ref-id="${x.id}"><button class="ref-preview" data-reference="view" data-id="${x.id}" aria-label="放大参考图 ${ids.indexOf(x.id)+1}"><img draggable="false" src="${src(img(x.id))}" alt="参考图 ${ids.indexOf(x.id)+1}"></button><button class="ref-grab" data-reference="drag" aria-label="拖动排序，或用左右方向键调整">${icon('grip',14)}</button><button class="rm" data-reference="remove" data-id="${x.id}" aria-label="移除参考图">${icon('x',12)}</button><span class="ref-number">${ids.indexOf(x.id)+1}</span></div>`);
  }
  function bind(box,b){
    box.addEventListener('click',e=>{const target=e.target.closest('[data-reference]');if(!target)return;e.preventDefault();e.stopPropagation();if(b.suppress){b.suppress=false;return;}
      if(target.dataset.reference==='add')b.options.add();
      if(target.dataset.reference==='view')openViewer(target.dataset.id,null,{reference:true,ids:[...b.options.read()]});
      if(target.dataset.reference==='remove')b.options.write(b.options.read().filter(id=>id!==target.dataset.id));
    });
    box.addEventListener('keydown',e=>{const grab=e.target.closest('[data-reference="drag"]');if(!grab||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const ids=[...b.options.read()],i=ids.indexOf(grab.closest('[data-ref-id]').dataset.refId),j=clamp(i+(e.key==='ArrowLeft'?-1:1),0,ids.length-1);if(i!==j){[ids[i],ids[j]]=[ids[j],ids[i]];b.options.write(ids);box.querySelector(`[data-ref-id="${ids[j]}"] .ref-grab`)?.focus();}});
    box.addEventListener('pointerdown',e=>{
      if(e.button>0||!e.target.closest('[data-reference="drag"]'))return;e.preventDefault();
      const el=e.target.closest('[data-ref-id]'),r=el.getBoundingClientRect(),ghost=el.cloneNode(true);ghost.classList.add('reference-drag-ghost');
      Object.assign(ghost.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});document.body.append(ghost);
      b.drag={id:el.dataset.refId,el,ghost,order:[...b.options.read()],x:e.clientX,y:e.clientY,pointer:e.pointerId};cancellations.add(cancel);el.classList.add('reference-dragging');box.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove',e=>{
      const d=b.drag;if(!d||d.pointer!==e.pointerId)return;e.preventDefault();d.ghost.style.transform=`translate3d(${e.clientX-d.x}px,${e.clientY-d.y}px,0)`;
      const other=[...box.querySelectorAll('[data-ref-id]')].filter(el=>el!==d.el),next=other.find(el=>{const r=el.getBoundingClientRect();return e.clientX<r.left+r.width/2;});
      const order=other.map(el=>el.dataset.refId),index=next?order.indexOf(next.dataset.refId):order.length;order.splice(index,0,d.id);
      if(order.join()!==d.order.join()){const positions=new Map(other.map(el=>[el,el.getBoundingClientRect().left]));box.insertBefore(d.el,next||box.querySelector('.ref-add'));d.order=order;for(const el of other){const dx=positions.get(el)-el.getBoundingClientRect().left;if(dx)el.animate([{transform:`translateX(${dx}px)`},{transform:'none'}],{duration:D(160),easing:E.std});}}
      const edge=box.getBoundingClientRect();if(e.clientX<edge.left+28)box.scrollLeft-=8;else if(e.clientX>edge.right-28)box.scrollLeft+=8;
    });
    const finish=(e,discard=false)=>{const d=b.drag;if(!d||d.pointer!==e.pointerId)return;b.drag=null;cancellations.delete(cancel);d.ghost.remove();d.el.classList.remove('reference-dragging');b.suppress=true;if(!discard)b.options.write(d.order);else render(box,b.options);setTimeout(()=>b.suppress=false,0);};
    const cancel=()=>{if(b.drag)finish({pointerId:b.drag.pointer},true);};
    box.addEventListener('pointerup',e=>finish(e));box.addEventListener('pointercancel',e=>finish(e,true));
    box.addEventListener('lostpointercapture',cancel);
  }
  return {render,cancel(){for(const discard of [...cancellations])discard();}};
})();
