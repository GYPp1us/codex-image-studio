const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const {parseHTML}=require('linkedom');
const html=fs.readFileSync('static/index.html','utf8');
const prompt='Generate an image using {prompt}, preserving the requested native dimensions.';
const baseAsset={id:'asset',width:900,height:1200,name:'山色.png',kind:'generated',bytes:1234,created:1000,job_id:'job',url:'/media/asset',thumbnail:'/media/asset?thumbnail=1',preview:'/media/asset?preview=1',favorite:0,tags:''};
function makeJob(id,extra={}){return {id,batch_id:'batch',prompt:'静谧山色',status:'queued',created:1000,collection_id:'untemplated',template_id:'',refs:[],references:[],outputs:[],attempt:0,max_attempts:3,error:'',model:'gpt-test',effort:'high',options:{ratio:'1:1',size:'auto',model:'gpt-test',effort:'high',stitch:0},progress:{stage:'queued',label:'等待调度'},...extra};}
async function fixture({unauth=false,failQuick=false,huge=false,delayInfo=null,failSync=false,legacyDraft=null,gallery=false,paginated=false,systemReduce=true,motion='reduce',legacyMotion=false,systemDark=false,avatarURL='',quickGate=null,settingsFail=false,bigFailure=false,chained=false,chainStatus='failed',defaultInjection='',rerollUpscale=false,savedDraft=null,previewGate=null,accountGate=null,loginGate=null,restoreGate=null,accountFail=false,loginFail=false,restoreFail=false,trashPaged=false,trashPageGate=null,connectGate=null,uploadGate=null,assetGate=null,renameGate=null,avatarGate=null,renameFail=false,passwordFail=false,staleStatusGate=null,settingsGate=null}={}){
 const {window}=parseHTML(html),{document}=window;const requests=[],timers=new Map(),stored={};let timerId=0,stateReads=0,statusReads=0;
 if(savedDraft)stored['studio-demo-composer:fixture']=JSON.stringify(savedDraft);
 const asset=huge?{...baseAsset,width:12000,height:8000,tile_template:'/api/assets/asset/tiles/{level}/{x}/{y}'}:baseAsset;
 const dataJobs=[makeJob('job',{status:'succeeded',outputs:[asset]}),...Array.from({length:19},(_,i)=>makeJob('job'+i))];
 const plan={factor:4,input_size:[900,1200],output_size:[1800,2400],budget:{images:3,reviews:1,max_calls:10},stages:[{index:1,input_size:[900,1200],output_size:[1800,2400],columns:1,rows:3,tile_count:3,status:'failed',cuts:{x:[],y:[400,800]},budget:{images:3,reviews:1,max_calls:10},diagnostic_available:true}]};
 if(bigFailure)plan.stages[0].tile_count=5000;
 const up=makeJob('up',{batch_id:'upbatch',status:'failed',options:{stitch:4,source_asset_id:'asset',upscale_requirements:'ORIGINAL-REQUIREMENT',upscale_injection:'ORIGINAL-REQUIREMENT',upscale_prompts:{policy:{append_system:false,include_source_context:true},revision:'old-revision'}},source_image:asset,upscale_plan:plan,error:'图块验收失败'});
 const chainParent=makeJob('parent',{batch_id:'chain',status:'succeeded',outputs:[asset],options:{ratio:'1:1',size:'auto',stitch:0,after_upscale:4}});
 const chainChild={...up,id:'child',batch_id:'chain',status:chainStatus,options:{...up.options,parent_job_id:'parent'}};
 const batches=chained?[{id:'chain',created:1000,jobs:[chainParent,chainChild]}]:[{id:'batch',created:1000,jobs:dataJobs},{id:'upbatch',created:999,jobs:[up]}];
 const prefs={defaults:{ratio:'3:2',size:'auto',count:3,transparent:false,polish:false,stitch:0},quick:{keep_spec:true,use_ref:true,use_source_template:true,effort:'high',notify:true},upscale:{factor:4,auto_select:true,default_injection:defaultInjection},motion:legacyMotion,motion_mode:motion,notify:false,call_prompt:prompt,polish_prompt:prompt,stitch_prompt:prompt,default_call_prompt:prompt,default_polish_prompt:prompt,default_stitch_prompt:prompt};
 const keys=['image_call','tile','requirements','source_context','repair','retry','review'];
 prefs.upscale_system_prompts=Object.fromEntries(keys.map(k=>[k,`CUSTOM-${k} {prompt}`]));
 prefs.default_upscale_system_prompts={...prefs.upscale_system_prompts};
 prefs.upscale_prompt_labels=Object.fromEntries(keys.map(k=>[k,`LABEL-${k}`]));
 prefs.upscale_prompt_variables=Object.fromEntries(keys.map(k=>[k,['prompt']]));
 const state={model:'gpt-test',effort:'high',concurrency:2,max_attempts:3,paused:true,preferences:prefs};
 const storage={bytes:1024,limit_bytes:0,free_bytes:1e9,groups:{database:512},tasks:[],trash:{assets:0,collections:0}};
 const fetch=async(path,opt={})=>{requests.push({path,method:opt.method||'GET',body:typeof opt.body==='string'?JSON.parse(opt.body):opt.body,headers:opt.headers,signal:opt.signal});let d;
  if(path==='/api/auth/state')d={initialized:true,authenticated:!unauth,csrf:'csrf-fixture',cache_scope:'fixture'};
  else if(path==='/api/state'){if(failSync&&stateReads++>0)return {ok:false,status:503,json:async()=>({detail:'poll unavailable'})};d=state;}
  else if(path==='/api/settings'){if(opt.method&&settingsGate)await settingsGate;if(opt.method&&settingsFail)return {ok:false,status:400,json:async()=>({detail:'保存失败：变量不合法'})};d=opt.method?{ok:true}:prefs;}
  else if(path==='/api/account/avatar'){if(opt.method&&avatarGate)await avatarGate;d={avatar_url:opt.method==='DELETE'?'':'/api/account/avatar?v=new'};}
  else if(path==='/api/account'){if(opt.method==='PATCH'&&accountGate)await accountGate;if(opt.method==='PATCH'&&accountFail)return {ok:false,status:400,json:async()=>({detail:'ACCOUNT FAILED'})};d={username:'tester',session_count:1,avatar_url:avatarURL};}
  else if(path==='/api/auth/password'){if(accountGate)await accountGate;if(passwordFail)return {ok:false,status:400,json:async()=>({detail:'PASSWORD FAILED'})};d={ok:true};}
  else if(path==='/api/auth/login'){if(loginGate)await loginGate;if(loginFail)return {ok:false,status:400,json:async()=>({detail:'LOGIN FAILED'})};d={ok:true,csrf:'csrf-fixture'};}
  else if(path.endsWith('/restore')){if(restoreGate)await restoreGate;if(restoreFail)return {ok:false,status:400,json:async()=>({detail:'RESTORE FAILED'})};d={ok:true};}
  else if(path==='/api/setup/status'){statusReads++;if(staleStatusGate&&statusReads>=3){await staleStatusGate;d={authenticated:false,version:'old-status',login:{running:false,output:'STALE-STATUS'}};}else d={authenticated:true,version:'fixture',login:{running:!!staleStatusGate}};}
  else if(path==='/api/setup/login'){if(connectGate)await connectGate;d={running:false,output:'NEW-AUTH-STATE'};}
  else if(path==='/api/assets'&&opt.method==='POST'){if(uploadGate)await uploadGate;d={asset};}
  else if(path==='/api/assets/asset'&&opt.method){if(assetGate)await assetGate;const body=typeof opt.body==='string'?JSON.parse(opt.body):opt.body;if(body?.name==='FIRST-NAME'&&renameGate)await renameGate;if(body?.name==='SAVE-FAILED'&&renameFail)return {ok:false,status:400,json:async()=>({detail:'NAME FAILED'})};d={...asset,...body};}
  else if(path==='/api/models')d={items:[{id:'gpt-test',name:'Fixture model',efforts:['low','high'],default_effort:'low'}]};
  else if(path.startsWith('/api/collections'))d={items:[{id:'untemplated',name:'无模板',image_count:1,active:19,covers:[asset]}],total:1};
  else if(path==='/api/templates')d=[{id:'template',title:'模板',text:'可复用提示词',refs:['asset'],references:[asset],options:{ratio:'9:16',size:'2048',transparent:true,polish:true,stitch:16,model:'gpt-test',effort:'low'}}];
  else if(path.startsWith('/api/assets?')&&path.includes('deleted=true')&&trashPaged){const query=new URL(path,'http://fixture').searchParams,offset=Number(query.get('offset')||0);if(offset&&trashPageGate)await trashPageGate;const all=Array.from({length:101},(_,i)=>({...asset,id:'trash-'+i,name:'trash-'+i}));d={items:all.slice(offset,offset+100),total:101};}
  else if(path.startsWith('/api/assets?')){const query=new URL(path,'http://fixture').searchParams;let items=gallery?[asset,{...asset,id:'neighbor',name:'相邻作品.png',job_id:null},{...asset,id:'reference',kind:'reference',name:'参考图.png',job_id:null},{...asset,id:'old-favorite',name:'旧收藏.png',job_id:null,favorite:1}]:[asset];if(paginated)items.push(...Array.from({length:80},(_,i)=>({...asset,id:'reference-'+i,kind:'reference',job_id:null})));if(query.get('kind')==='reference')items=items.filter(a=>a.kind==='reference');if(query.get('kind')==='generated')items=items.filter(a=>a.kind==='generated');if(query.get('favorite')==='true')items=items.filter(a=>a.favorite);else items=items.filter(a=>a.id!=='old-favorite');const total=items.length,offset=Number(query.get('offset')||0),limit=Number(query.get('limit')||100);d={items:items.slice(offset,offset+limit),total};}
  else if(path.startsWith('/api/batches'))d={items:batches,total:2};
  else if(path==='/api/upscale/jobs/up')d=up;
  else if(path==='/api/upscale/jobs/child')d=chainChild;
  else if(path==='/api/jobs/job')d=dataJobs[0];
  else if(path==='/api/jobs/job/log')d={text:'ACTUAL LOG LINE'};
  else if(path==='/api/upscale/jobs/up/prompt-snapshot')d={available:true,snapshot:{revision:'abcdef123456',templates:{tile:'SAVED TEMPLATE'}}};
  else if(path==='/api/upscale/jobs/up/calls')d={total:1,items:[{id:'savedcall',kind:'redraw',scope:{level:1,tile:0}}]};
  else if(path==='/api/upscale/jobs/up/calls/savedcall')d={worker_instruction:'ACTUAL SENT EXACTLY',prompt_metadata:{components:[{enabled:false,label:'disabled template',text:'disabled'}],snapshot_revision:'abcdef123456',scope:{level:1,tile:0}}};
  else if(path==='/api/assets/asset/upscale-prompt-preview'){if(previewGate)await previewGate;d={snapshot_revision:'abc123',worker_instruction:'COMPILED SERVER PREVIEW',scope:{level:1,tile:0},components:[{enabled:false,label:'tile',text:'NOT INCLUDED'}],review:{worker_instruction:'REVIEW SERVER PREVIEW'}};}
  else if(path==='/api/assets/asset/upscale')d={batch_id:'upbatch',ids:['queued-upscale']};
  else if(path.includes('/upscale-plan'))d=plan;
  else if(path.includes('/diagnostics?'))d={input_size:[900,1200],images:{source:'/source.webp',raw:'/raw.webp',affine:'/affine.webp'},tiles:[{index:4,core:[0,0,900,400],state:'ready',reason:'几何正常'},{index:7,core:[0,400,900,800],state:'coverage',reason:'配准后缺失'},{index:8,core:[0,800,900,1200],state:'missing',reason:'尚未返回'}]};
  else if(path.includes('/comparison?'))d={input_size:[600,400],output_size:[1024,768],images:{input:'/input.webp',output:'/output.webp'}};
  else if(path.endsWith('/redraw'))d={ok:true};
  else if(path.endsWith('/quick-edit')){if(quickGate)await quickGate;if(failQuick)return {ok:false,status:503,json:async()=>({detail:'模拟临时失败'})};d={batch_id:'batch',ids:['queued-job']};}
  else if(path==='/api/jobs'&&opt.method)d={batch_id:'batch',ids:['queued-job']};
  else if(path==='/api/storage')d=storage;
  else if(path.includes('/assets/asset/info')){if(delayInfo)await delayInfo;d={asset:asset,job:rerollUpscale?up:dataJobs[0]};}
  else if(path.startsWith('/api/jobs?'))d={items:dataJobs,total:20};
  else d={ok:true};
  if(bigFailure&&path.includes('/diagnostics?'))d.tiles=Array.from({length:5000},(_,i)=>({index:i,core:[(i%100)*9,Math.floor(i/100)*24,(i%100+1)*9,(Math.floor(i/100)+1)*24],state:i===0?'coverage':'ready',reason:'fixture'}));
  return {ok:true,status:200,json:async()=>structuredClone(d)};
 };
 const eventListeners={};const addEventListener=(name,fn)=>{(eventListeners[name]??=[]).push(fn);};
 const history={state:{depth:0},pushState(value){this.state=value;},replaceState(value){this.state=value;},back(){this.go(-1);},go(delta){this.state={depth:Math.max(0,this.state.depth+delta)};queueMicrotask(()=>eventListeners.popstate?.forEach(fn=>fn({state:this.state})));}};
 Object.defineProperties(window.HTMLElement.prototype,{offsetWidth:{configurable:true,get(){return parseFloat(this.style.width)||390;}},offsetHeight:{configurable:true,get(){return parseFloat(this.style.height)||844;}},offsetLeft:{configurable:true,get(){return 0;}}});
 window.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,left:0,top:0,right:390,bottom:844,width:390,height:844};};
 window.HTMLElement.prototype.getAnimations=function(){return [];};window.HTMLElement.prototype.animate=function(){return {finished:Promise.resolve({cancel(){}}),cancel(){}};};window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.scrollTo=function(){};
 window.HTMLElement.prototype.setPointerCapture=function(){};window.HTMLElement.prototype.blur=function(){};
 const mediaListeners=[],media={matches:systemReduce,addEventListener:(type,listener)=>{if(type==='change')mediaListeners.push(listener);}};
 const context=vm.createContext({document,window,console,Headers,FormData,AbortController,fetch,history,location:{href:'http://fixture/'},navigator:{clipboard:{writeText:async()=>{}},vibrate(){}},localStorage:{getItem:key=>stored[key]??(key==='studio_draft'&&legacyDraft?JSON.stringify(legacyDraft):null),setItem(key,value){stored[key]=value;}},matchMedia:query=>query.includes('color-scheme')?{matches:systemDark,addEventListener(){}}:media,performance,addEventListener,requestAnimationFrame:fn=>setImmediate(()=>fn(performance.now())),cancelAnimationFrame:clearImmediate,setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),MutationObserver:window.MutationObserver,getComputedStyle:()=>({opacity:'1',getPropertyValue:()=> '0px'}),StudioImages:{status:async()=>({bytes:0,count:0}),clear:async()=>{}},Image:function(){const image=document.createElement("img");Object.defineProperty(image,"src",{get(){return image.getAttribute("src")||"";},set(value){image.setAttribute("src",value);queueMicrotask(()=>image.onload?.());}});Object.defineProperty(image,"naturalWidth",{value:512});Object.defineProperty(image,"naturalHeight",{value:512});image.decode=()=>Promise.resolve();return image;},devicePixelRatio:1,visualViewport:null});
 for(const file of ['studio-theme.js','studio-layout.js','studio-feedback.js','studio-progress.js','studio-ui.js','studio-failure-map.js','studio-chrome.js','studio-zoom.js','studio-native-download.js','studio-download.js','studio-references.js','studio-picker.js','studio-avatar.js','studio-selection.js','studio-tasks.js','studio-upscale-prompts.js','studio-recovery.js','studio-service.js'])vm.runInContext(fs.readFileSync('static/'+file,'utf8'),context,{filename:file});
 await vm.runInContext('studioReady',context);
 return {context,document,requests,stored,setSystemReduce(value){media.matches=value;mediaListeners.forEach(fn=>fn({matches:value}));},flushTimers(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}},run:code=>vm.runInContext(code,context),service:vm.runInContext('StudioService',context),prefs,plan};
}


const tick=()=>new Promise(resolve=>setImmediate(resolve));
function makeProgressTask({count=3,failStage='generating',status='failed'}={}){
  const tiles=Array.from({length:count},(_,i)=>({index:i+1,state:i===0?'done':i===1?'failed':'queued',stage:i===0?'receiving':i===1?failStage:'queued',checkpoint:i===0}));
  return {id:'progress-fixture',status,raw:{progress:{stage:'redraw',level:1,children:tiles,timeline:[{index:1,status:'failed',phase:'redraw',fraction:.4,tiles,phases:{base:{status:'succeeded'},cutting:{status:'failed'}}}]}},
    up:{cur:0,levels:[{tiles,raw:{index:1,status:'failed',tile_count:count}}]}};
}
async function progressFixture(task){
  const f=await fixture();f.context.taskFixture=task;
  f.run("document.querySelector('#app').insertAdjacentHTML('beforeend',StudioProgress.html(taskFixture,{all:true,key:'test'}))");
  const scroll=f.document.querySelector('.progress-board-scroll');
  Object.defineProperty(scroll,'clientWidth',{value:360,configurable:true});
  f.run("StudioProgress.hydrate(document.querySelector('#app'))");
  return {...f,scroll,board:f.document.querySelector('[data-progress-board]')};
}
test('multi-thousand-tile progress bounds visible columns and virtualizes on horizontal scroll',async()=>{
  const f=await progressFixture(makeProgressTask({count:5000}));
  let columns=f.board.querySelectorAll('.progress-column');
  assert.ok(columns.length>0&&columns.length<30,`visible columns: ${columns.length}`);
  assert.equal(f.board.querySelectorAll('[data-tile="0"] [data-state="done"]').length,4);
  assert.equal(f.board.querySelectorAll('[data-tile="1"] [data-state="failed"]').length,1);
  assert.equal(f.board.querySelectorAll('[data-phase="cutting"] [data-state="failed"]').length,1);
  f.scroll.dispatchEvent(new f.context.window.Event('pointerdown',{bubbles:true}));
  f.scroll.scrollLeft=36*4000;f.scroll.dispatchEvent(new f.context.window.Event('scroll'));
  columns=f.board.querySelectorAll('.progress-column');
  assert.ok(columns.length<30);assert.ok(f.board.querySelector('[data-tile="4000"]'));
});
test('failed tile before an observed model stage still has a red failure segment',async()=>{
  const f=await progressFixture(makeProgressTask({failStage:'queued'}));
  assert.equal(f.board.querySelectorAll('[data-tile="1"] [data-state="failed"]').length,1);
  assert.equal(f.board.querySelectorAll('[data-tile="0"] [data-state="done"]').length,4);
});
test('successful upscale hides both short and expanded progress bars',async()=>{
  const f=await fixture();f.context.taskFixture=makeProgressTask({status:'done'});
  assert.equal(f.run('StudioProgress.short(taskFixture)'), '');
  const html=f.run('StudioProgress.html(taskFixture,{all:true})');
  assert.match(html,/已完成/);assert.doesNotMatch(html,/progress-board|work-cell|progressbar/);
});

test('task log is loaded inside the existing task detail and does not open another screen',async()=>{
  const f=await fixture();
  const button=f.document.createElement('button');button.dataset.act='task-info';button.dataset.id='job';f.document.body.append(button);
  await f.service.action('task-info',button);await tick();
  const workspace=f.document.querySelector('.task-details-workspace');assert.ok(workspace);
  const log=workspace.querySelector('[data-task-log]');assert.ok(log);
  const screenCount=f.document.querySelectorAll('.screen-layer').length;
  log.open=true;log.dispatchEvent(new f.context.window.Event('toggle'));await tick();await tick();
  assert.equal(workspace.querySelector('[data-log-content]').textContent,'ACTUAL LOG LINE');
  assert.equal(f.document.querySelectorAll('.screen-layer').length,screenCount);
  assert.equal(f.requests.filter(r=>r.path==='/api/jobs/job/log').length,1);
});
test('all seven editable system templates appear and a rejected save preserves the draft',async()=>{
  const f=await fixture({settingsFail:true});
  f.run("document.querySelector('#app').insertAdjacentHTML('beforeend',StudioUpscalePrompts.settingsHTML())");
  const rows=f.document.querySelectorAll('[data-upp-edit]');assert.equal(rows.length,7);
  f.document.querySelector('[data-upp-edit="tile"]').click();
  const editor=f.document.querySelector('.system-prompt-screen');assert.ok(editor);
  const ta=editor.querySelector('textarea');ta.value='User draft remains {target_size}';editor.querySelector('[data-upp-save]').click();
  await tick();await tick();
  assert.equal(ta.value,'User draft remains {target_size}');
  assert.match(editor.querySelector('.form-err').textContent,/保存失败/);
  assert.equal(f.requests.filter(r=>r.path==='/api/settings'&&r.method==='PATCH').length,1);
});
test('composer entry sends its selected policy and task requirements',async()=>{
  const f=await fixture();
  f.run("S.composer.upscaleRequirements='COMPOSER-REQUIREMENT';S.composer.prompt='a fixture';S.composer.stitch='4×';S.composer.upscalePolicy={append_system:false,include_source_context:true};document.querySelector('#gen').disabled=false");
  await f.service.generate();
  const req=f.requests.find(r=>r.path==='/api/jobs'&&r.method==='POST');assert.ok(req);
  assert.equal(req.body.upscale_requirements,'COMPOSER-REQUIREMENT');
  assert.deepEqual(req.body.upscale_policy,{append_system:false,include_source_context:true});
  assert.equal(req.body.after_upscale,4);
});
test('asset sheet entry sends its own selected policy and typed requirements',async()=>{
  const f=await fixture();f.service.upscaleSheet('asset');await tick();await tick();
  const sheet=f.document.querySelector('.up-entry-sheet');assert.ok(sheet);
  const toggle=sheet.querySelector('[data-upp-policy="include_source_context"]');assert.ok(toggle);toggle.click();
  sheet.querySelector('#up-inj').value='SHEET-REQUIREMENT';
  const button=sheet.querySelector('[data-act="up-go"]');button.disabled=false;
  await f.service.action('up-go',button);await tick();
  const req=f.requests.find(r=>r.path==='/api/assets/asset/upscale'&&r.method==='POST');assert.ok(req);
  assert.equal(req.body.upscale_requirements,'SHEET-REQUIREMENT');
  assert.deepEqual(req.body.upscale_policy,{append_system:true,include_source_context:true});
});

test('standalone upscale entry sends its own policy and task requirements',async()=>{
  const f=await fixture();
  f.run("S.mode='up';S.upc.src='asset';S.upc.factor='4×';S.upc.policy={append_system:false,include_source_context:true};renderPage()");
  await tick();await tick();
  const input=f.document.querySelector('#cu-inj'),button=f.document.querySelector('[data-act="up-start"]');assert.ok(input&&button);
  input.value='STANDALONE-REQUIREMENT';button.disabled=false;
  await f.service.action('up-start',button);await tick();
  const req=f.requests.find(r=>r.path==='/api/assets/asset/upscale'&&r.method==='POST');assert.ok(req);
  assert.equal(req.body.upscale_requirements,'STANDALONE-REQUIREMENT');
  assert.deepEqual(req.body.upscale_policy,{append_system:false,include_source_context:true});
});
test('preview and actual-call screens display server text and disclosed disabled components',async()=>{
  const f=await fixture();f.service.upscaleSheet('asset');await tick();await tick();
  const sheet=f.document.querySelector('.up-entry-sheet');sheet.querySelector('#up-inj').value='PREVIEW-REQUIREMENT';sheet.querySelector('#up-inj').dispatchEvent(new f.context.window.Event('input',{bubbles:true}));
  sheet.querySelector('[data-upp-preview]').click();await tick();await tick();
  const preview=f.document.querySelector('.prompt-preview-screen');assert.ok(preview);
  assert.match(preview.textContent,/COMPILED SERVER PREVIEW/);assert.match(preview.textContent,/REVIEW SERVER PREVIEW/);
  assert.match(preview.textContent,/未拼接/);
  const req=f.requests.find(r=>r.path==='/api/assets/asset/upscale-prompt-preview');assert.equal(req.body.upscale_requirements,'PREVIEW-REQUIREMENT');
  const holder=f.document.createElement('section');f.document.querySelector('#app').append(holder);
  await f.run("StudioUpscalePrompts.mountTask(globalThis.testHolder,{id:'up'},StudioService.api)", f.context.testHolder=holder);
  assert.match(holder.textContent,/SAVED TEMPLATE/);assert.match(holder.textContent,/实际调用记录/);
  holder.querySelector('[data-prompt-call]').click();await tick();await tick();
  const screens=f.document.querySelectorAll('.prompt-preview-screen');const actual=screens[screens.length-1];
  assert.match(actual.textContent,/ACTUAL SENT EXACTLY/);assert.match(actual.textContent,/未拼接/);
});


test('failure workspace keeps DOM bounded for thousands of tiles',async()=>{
  const f=await fixture({bigFailure:true});
  await f.service.openFailure('up');await tick();await tick();
  const screen=f.document.querySelector('.fail-screen');assert.ok(screen);
  const count=screen.querySelectorAll('*').length;
  assert.ok(count<500,`failure workspace rendered ${count} nodes for 5000 tiles`);
});


test('large failure list can page, select across pages and submit both tiles',async()=>{
  const f=await fixture({bigFailure:true});await f.service.openFailure('up');await tick();await tick();
  const screen=f.document.querySelector('.fail-screen');assert.ok(screen);
  screen.querySelector('[data-act="fx-sel"][data-v="none"]').click();await tick();
  screen.querySelector('[data-act="fx-showok"]').click();await tick();
  let first=screen.querySelector('[data-act="fx-tile"][data-i="1"]');assert.ok(first);first.click();
  const next=screen.querySelector('[data-act="fx-page"][data-d="1"]');assert.ok(next);next.click();await tick();
  const later=screen.querySelector('[data-act="fx-tile"][data-i="40"]');assert.ok(later,'next page exposes later tile');later.click();await tick();
  screen.querySelector('#fx-inj').value='PAGED-REPAIR';
  await f.service.fxSubmit();
  const req=f.requests.find(r=>r.path==='/api/upscale/jobs/up/redraw');assert.ok(req);
  assert.deepEqual(req.body.tiles,[1,40]);assert.equal(req.body.repair_request,'PAGED-REPAIR');
});




test('failure canvas supports pointer and keyboard selection without per-tile elements',async()=>{
  const f=await fixture({bigFailure:true});await f.service.openFailure('up');await tick();await tick();
  const screen=f.document.querySelector('.fail-screen');screen.querySelector('[data-act="fx-sel"][data-v="none"]').click();await tick();
  const canvas=screen.querySelector('[data-failure-map]');assert.ok(canvas);
  Object.defineProperties(canvas,{clientWidth:{value:390},clientHeight:{value:844}});
  const ctx={setTransform(){},clearRect(){},fillRect(){},strokeRect(){},setLineDash(){},measureText(){return {width:8}},fillText(){}};
  canvas.getContext=()=>ctx;f.run('StudioFailureMap.hydrate(document.querySelector(".fail-screen"))');
  function pointer(type){const e=new f.context.window.Event(type,{bubbles:true});Object.assign(e,{clientX:1,clientY:163});canvas.dispatchEvent(e);}
  pointer('pointerdown');pointer('pointerup');assert.equal(f.run('FX.sel.has(0)'),true);
  const right=new f.context.window.Event('keydown',{bubbles:true,cancelable:true});right.key='ArrowRight';canvas.dispatchEvent(right);
  const select=new f.context.window.Event('keydown',{bubbles:true,cancelable:true});select.key='Enter';canvas.dispatchEvent(select);
  assert.equal(f.run('FX.sel.has(1)'),true);
  assert.ok(screen.querySelectorAll('*').length<500);
});

test('progress updates retain manual horizontal position and visible keyed tile node',async()=>{
  const task=makeProgressTask({count:5000,status:'running'}),f=await progressFixture(task);
  f.scroll.dispatchEvent(new f.context.window.Event('wheel',{bubbles:true}));
  f.scroll.scrollLeft=36*200;f.scroll.dispatchEvent(new f.context.window.Event('scroll'));
  const tile=f.board.querySelector('[data-tile="200"]');assert.ok(tile);
  const host=f.document.createElement('div');f.document.querySelector('#app').append(host);host.append(f.board);f.context.progressHost=host;
  host.dataset.h=f.run("StudioProgress.html(taskFixture,{all:true,key:'test'})");
  const before=f.scroll.scrollLeft;
  task.raw.progress.timeline[0].tiles[200]={index:201,state:'failed',stage:'generating'};
  f.run("setHTML(progressHost,StudioProgress.html(taskFixture,{all:true,key:'test'}));StudioProgress.hydrate(progressHost)");
  const board=f.document.querySelector('[data-progress-board]'),scroll=board.querySelector('.progress-board-scroll');
  assert.equal(scroll.scrollLeft,before);
  assert.ok(board.querySelector('[data-tile="200"]')===tile,'existing visible tile node is preserved');
  assert.equal(tile.querySelectorAll('[data-state="failed"]').length,1);
});
test('copy upscale keeps source, requirements and policy, and submits a fresh task',async()=>{
  const f=await fixture();await f.service.cloneUpscale('up');await tick();await tick();
  assert.equal(f.run('S.upc.src'),'asset');assert.equal(f.run('S.upc.inj'),'ORIGINAL-REQUIREMENT');
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(S.upc.policy)')),{append_system:false,include_source_context:true});
  const button=f.document.querySelector('[data-act="up-start"]');assert.ok(button);button.disabled=false;
  await f.service.action('up-start',button);await tick();
  const req=f.requests.find(r=>r.path==='/api/assets/asset/upscale'&&r.method==='POST');assert.ok(req);
  assert.equal(req.body.upscale_requirements,'ORIGINAL-REQUIREMENT');
  assert.deepEqual(req.body.upscale_policy,{append_system:false,include_source_context:true});
  assert.equal(req.body.expected_prompt_revision,undefined);assert.equal(req.body.upscale_prompts,undefined);
  assert.equal(req.body.repair_scopes,undefined);assert.equal(req.body.parent_job_id,undefined);
});
test('repair template switch changes only local repair request policy',async()=>{
  const f=await fixture();await f.service.openFailure('up');await tick();await tick();
  const screen=f.document.querySelector('.fail-screen');assert.ok(screen);
  screen.querySelector('[data-act="fx-repair-system"]').click();await tick();
  screen.querySelector('#fx-inj').value='REPAIR-SCOPED-ONLY';await f.service.fxSubmit();
  const req=f.requests.find(r=>r.path==='/api/upscale/jobs/up/redraw');assert.ok(req);
  assert.equal(req.body.repair_request,'REPAIR-SCOPED-ONLY');assert.equal(req.body.append_system,false);
  assert.equal(req.body.upscale_requirements,undefined);assert.equal(req.body.upscale_policy,undefined);
});
test('failure tile jump finds a normal tile on a later page',async()=>{
  const f=await fixture({bigFailure:true});await f.service.openFailure('up');await tick();await tick();
  const screen=f.document.querySelector('.fail-screen');screen.querySelector('[data-act="fx-showok"]').click();await tick();
  const jump=screen.querySelector('[data-fx-jump]');assert.ok(jump);jump.value='4001';jump.dispatchEvent(new f.context.window.Event('change',{bubbles:true}));await tick();
  assert.ok(screen.querySelector('[data-act="fx-tile"][data-i="4000"]'));
  assert.ok(screen.querySelectorAll('*').length<500);
});

test('generated parent and failed upscale remain one chained batch and retry only failed child',async()=>{
  const f=await fixture({chained:true});
  f.run("S.filter='failed';S.expanded.add('chain')");await f.run("go('queue')");await tick();
  const batch=f.document.querySelector('.chained-batch[data-id="chain"]');assert.ok(batch);
  assert.match(batch.textContent,/1 张原图/);assert.match(batch.textContent,/1\/1 张原图完成/);assert.match(batch.textContent,/超分失败/);
  assert.ok(batch.querySelector('.bbar [data-st="done"]'),'parent completion is preserved');
  assert.ok(batch.querySelector('.bbar [data-st="failed"]'),'child failure is shown');
  assert.ok(batch.querySelector('[data-progress-board]'),'expanded child shares the progress renderer');
  const retry=batch.querySelector('[data-act="retry-batch"]');assert.ok(retry);
  await f.service.action('retry-batch',retry);
  const calls=f.requests.filter(r=>r.method==='POST'&&/\/retry$/.test(r.path));
  assert.deepEqual(calls.map(r=>r.path),['/api/jobs/child/retry']);
});

test('chained batch keeps completed original visible while its upscale runs',async()=>{
  const f=await fixture({chained:true,chainStatus:'running'});
  f.run("S.filter='active';S.expanded.add('chain')");await f.run("go('queue')");await tick();
  const batch=f.document.querySelector('.chained-batch[data-id="chain"]');assert.ok(batch);
  assert.match(batch.textContent,/1\/1 张原图完成/);assert.match(batch.textContent,/1 项超分进行中/);
  assert.ok(batch.querySelector('.bbar [data-st="done"]'));
  assert.ok(batch.querySelector('.bbar [data-st="running"]'));
  assert.ok(!batch.querySelector('[data-act="retry-batch"]'));
});

test('call_wait shows waiting label and queued segment instead of generating',async()=>{
  const f=await fixture();
  f.context.waitBatch={id:'wait',prompt:'waiting',created:1000,coll:'untemplated',ratio:'1:1',kind:'image',tasks:[{id:'wait-job',status:'running',stage:0,waitingForSlot:true,raw:{progress:{stage:'call_wait',label:'等待并发名额'},options:{}}}]};
  const html=f.run('batchHTML(waitBatch)');
  const box=f.document.createElement('div');box.innerHTML=html;
  assert.match(box.textContent,/等待并发名额/);
  assert.doesNotMatch(box.querySelector('.b-sum').textContent,/生成中/);
  assert.ok(box.querySelector('.bbar [data-st="queued"]'));
});

test('collection navigation and logout clear active batch-selection state',async()=>{
  const f=await fixture({gallery:true});await f.run("go('works')");
  f.run("StudioSelection.begin('asset')");assert.equal(f.run('StudioSelection.active()'),true);
  await f.run("openColl('untemplated')");await tick();
  assert.equal(f.run('StudioSelection.active()'),false);assert.equal(f.run('S.coll'),'untemplated');
  f.run("StudioSelection.begin('asset')");assert.equal(f.run('StudioSelection.active()'),true);
  const button=f.document.createElement('button');button.dataset.act='logout';f.document.body.append(button);
  await f.service.action('logout',button);await tick();
  assert.equal(f.run('StudioSelection.active()'),false);
  assert.equal(f.document.querySelector('#selection-toolbar'),null);
});

test('loading a template does not silently replace the draft upscale policy',async()=>{
  const f=await fixture();
  f.run("S.composer.prompt='UNSAVED DRAFT';S.composer.upscalePolicy={append_system:false,include_source_context:true}");
  await f.service.loadTemplate('template');
  assert.equal(f.run('S.composer.prompt'),'UNSAVED DRAFT');
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(S.composer.upscalePolicy)')),{append_system:false,include_source_context:true});
});
test('changing a default does not silently replace the existing generation draft requirement',async()=>{
  const f=await fixture({defaultInjection:'OLD-DRAFT-REQUIREMENT'});
  f.run("S.composer.prompt='UNSAVED DRAFT';S.composer.stitch='4×'");
  // The settings screen changes a default after the draft was already established.
  f.run("S.settings.upscale.injection='NEW-DEFAULT';document.querySelector('#gen').disabled=false");
  await f.service.generate();
  const req=f.requests.find(r=>r.path==='/api/jobs'&&r.method==='POST');assert.ok(req);
  assert.equal(req.body.upscale_requirements,'OLD-DRAFT-REQUIREMENT');
});

test('reroll an upscale result uses its own saved policy instead of a different draft',async()=>{
  const f=await fixture({rerollUpscale:true});
  f.run("S.upc.policy={append_system:true,include_source_context:false}");
  await f.service.reroll('asset');
  const req=f.requests.find(r=>r.path==='/api/assets/asset/upscale'&&r.method==='POST');assert.ok(req);
  assert.equal(req.body.upscale_requirements,'ORIGINAL-REQUIREMENT');
  assert.deepEqual(req.body.upscale_policy,{append_system:false,include_source_context:true});
});



test('composer requirement edits persist as draft and explicit reset adopts only current upscale defaults',async()=>{
  const f=await fixture({defaultInjection:'DEFAULT-ONE'});
  f.run("S.composer.prompt='KEEP ORIGINAL DRAFT';S.composer.stitch='4×';paramsSheet()");
  const holder=f.document.querySelector('.sheet-layer [data-prompt-scope="composer"]');assert.ok(holder);
  const input=holder.querySelector('[data-upp-requirements]');input.value='SAVED-DRAFT-REQUIREMENT';input.dispatchEvent(new f.context.window.Event('input',{bubbles:true}));
  holder.querySelector('[data-upp-policy="append_system"]').click();await tick();f.flushTimers(250);
  const saved=JSON.parse(f.stored['studio-demo-composer:fixture']);
  assert.equal(saved.composer.upscaleRequirements,'SAVED-DRAFT-REQUIREMENT');assert.equal(saved.composer.upscalePolicy.append_system,false);
  const restored=await fixture({defaultInjection:'DEFAULT-TWO',savedDraft:saved});
  assert.equal(restored.run('S.composer.prompt'),'KEEP ORIGINAL DRAFT');
  assert.equal(restored.run('S.composer.upscaleRequirements'),'SAVED-DRAFT-REQUIREMENT');
  assert.equal(restored.run('S.composer.upscalePolicy.append_system'),false);
  restored.run('paramsSheet()');const current=restored.document.querySelector('.sheet-layer [data-prompt-scope="composer"]');
  assert.match(current.textContent,/本次草稿选项/);current.querySelector('[data-upp-defaults]').click();await tick();
  assert.equal(restored.run('S.composer.upscaleRequirements'),'DEFAULT-TWO');
  assert.equal(restored.run('S.composer.upscalePolicy.append_system'),true);
  assert.equal(restored.run('S.composer.prompt'),'KEEP ORIGINAL DRAFT');
});
test('late preview is discarded when requirements change while request is in flight',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({previewGate:gate});
  f.service.upscaleSheet('asset');await tick();await tick();
  const sheet=f.document.querySelector('.up-entry-sheet'),input=sheet.querySelector('#up-inj');
  input.value='BEFORE';input.dispatchEvent(new f.context.window.Event('input',{bubbles:true}));
  sheet.querySelector('[data-upp-preview]').click();await tick();
  input.value='AFTER';input.dispatchEvent(new f.context.window.Event('input',{bubbles:true}));release();await tick();await tick();
  assert.equal(f.document.querySelector('.prompt-preview-screen'),null);
  const scope=sheet.dataset.promptScope;f.context.testScope=scope;
  assert.equal(f.run('StudioUpscalePrompts.entryValue(testScope).expected_prompt_revision'),undefined);
  const button=sheet.querySelector('[data-act="up-go"]');button.disabled=false;await f.service.action('up-go',button);
  const submitted=f.requests.find(r=>r.path==='/api/assets/asset/upscale'&&r.method==='POST');
  assert.equal(submitted.body.upscale_requirements,'AFTER');assert.equal(submitted.body.expected_prompt_revision,undefined);
});
test('saved standalone upscale draft keeps its source, requirements and policy after reload',async()=>{
  const draft={mode:'up',composer:{prompt:'KEEP'},upc:{src:'asset',factor:'4×',inj:'SAVED-UP-REQUIREMENT',policy:{append_system:false,include_source_context:true}}};
  const f=await fixture({defaultInjection:'NEW-DEFAULT',savedDraft:draft});
  assert.equal(f.run('S.upc.src'),'asset');assert.equal(f.run('S.upc.inj'),'SAVED-UP-REQUIREMENT');
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(S.upc.policy)')),{append_system:false,include_source_context:true});
  assert.equal(f.document.querySelector('#cu-inj').value,'SAVED-UP-REQUIREMENT');
});

test('two visible composer entry controls stay synchronized when policy and requirements change',async()=>{
  const f=await fixture({defaultInjection:'INITIAL'});
  f.run("document.querySelector('#app').insertAdjacentHTML('beforeend','<section id=\\\"mirror-a\\\">'+StudioUpscalePrompts.entry('composer')+'</section><section id=\\\"mirror-b\\\">'+StudioUpscalePrompts.entry('composer')+'</section>')");
  let first=f.document.querySelector('#mirror-a [data-upp-requirements]');first.value='SHARED DRAFT';first.dispatchEvent(new f.context.window.Event('input',{bubbles:true}));
  assert.equal(f.document.querySelector('#mirror-b [data-upp-requirements]').value,'SHARED DRAFT');
  f.document.querySelector('#mirror-a [data-upp-policy="append_system"]').click();await tick();
  assert.equal(f.document.querySelector('#mirror-b [data-upp-policy="append_system"]').getAttribute('aria-pressed'),'false');
});

test('reroll ignores duplicate activation while reading the source task',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({delayInfo:gate});
  const button=f.document.createElement('button');f.document.body.append(button);
  const first=f.service.reroll('asset',button),second=f.service.reroll('asset',button);await tick();
  const pending=button.getAttribute('aria-busy');const infoCalls=f.requests.filter(r=>r.path==='/api/assets/asset/info').length;
  release();await Promise.all([first,second]);
  assert.equal(infoCalls,1);assert.equal(pending,'true');
  assert.equal(f.requests.filter(r=>r.path==='/api/jobs'&&r.method==='POST').length,1);
});

function fakeFormData(f){f.context.FormData=class {constructor(form){this.rows=[...form.querySelectorAll('input[name]')].map(input=>[input.name,input.value]);}[Symbol.iterator](){return this.rows[Symbol.iterator]();}};}
test('account form shows pending and ignores a repeated submit',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({accountGate:gate});fakeFormData(f);
  const opener=f.document.createElement('button');opener.dataset.act='account-edit';f.document.body.append(opener);await f.service.action('account-edit',opener);
  const form=f.document.querySelector('#account-form'),button=form.querySelector('button');assert.ok(form);
  form.dispatchEvent(new f.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  form.dispatchEvent(new f.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  const calls=f.requests.filter(r=>r.path==='/api/account'&&r.method==='PATCH').length,pending=button.getAttribute('aria-busy');
  release();await tick();await tick();
  assert.equal(calls,1);assert.equal(pending,'true');
});
test('login form shows pending and ignores a repeated submit',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({unauth:true,loginGate:gate});fakeFormData(f);
  const form=f.document.querySelector('#login-form'),button=form.querySelector('button');assert.ok(form);
  form.dispatchEvent(new f.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  form.dispatchEvent(new f.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  const calls=f.requests.filter(r=>r.path==='/api/auth/login'&&r.method==='POST').length,pending=button.getAttribute('aria-busy');
  release();await tick();await tick();
  assert.equal(calls,1);assert.equal(pending,'true');
});
test('trash restore shows pending and ignores duplicate activation',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({restoreGate:gate});
  const opener=f.document.createElement('button');opener.dataset.act='trash';f.document.body.append(opener);await f.service.action('trash',opener);
  const button=f.document.querySelector('[data-restore-img="asset"]');assert.ok(button);button.click();await tick();button.click();await tick();
  const calls=f.requests.filter(r=>r.path==='/api/assets/asset/restore').length,pending=button.getAttribute('aria-busy');
  release();await tick();await tick();
  assert.equal(calls,1);assert.equal(pending,'true');
});

test('account and login failures preserve typed fields and expose errors',async()=>{
  const account=await fixture({accountFail:true});fakeFormData(account);
  const opener=account.document.createElement('button');opener.dataset.act='account-edit';account.document.body.append(opener);await account.service.action('account-edit',opener);
  const af=account.document.querySelector('#account-form');af.querySelector('[name="username"]').value='KEEP ACCOUNT DRAFT';af.querySelector('[name="current_password"]').value='keep-password';
  af.dispatchEvent(new account.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
  assert.equal(af.querySelector('[name="username"]').value,'KEEP ACCOUNT DRAFT');assert.equal(af.querySelector('[name="current_password"]').value,'keep-password');assert.match(af.querySelector('.form-err').textContent,/ACCOUNT FAILED/);
  const login=await fixture({unauth:true,loginFail:true});fakeFormData(login);
  const lf=login.document.querySelector('#login-form');lf.querySelector('[name="username"]').value='KEEP LOGIN DRAFT';lf.querySelector('[name="password"]').value='keep-password';
  lf.dispatchEvent(new login.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
  assert.equal(lf.querySelector('[name="username"]').value,'KEEP LOGIN DRAFT');assert.equal(lf.querySelector('[name="password"]').value,'keep-password');assert.match(lf.querySelector('.form-err').textContent,/LOGIN FAILED/);
});
test('failed trash restore keeps its entry and reenables retry',async()=>{
  const f=await fixture({restoreFail:true}),opener=f.document.createElement('button');opener.dataset.act='trash';f.document.body.append(opener);await f.service.action('trash',opener);
  const button=f.document.querySelector('[data-restore-img="asset"]');button.click();await tick();await tick();
  assert.ok(button.isConnected);assert.equal(button.disabled,false);assert.match(f.document.querySelector('#toast').textContent,/RESTORE FAILED/);
});

test('late account success does not close a newer screen',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({accountGate:gate});fakeFormData(f);
  const opener=f.document.createElement('button');opener.dataset.act='account-edit';f.document.body.append(opener);await f.service.action('account-edit',opener);
  const form=f.document.querySelector('#account-form');form.dispatchEvent(new f.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  f.run("openScreen('<h1>NEWER SCREEN</h1>',{cls:'newer-screen'})");release();await tick();await tick();
  const newer=f.document.querySelector('.newer-screen');assert.ok(newer?.isConnected);assert.match(newer.textContent,/NEWER SCREEN/);
});
test('trash pagination is single flight and appends the next page once',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({trashPaged:true,trashPageGate:gate});
  const opener=f.document.createElement('button');opener.dataset.act='trash';f.document.body.append(opener);await f.service.action('trash',opener);
  const more=f.document.querySelector('[data-trash-more]');assert.ok(more);more.click();await tick();more.click();await tick();
  const pending=more.getAttribute('aria-busy'),calls=f.requests.filter(r=>r.path.includes('deleted=true')&&r.path.includes('offset=100')).length;
  release();await tick();await tick();assert.equal(calls,1);assert.equal(pending,'true');
  assert.equal(f.document.querySelectorAll('[data-restore-img]').length,101);
});
test('successful restore with failed refresh reports accepted action and retains screen',async()=>{
  const f=await fixture({failSync:true}),opener=f.document.createElement('button');opener.dataset.act='trash';f.document.body.append(opener);await f.service.action('trash',opener);
  const button=f.document.querySelector('[data-restore-img="asset"]');button.click();await tick();await tick();
  assert.equal(f.requests.filter(r=>r.path==='/api/assets/asset/restore').length,1);
  assert.ok(f.document.querySelector('.trash-screen'));assert.match(f.document.querySelector('#toast').textContent,/已恢复.*未刷新/);
});

test('subscription connection serializes competing actions and shows pending feedback',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({connectGate:gate});
  const opener=f.document.createElement('button');opener.dataset.act='reconnect-set';f.document.body.append(opener);await f.service.action('reconnect-set',opener);
  const sheet=f.document.querySelector('.sheet-layer'),first=sheet.querySelector('[data-connect="browser"]'),second=sheet.querySelector('[data-connect="device"]');
  first.click();await tick();second.click();await tick();
  const calls=f.requests.filter(r=>r.path==='/api/setup/login').length,pending=first.getAttribute('aria-busy');release();await tick();await tick();
  assert.equal(calls,1);assert.equal(pending,'true');
});
test('picker upload shows real in-flight status and prevents repeat upload',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({uploadGate:gate});
  await f.service.pickerSheet({});const picker=f.document.querySelector('.reference-picker'),file=picker.querySelector('#pk-file'),button=picker.querySelector('[data-pk="upload"]');
  Object.defineProperty(file,'files',{configurable:true,value:[new Blob(['fixture'],{type:'image/png'})]});
  file.dispatchEvent(new f.context.window.Event('change',{bubbles:true}));await tick();file.dispatchEvent(new f.context.window.Event('change',{bubbles:true}));await tick();
  const calls=f.requests.filter(r=>r.path==='/api/assets'&&r.method==='POST').length,text=picker.textContent;
  assert.equal(button.disabled,true);release();await tick();await tick();
  assert.equal(calls,1);assert.match(text,/上传中|正在上传/);
});
test('duplicate ordinary image deletion is single-flight with visible waiting state',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({assetGate:gate});
  const button=f.document.createElement('button');f.document.body.append(button);
  const a=f.service.deleteImage('asset',button),b=f.service.deleteImage('asset',button);await tick();
  const count=f.requests.filter(r=>r.path==='/api/assets/asset'&&r.method==='DELETE').length,pending=button.getAttribute('aria-busy');
  release();await Promise.all([a,b]);assert.equal(count,1);assert.equal(pending,'true');
});
test('avatar reset provides a real pending label and prevents repeat actions',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({avatarURL:'/old.png',avatarGate:gate});
  const opener=f.document.createElement('button');opener.dataset.act='avatar-edit';f.document.body.append(opener);await f.service.action('avatar-edit',opener);
  const editor=f.document.querySelector('.avatar-editor'),button=editor.querySelector('.avatar-remove'),save=editor.querySelector('.avatar-save');button.click();await tick();button.click();await tick();
  const calls=f.requests.filter(r=>r.path==='/api/account/avatar'&&r.method==='DELETE').length,text=save.textContent,disabled=button.disabled;
  release();await tick();await tick();assert.equal(calls,1);assert.equal(disabled,true);assert.match(text,/正在保存/);
});

test('overlapping image name saves keep the latest user value',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({renameGate:gate});
  const input=f.document.createElement('input');input.dataset.id='asset';input.dataset.edit='name';f.document.body.append(input);
  input.value='FIRST-NAME';const first=f.service.editImage(input);await tick();
  input.value='LATEST-NAME';const second=f.service.editImage(input);await tick();
  const beforeRelease=f.requests.filter(r=>r.path==='/api/assets/asset'&&r.method==='PATCH').map(r=>r.body.name);
  release();await Promise.all([first,second]);
  assert.deepEqual(beforeRelease,['FIRST-NAME']);
  assert.deepEqual(f.requests.filter(r=>r.path==='/api/assets/asset'&&r.method==='PATCH').map(r=>r.body.name),['FIRST-NAME','LATEST-NAME']);
  assert.equal(f.run('img("asset").name'),'LATEST-NAME');assert.equal(input.value,'LATEST-NAME');
});

test('password change displays pending and ignores repeat submission',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({accountGate:gate});fakeFormData(f);
  const opener=f.document.createElement('button');opener.dataset.act='password';f.document.body.append(opener);await f.service.action('password',opener);
  const form=f.document.querySelector('#password-form'),button=form.querySelector('button');form.dispatchEvent(new f.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();form.dispatchEvent(new f.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  const count=f.requests.filter(r=>r.path==='/api/auth/password').length,pending=button.getAttribute('aria-busy');release();await tick();await tick();
  assert.equal(count,1);assert.equal(pending,'true');
});

test('favorite action guards duplicate activation and shows pending',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({assetGate:gate});
  const button=f.document.createElement('button');button.dataset.act='im-fav';button.dataset.id='asset';f.document.body.append(button);
  const a=f.service.action('im-fav',button),b=f.service.action('im-fav',button);await tick();
  const count=f.requests.filter(r=>r.path==='/api/assets/asset'&&r.method==='PATCH').length,pending=button.getAttribute('aria-busy');
  release();await Promise.all([a,b]);assert.equal(count,1);assert.equal(pending,'true');
});

test('failed image rename preserves the typed draft for retry',async()=>{
  const f=await fixture({renameFail:true}),input=f.document.createElement('input');input.dataset.id='asset';input.dataset.edit='name';input.value='SAVE-FAILED';
  await assert.rejects(f.service.editImage(input),/NAME FAILED/);
  assert.equal(input.value,'SAVE-FAILED');
});

test('failed password change preserves typed values for retry',async()=>{
  const f=await fixture({passwordFail:true});fakeFormData(f);
  const opener=f.document.createElement('button');opener.dataset.act='password';f.document.body.append(opener);await f.service.action('password',opener);
  const form=f.document.querySelector('#password-form');form.querySelector('[name="current"]').value='old-password';form.querySelector('[name="password"]').value='new-password';
  form.dispatchEvent(new f.context.window.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
  assert.equal(form.querySelector('[name="current"]').value,'old-password');assert.equal(form.querySelector('[name="password"]').value,'new-password');assert.match(form.querySelector('.form-err').textContent,/PASSWORD FAILED/);
});

test('image name save exposes pending state until the request finishes',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({renameGate:gate});
  const input=f.document.createElement('input');input.dataset.id='asset';input.dataset.edit='name';input.value='FIRST-NAME';f.document.body.append(input);
  const request=f.service.editImage(input);await tick();const pending=input.getAttribute('aria-busy');release();await request;
  assert.equal(pending,'true');
});


test('older subscription status response cannot overwrite a newer authorization result',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({staleStatusGate:gate});
  const opener=f.document.createElement('button');opener.dataset.act='reconnect-set';f.document.body.append(opener);await f.service.action('reconnect-set',opener);
  const sheet=f.document.querySelector('.sheet-layer');f.flushTimers(1500);await tick();
  sheet.querySelector('[data-connect="browser"]').click();await tick();await tick();
  assert.match(sheet.querySelector('#login-status').textContent,/NEW-AUTH-STATE/);
  release();await tick();await tick();
  assert.match(sheet.querySelector('#login-status').textContent,/NEW-AUTH-STATE/);
});

test('closing an uploading picker aborts its request and preserves existing references',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({uploadGate:gate});
  f.run('StudioService.setComposerRefs(["asset"])');await f.service.pickerSheet({refs:['asset']});
  const picker=f.document.querySelector('.reference-picker'),file=picker.querySelector('#pk-file');Object.defineProperty(file,'files',{configurable:true,value:[new Blob(['fixture'],{type:'image/png'})]});
  file.dispatchEvent(new f.context.window.Event('change',{bubbles:true}));await tick();
  const upload=f.requests.find(r=>r.path==='/api/assets'&&r.method==='POST');assert.ok(upload?.signal);assert.equal(upload.signal.aborted,false);
  await f.run('back()');assert.equal(upload.signal.aborted,true);release();await tick();await tick();
  assert.deepEqual(Array.from(f.run('S.composer.refs')),['asset']);
});
test('upload and concurrent reference selection do not exceed eight choices',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({gallery:true,uploadGate:gate});
  const refs=Array.from({length:7},(_,i)=>'old-'+i);await f.service.pickerSheet({refs});
  const picker=f.document.querySelector('.reference-picker'),file=picker.querySelector('#pk-file');Object.defineProperty(file,'files',{configurable:true,value:[new Blob(['fixture'],{type:'image/png'})]});
  file.dispatchEvent(new f.context.window.Event('change',{bubbles:true}));await tick();
  const select=picker.querySelector('[data-pk="select"][data-id="reference"]');assert.ok(select);select.click();await tick();
  release();await tick();await tick();await tick();assert.match(picker.querySelector('#pk-count').textContent,/8 \/ 8/);
});

test('queue pause displays pending and ignores repeated activation',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({settingsGate:gate});
  const button=f.document.createElement('button');button.dataset.act='pause';f.document.body.append(button);
  const a=f.service.action('pause',button),b=f.service.action('pause',button);await tick();
  const count=f.requests.filter(r=>r.path==='/api/settings'&&r.method==='PATCH').length,pending=button.getAttribute('aria-busy');
  release();await Promise.all([a,b]);assert.equal(count,1);assert.equal(pending,'true');
});


test('advanced prompt controls start collapsed and preview requires a source',async()=>{
  const f=await fixture();f.run("S.upc.src=null;document.querySelector('#app').insertAdjacentHTML('beforeend',StudioUpscalePrompts.entry('upscale'))");
  const holder=f.document.querySelector('.prompt-composition[data-prompt-scope=upscale]');assert.ok(holder);assert.equal(holder.querySelector('.composition-advanced').hasAttribute('open'),false);assert.equal(holder.querySelector('[data-upp-preview]').hasAttribute('disabled'),true);
  assert.ok(holder.querySelector('[data-upp-policy=append_system]'));
});
