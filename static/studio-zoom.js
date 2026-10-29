"use strict";
/* Preview and native tiles share one compositor transform. Image dimensions never
   change in the pointer-move path; network/decode work has a separate budget. */
const StudioZoom=(()=>{
  const MAX_REQUESTS=4,MAX_CACHE_BYTES=64*1024*1024,MAX_ENTRIES=96,MAX_WANTED=56,TILE_INTERVAL=90;
  let asset=null,id=null,metrics=null,preview=null,plane=null,tileLayer=null,fallbackLayer=null;
  let scale=1,x=0,y=0,frameId=null,resizeFrame=null,settleTimer=null,retryTimer=null,gesture=null,closing=false;
  let epoch=0,active=0,cacheBytes=0,clock=0,lastTiles=-Infinity,signature='',forceTiles=false,lastWheel=-Infinity;
  let queue=[],wanted=new Set(),visible=new Set();const cache=new Map(),points=new Map();
  const currentId=()=>V.list[V.i];
  const now=()=>performance.now();
  function measure(){
    const previous=metrics?.fit,rect=app.getBoundingClientRect(),width=app.offsetWidth,height=app.offsetHeight;
    const top=(parseFloat(getComputedStyle(app).getPropertyValue('--safe-top'))||0)+58,area=Math.max(1,height-top-200);
    let w=width,h=w*asset.h/asset.w;if(h>area){h=area;w=h*asset.w/asset.h;}
    metrics={width,height,rect,screenScale:rect.width/width||1,dpr:Math.max(1,globalThis.devicePixelRatio||1),
      fit:{x:(width-w)/2,y:top+(area-h)/2,w,h},area};
    if(plane&&previous&&(previous.w!==w||previous.h!==h))sizeSurface();
  }
  function ensure(){
    if(!V.open||!currentId())return false;
    if(id!==currentId()){reset();id=currentId();asset=img(id);preview=curImg();}
    if(!asset||!preview)return false;if(!metrics)measure();return true;
  }
  function point(e){return {x:(e.clientX-metrics.rect.left)/metrics.screenScale,y:(e.clientY-metrics.rect.top)/metrics.screenScale};}
  function geometry(){const r=metrics.fit;return {x:r.x+(r.w-r.w*scale)/2+x,y:r.y+(r.h-r.h*scale)/2+y,w:r.w*scale,h:r.h*scale};}
  function clampPose(){const r=metrics.fit;x=clamp(x,-Math.max(0,(r.w*scale-metrics.width)/2),Math.max(0,(r.w*scale-metrics.width)/2));y=clamp(y,-Math.max(0,(r.h*scale-metrics.area)/2),Math.max(0,(r.h*scale-metrics.area)/2));}
  function restorePreview(){
    if(!preview||!metrics)return;const r=metrics.fit;
    Object.assign(preview.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px',transform:''});
  }
  function positionTile(entry){
    const k=metrics.fit.w/asset.w;
    Object.assign(entry.image.style,{left:entry.col*entry.span*k+'px',top:entry.row*entry.span*k+'px',
      width:Math.min(entry.span,asset.w-entry.col*entry.span)*k+'px',height:Math.min(entry.span,asset.h-entry.row*entry.span)*k+'px'});
  }
  function makeSurface(){
    if(plane)return;plane=document.createElement('div');plane.className='zoom-plane';
    fallbackLayer=document.createElement('div');fallbackLayer.className='native-tiles tile-fallback';
    tileLayer=document.createElement('div');tileLayer.className='native-tiles tile-current';
    preview.parentNode.insertBefore(plane,preview);plane.append(preview,fallbackLayer,tileLayer);sizeSurface();
  }
  function sizeSurface(){
    if(!plane)return;const r=metrics.fit;Object.assign(plane.style,{width:r.w+'px',height:r.h+'px'});
    Object.assign(preview.style,{left:'0px',top:'0px',width:r.w+'px',height:r.h+'px',transform:''});
    for(const entry of cache.values())positionTile(entry);
  }
  function schedulePaint(force=false){
    forceTiles=forceTiles||force;if(closing||frameId!==null||!V.open)return;
    frameId=requestAnimationFrame(render);
  }
  function render(time){
    frameId=null;if(closing||!ensure())return;clampPose();
    if(scale<=1.0001&&!gesture){releaseSurface();restorePreview();return;}
    makeSurface();const g=geometry();plane.style.transform=`translate3d(${g.x}px,${g.y}px,0) scale(${scale})`;
    if(asset.tile_template&&(forceTiles||time-lastTiles>=TILE_INTERVAL)){const force=forceTiles;forceTiles=false;lastTiles=time;updateTiles(force);}
  }
  function anchorAt(p){const g=geometry();return {x:(p.x-g.x)/g.w,y:(p.y-g.y)/g.h};}
  function zoomTo(value,p,anchor=anchorAt(p)){
    const r=metrics.fit;scale=clamp(value,1,Math.max(4,asset.w/r.w*2));
    x=p.x-(r.x+(r.w-r.w*scale)/2)-anchor.x*r.w*scale;
    y=p.y-(r.y+(r.h-r.h*scale)/2)-anchor.y*r.h*scale;clampPose();schedulePaint();
  }
  function settle(){clearTimeout(settleTimer);settleTimer=setTimeout(()=>{settleTimer=null;schedulePaint(true);},110);}
  function toggleNative(){if(!ensure()||V.redraw)return;closing=false;const p={x:metrics.width/2,y:metrics.fit.y+metrics.fit.h/2};zoomTo(scale>1.0001?1:Math.max(1,asset.w/metrics.fit.w),p);schedulePaint(true);vw.classList.remove('chrome-off');}
  function cancelEntry(entry){
    if(entry.status==='loading'||entry.status==='decoding'){active--;entry.image.onload=entry.image.onerror=null;entry.image.removeAttribute('src');}
    if(entry.status==='ready')cacheBytes-=entry.bytes;
    entry.status='removed';entry.image.remove();entry.image.removeAttribute('src');cache.delete(entry.key);
  }
  function evict(){
    while(cacheBytes>MAX_CACHE_BYTES||cache.size>MAX_ENTRIES){
      const candidates=[...cache.values()].filter(e=>!wanted.has(e.key)&&e.status!=='loading'&&e.status!=='decoding').sort((a,b)=>a.used-b.used);
      if(!candidates.length)break;cancelEntry(candidates[0]);
    }
  }
  function tileBounds(level,padding=0){
    const g=geometry(),native=g.w/asset.w,maximum=Math.ceil(Math.log2(Math.max(asset.w,asset.h))),span=512*2**(maximum-level);
    const left=clamp(-g.x/native,0,asset.w),right=clamp((metrics.width-g.x)/native,0,asset.w),top=clamp(-g.y/native,0,asset.h),bottom=clamp((metrics.height-g.y)/native,0,asset.h);
    return {span,left,right,top,bottom,c0:Math.max(0,Math.floor(left/span)-padding),c1:Math.min(Math.ceil(asset.w/span)-1,Math.floor(right/span)+padding),r0:Math.max(0,Math.floor(top/span)-padding),r1:Math.min(Math.ceil(asset.h/span)-1,Math.floor(bottom/span)+padding)};
  }
  const count=b=>(b.c1-b.c0+1)*(b.r1-b.r0+1);
  function pruneFallback(){
    if(!fallbackLayer)return;const allReady=[...visible].every(key=>cache.get(key)?.status==='ready');
    for(const node of [...fallbackLayer.children])if(allReady)node.remove();
    while(fallbackLayer.children.length>16)fallbackLayer.firstElementChild.remove();
  }
  function updateTiles(force=false){
    if(!plane||!asset.tile_template||closing)return;const maximum=Math.ceil(Math.log2(Math.max(asset.w,asset.h))),native=metrics.fit.w*scale/asset.w;
    const dpr=Math.min(metrics.dpr,Math.sqrt(8_000_000/(metrics.width*metrics.height)));
    let level=clamp(Math.round(maximum+Math.log2(native*dpr)),0,maximum),bounds=tileBounds(level);
    while(level>0&&count(bounds)>MAX_WANTED){level--;bounds=tileBounds(level);}
    let padded=tileBounds(level,1);if(count(padded)>MAX_WANTED)padded=bounds;
    const key=`${level}/${padded.c0}/${padded.c1}/${padded.r0}/${padded.r1}/${metrics.fit.w}`;
    if(!force&&key===signature)return;signature=key;
    const next=new Set(),onScreen=new Set(),nextQueue=[],centerX=(bounds.c0+bounds.c1)/2,centerY=(bounds.r0+bounds.r1)/2;
    for(let row=padded.r0;row<=padded.r1;row++)for(let col=padded.c0;col<=padded.c1;col++){
      const tileKey=`${level}/${col}/${row}`,inView=col>=bounds.c0&&col<=bounds.c1&&row>=bounds.r0&&row<=bounds.r1;
      next.add(tileKey);if(inView)onScreen.add(tileKey);let entry=cache.get(tileKey);
      if(!entry){const image=new Image();image.alt='';image.draggable=false;entry={key:tileKey,image,level,col,row,span:padded.span,status:'idle',used:++clock,bytes:0,failures:0,retryAt:0};cache.set(tileKey,entry);positionTile(entry);}
      entry.used=++clock;
      if(entry.status==='ready'){if(entry.image.parentNode!==tileLayer)tileLayer.append(entry.image);}
      else if(entry.status==='idle'||entry.status==='error'&&now()>=entry.retryAt)nextQueue.push({entry,priority:(inView?0:1e6)+(col-centerX)**2+(row-centerY)**2});
    }
    wanted=next;visible=onScreen;
    for(const entry of [...cache.values()])if(!wanted.has(entry.key)){
      if(entry.status==='loading'||entry.status==='decoding'){cancelEntry(entry);continue;}
      const intersects=entry.col*entry.span<bounds.right&&(entry.col+1)*entry.span>bounds.left&&entry.row*entry.span<bounds.bottom&&(entry.row+1)*entry.span>bounds.top;
      if(entry.status==='ready'&&intersects)fallbackLayer.append(entry.image);else entry.image.remove();
    }
    queue=nextQueue.sort((a,b)=>a.priority-b.priority).map(x=>x.entry);pruneFallback();evict();pump();
  }
  function pump(){
    if(closing||!V.open)return;
    while(active<MAX_REQUESTS&&queue.length){
      const entry=queue.shift();if(!wanted.has(entry.key)||cache.get(entry.key)!==entry||!['idle','error'].includes(entry.status))continue;
      const generation=epoch;entry.status='loading';active++;
      const valid=()=>generation===epoch&&cache.get(entry.key)===entry&&['loading','decoding'].includes(entry.status);
      const failed=()=>{if(!valid())return;active--;entry.status='error';entry.failures++;entry.retryAt=now()+1500;entry.image.remove();
        if(entry.failures<2&&wanted.has(entry.key)){clearTimeout(retryTimer);retryTimer=setTimeout(()=>schedulePaint(true),1550);}pump();};
      entry.image.onerror=failed;
      entry.image.onload=()=>{if(!valid())return;entry.status='decoding';
        const decoded=typeof entry.image.decode==='function'?entry.image.decode():Promise.resolve();
        Promise.resolve(decoded).then(()=>{if(!valid())return;active--;entry.status='ready';entry.used=++clock;entry.bytes=(entry.image.naturalWidth||512)*(entry.image.naturalHeight||512)*4;cacheBytes+=entry.bytes;
          if(wanted.has(entry.key)&&tileLayer)tileLayer.append(entry.image);pruneFallback();evict();pump();},failed);};
      entry.image.src=asset.tile_template.replace('{level}',entry.level).replace('{x}',entry.col).replace('{y}',entry.row);
    }
  }
  function cancelWork(){
    if(frameId!==null)cancelAnimationFrame(frameId);frameId=null;if(resizeFrame!==null)cancelAnimationFrame(resizeFrame);resizeFrame=null;clearTimeout(settleTimer);clearTimeout(retryTimer);settleTimer=retryTimer=null;
    queue=[];points.clear();gesture=null;for(const entry of [...cache.values()])if(entry.status==='loading'||entry.status==='decoding')cancelEntry(entry);
  }
  function releaseSurface(){
    for(const entry of [...cache.values()])cancelEntry(entry);cache.clear();cacheBytes=0;active=0;queue=[];wanted.clear();visible.clear();signature='';
    if(plane){if(preview?.parentNode===plane)plane.before(preview);plane.remove();}plane=tileLayer=fallbackLayer=null;
  }
  function reset(){epoch++;cancelWork();releaseSurface();restorePreview();asset=null;id=null;metrics=null;preview=null;scale=1;x=y=0;closing=false;lastTiles=-Infinity;forceTiles=false;lastWheel=-Infinity;}
  function stop(){closing=true;epoch++;cancelWork();return plane||preview;}
  function fit(){reset();if(ensure())restorePreview();}
  function startGesture(){
    const list=[...points.values()];if(list.length>=2){const [a,b]=list,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};gesture={kind:'pinch',distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),scale,anchor:anchorAt(mid)};}
    else if(list.length)gesture={kind:'pan',point:list[0],x,y,moved:false,time:now()};
  }
  stage.addEventListener('pointerdown',e=>{
    if(e.button>0||V.redraw||!ensure())return;measure();points.set(e.pointerId,point(e));
    if(points.size>=2||scale>1.0001){drag=null;track.style.transform='';closing=false;startGesture();stage.setPointerCapture(e.pointerId);e.stopImmediatePropagation();}
  },true);
  stage.addEventListener('pointermove',e=>{
    if(!points.has(e.pointerId)||!gesture||!metrics)return;const p=point(e);points.set(e.pointerId,p);e.stopImmediatePropagation();
    if(gesture.kind==='pinch'&&points.size>=2){const [a,b]=[...points.values()];zoomTo(gesture.scale*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance,{x:(a.x+b.x)/2,y:(a.y+b.y)/2},gesture.anchor);}
    else if(gesture.kind==='pan'){const dx=p.x-gesture.point.x,dy=p.y-gesture.point.y;gesture.moved=gesture.moved||Math.hypot(dx,dy)>3;x=gesture.x+dx;y=gesture.y+dy;clampPose();schedulePaint();}
  },{capture:true,passive:true});
  function up(e){
    points.delete(e.pointerId);if(!gesture)return;e.stopImmediatePropagation();const tap=e.type!=='pointercancel'&&gesture.kind==='pan'&&!gesture.moved&&now()-gesture.time<350;
    if(e.type==='pointercancel')points.clear();if(points.size)startGesture();else{gesture=null;schedulePaint(true);if(tap)vw.classList.toggle('chrome-off');}
  }
  stage.addEventListener('pointerup',up,true);stage.addEventListener('pointercancel',up,true);
  stage.addEventListener('dblclick',e=>{if(V.redraw)return;e.preventDefault();toggleNative();});
  stage.addEventListener('wheel',e=>{if(V.redraw||!ensure())return;e.preventDefault();lastWheel=now();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?metrics.height:1);zoomTo(scale*Math.exp(-delta*.002),point(e));settle();},{passive:false});
  function resized(){
    if(!V.open)return;
    if(V.redraw){const im=img(currentId()),previous=V.fitRect||fitRect(im),next=fitRect(im);for(const r of V.regions){r.x=next.x+(r.x-previous.x)/previous.w*next.w;r.y=next.y+(r.y-previous.y)/previous.h*next.h;r.w=r.w/previous.w*next.w;r.h=r.h/previous.h*next.h;}const image=curImg();if(image)Object.assign(image.style,{left:next.x+'px',top:next.y+'px',width:next.w+'px',height:next.h+'px'});V.fitRect=next;renderRegions();}
    else if(ensure()){points.clear();gesture=null;measure();sizeSurface();schedulePaint(true);}
  }
  const requestResize=()=>{if(resizeFrame===null)resizeFrame=requestAnimationFrame(()=>{resizeFrame=null;resized();});};
  addEventListener('resize',requestResize);globalThis.visualViewport?.addEventListener('resize',requestResize);
  return {reset,stop,fit,toggleNative,paint(){if(ensure())schedulePaint(true);},isZoomed:()=>scale>1.0001,isInteracting:()=>points.size>0||now()-lastWheel<150,cacheUsage:()=>({bytes:cacheBytes,entries:cache.size,active})};
})();
