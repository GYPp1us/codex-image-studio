"use strict";
/* Zoom and bounded DZI loading extend the demo viewer without changing its chrome. */
const StudioZoom=(()=>{
  let scale=1,x=0,y=0,id=null,gesture=null,timer=null,tiles=new Map();const points=new Map();
  function image(){return img(V.list[V.i]);}
  function reset(){scale=1;x=y=0;id=image()?.id;points.clear();gesture=null;clearTimeout(timer);for(const tile of tiles.values())tile.remove();tiles.clear();$('.native-tiles',stage)?.remove();}
  function geometry(){const r=fitRect(image());return {x:r.x+(r.w-r.w*scale)/2+x,y:r.y+(r.h-r.h*scale)/2+y,w:r.w*scale,h:r.h*scale};}
  function nativeScale(){return image().w/fitRect(image()).w;}
  function paint(){if(!V.open||!image()||!curImg())return;if(id!==image().id)reset();const fit=fitRect(image()),w=fit.w*scale,h=fit.h*scale;
    x=clamp(x,-Math.max(0,(w-app.offsetWidth)/2),Math.max(0,(w-app.offsetWidth)/2));y=clamp(y,-Math.max(0,(h-(app.offsetHeight-200-58))/2),Math.max(0,(h-(app.offsetHeight-200-58))/2));
    const g=geometry();Object.assign(curImg().style,{left:g.x+'px',top:g.y+'px',width:g.w+'px',height:g.h+'px',transform:''});clearTimeout(timer);if(image().tile_template)timer=setTimeout(paintTiles,70);}
  function zoom(value,p={x:app.offsetWidth/2,y:app.offsetHeight/2}){if(!V.open||V.redraw)return;if(id!==image().id)reset();const before=geometry(),ax=(p.x-before.x)/before.w,ay=(p.y-before.y)/before.h;scale=clamp(value,1,Math.max(4,nativeScale()*2));const fit=fitRect(image());x=p.x-(fit.x+(fit.w-fit.w*scale)/2)-ax*fit.w*scale;y=p.y-(fit.y+(fit.h-fit.h*scale)/2)-ay*fit.h*scale;paint();}
  function toggleNative(){if(!V.open)return;zoom(scale>1.01?1:Math.max(1,nativeScale()));vw.classList.remove('chrome-off');}
  function paintTiles(){if(!V.open||!image()?.tile_template)return;const im=image(),g=geometry(),native=g.w/im.w,maximum=Math.ceil(Math.log2(Math.max(im.w,im.h))),level=clamp(Math.ceil(maximum+Math.log2(native*(devicePixelRatio||1))),0,maximum),span=512*2**(maximum-level);
    let layer=$('.native-tiles',stage);if(!layer){layer=document.createElement('div');layer.className='native-tiles';$('.slide[data-o="0"]',track).append(layer);}
    const bounds={left:clamp(-g.x/native,0,im.w),right:clamp((app.offsetWidth-g.x)/native,0,im.w),top:clamp(-g.y/native,0,im.h),bottom:clamp((app.offsetHeight-g.y)/native,0,im.h)},wanted=new Set();
    for(let row=Math.floor(bounds.top/span);row<Math.min(Math.ceil(im.h/span),Math.floor(bounds.bottom/span)+1);row++)for(let col=Math.floor(bounds.left/span);col<Math.min(Math.ceil(im.w/span),Math.floor(bounds.right/span)+1);col++){
      const key=`${level}/${col}/${row}`;wanted.add(key);let tile=tiles.get(key);if(!tile){tile=new Image();tile.alt='';tile.draggable=false;tile.src=im.tile_template.replace('{level}',level).replace('{x}',col).replace('{y}',row);tile.onerror=()=>tile.remove();layer.append(tile);tiles.set(key,tile);}Object.assign(tile.style,{left:g.x+col*span*native+'px',top:g.y+row*span*native+'px',width:Math.min(span,im.w-col*span)*native+'px',height:Math.min(span,im.h-row*span)*native+'px'});}
    for(const [key,tile] of tiles)if(!wanted.has(key)){tile.remove();tiles.delete(key);}}
  stage.addEventListener('pointerdown',e=>{if(!V.open||V.redraw||e.button>0)return;if(id!==image()?.id)reset();const p=local(e);points.set(e.pointerId,p);
    if(points.size>=2){drag=null;track.style.transform='';curImg().style.transform='';const [a,b]=[...points.values()];gesture={kind:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y),scale};stage.setPointerCapture(e.pointerId);e.stopImmediatePropagation();}
    else if(scale>1.01){gesture={kind:'pan',point:p,x,y};stage.setPointerCapture(e.pointerId);e.stopImmediatePropagation();}
  },true);
  stage.addEventListener('pointermove',e=>{if(!points.has(e.pointerId)||!gesture)return;points.set(e.pointerId,local(e));e.stopImmediatePropagation();if(gesture.kind==='pinch'&&points.size>=2){const [a,b]=[...points.values()];zoom(gesture.scale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,gesture.distance),{x:(a.x+b.x)/2,y:(a.y+b.y)/2});}else if(gesture.kind==='pan'){const p=local(e);x=gesture.x+p.x-gesture.point.x;y=gesture.y+p.y-gesture.point.y;paint();}},true);
  function up(e){points.delete(e.pointerId);if(gesture){e.stopImmediatePropagation();if(points.size){const p=[...points.values()][0];gesture={kind:'pan',point:p,x,y};}else gesture=null;}}
  stage.addEventListener('pointerup',up,true);stage.addEventListener('pointercancel',up,true);
  stage.addEventListener('dblclick',e=>{if(V.redraw)return;e.preventDefault();toggleNative();});
  stage.addEventListener('wheel',e=>{if(!V.open||V.redraw)return;e.preventDefault();zoom(scale*Math.exp(-e.deltaY*.002),local(e));},{passive:false});
  const resized=()=>{if(!V.open)return;if(V.redraw){const im=image(),previous=V.fitRect||fitRect(im),next=fitRect(im);for(const r of V.regions){r.x=next.x+(r.x-previous.x)/previous.w*next.w;r.y=next.y+(r.y-previous.y)/previous.h*next.h;r.w=r.w/previous.w*next.w;r.h=r.h/previous.h*next.h;}Object.assign(curImg().style,{left:next.x+'px',top:next.y+'px',width:next.w+'px',height:next.h+'px'});V.fitRect=next;renderRegions();}else paint();};
  addEventListener('resize',resized);visualViewport?.addEventListener('resize',resized);
  return {reset,paint,toggleNative,fit(){reset();paint();},isZoomed:()=>scale>1.01};
})();
