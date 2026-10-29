const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const {parseHTML}=require('linkedom');
const html=fs.readFileSync('static/index.html','utf8');
const prompt='Generate an image using {prompt}, preserving the requested native dimensions.';
const baseAsset={id:'asset',width:900,height:1200,name:'山色.png',kind:'generated',bytes:1234,created:1000,job_id:'job',url:'/media/asset',thumbnail:'/media/asset?thumbnail=1',preview:'/media/asset?preview=1',favorite:0,tags:''};
function makeJob(id,extra={}){return {id,batch_id:'batch',prompt:'静谧山色',status:'queued',created:1000,collection_id:'untemplated',template_id:'',refs:[],references:[],outputs:[],attempt:0,max_attempts:3,error:'',model:'gpt-test',effort:'high',options:{ratio:'1:1',size:'auto',model:'gpt-test',effort:'high',stitch:0},progress:{stage:'queued',label:'等待调度'},...extra};}
async function fixture({unauth=false,failQuick=false,huge=false,delayInfo=null,failSync=false,legacyDraft=null,gallery=false,paginated=false}={}){
 const {window}=parseHTML(html),{document}=window;const requests=[],timers=new Map();let timerId=0,stateReads=0;
 const asset=huge?{...baseAsset,width:12000,height:8000,tile_template:'/api/assets/asset/tiles/{level}/{x}/{y}'}:baseAsset;
 const dataJobs=[makeJob('job',{status:'succeeded',outputs:[asset]}),...Array.from({length:19},(_,i)=>makeJob('job'+i))];
 const plan={factor:4,input_size:[900,1200],output_size:[1800,2400],budget:{images:3,reviews:1,max_calls:10},stages:[{index:1,input_size:[900,1200],output_size:[1800,2400],columns:1,rows:3,tile_count:3,status:'failed',cuts:{x:[],y:[400,800]},budget:{images:3,reviews:1,max_calls:10},diagnostic_available:true}]};
 const up=makeJob('up',{batch_id:'upbatch',status:'failed',options:{stitch:4,source_asset_id:'asset'},source_image:asset,upscale_plan:plan,error:'图块验收失败'});
 const batches=[{id:'batch',created:1000,jobs:dataJobs},{id:'upbatch',created:999,jobs:[up]}];
 const prefs={defaults:{ratio:'3:2',size:'auto',count:3,transparent:false,polish:false,stitch:0},quick:{keep_spec:true,use_ref:true,use_source_template:true,effort:'high',notify:true},upscale:{factor:4,auto_select:true,default_injection:''},motion:false,motion_mode:'reduce',notify:false,call_prompt:prompt,polish_prompt:prompt,stitch_prompt:prompt,default_call_prompt:prompt,default_polish_prompt:prompt,default_stitch_prompt:prompt};
 const state={model:'gpt-test',effort:'high',concurrency:2,max_attempts:3,paused:true,preferences:prefs};
 const storage={bytes:1024,limit_bytes:0,free_bytes:1e9,groups:{database:512},tasks:[],trash:{assets:0,collections:0}};
 const fetch=async(path,opt={})=>{requests.push({path,method:opt.method||'GET',body:typeof opt.body==='string'?JSON.parse(opt.body):opt.body,headers:opt.headers});let d;
  if(path==='/api/auth/state')d={initialized:true,authenticated:!unauth,csrf:'csrf-fixture',cache_scope:'fixture'};
  else if(path==='/api/state'){if(failSync&&stateReads++>0)return {ok:false,status:503,json:async()=>({detail:'poll unavailable'})};d=state;}
  else if(path==='/api/settings')d=opt.method?{ok:true}:prefs;
  else if(path==='/api/account')d={username:'tester',session_count:1};
  else if(path==='/api/setup/status')d={authenticated:true,version:'fixture'};
  else if(path==='/api/models')d={items:[{id:'gpt-test',name:'Fixture model',efforts:['low','high'],default_effort:'low'}]};
  else if(path.startsWith('/api/collections'))d={items:[{id:'untemplated',name:'无模板',image_count:1,active:19,covers:[asset]}],total:1};
  else if(path==='/api/templates')d=[{id:'template',title:'模板',text:'可复用提示词',refs:['asset'],references:[asset],options:{ratio:'9:16',size:'2048',transparent:true,polish:true,stitch:16,model:'gpt-test',effort:'low'}}];
  else if(path.startsWith('/api/assets?')){const query=new URL(path,'http://fixture').searchParams;let items=gallery?[asset,{...asset,id:'neighbor',name:'相邻作品.png',job_id:null},{...asset,id:'reference',kind:'reference',name:'参考图.png',job_id:null},{...asset,id:'old-favorite',name:'旧收藏.png',job_id:null,favorite:1}]:[asset];if(paginated)items.push(...Array.from({length:80},(_,i)=>({...asset,id:'reference-'+i,kind:'reference',job_id:null})));if(query.get('kind')==='reference')items=items.filter(a=>a.kind==='reference');if(query.get('favorite')==='true')items=items.filter(a=>a.favorite);else items=items.filter(a=>a.id!=='old-favorite');const total=items.length,offset=Number(query.get('offset')||0),limit=Number(query.get('limit')||100);d={items:items.slice(offset,offset+limit),total};}
  else if(path.startsWith('/api/batches'))d={items:batches,total:2};
  else if(path==='/api/upscale/jobs/up')d=up;
  else if(path.includes('/upscale-plan'))d=plan;
  else if(path.includes('/diagnostics?'))d={input_size:[900,1200],images:{source:'/source.webp',raw:'/raw.webp',affine:'/affine.webp'},tiles:[{index:4,core:[0,0,900,400],state:'ready',reason:'几何正常'},{index:7,core:[0,400,900,800],state:'coverage',reason:'配准后缺失'},{index:8,core:[0,800,900,1200],state:'missing',reason:'尚未返回'}]};
  else if(path.includes('/comparison?'))d={input_size:[600,400],output_size:[1024,768],images:{input:'/input.webp',output:'/output.webp'}};
  else if(path.endsWith('/redraw'))d={ok:true};
  else if(path.endsWith('/quick-edit')){if(failQuick)return {ok:false,status:503,json:async()=>({detail:'模拟临时失败'})};d={batch_id:'batch',ids:['queued-job']};}
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
 window.HTMLElement.prototype.animate=function(){return {finished:Promise.resolve({cancel(){}}),cancel(){}};};window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.scrollTo=function(){};
 window.HTMLElement.prototype.setPointerCapture=function(){};window.HTMLElement.prototype.blur=function(){};
 const context=vm.createContext({document,window,console,Headers,FormData,fetch,history,location:{href:'http://fixture/'},navigator:{clipboard:{writeText:async()=>{}},vibrate(){}},localStorage:{getItem:key=>key==='studio_draft'&&legacyDraft?JSON.stringify(legacyDraft):null,setItem(){}},matchMedia:()=>({matches:true}),performance,addEventListener,requestAnimationFrame:fn=>setImmediate(()=>fn(performance.now())),cancelAnimationFrame:clearImmediate,setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),MutationObserver:window.MutationObserver,getComputedStyle:()=>({opacity:'1',getPropertyValue:()=> '0px'}),StudioImages:{status:async()=>({bytes:0,count:0}),clear:async()=>{}},Image:function(){const image=document.createElement("img");Object.defineProperty(image,"src",{get(){return image.getAttribute("src")||"";},set(value){image.setAttribute("src",value);queueMicrotask(()=>image.onload?.());}});Object.defineProperty(image,"naturalWidth",{value:512});Object.defineProperty(image,"naturalHeight",{value:512});image.decode=()=>Promise.resolve();return image;},devicePixelRatio:1,visualViewport:null});
 for(const file of ['studio-layout.js','studio-ui.js','studio-zoom.js','studio-download.js','studio-service.js'])vm.runInContext(fs.readFileSync('static/'+file,'utf8'),context,{filename:file});
 await vm.runInContext('studioReady',context);
 return {context,document,requests,flushTimers(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}},run:code=>vm.runInContext(code,context),service:vm.runInContext('StudioService',context),prefs,plan};
}
test('production entry uses only transplanted component styles and real adapter',()=>{
 assert.doesNotMatch(html,/workspace\.css|style\.css|mobile\.css|app\.js/);assert.match(html,/studio-ui\.js/);assert.match(html,/studio-layout\.js/);
 const ui=fs.readFileSync('static/studio-ui.js','utf8');assert.doesNotMatch(ui,/makeImage|newBatch|Math\.random\(\).*status|simulated scheduler|thread.started demo/);
 const css=fs.readFileSync('static/studio.css','utf8');assert.match(css,/--bg:#f5f4ef/);assert.match(css,/\.top\{flex:none;height:56px/);assert.doesNotMatch(css,/\.cmp-l\.out\.offset\{/);
});
test('boot maps a complete 20-image batch once and actual image ratio differs from requested ratio',async()=>{const f=await fixture();assert.equal(f.run('S.batches.find(b=>b.id==="batch").tasks.length'),20);assert.equal(f.run('img("asset").ratio'),'3:4');assert.equal(f.run('S.composer.count'),3);assert.equal(f.document.querySelector('#tabbar').hidden,false);});
test('trusted layout values are applied through CSSOM without relaxing CSP',async()=>{const f=await fixture();f.run('openViewer("asset","recent")');assert.match(f.document.querySelector('.slide img').style.width,/px/);assert.equal(f.document.querySelector('.slide img').style.width,'390px');const app=fs.readFileSync('app.py','utf8');assert.match(app,/style-src 'self'; script-src 'self'/);assert.doesNotMatch(app,/unsafe-inline/);});
test('generate forwards real options including generation-followed-by-upscale and CSRF',async()=>{const f=await fixture();f.run('Object.assign(S.composer,{prompt:"生成一张山谷",count:4,stitch:"16×",polish:true,size:"2K"})');await f.service.generate();const req=f.requests.find(r=>r.path==='/api/jobs'&&r.method==='POST');assert.equal(req.body.after_upscale,16);assert.equal(req.body.count,4);assert.equal(req.body.size,'2048');assert.equal(req.body.model,'gpt-test');assert.equal(req.headers.get('X-CSRF-Token'),'csrf-fixture');});
test('failed quick edit preserves user input and propagates error to its caller',async()=>{const f=await fixture({failQuick:true});await assert.rejects(f.service.sendQuick('asset','换成雨天'),/模拟临时失败/);assert.ok(f.requests.some(r=>r.path.endsWith('/quick-edit')));});
test('template restores references, dimensions, transparency, polish, model and upscale',async()=>{const f=await fixture();await f.service.loadTemplate('template');assert.equal(f.run('S.composer.refs[0]'),'asset');assert.equal(f.run('S.composer.ratio'),'9:16');assert.equal(f.run('S.composer.size'),'2K');assert.equal(f.run('S.composer.stitch'),'16×');assert.equal(f.run('S.composer.effort'),'low');assert.equal(f.run('S.composer.transparent'),true);});
test('failure workspace uses diagnostic images, stable adaptive tile IDs and native comparison dimensions',async()=>{const f=await fixture();await f.service.openFailure('up');assert.match(f.document.querySelector('.fx-stage img').src,/affine.webp/);assert.deepEqual(Array.from(f.run('[...FX.sel]')),[7,8]);await f.service.action('fx-cmp',{dataset:{i:'7'}},{});assert.equal(f.document.querySelector('.cmp-l.out img').src,'/output.webp');assert.match(f.document.querySelector('.fx-cap').textContent,/1024×768/);await f.service.fxSubmit();const req=f.requests.find(r=>r.path.endsWith('/redraw')&&r.method==='POST');assert.deepEqual(req.body.tiles,[7,8]);assert.equal(req.body.level,1);});
test('settings persist demo quick switches and all three motion modes',async()=>{const f=await fixture();f.run('S.settings.quick.keepSpec=false;S.settings.quick.useRef=false;S.settings.motion="full"');await f.service.settingChanged('motion');const req=f.requests.find(r=>r.path==='/api/settings'&&r.method==='PATCH');assert.equal(req.body.motion_mode,'full');assert.equal(req.body.quick.keep_spec,false);assert.equal(req.body.quick.use_ref,false);assert.equal(req.body.paused,undefined);});
test('unauthenticated boot shows login and hides workspace navigation',async()=>{const f=await fixture({unauth:true});assert.ok(f.document.querySelector('#login-form'));assert.equal(f.document.querySelector('#tabbar').hidden,true);assert.equal(f.requests.some(r=>r.path==='/api/assets?kind=all&limit=200'),false);});

test('all demo component rules are retained verbatim except simulated image distortions',()=>{
 const demo=fs.readFileSync('docs/ui-proposal/index.html','utf8'),css=fs.readFileSync('static/studio.css','utf8');
 const start='/* ---------- page chrome ---------- */';
 const source=demo.slice(demo.indexOf(start),demo.indexOf('</style>')).split('\n').filter(line=>!line.startsWith('.cmp-l.out.')).join('\n').replace(/\s+/g,' ').trim();
 const product=css.slice(css.indexOf(start),css.indexOf('/* Real viewport:')).replace(/\s+/g,' ').trim();assert.equal(product,source);
});
test('sheet content switches preserve one history layer and serialized back closes one at a time',async()=>{const f=await fixture();f.run('openViewer("asset","recent");openSheet({title:"第一步",html:"内容"});openSheet({title:"第二步",html:"新内容"})');assert.equal(f.run('layers.length'),2);assert.equal(f.document.querySelectorAll('.sheet-layer').length,1);assert.equal(f.document.querySelector('.sheet-head h2').textContent,'第二步');await Promise.all([f.run('back()'),f.run('back()')]);assert.equal(f.run('layers.length'),0);assert.equal(f.run('V.open'),false);});
test('Android back hook consumes a sheet or viewer and returns false at root',async()=>{const f=await fixture();assert.equal(f.run('studioBack()'),false);f.run('openSheet({title:"详情",html:"内容"})');assert.equal(f.run('studioBack()'),true);await f.run('historyQueue');assert.equal(f.run('layers.length'),0);});

test('native-pixel view loads only visible bounded DZI tiles and returns to fit',async()=>{const f=await fixture({huge:true});f.run('openViewer("asset","recent");StudioZoom.toggleNative()');await new Promise(resolve=>setImmediate(resolve));const surface=f.document.querySelector('.zoom-plane');assert.ok(surface);assert.ok(Math.abs(Number(surface.style.transform.match(/scale\(([^)]+)\)/)[1])*390-12000)<.001);const tiles=f.document.querySelectorAll('.native-tiles img');assert.ok(tiles.length>0&&tiles.length<=56);for(const image of tiles)assert.match(image.src,/\/tiles\/14\//);f.run('StudioZoom.fit()');assert.equal(f.document.querySelector('.slide img').style.width,'390px');assert.equal(f.document.querySelectorAll('.native-tiles img').length,0);});

test('late image info cannot replace a panel opened while the request was pending',async()=>{let release;const waiting=new Promise(resolve=>release=resolve),f=await fixture({delayInfo:waiting});const pending=f.service.infoSheet('asset');await new Promise(resolve=>setImmediate(resolve));f.run('openSheet({title:"新的操作",html:"保留当前面板"})');release();await pending;assert.equal(f.document.querySelector('.sheet-head h2').textContent,'新的操作');assert.match(f.document.querySelector('.sheet-body').textContent,/保留当前面板/);});
test('an accepted generation stays accepted when the subsequent status poll fails',async()=>{const f=await fixture({failSync:true});f.run('S.composer.prompt="山谷"');await f.service.generate();assert.equal(f.requests.filter(r=>r.path==='/api/jobs'&&r.method==='POST').length,1);assert.equal(f.document.querySelector('#gen').classList.contains('done'),true);assert.match(f.document.querySelector('#toast').textContent,/任务已提交/);});

test('the previous UI draft migrates into the demo composer without losing template or options',async()=>{const f=await fixture({legacyDraft:{prompt:"保留的长草稿",refs:['asset'],ratio:'auto',count:4,size:'2048',stitch:16,transparent:true,polish:true,template:{id:'template'}}});assert.equal(f.run('S.composer.prompt'),'保留的长草稿');assert.equal(f.run('S.composer.ratio'),'自动');assert.equal(f.run('S.composer.stitch'),'16×');assert.equal(f.run('S.composer.template'),'template');assert.equal(f.run('S.composer.refs[0]'),'asset');assert.equal(f.run('S.composer.size'),'2K');assert.equal(f.run('S.composer.effort'),'high');});

test('touch redraw owns its gesture, supports a second region and does not force the keyboard open',async()=>{
 const f=await fixture();f.run('openViewer("asset","recent");enterRedraw()');assert.equal(f.document.documentElement.classList.contains('rm'),true);
 const touch=(type,x,y,id=4)=>f.run(`(()=>{const e=new window.Event(${JSON.stringify(type)},{bubbles:true,cancelable:true}),t={identifier:${id},clientX:${x},clientY:${y}};Object.assign(e,{touches:${type==='touchend'||type==='touchcancel'?'[]':'[t]'},changedTouches:{0:t,length:1}});stage.dispatchEvent(e);return e.defaultPrevented;})()`);
 f.run('(()=>{const e=new window.Event("pointerdown",{bubbles:true});Object.assign(e,{pointerType:"touch",pointerId:4,clientX:80,clientY:200});stage.dispatchEvent(e);})()');assert.equal(f.run('sd'),null);
 assert.equal(touch('touchstart',80,200),true,JSON.stringify(f.run('[V.open,V.redraw,selectionTouch,!!sd]')));assert.equal(touch('touchmove',220,420),true,JSON.stringify(f.run('[V.open,V.redraw,selectionTouch,!!sd]')));touch('touchend',220,420);
 assert.equal(f.run('V.regions.length'),1);assert.equal(f.run('sd'),null);assert.equal(f.document.querySelectorAll('.sel').length,1);
 touch('touchstart',260,140);touch('touchmove',350,230);touch('touchend',350,230);assert.equal(f.run('V.regions.length'),2);
 let focuses=0;f.document.querySelector('#rd-text').focus=()=>focuses++;f.flushTimers(120);assert.equal(focuses,0);
 touch('touchstart',30,450);touch('touchmove',70,500);touch('touchcancel',70,500);assert.equal(f.run('V.regions.length'),2);assert.equal(f.document.querySelectorAll('.sel').length,2);
});

test('swiping batches pointer movement without layout reads and keeps the decoded next image node',async()=>{
 const f=await fixture({gallery:true});f.run('openViewer("asset","recent")');const next=f.document.querySelector('.slide[data-o="1"] img');assert.ok(next);
 const pointer=(type,x)=>f.run(`(()=>{const e=new window.Event(${JSON.stringify(type)},{bubbles:true});Object.assign(e,{pointerId:3,button:0,clientX:${x},clientY:300});stage.dispatchEvent(e);})()`);
 pointer('pointerdown',300);let reads=0;f.document.querySelector('#app').getBoundingClientRect=()=>{reads++;return {left:0,top:0,width:390,height:844};};
 for(let i=0;i<120;i++)pointer('pointermove',299-i);assert.equal(reads,0);assert.equal(f.document.querySelector('#v-track').style.transform,'');
 await new Promise(resolve=>setImmediate(resolve));assert.match(f.document.querySelector('#v-track').style.transform,/translate3d\(-120px/);
 pointer('pointerup',180);await Promise.resolve();assert.equal(f.run('V.i'),1);assert.equal(f.document.querySelector('.slide[data-o="0"] img'),next);assert.equal(f.document.querySelectorAll('.slide').length,2);
});

test('reference and favorites tabs query complete server lists and keep independent viewer navigation',async()=>{
 const f=await fixture({gallery:true});assert.equal(f.run('img("old-favorite")'),undefined);f.run('S.tab="works";renderPage()');await f.service.action('works-tab',{dataset:{v:'references'}},{});
 assert.match(f.requests.at(-1).path,/kind=reference/);assert.equal(f.document.querySelectorAll('#works-grid .tile').length,1);assert.equal(f.document.querySelector('#works-grid .tile').dataset.id,'reference');f.run('openViewer("reference","references")');assert.deepEqual(Array.from(f.run('V.list')),['reference']);await f.run('back()');
 await f.service.action('works-tab',{dataset:{v:'favorites'}},{});assert.match(f.requests.at(-1).path,/favorite=true/);assert.equal(f.document.querySelector('#works-grid .tile').dataset.id,'old-favorite');f.run('openViewer("old-favorite","favorites")');assert.deepEqual(Array.from(f.run('V.list')),['old-favorite']);
});

test('mouse selection remains usable when the document itself has the reduced-motion rm class',async()=>{
 const f=await fixture();f.run('openViewer("asset","recent");enterRedraw()');assert.ok(f.document.documentElement.classList.contains('rm'));
 for(const [type,x,y] of [['pointerdown',60,200],['pointermove',200,330],['pointerup',200,330]])f.run(`(()=>{const event=new window.Event('${type}',{bubbles:true,cancelable:true});Object.assign(event,{pointerId:2,pointerType:'mouse',button:0,clientX:${x},clientY:${y}});stage.dispatchEvent(event);})()`);
 assert.equal(f.run('V.regions.length'),1);assert.equal(f.run('V.regions[0].w'),140);assert.equal(f.run('V.regions[0].h'),130);
});

test('reference pagination reaches older uploads without losing the first page or viewer order',async()=>{
 const f=await fixture({gallery:true,paginated:true});f.run('S.tab="works";renderPage()');await f.service.action('works-tab',{dataset:{v:'references'}},{});assert.equal(f.document.querySelectorAll('#works-grid .tile').length,80);
 await f.service.action('works-more',{dataset:{}},{});assert.match(f.requests.at(-1).path,/offset=80/);assert.equal(f.document.querySelectorAll('#works-grid .tile').length,81);assert.equal(f.document.querySelector('[data-act="works-more"]').hidden,true);
 f.run('openViewer("reference-79","references")');assert.equal(f.run('V.list.length'),81);assert.equal(f.run('V.i'),80);
});
