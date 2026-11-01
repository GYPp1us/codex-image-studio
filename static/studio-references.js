"use strict";
/* Direct manipulation: a tap previews; a still hold lifts into horizontal ordering. */
const StudioReferences=(()=>{
  const bindings=new WeakMap(),cancellations=new Set(),HOLD=420,SLOP=8;
  function render(box,options){
    if(!box)return;let b=bindings.get(box);
    if(!b){b={options,press:null,suppressUntil:0};bindings.set(box,b);bind(box,b);}b.options=options;
    if(b.press)return;
    const ids=options.read();
    syncList(box,[...ids.map(id=>({id})),{id:'__add'}],x=>x.id,x=>x.id==='__add'?`<button class="ref-add" data-reference="add" aria-label="添加参考图">${icon('plus',22)}</button>`:`<div class="ref" data-ref-id="${x.id}"><button class="ref-preview" data-reference="view" data-id="${x.id}" aria-label="放大参考图 ${ids.indexOf(x.id)+1}；长按或 Alt 加左右键排序" aria-roledescription="可排序参考图"><img draggable="false" src="${src(img(x.id))}" alt="参考图 ${ids.indexOf(x.id)+1}"></button><button class="rm" data-reference="remove" data-id="${x.id}" aria-label="移除参考图">${icon('x',12)}</button><span class="ref-number">${ids.indexOf(x.id)+1}</span></div>`);
  }
  function bind(box,b){
    let frame=0,lastFrame=0;
    const movePeers=d=>{
      const others=[...box.querySelectorAll('[data-ref-id]')].filter(el=>el!==d.el);
      const center=d.left+d.width/2+d.dx;
      const next=others.find(el=>{const r=el.getBoundingClientRect();return center<r.left+r.width/2;});
      const order=others.map(el=>el.dataset.refId),i=next?order.indexOf(next.dataset.refId):order.length;order.splice(i,0,d.id);
      if(order.join()===d.order.join())return;
      const before=new Map(others.map(el=>[el,el.getBoundingClientRect().left]));box.insertBefore(d.el,next||box.querySelector('.ref-add'));d.order=order;
      for(const el of others){const dx=before.get(el)-el.getBoundingClientRect().left;if(dx){el.getAnimations().forEach(a=>a.cancel());el.animate([{transform:`translateX(${dx}px)`},{transform:'none'}],{duration:D(180),easing:E.emph});}}
    };
    const paint=now=>{
      frame=0;const d=b.press;if(!d?.active)return;
      if(!box.isConnected||!d.el.isConnected){finish(true);return;}
      const r=box.getBoundingClientRect(),dt=Math.min(32,now-(lastFrame||now));lastFrame=now;
      const edge=40,speed=d.clientX<r.left+edge?-Math.min(1,(r.left+edge-d.clientX)/edge):d.clientX>r.right-edge?Math.min(1,(d.clientX-r.right+edge)/edge):0;
      if(speed)box.scrollLeft+=speed*dt*.42;
      d.dx=clamp(d.clientX-d.startX,r.left-d.left-d.width*.25,r.right-d.left-d.width*.75);
      d.ghost.style.transform=`translate3d(${d.dx}px,0,0) scale(1.04)`;movePeers(d);
      if(speed)frame=requestAnimationFrame(paint);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(paint);};
    function finish(discard=false){
      const d=b.press;if(!d)return;
      if(!discard&&d.active&&d.el.isConnected&&box.isConnected){cancelAnimationFrame(frame);frame=0;paint(performance.now());}
      b.press=null;clearTimeout(d.timer);cancellations.delete(cancel);cancelAnimationFrame(frame);frame=0;lastFrame=0;
      d.el.classList.remove('reference-pressing','reference-dragging');box.classList.remove('reference-ordering');
      if(d.active){
        b.suppressUntil=performance.now()+650;
        if(box.hasPointerCapture?.(d.pointer))box.releasePointerCapture(d.pointer);
        const target=d.el.getBoundingClientRect(),ghost=d.ghost;
        if(!discard&&ghost?.isConnected&&!RM){const animation=ghost.animate([{transform:ghost.style.transform},{transform:`translate3d(${target.left-d.left}px,${target.top-d.top}px,0) scale(1)`}],{duration:D(180),easing:E.emph,fill:'forwards'});animation.finished.catch(()=>{}).finally(()=>ghost.remove());}else ghost?.remove();
        if(!discard)b.options.write(d.order);
      }
      render(box,b.options);
    }
    const cancel=()=>finish(true);
    function activate(){
      const d=b.press;if(!d||!box.isConnected||!d.el.isConnected)return cancel();
      const r=d.el.getBoundingClientRect();d.left=r.left;d.top=r.top;d.width=r.width;d.dx=0;d.active=true;
      const ghost=d.el.cloneNode(true);ghost.classList.add('reference-drag-ghost');ghost.classList.remove('reference-pressing');ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',transform:'translate3d(0,0,0) scale(1.04)'});document.body.append(ghost);d.ghost=ghost;
      d.el.classList.remove('reference-pressing');d.el.classList.add('reference-dragging');box.classList.add('reference-ordering');box.setPointerCapture?.(d.pointer);
      navigator.vibrate?.(8);schedule();
    }
    box.addEventListener('pointerdown',e=>{
      if(e.button>0||!e.target.closest('[data-reference="view"]'))return;
      if(b.press){cancel();return;}
      const el=e.target.closest('[data-ref-id]');el.classList.add('reference-pressing');
      b.press={id:el.dataset.refId,el,order:[...b.options.read()],startX:e.clientX,startY:e.clientY,clientX:e.clientX,pointer:e.pointerId,active:false,timer:setTimeout(activate,HOLD)};cancellations.add(cancel);
    });
    box.addEventListener('pointermove',e=>{const d=b.press;if(!d||d.pointer!==e.pointerId)return;if(!d.active){if(Math.hypot(e.clientX-d.startX,e.clientY-d.startY)>SLOP)cancel();return;}e.preventDefault();d.clientX=e.clientX;schedule();});
    // Keep native scrolling before the hold; claim touch movement only after lift.
    box.addEventListener('touchmove',e=>{if(b.press?.active)e.preventDefault();},{passive:false});
    box.addEventListener('touchstart',e=>{if(e.touches.length>1)cancel();},{passive:true});
    box.addEventListener('pointerup',e=>{if(b.press?.pointer===e.pointerId){b.press.clientX=e.clientX;finish(false);}});
    box.addEventListener('pointercancel',cancel);box.addEventListener('lostpointercapture',cancel);
    box.addEventListener('contextmenu',e=>{if(e.target.closest('[data-ref-id]'))e.preventDefault();});
    box.addEventListener('click',e=>{
      const target=e.target.closest('[data-reference]');if(!target)return;e.preventDefault();e.stopPropagation();
      if(performance.now()<b.suppressUntil)return;
      if(target.dataset.reference==='add')b.options.add();
      if(target.dataset.reference==='view')openViewer(target.dataset.id,null,{reference:true,ids:[...b.options.read()]});
      if(target.dataset.reference==='remove')b.options.write(b.options.read().filter(id=>id!==target.dataset.id));
    });
    box.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&b.press){e.preventDefault();cancel();return;}
      const view=e.target.closest('[data-reference="view"]');if(!view||!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();const ids=[...b.options.read()],i=ids.indexOf(view.dataset.id),j=clamp(i+(e.key==='ArrowLeft'?-1:1),0,ids.length-1);
      if(i!==j){[ids[i],ids[j]]=[ids[j],ids[i]];b.options.write(ids);box.querySelector(`[data-ref-id="${view.dataset.id}"] .ref-preview`)?.focus();toast(`已移到第 ${j+1} 张`);}
    });
  }
  const cancelAll=()=>{for(const cancel of [...cancellations])cancel();};
  document.addEventListener('pointerup',cancelAll);document.addEventListener('pointercancel',cancelAll);
  addEventListener('resize',cancelAll);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelAll();});
  return {render,cancel:cancelAll};
})();
