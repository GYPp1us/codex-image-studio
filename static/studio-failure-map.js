"use strict";
/* One canvas for arbitrarily many diagnostic cells; the accessible list is paged. */
const StudioFailureMap=(()=>{
  const bindings=new WeakMap();
  function paint(canvas){
    const d=FX.diag,task=fxTask();if(!d||!task||!canvas.isConnected)return;
    const W=canvas.clientWidth||canvas.parentElement.clientWidth,H=canvas.clientHeight||canvas.parentElement.clientHeight;if(!W||!H)return;
    const ratio=Math.min(globalThis.devicePixelRatio||1,2,Math.sqrt(2_000_000/(W*H)));canvas.width=Math.round(W*ratio);canvas.height=Math.round(H*ratio);
    const ctx=canvas.getContext?.('2d');if(!ctx)return;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,W,H);
    const [w,h]=d.input_size,k=Math.min(W/w,H/h),left=(W-w*k)/2,top=(H-h*k)/2;
    const accent=getComputedStyle(app).getPropertyValue('--sage-ink').trim()||'#5d7350',tiles=task.up.levels[task.up.cur].tiles,b=bindings.get(canvas);
    for(const tile of tiles){const [a,y,c,e]=tile.core,x=left+a*k,t=top+y*k,rw=(c-a)*k,rh=(e-y)*k,selected=FX.sel.has(tile.i);
      if(selected){ctx.globalAlpha=.28;ctx.fillStyle=accent;ctx.fillRect(x,t,rw,rh);ctx.globalAlpha=1;}
      ctx.strokeStyle=selected?accent:tile.state==='done'?'#fff9':'#d6553c';ctx.lineWidth=selected?2:1;ctx.strokeRect(x+.5,t+.5,Math.max(0,rw-1),Math.max(0,rh-1));
      if(tile.i===b?.focus){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.setLineDash([4,3]);ctx.strokeRect(x+2,t+2,Math.max(0,rw-4),Math.max(0,rh-4));ctx.setLineDash([]);}
      if(rw>28&&rh>20){ctx.font='10px system-ui';const text=String(tile.i+1);ctx.fillStyle='#0009';ctx.fillRect(x+2,t+2,ctx.measureText(text).width+7,14);ctx.fillStyle='#fff';ctx.fillText(text,x+5,t+13);}
    }
    canvas.setAttribute('aria-label',`诊断切图，已选 ${FX.sel.size} 块。点击选择；左右键定位图块，空格选择。`);
  }
  function hydrate(root){
    const canvas=root?.querySelector('[data-failure-map]');if(!canvas)return;
    if(!bindings.has(canvas)){
      const b={focus:null,down:null,observer:null};bindings.set(canvas,b);
      canvas.addEventListener('pointerdown',event=>{b.down={x:event.clientX,y:event.clientY};},{passive:true});
      canvas.addEventListener('pointercancel',()=>b.down=null);
      canvas.addEventListener('pointerup',event=>{
        const start=b.down;b.down=null;if(!start||Math.hypot(event.clientX-start.x,event.clientY-start.y)>8)return;
        const rect=canvas.getBoundingClientRect(),[w,h]=FX.diag.input_size,k=Math.min(rect.width/w,rect.height/h),x=(event.clientX-rect.left-(rect.width-w*k)/2)/k,y=(event.clientY-rect.top-(rect.height-h*k)/2)/k;
        const tile=fxTask().up.levels[fxTask().up.cur].tiles.find(tile=>x>=tile.core[0]&&x<tile.core[2]&&y>=tile.core[1]&&y<tile.core[3]);
        if(tile){FX.sel.has(tile.i)?FX.sel.delete(tile.i):FX.sel.add(tile.i);b.focus=tile.i;fxSel(root);}
      });
      canvas.addEventListener('keydown',event=>{const tiles=fxTask().up.levels[fxTask().up.cur].tiles,i=tiles.findIndex(t=>t.i===b.focus);if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();b.focus=tiles[clamp(i+(event.key==='ArrowLeft'?-1:1),0,tiles.length-1)]?.i;paint(canvas);}if([' ','Enter'].includes(event.key)&&b.focus!==null){event.preventDefault();FX.sel.has(b.focus)?FX.sel.delete(b.focus):FX.sel.add(b.focus);fxSel(root);}});
      if(typeof ResizeObserver==='function'){b.observer=new ResizeObserver(()=>paint(canvas));b.observer.observe(canvas);}
    }
    paint(canvas);
  }
  new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node.nodeType===1)for(const canvas of [...(node.matches?.('[data-failure-map]')?[node]:[]),...node.querySelectorAll('[data-failure-map]')])if(!canvas.isConnected)bindings.get(canvas)?.observer?.disconnect();}).observe(document.documentElement,{childList:true,subtree:true});
  app.addEventListener('change',event=>{if(!event.target.hasAttribute('data-fx-jump'))return;const index=Number(event.target.value)-1,lv=fxTask()?.up.levels[fxTask().up.cur];if(!lv||!Number.isInteger(index))return;const tile=lv.tiles.find(t=>t.i===index);if(!tile){toast('没有这个图块编号');return;}if(tile.state==='done')FX.showOk=true;const order=[...lv.tiles.filter(t=>t.state!=='done'),...(FX.showOk?lv.tiles.filter(t=>t.state==='done'):[])];FX.page=Math.floor(order.findIndex(t=>t.i===index)/40);fxRender();const row=$(`#fx-list [data-i="${index}"]`,topScreen());row?.scrollIntoView({block:'center',behavior:RM?'auto':'smooth'});row?.classList.add('hl');});
  return {hydrate};
})();
