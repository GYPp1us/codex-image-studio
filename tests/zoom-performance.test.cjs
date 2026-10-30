const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {parseHTML}=require('linkedom');
function fixture({dpr=1,width=12017,height=8003}={}){
 const {document,window}=parseHTML('<html><body><div id="app"><div id="viewer"><div id="stage"><div id="track"><div class="slide" data-o="0"><img id="preview"></div></div></div></div></div></body></html>');
 const app=document.querySelector('#app'),vw=document.querySelector('#viewer'),stage=document.querySelector('#stage'),track=document.querySelector('#track'),preview=document.querySelector('#preview');
 const frames=new Map(),timers=new Map(),requests=[],loading=new Set(),writes=[];let clock=0,next=0,reads=0,maxLoading=0;
 const asset={id:'large',w:width,h:height,tile_template:'/api/assets/large/tiles/{level}/{x}/{y}'},V={open:true,list:['large'],i:0,redraw:false};
 function watch(node){const style=node.style,proxy=new Proxy(style,{set(target,key,value){writes.push({node,key,value});target[key]=value;return true;}});Object.defineProperty(node,'style',{configurable:true,get:()=>proxy});return node;}
 watch(preview);const create=document.createElement.bind(document);document.createElement=function(...args){return watch(create(...args));};
 Object.defineProperty(app,'offsetWidth',{get(){reads++;return 390;}});Object.defineProperty(app,'offsetHeight',{get(){reads++;return 844;}});app.getBoundingClientRect=()=>{reads++;return {left:0,top:0,width:390,height:844};};stage.setPointerCapture=()=>{};
 const events={};const context=vm.createContext({document,console,Image:function(){const image=document.createElement('img');Object.defineProperty(image,'naturalWidth',{value:512});Object.defineProperty(image,'naturalHeight',{value:512});Object.defineProperty(image,'src',{get:()=>image.getAttribute('src')||'',set(value){image.setAttribute('src',value);requests.push(value);loading.add(image);maxLoading=Math.max(maxLoading,loading.size);}});image.decode=()=>Promise.resolve();return image;},
   app,vw,stage,track,V,img:()=>asset,curImg:()=>preview,$:(s,r=document)=>r.querySelector(s),clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),fitRect:()=>({x:0,y:200,w:390,h:260}),renderRegions(){},getComputedStyle:()=>{reads++;return {getPropertyValue:()=> '0px'};},performance:{now:()=>clock},devicePixelRatio:dpr,
   requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(fn,ms)=>{timers.set(++next,{fn,at:clock+ms});return next;},clearTimeout:id=>timers.delete(id),addEventListener:(type,fn)=>{events[type]=fn;},drag:null});
 vm.runInContext(fs.readFileSync('static/studio-zoom.js','utf8'),context);const zoom=vm.runInContext('StudioZoom',context);
 function pointer(type,x,y,id=1){const e=new window.Event(type,{bubbles:true});Object.assign(e,{clientX:x,clientY:y,pointerId:id,button:0});stage.dispatchEvent(e);}
 function wheel(deltaY){const e=new window.Event('wheel',{bubbles:true,cancelable:true});Object.assign(e,{clientX:190,clientY:350,deltaY,deltaMode:0});stage.dispatchEvent(e);}
 function frame(){clock+=16.67;const next=[...frames.values()];frames.clear();next.forEach(fn=>fn(clock));}
 async function loaded(){for(let rounds=0;rounds<100&&(loading.size||zoom.cacheUsage().active);rounds++){const batch=[...loading];loading.clear();batch.forEach(image=>image.onload?.());await Promise.resolve();await Promise.resolve();}}
 async function native(){zoom.toggleNative();frame();await loaded();writes.length=0;reads=0;}
 async function pan(dx,dy=0){pointer('pointerdown',100,350);pointer('pointermove',100+dx,350+dy);pointer('pointerup',100+dx,350+dy);frame();await loaded();}
 return {document,context,zoom,asset,V,stage,preview,requests,loading,writes,events,frames,pointer,wheel,frame,loaded,native,pan,get reads(){return reads;},clear(){reads=0;writes.length=0;},get maxLoading(){return maxLoading;},advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}}};
}
const surfaceScale=f=>{const surface=f.document.querySelector('.zoom-plane');return surface?Number(surface.style.transform.match(/scale\(([^)]+)\)/)[1]):1;};
function underPinch(f){f.pointer('pointerdown',100,300,1);f.pointer('pointerdown',300,300,2);f.pointer('pointermove',160,300,1);f.pointer('pointermove',240,300,2);f.frame();}
test('240 pointer updates share one compositor write and perform no layout reads',async()=>{const f=fixture();await f.native();f.pointer('pointerdown',100,350);f.clear();const source=f.preview.style.cssText,tiles=[...f.document.querySelectorAll('.tile-current img')].map(t=>t.style.cssText);for(let i=1;i<=240;i++)f.pointer('pointermove',100+i,350+i/2);assert.equal(f.frames.size,1);assert.equal(f.reads,0);assert.equal(f.writes.length,0);f.frame();assert.equal(f.reads,0);assert.deepEqual(f.writes.map(w=>w.key),['transform']);assert.equal(f.preview.style.cssText,source);assert.deepEqual([...f.document.querySelectorAll('.tile-current img')].map(t=>t.style.cssText),tiles);});
test('preview and every native tile move in the same transformed plane',async()=>{const f=fixture();await f.native();const plane=f.document.querySelector('.zoom-plane');assert.equal(f.preview.parentNode,plane);const before=plane.style.transform;await f.pan(240,100);assert.notEqual(plane.style.transform,before);for(const image of f.document.querySelectorAll('.native-tiles img'))assert.equal(image.parentNode.parentNode,plane);assert.ok(f.zoom.cacheUsage().bytes>0);});
test('a return to a cached view reuses decoded tiles without downloads',async()=>{const f=fixture();await f.native();const original=[...f.document.querySelectorAll('.tile-current img')];await f.pan(700);const count=f.requests.length;await f.pan(-700);assert.equal(f.requests.length,count);assert.ok(original.some(image=>image.isConnected));});
test('new detail is fetched during a continuous drag with at most four active requests',async()=>{const f=fixture();await f.native();const before=f.requests.length;f.pointer('pointerdown',100,350);for(let i=1;i<=15;i++){f.pointer('pointermove',100+i*70,350);f.frame();await f.loaded();}assert.ok(f.requests.length>before);assert.ok(f.maxLoading<=4);f.pointer('pointerup',1150,350);f.frame();});
test('decoded cache and attached tile counts stay bounded over a long traversal',async()=>{const f=fixture({width:64000,height:32000,dpr:3});await f.native();for(let i=0;i<20;i++)await f.pan(950);for(let i=0;i<40;i++)await f.pan(-950);const usage=f.zoom.cacheUsage();assert.ok(usage.bytes<=64*1024*1024,JSON.stringify(usage));assert.ok(usage.entries<=96,JSON.stringify(usage));assert.ok(f.document.querySelectorAll('.native-tiles img').length<=72);});
test('pinching keeps its source anchor while the two-finger midpoint moves',async()=>{const f=fixture();await f.native();const parse=()=>f.document.querySelector('.zoom-plane').style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,0\) scale\(([-\d.]+)\)/),before=parse(),anchor={x:(150-Number(before[1]))/Number(before[3]),y:(300-Number(before[2]))/Number(before[3])};f.pointer('pointerdown',100,300,1);f.pointer('pointerdown',200,300,2);f.pointer('pointermove',80,320,1);f.pointer('pointermove',220,320,2);f.frame();const m=parse(),scale=Number(m[3]);assert.ok(Math.abs(Number(m[1])+anchor.x*scale-150)<.001);assert.ok(Math.abs(Number(m[2])+anchor.y*scale-320)<.001);f.pointer('pointerup',80,320,1);f.pointer('pointerup',220,320,2);assert.equal(f.zoom.isInteracting(),false);});
test('fit mode restores plain image geometry for region editing',async()=>{const f=fixture();await f.native();f.zoom.fit();assert.equal(f.document.querySelector('.zoom-plane'),null);assert.equal(f.preview.style.width,'390px');assert.equal(f.zoom.cacheUsage().bytes,0);assert.equal(f.zoom.isZoomed(),false);});
test('close cancels pending work and late tile loads cannot recreate the surface',()=>{const f=fixture();f.zoom.toggleNative();f.frame();const callbacks=[...f.loading].map(image=>image.onload);f.zoom.stop();f.zoom.reset();f.V.open=false;callbacks.forEach(fn=>fn?.());f.frame();assert.equal(f.document.querySelector('.zoom-plane'),null);assert.equal(f.zoom.cacheUsage().active,0);assert.equal(f.zoom.cacheUsage().entries,0);assert.equal(f.frames.size,0);});
test('right edge tiles preserve partial native dimensions',async()=>{const f=fixture();await f.native();await f.pan(-100000);const plane=f.document.querySelector('.zoom-plane'),base=Number.parseFloat(plane.style.width);const images=[...f.document.querySelectorAll('.tile-current img')];const edge=images.filter(image=>{const m=image.src.match(/\/14\/(\d+)\//);return m&&Number(m[1])===Math.floor(f.asset.w/512);});assert.ok(edge.length);for(const image of edge)assert.ok(Math.abs(Number.parseFloat(image.style.width)-(f.asset.w%512)*base/f.asset.w)<.000001);});

test('wheel zoom cancels an unfinished zoom animation and keeps the new scale',()=>{
 const f=fixture();f.zoom.toggleAt({clientX:190,clientY:350});for(let i=0;i<4;i++)f.frame();const before=surfaceScale(f);assert.ok(before>1&&before<3);
 f.wheel(-500);f.frame();const expected=before*Math.exp(1);assert.ok(Math.abs(surfaceScale(f)-expected)<1e-9);
 for(let i=0;i<30;i++)f.frame();assert.ok(Math.abs(surfaceScale(f)-expected)<1e-9);
});

test('wheel input stops pan momentum instead of continuing to move the image',async()=>{
 const f=fixture();await f.native();f.pointer('pointerdown',100,350);f.advance(16);f.pointer('pointermove',180,350);f.frame();f.pointer('pointerup',180,350);f.frame();assert.ok(f.frames.size>0);
 f.wheel(-100);f.frame();const transform=f.document.querySelector('.zoom-plane').style.transform;for(let i=0;i<20;i++)f.frame();assert.equal(f.document.querySelector('.zoom-plane').style.transform,transform);
});

test('pinch spring back keeps its surface visible and progresses before releasing it at fit',()=>{
 const f=fixture();underPinch(f);const before=surfaceScale(f);assert.ok(before<1);f.pointer('pointerup',240,300,2);f.pointer('pointermove',170,310,1);f.pointer('pointerup',170,310,1);f.frame();const first=surfaceScale(f);assert.ok(first>=before&&first<1);assert.ok(f.document.querySelector('.zoom-plane'));
 for(let i=0;i<5;i++)f.frame();assert.ok(surfaceScale(f)>first&&surfaceScale(f)<1);for(let i=0;i<20;i++)f.frame();assert.equal(!!f.document.querySelector('.zoom-plane'),false);assert.equal(f.preview.style.width,'390px');assert.equal(f.zoom.cacheUsage().entries,0);assert.equal(f.frames.size,0);
});

test('lifting the last stationary finger after a pinch starts rebound without becoming a tap',()=>{
 const f=fixture();underPinch(f);f.pointer('pointerup',240,300,2);f.pointer('pointerup',160,300,1);f.frame();assert.ok(surfaceScale(f)<1);assert.equal(f.document.querySelector('#viewer').classList.contains('chrome-off'),false);
 for(let i=0;i<30;i++)f.frame();assert.equal(!!f.document.querySelector('.zoom-plane'),false);assert.equal(f.frames.size,0);
});

test('reduced motion returns directly to fit without leaving an animation scheduled',()=>{
 const f=fixture();f.context.RM=true;underPinch(f);f.pointer('pointerup',240,300,2);f.pointer('pointerup',160,300,1);f.frame();assert.equal(!!f.document.querySelector('.zoom-plane'),false);assert.equal(f.frames.size,0);assert.equal(f.document.querySelector('#viewer').classList.contains('chrome-off'),false);
});

test('stop and reset cancel an in-progress tween without recreating the closed surface',()=>{
 const f=fixture();f.zoom.toggleAt({clientX:190,clientY:350});for(let i=0;i<4;i++)f.frame();assert.ok(f.document.querySelector('.zoom-plane'));f.zoom.stop();f.zoom.reset();f.V.open=false;for(let i=0;i<30;i++)f.frame();assert.equal(!!f.document.querySelector('.zoom-plane'),false);assert.equal(f.frames.size,0);assert.equal(f.zoom.cacheUsage().entries,0);
});

test('instant native-pixel viewing cancels an earlier animated target',()=>{
 const f=fixture();f.zoom.toggleAt({clientX:190,clientY:350});for(let i=0;i<4;i++)f.frame();f.zoom.toggleNative();f.frame();assert.equal(!!f.document.querySelector('.zoom-plane'),false);for(let i=0;i<30;i++)f.frame();assert.equal(!!f.document.querySelector('.zoom-plane'),false);
});
