const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const {parseHTML}=require('linkedom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(kind='standard'){
 const {document}=parseHTML('<html><head><meta name="theme-color" content="#f5f4ef"></head><body><div id="app"></div></body></html>'),app=document.querySelector('#app');
 let requests=0,exits=0,resolveEnter,resolveExit;const listeners={};document.addEventListener=(type,fn)=>listeners[type]=fn;
 const enter=()=>{requests++;if(kind==='denied')return Promise.reject(new Error('Fullscreen denied'));if(kind==='delayed')return new Promise(resolve=>resolveEnter=()=>{document.fullscreenElement=app;listeners.fullscreenchange?.();resolve();});document.fullscreenElement=app;return Promise.resolve();};
 const exit=()=>{exits++;return new Promise(resolve=>resolveExit=()=>{document.fullscreenElement=null;document.webkitFullscreenElement=null;listeners.fullscreenchange?.();resolve();});};
 if(kind==='webkit'){app.webkitRequestFullscreen=()=>{requests++;document.webkitFullscreenElement=app;};document.webkitExitFullscreen=exit;}
 else if(kind!=='none'){app.requestFullscreen=enter;document.exitFullscreen=exit;}
 const context=vm.createContext({document,app,navigator:{maxTouchPoints:1},matchMedia:()=>({matches:true}),Promise});vm.runInContext(fs.readFileSync('static/studio-chrome.js','utf8'),context);const chrome=vm.runInContext('StudioChrome',context);
 return {document,app,chrome,get requests(){return requests;},get exits(){return exits;},enter(){resolveEnter?.();},exit(){resolveExit?.();},theme:()=>document.querySelector('meta[name="theme-color"]').content};
}
test('viewer requests mobile fullscreen synchronously and keeps its dark theme until exit completes',async()=>{
 const f=fixture();f.chrome.enterViewer();assert.equal(f.requests,1);assert.equal(f.theme(),'#0c0c0a');await tick();const done=f.chrome.leaveViewer();await tick();assert.equal(f.exits,1);assert.equal(f.theme(),'#0c0c0a');f.exit();await done;assert.equal(f.theme(),'#f5f4ef');assert.equal(f.document.documentElement.classList.contains('viewer-present'),false);
});
test('an unsupported browser still gets stable viewer colors and restores them on close',async()=>{const f=fixture('none');f.chrome.enterViewer();assert.equal(f.theme(),'#0c0c0a');assert.equal(f.document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content,'black-translucent');await f.chrome.leaveViewer();assert.equal(f.theme(),'#f5f4ef');assert.equal(f.document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),null);});
test('fullscreen denial does not prevent viewing or leave the page dark after close',async()=>{const f=fixture('denied');f.chrome.enterViewer();await tick();assert.equal(f.theme(),'#0c0c0a');await f.chrome.leaveViewer();assert.equal(f.theme(),'#f5f4ef');assert.equal(f.exits,0);});
test('closing the viewer never exits fullscreen owned by another element',async()=>{const f=fixture(),foreign=f.document.createElement('div');f.document.fullscreenElement=foreign;f.chrome.enterViewer();assert.equal(f.requests,0);await f.chrome.leaveViewer();assert.equal(f.exits,0);assert.equal(f.document.fullscreenElement,foreign);});
test('a late fullscreen entry after closing is exited before the light theme returns',async()=>{const f=fixture('delayed');f.chrome.enterViewer();const done=f.chrome.leaveViewer();assert.equal(f.theme(),'#0c0c0a');f.enter();await tick();assert.ok(f.exits>0);assert.equal(f.theme(),'#0c0c0a');f.exit();await done;assert.equal(f.theme(),'#f5f4ef');});
test('a new viewer keeps its dark theme when an older exit finishes',async()=>{const f=fixture();f.chrome.enterViewer();await tick();const old=f.chrome.leaveViewer();await tick();f.chrome.enterViewer();f.exit();await old;assert.equal(f.theme(),'#0c0c0a');assert.equal(f.document.documentElement.classList.contains('viewer-present'),true);});
test('prefixed iPad fullscreen follows the same ownership and theme lifecycle',async()=>{const f=fixture('webkit');f.chrome.enterViewer();await tick();assert.equal(f.requests,1);const done=f.chrome.leaveViewer();await tick();assert.equal(f.exits,1);f.exit();await done;assert.equal(f.theme(),'#f5f4ef');});
test('navigation gets an independent static snapshot above page transitions',()=>{const css=fs.readFileSync('static/studio-service.css','utf8');assert.match(css,/#tabbar\{view-transition-name:studio-tabbar\}/);assert.match(css,/::view-transition-group\(studio-tabbar\)\{z-index:100;animation:none!important\}/);assert.match(css,/::view-transition-new\(studio-tabbar\)\{animation:none!important/);});

function androidFixture(){
 const {document}=parseHTML('<html><head><meta name="theme-color" content="#f5f4ef"></head><body><div id="app"><nav id="tabbar"></nav><div id="screens"></div><div id="layers"></div></div></body></html>');
 const app=document.querySelector('#app'),listeners={},frames=new Map(),messages=[],observers=[];let now=0,next=0,requests=0;
 const rect={left:0,right:400,top:0,bottom:800};app.getBoundingClientRect=()=>rect;Object.defineProperty(app,'clientWidth',{value:400});
 const style=el=>({backgroundColor:el._bg||'rgba(0, 0, 0, 0)',opacity:el.style.opacity||'1',display:el.style.display||'block',visibility:'visible',zIndex:el._z||'auto'});
 app._bg='rgb(245, 244, 239)';const bar=document.querySelector('#tabbar');bar._bg='rgba(248, 247, 242, 0.9)';bar._z='20';bar.getBoundingClientRect=()=>({...rect,top:738});
 document.querySelector('#screens')._z='55';document.querySelector('#layers')._z='60';
 const window={addEventListener:(name,fn)=>listeners[name]=fn};app.requestFullscreen=()=>requests++;
 class MutationObserver{constructor(fn){observers.push(fn);}observe(){}}
 const context=vm.createContext({document,app,window,navigator:{maxTouchPoints:1,userAgent:'Android ImageStudioAndroid/1.1'},MutationObserver,getComputedStyle:style,performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},matchMedia:()=>({matches:true}),Promise});
 vm.runInContext(fs.readFileSync('static/studio-chrome.js','utf8'),context);
 const port={postMessage:value=>messages.push(JSON.parse(value)),close(){this.closed=true;}};
 const handshake=overrides=>listeners.message({data:'IMAGE_STUDIO_CHROME_PORT_V1',isTrusted:true,ports:[port],source:null,...overrides});
 return {document,chrome:vm.runInContext('StudioChrome',context),port,messages,handshake,get requests(){return requests;},frame(ms=16){now+=ms;const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());},get frameCount(){return frames.size;},mutate(){observers.forEach(fn=>fn());},overlay(cls,bg,top=0,host='#layers'){const el=document.createElement('div');el.className=cls;el._bg=bg;el.getBoundingClientRect=()=>({...rect,top});document.querySelector(host).append(el);return el;}};
}
test('native Android uses its port for immersive mode, including a viewer opened before handshake',async()=>{
 const f=androidFixture();f.chrome.enterViewer();assert.equal(f.requests,0);f.handshake();assert.deepEqual(f.messages.at(-1),{viewer:true,topColor:'#0c0c0a',bottomColor:'#0c0c0a'});await f.chrome.leaveViewer();assert.equal(f.messages.at(-1).viewer,false);assert.equal(f.messages.at(-1).topColor,'#f5f4ef');
});
test('native system-bar colors follow menu dimming, dragging and a fading noninteractive scrim',()=>{
 const f=androidFixture();f.handshake();const scrim=f.overlay('scrim','rgba(20, 20, 16, 0.38)'),sheet=f.overlay('sheet','rgb(255, 254, 250)',500);f.mutate();f.frame();assert.equal(f.messages.at(-1).topColor,'#a09f9a');assert.equal(f.messages.at(-1).bottomColor,'#fffefa');
 scrim.style.opacity='0.5';scrim.style.pointerEvents='none';f.mutate();f.frame();assert.equal(f.messages.at(-1).topColor,'#cac9c5');sheet.remove();scrim.remove();f.mutate();f.frame();assert.equal(f.messages.at(-1).topColor,'#f5f4ef');assert.equal(f.messages.at(-1).bottomColor,'#f8f7f2');
});
test('native bridge rejects synthetic/foreign handshakes, replaces ports and stops idle sampling',()=>{
 const f=androidFixture();f.handshake({isTrusted:false});f.handshake({source:{}});assert.equal(f.messages.length,0);f.handshake();assert.equal(f.messages.length,1);f.frame(500);assert.equal(f.frameCount,0);assert.equal(f.messages.length,1);f.handshake();assert.equal(f.port.closed,true);assert.equal(f.messages.length,2);
});
test('nested screens and menus compose in their visual stacking order',()=>{
 const f=androidFixture();f.handshake();f.overlay('screen','rgb(240, 230, 220)',0,'#screens');f.overlay('scrim','rgba(20, 20, 16, 0.38)');f.mutate();f.frame();assert.equal(f.messages.at(-1).topColor,'#9c968e');
});
