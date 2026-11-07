const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const {parseHTML}=require('linkedom');
const html=fs.readFileSync('static/index.html','utf8');
const prompt='Generate an image using {prompt}, preserving the requested native dimensions.';
const baseAsset={id:'asset',width:900,height:1200,name:'山色.png',kind:'generated',bytes:1234,created:1000,job_id:'job',url:'/media/asset',thumbnail:'/media/asset?thumbnail=1',preview:'/media/asset?preview=1',favorite:0,tags:''};
function makeJob(id,extra={}){return {id,batch_id:'batch',prompt:'静谧山色',status:'queued',created:1000,collection_id:'untemplated',template_id:'',refs:[],references:[],outputs:[],attempt:0,max_attempts:3,error:'',model:'gpt-test',effort:'high',options:{ratio:'1:1',size:'auto',model:'gpt-test',effort:'high',stitch:0},progress:{stage:'queued',label:'等待调度'},...extra};}
async function fixture({unauth=false,failQuick=false,huge=false,delayInfo=null,failSync=false,legacyDraft=null,gallery=false,paginated=false,systemReduce=true,motion='reduce',legacyMotion=false,systemDark=false,avatarURL='',quickGate=null}={}){
 const {window}=parseHTML(html),{document}=window;const requests=[],timers=new Map();let timerId=0,stateReads=0;
 const asset=huge?{...baseAsset,width:12000,height:8000,tile_template:'/api/assets/asset/tiles/{level}/{x}/{y}'}:baseAsset;
 const dataJobs=[makeJob('job',{status:'succeeded',outputs:[asset]}),...Array.from({length:19},(_,i)=>makeJob('job'+i))];
 const plan={factor:4,input_size:[900,1200],output_size:[1800,2400],budget:{images:3,reviews:1,max_calls:10},stages:[{index:1,input_size:[900,1200],output_size:[1800,2400],columns:1,rows:3,tile_count:3,status:'failed',cuts:{x:[],y:[400,800]},budget:{images:3,reviews:1,max_calls:10},diagnostic_available:true}]};
 const up=makeJob('up',{batch_id:'upbatch',status:'failed',options:{stitch:4,source_asset_id:'asset'},source_image:asset,upscale_plan:plan,error:'图块验收失败'});
 const batches=[{id:'batch',created:1000,jobs:dataJobs},{id:'upbatch',created:999,jobs:[up]}];
 const prefs={defaults:{ratio:'3:2',size:'auto',count:3,transparent:false,polish:false,stitch:0},quick:{keep_spec:true,use_ref:true,use_source_template:true,effort:'high',notify:true},upscale:{factor:4,auto_select:true,default_injection:''},motion:legacyMotion,motion_mode:motion,notify:false,call_prompt:prompt,polish_prompt:prompt,stitch_prompt:prompt,default_call_prompt:prompt,default_polish_prompt:prompt,default_stitch_prompt:prompt};
 const state={model:'gpt-test',effort:'high',concurrency:2,max_attempts:3,paused:true,preferences:prefs};
 const storage={bytes:1024,limit_bytes:0,free_bytes:1e9,groups:{database:512},tasks:[],trash:{assets:0,collections:0}};
 const fetch=async(path,opt={})=>{requests.push({path,method:opt.method||'GET',body:typeof opt.body==='string'?JSON.parse(opt.body):opt.body,headers:opt.headers});let d;
  if(path==='/api/auth/state')d={initialized:true,authenticated:!unauth,csrf:'csrf-fixture',cache_scope:'fixture'};
  else if(path==='/api/state'){if(failSync&&stateReads++>0)return {ok:false,status:503,json:async()=>({detail:'poll unavailable'})};d=state;}
  else if(path==='/api/settings')d=opt.method?{ok:true}:prefs;
  else if(path==='/api/account/avatar')d={avatar_url:opt.method==='DELETE'?'':'/api/account/avatar?v=new'};
  else if(path==='/api/account')d={username:'tester',session_count:1,avatar_url:avatarURL};
  else if(path==='/api/setup/status')d={authenticated:true,version:'fixture'};
  else if(path==='/api/models')d={items:[{id:'gpt-test',name:'Fixture model',efforts:['low','high'],default_effort:'low'}]};
  else if(path.startsWith('/api/collections'))d={items:[{id:'untemplated',name:'无模板',image_count:1,active:19,covers:[asset]}],total:1};
  else if(path==='/api/templates')d=[{id:'template',title:'模板',text:'可复用提示词',refs:['asset'],references:[asset],options:{ratio:'9:16',size:'2048',transparent:true,polish:true,stitch:16,model:'gpt-test',effort:'low'}}];
  else if(path.startsWith('/api/assets?')){const query=new URL(path,'http://fixture').searchParams;let items=gallery?[asset,{...asset,id:'neighbor',name:'相邻作品.png',job_id:null},{...asset,id:'reference',kind:'reference',name:'参考图.png',job_id:null},{...asset,id:'old-favorite',name:'旧收藏.png',job_id:null,favorite:1}]:[asset];if(paginated)items.push(...Array.from({length:80},(_,i)=>({...asset,id:'reference-'+i,kind:'reference',job_id:null})));if(query.get('kind')==='reference')items=items.filter(a=>a.kind==='reference');if(query.get('kind')==='generated')items=items.filter(a=>a.kind==='generated');if(query.get('favorite')==='true')items=items.filter(a=>a.favorite);else items=items.filter(a=>a.id!=='old-favorite');const total=items.length,offset=Number(query.get('offset')||0),limit=Number(query.get('limit')||100);d={items:items.slice(offset,offset+limit),total};}
  else if(path.startsWith('/api/batches'))d={items:batches,total:2};
  else if(path==='/api/upscale/jobs/up')d=up;
  else if(path.includes('/upscale-plan'))d=plan;
  else if(path.includes('/diagnostics?'))d={input_size:[900,1200],images:{source:'/source.webp',raw:'/raw.webp',affine:'/affine.webp'},tiles:[{index:4,core:[0,0,900,400],state:'ready',reason:'几何正常'},{index:7,core:[0,400,900,800],state:'coverage',reason:'配准后缺失'},{index:8,core:[0,800,900,1200],state:'missing',reason:'尚未返回'}]};
  else if(path.includes('/comparison?'))d={input_size:[600,400],output_size:[1024,768],images:{input:'/input.webp',output:'/output.webp'}};
  else if(path.endsWith('/redraw'))d={ok:true};
  else if(path.endsWith('/quick-edit')){if(quickGate)await quickGate;if(failQuick)return {ok:false,status:503,json:async()=>({detail:'模拟临时失败'})};d={batch_id:'batch',ids:['queued-job']};}
  else if(path==='/api/jobs'&&opt.method)d={batch_id:'batch',ids:['queued-job']};
  else if(path==='/api/storage')d=storage;
  else if(path.includes('/assets/asset/info')){if(delayInfo)await delayInfo;d={asset:asset,job:dataJobs[0]};}
  else if(path.startsWith('/api/jobs?'))d={items:dataJobs,total:20};
  else d={ok:true};
  return {ok:true,status:200,json:async()=>structuredClone(d)};
 };
 const eventListeners={};const addEventListener=(name,fn)=>{(eventListeners[name]??=[]).push(fn);};
 const history={state:{depth:0},pushState(value){this.state=value;},replaceState(value){this.state=value;},back(){this.go(-1);},go(delta){this.state={depth:Math.max(0,this.state.depth+delta)};queueMicrotask(()=>eventListeners.popstate?.forEach(fn=>fn({state:this.state})));}};
 Object.defineProperties(window.HTMLElement.prototype,{offsetWidth:{configurable:true,get(){return parseFloat(this.style.width)||390;}},offsetHeight:{configurable:true,get(){return parseFloat(this.style.height)||844;}},offsetLeft:{configurable:true,get(){return 0;}}});
 window.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,left:0,top:0,right:390,bottom:844,width:390,height:844};};
 window.HTMLElement.prototype.getAnimations=function(){return [];};window.HTMLElement.prototype.animate=function(){return {finished:Promise.resolve({cancel(){}}),cancel(){}};};window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.scrollTo=function(){};
 window.HTMLElement.prototype.setPointerCapture=function(){};window.HTMLElement.prototype.blur=function(){};
 const mediaListeners=[],media={matches:systemReduce,addEventListener:(type,listener)=>{if(type==='change')mediaListeners.push(listener);}};
 const context=vm.createContext({document,window,console,Headers,FormData,fetch,history,location:{href:'http://fixture/'},navigator:{clipboard:{writeText:async()=>{}},vibrate(){}},localStorage:{getItem:key=>key==='studio_draft'&&legacyDraft?JSON.stringify(legacyDraft):null,setItem(){}},matchMedia:query=>query.includes('color-scheme')?{matches:systemDark,addEventListener(){}}:query.includes('min-aspect-ratio')?{matches:false,addEventListener(){}}:media,performance,addEventListener,requestAnimationFrame:fn=>setImmediate(()=>fn(performance.now())),cancelAnimationFrame:clearImmediate,setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),MutationObserver:window.MutationObserver,getComputedStyle:()=>({opacity:'1',getPropertyValue:()=> '0px'}),StudioImages:{status:async()=>({bytes:0,count:0}),clear:async()=>{}},Image:function(){const image=document.createElement("img");Object.defineProperty(image,"src",{get(){return image.getAttribute("src")||"";},set(value){image.setAttribute("src",value);queueMicrotask(()=>image.onload?.());}});Object.defineProperty(image,"naturalWidth",{value:512});Object.defineProperty(image,"naturalHeight",{value:512});image.decode=()=>Promise.resolve();return image;},devicePixelRatio:1,visualViewport:null});
 for(const file of ['studio-theme.js','studio-layout.js','studio-feedback.js','studio-progress.js','studio-ui.js','studio-chrome.js','studio-zoom.js','studio-native-download.js','studio-download.js','studio-references.js','studio-picker.js','studio-avatar.js','studio-selection.js','studio-tasks.js','studio-upscale-prompts.js','studio-landscape.js','studio-failure-map.js','studio-quick-settings.js','studio-service.js'])vm.runInContext(fs.readFileSync('static/'+file,'utf8'),context,{filename:file});
 await vm.runInContext('studioReady',context);
 return {context,document,requests,setSystemReduce(value){media.matches=value;mediaListeners.forEach(fn=>fn({matches:value}));},flushTimers(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}},run:code=>vm.runInContext(code,context),service:vm.runInContext('StudioService',context),prefs,plan};
}

// Independent behavior acceptance. Geometry/timing are controlled; real touch and
// rendering remain browser/device checks. Baseline failures are expected until integration.
function strip(f){
 f.run('StudioService.setComposerRefs(["asset","neighbor","reference"])');
 const box=f.document.querySelector('#refs');
 box.getBoundingClientRect=()=>({left:0,right:264,top:0,bottom:80,width:264,height:80});
 for(const el of box.children)el.getBoundingClientRect=()=>{const i=[...box.children].indexOf(el);return {left:i*88,right:i*88+80,top:0,bottom:80,width:80,height:80};};
 return box;
}
function pointer(f,target,type,x,y=20){const e=new f.context.window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:12,pointerType:'touch',button:0,clientX:x,clientY:y});target.dispatchEvent(e);return e;}
const order=f=>Array.from(f.run('S.composer.refs'));
test('reference hold moves horizontally without a handle, commits once and suppresses preview',async()=>{
 const f=await fixture({gallery:true}),box=strip(f),first=box.querySelector('[data-ref-id="asset"] [data-reference="view"]');
 assert.ok(!box.querySelector('[data-reference="drag"]'),'no drag handle');
 pointer(f,first,'pointerdown',20);f.flushTimers(420);pointer(f,box,'pointermove',230,120);await new Promise(resolve=>setImmediate(resolve));pointer(f,box,'pointerup',230,120);
 assert.deepEqual(order(f),['neighbor','reference','asset']);
 first.dispatchEvent(new f.context.window.Event('click',{bubbles:true,cancelable:true}));
 assert.equal(f.run('V.open'),false,'hold must not open the preview on release');
});
test('reference drop commits the last pointer position even before the next frame',async()=>{
 const f=await fixture({gallery:true}),box=strip(f),first=box.querySelector('[data-ref-id="asset"] [data-reference="view"]');
 pointer(f,first,'pointerdown',20);f.flushTimers(420);pointer(f,box,'pointermove',230);pointer(f,box,'pointerup',230);
 assert.deepEqual(order(f),['neighbor','reference','asset']);
});
test('reference motion before hold and cancelled drag preserve original order',async()=>{
 const f=await fixture({gallery:true}),box=strip(f),first=box.querySelector('[data-ref-id="asset"] [data-reference="view"]');
 pointer(f,first,'pointerdown',20);pointer(f,box,'pointermove',29);f.flushTimers(420);pointer(f,box,'pointerup',230);
 assert.deepEqual(order(f),['asset','neighbor','reference']);
 pointer(f,first,'pointerdown',20);f.flushTimers(420);pointer(f,box,'pointermove',230);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual([...box.querySelectorAll('[data-ref-id]')].map(el=>el.dataset.refId),['neighbor','reference','asset'],'drag visibly changes temporary order before cancellation');
 assert.deepEqual([...box.querySelectorAll('.ref-number')].map(el=>el.textContent),['1','2','3']);assert.match(box.querySelector('[data-ref-id="asset"] .ref-preview').getAttribute('aria-label'),/3/);
 pointer(f,box,'pointercancel',230);assert.deepEqual(order(f),['asset','neighbor','reference']);
 assert.deepEqual([...box.querySelectorAll('[data-ref-id]')].map(el=>el.dataset.refId),['asset','neighbor','reference'],'cancel restores display');assert.match(box.querySelector('[data-ref-id="asset"] .ref-preview').getAttribute('aria-label'),/1/);
});
// These scenarios require the integrated public behavior to settle before concrete
// selectors can be selected. They are intentionally reported as pending, not passing.
test('stationary pointer at edge continues auto-scroll until cancel',async()=>{
 const f=await fixture({gallery:true}),box=strip(f),frames=new Map();let sequence=0;
 f.context.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};f.context.cancelAnimationFrame=id=>frames.delete(id);
 box.scrollLeft=0;const first=box.querySelector('[data-ref-id="asset"] [data-reference="view"]');
 pointer(f,first,'pointerdown',20);f.flushTimers(420);pointer(f,box,'pointermove',260);
 for(let time=0;time<=1000;time+=16){const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(time));}
 assert.ok(box.scrollLeft>0,'edge auto-scroll advances while pointer is stationary');
 pointer(f,box,'pointercancel',260);const stopped=box.scrollLeft;
 for(let time=1016;time<=1200;time+=16){const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(time));}
 assert.equal(box.scrollLeft,stopped,'cancel stops scrolling');assert.deepEqual(order(f),['asset','neighbor','reference']);
});
test('pending quick edit rejects a duplicate submit and preserves input on failure',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const f=await fixture({failQuick:true,quickGate:gate});f.run('quickSheet("asset")');
 const input=f.document.querySelector('#qs-input'),form=f.document.querySelector('#qs-form');input.value='保留这段文字';input.dispatchEvent(new f.context.window.Event('input',{bubbles:true}));
 const submit=()=>form.dispatchEvent(new f.context.window.Event('submit',{bubbles:true,cancelable:true}));
 submit();submit();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.requests.filter(r=>r.path.endsWith('/quick-edit')).length,1,'one request while pending');
 release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(input.value,'保留这段文字');assert.ok(form.isConnected);
});
// Actual CSS cascade, pseudo-elements and contrast are exercised by tests/android/overhaul/run.ps1 in Android WebView.
test('viewer reports pending decode, failure, retry and success without discarding thumbnail',async()=>{
 const f=await fixture(),loads=[];f.context.Image=function(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});const loader={decode:()=>promise};loads.push({loader,resolve,reject});return loader;};
 f.run('openViewer("asset","recent")');const slide=f.document.querySelector('.slide[data-o="0"]'),image=slide.querySelector('img');
 assert.equal(slide.getAttribute('data-loading'),'1');assert.match(image.src,/thumbnail/);loads[0].reject(new Error('decode failed'));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(slide.getAttribute('data-loading'),'error');assert.match(image.src,/thumbnail/);slide.dataset.loading='error';slide.querySelector('.preview-loading').click();assert.equal(slide.getAttribute('data-loading'),'1');
 loads.at(-1).resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(slide.getAttribute('data-loading'),'0');assert.match(image.src,/preview/);
});
test('works selection enters on hold, toggles items and back clears mode',async()=>{
 const f=await fixture({gallery:true});f.run('S.tab="works";renderPage()');const tile=f.document.querySelector('#page .tile');assert.ok(tile);
 pointer(f,tile,'pointerdown',30);f.flushTimers(480);assert.equal(f.run('StudioSelection.active()'),false);f.flushTimers(420);assert.equal(f.run('StudioSelection.active()'),true);assert.equal(tile.getAttribute('aria-pressed'),'true');
 tile.dispatchEvent(new f.context.window.Event('click',{bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
 // The synthetic click immediately following hold is intentionally suppressed.
 assert.equal(tile.getAttribute('aria-pressed'),'true');await f.run('back()');assert.equal(f.run('StudioSelection.active()'),false);
});
test('native bridge sends cached blob in acknowledged bounded chunks without URL or cookie',async()=>{
 const events={},messages=[];let inflight=0,maxInflight=0;
 const port={start(){},close(){},postMessage(raw){const m=JSON.parse(raw);messages.push(m);inflight++;maxInflight=Math.max(maxInflight,inflight);queueMicrotask(()=>{inflight--;const type=m.type==='begin'?'ready':m.type==='chunk'?'ack':m.type==='end'?'complete':null;if(type)port.onmessage({data:JSON.stringify({id:m.id,type,seq:m.seq,detail:'saved.png'})});});}};
 const window={},context=vm.createContext({window,navigator:{userAgent:'ImageStudioAndroid/1.1'},location:{origin:'https://image.arcol.site'},addEventListener:(name,fn)=>events[name]=fn,crypto:require('node:crypto').webcrypto,Uint8Array,Blob,DOMException,btoa,setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync('static/studio-native-download.js','utf8'),context);
 events.message({isTrusted:true,source:window,origin:'https://image.arcol.site',data:'IMAGE_STUDIO_DOWNLOAD_PORT_V1',ports:[port]});
 const blob=new Blob([new Uint8Array(140000)],{type:'image/png'}),result=await vm.runInContext('StudioNativeDownloads',context).save(blob,'safe.png');
 assert.equal(result,'saved.png');assert.deepEqual(messages.map(m=>m.type),['begin','chunk','chunk','chunk','end']);assert.equal(maxInflight,1);
 assert.deepEqual(messages.filter(m=>m.type==='chunk').map(m=>Buffer.from(m.data,'base64').length),[65536,65536,8928]);
 assert.ok(messages.every(m=>!('url' in m)&&!('cookie' in m)));
});
test('mixed generation and upscale batch distinguishes child progress and preserves failure',async()=>{
 const f=await fixture();
 f.context.composite={id:'composite',kind:'image',prompt:'复合任务',created:1000,coll:'untemplated',ratio:'1:1',tasks:[
  {id:'parent',status:'done',stage:0,img:'asset',raw:{options:{after_upscale:4}}},
  {id:'child',status:'running',stage:2,raw:{options:{stitch:4,parent_job_id:'parent'},progress:{label:'第 1 级 · 2/4 块'}}}
 ]};
 const running=f.run('batchHTML(composite)');assert.match(running,/原图完成/);assert.match(running,/超分进行中/);assert.match(running,/第 1 级/);
 f.context.composite.tasks[1].status='failed';f.context.composite.tasks[1].err='图块验收失败';
 const failed=f.run('batchHTML(composite)');assert.match(failed,/图块验收失败/);assert.match(failed,/failure-job/);assert.match(failed,/原图完成/);
});
test('landscape viewport respects safe insets and fits images across short and wide canvases',()=>{
 const {document}=parseHTML('<html><body><div id="app"><div id="screens"></div></div></body></html>'),app=document.querySelector('#app');let w=667,h=375;Object.defineProperties(app,{offsetWidth:{get:()=>w},offsetHeight:{get:()=>h}});
 const context=vm.createContext({document,app,viewerHeight:()=>h,matchMedia:()=>({matches:true,addEventListener(){}}),clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),getComputedStyle:()=>({getPropertyValue:key=>({'--safe-left':'24px','--safe-right':'12px','--safe-top':'8px','--safe-bottom':'10px'}[key]||'0px')}),MutationObserver:class{observe(){}},requestAnimationFrame:()=>1,addEventListener(){},$:s=>document.querySelector(s),$$:s=>[...document.querySelectorAll(s)]});
 vm.runInContext(fs.readFileSync('static/studio-landscape.js','utf8'),context);const land=vm.runInContext('StudioLandscape',context);
 for(const [width,height] of [[667,375],[844,390],[1024,768],[1440,900]]){w=width;h=height;const v=land.viewport(),fit=land.fit({w:900,h:1200});assert.equal(v.left,40);assert.equal(v.top,60);assert.equal(v.bottom,height-26);assert.ok(fit.x>=v.left-.001&&fit.y>=v.top-.001);assert.ok(fit.x+fit.w<=v.right+.001&&fit.y+fit.h<=v.bottom+.001);assert.ok(Math.abs(fit.w/fit.h-.75)<1e-8);}
 const readonly=land.viewport({reference:true,select:false}),select=land.viewport({reference:true,select:true});assert.equal(readonly.right-select.right,190);
});
test('redraw regions preserve normalized coordinates and text when viewport rotates',()=>{
 const {document,window}=parseHTML('<html><body><div id="app"><div id="viewer"><div id="stage"><div id="track"><img id="preview"></div></div></div></div></body></html>'),app=document.querySelector('#app'),vw=document.querySelector('#viewer'),stage=document.querySelector('#stage'),track=document.querySelector('#track'),preview=document.querySelector('#preview');let fit={x:0,y:100,w:390,h:520},frame;const events={};
 const old={...fit},region={x:old.x+old.w*.2,y:old.y+old.h*.25,w:old.w*.3,h:old.h*.35,text:'保留文字'},V={open:true,redraw:true,list:['asset'],i:0,fitRect:old,regions:[region]};
 const context=vm.createContext({document,window,app,vw,stage,track,V,img:()=>({id:'asset',w:900,h:1200}),curImg:()=>preview,fitRect:()=>({...fit}),renderRegions(){},selCancel(){},addEventListener:(name,fn)=>events[name]=fn,requestAnimationFrame:fn=>{frame=fn;return 1},cancelAnimationFrame(){},setTimeout,clearTimeout,performance,devicePixelRatio:1,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),$:(s,r=document)=>r.querySelector(s)});
 vm.runInContext(fs.readFileSync('static/studio-zoom.js','utf8'),context);fit={x:80,y:52,w:210,h:280};events.resize();frame(16);
 assert.ok(Math.abs((region.x-fit.x)/fit.w-.2)<1e-9);assert.ok(Math.abs((region.y-fit.y)/fit.h-.25)<1e-9);assert.ok(Math.abs(region.w/fit.w-.3)<1e-9);assert.ok(Math.abs(region.h/fit.h-.35)<1e-9);assert.equal(region.text,'保留文字');
});

function rotatingZoomFixture({dpr=1,width=12017,height=8003}={}){
 const {document,window}=parseHTML('<html><body><div id="app"><div id="viewer"><div id="stage"><div id="track"><div class="slide" data-o="0"><img id="preview"></div></div></div></div></div></body></html>');
 const app=document.querySelector('#app'),vw=document.querySelector('#viewer'),stage=document.querySelector('#stage'),track=document.querySelector('#track'),preview=document.querySelector('#preview');
 let fit={x:0,y:200,w:390,h:260},viewport={w:390,h:844};const frames=new Map(),timers=new Map(),requests=[],loading=new Set(),writes=[];let clock=0,next=0,reads=0,maxLoading=0;
 const asset={id:'large',w:width,h:height,tile_template:'/api/assets/large/tiles/{level}/{x}/{y}'},V={open:true,list:['large'],i:0,redraw:false};
 function watch(node){const style=node.style,proxy=new Proxy(style,{set(target,key,value){writes.push({node,key,value});target[key]=value;return true;}});Object.defineProperty(node,'style',{configurable:true,get:()=>proxy});return node;}
 watch(preview);const create=document.createElement.bind(document);document.createElement=function(...args){return watch(create(...args));};
 Object.defineProperty(app,'offsetWidth',{get(){reads++;return viewport.w;}});Object.defineProperty(app,'offsetHeight',{get(){reads++;return viewport.h;}});app.getBoundingClientRect=()=>{reads++;return {left:0,top:0,width:viewport.w,height:viewport.h};};stage.setPointerCapture=()=>{};
 const events={};const context=vm.createContext({document,console,Image:function(){const image=document.createElement('img');Object.defineProperty(image,'naturalWidth',{value:512});Object.defineProperty(image,'naturalHeight',{value:512});Object.defineProperty(image,'src',{get:()=>image.getAttribute('src')||'',set(value){image.setAttribute('src',value);requests.push(value);loading.add(image);maxLoading=Math.max(maxLoading,loading.size);}});image.decode=()=>Promise.resolve();return image;},
   app,vw,stage,track,V,img:()=>asset,curImg:()=>preview,$:(s,r=document)=>r.querySelector(s),clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),fitRect:()=>({...fit}),renderRegions(){},getComputedStyle:()=>{reads++;return {getPropertyValue:()=> '0px'};},performance:{now:()=>clock},devicePixelRatio:dpr,
   requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(fn,ms)=>{timers.set(++next,{fn,at:clock+ms});return next;},clearTimeout:id=>timers.delete(id),addEventListener:(type,fn)=>{events[type]=fn;},drag:null});
 vm.runInContext(fs.readFileSync('static/studio-zoom.js','utf8'),context);const zoom=vm.runInContext('StudioZoom',context);
 function pointer(type,x,y,id=1){const e=new window.Event(type,{bubbles:true});Object.assign(e,{clientX:x,clientY:y,pointerId:id,button:0});stage.dispatchEvent(e);}
 function wheel(deltaY){const e=new window.Event('wheel',{bubbles:true,cancelable:true});Object.assign(e,{clientX:190,clientY:350,deltaY,deltaMode:0});stage.dispatchEvent(e);}
 function frame(){clock+=16.67;const next=[...frames.values()];frames.clear();next.forEach(fn=>fn(clock));}
 async function loaded(){for(let rounds=0;rounds<100&&(loading.size||zoom.cacheUsage().active);rounds++){const batch=[...loading];loading.clear();batch.forEach(image=>image.onload?.());await Promise.resolve();await Promise.resolve();}}
 async function native(){zoom.toggleNative();frame();await loaded();writes.length=0;reads=0;}
 async function pan(dx,dy=0){pointer('pointerdown',100,350);pointer('pointermove',100+dx,350+dy);pointer('pointerup',100+dx,350+dy);frame();await loaded();}
 return {setView(nextFit,nextViewport){fit=nextFit;viewport=nextViewport;},document,context,zoom,asset,V,stage,preview,requests,loading,writes,events,frames,pointer,wheel,frame,loaded,native,pan,get reads(){return reads;},clear(){reads=0;writes.length=0;},get maxLoading(){return maxLoading;},advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}}};
}
test('rotation preserves native pixel scale and the visible source anchor in zoom mode',async()=>{
 const f=rotatingZoomFixture();await f.native();await f.pan(200,60);
 const old={x:0,y:200,w:390,h:260},parse=()=>f.document.querySelector('.zoom-plane').style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,0\) scale\(([-\d.]+)\)/),before=parse();
 const nativeScale=Number(before[3])*old.w/f.asset.w,anchorX=(old.x+old.w/2-Number(before[1]))/(old.w*Number(before[3])),anchorY=(old.y+old.h/2-Number(before[2]))/(old.h*Number(before[3]));
 const next={x:40,y:52,w:400,h:266.6666666667};f.setView(next,{w:667,h:375});f.events.resize();f.frame();f.frame();const after=parse();
 assert.ok(Math.abs(Number(after[3])*next.w/f.asset.w-nativeScale)<1e-9);
 assert.ok(Math.abs((next.x+next.w/2-Number(after[1]))/(next.w*Number(after[3]))-anchorX)<1e-9);
 assert.ok(Math.abs((next.y+next.h/2-Number(after[2]))/(next.h*Number(after[3]))-anchorY)<1e-9);
});
