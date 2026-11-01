"use strict";
/* Real service adapter for the PR #1 interface. UI state is never a scheduler. */
const StudioService=(()=>{
  let sessionEpoch=0;
  let csrf='',authenticated=false,authState=null,config={},account={},setup={},prefs={},models=[],polling=null,loading=false,saveQueue=Promise.resolve(),draftTimer,installPrompt;
  const assets=new Map(),jobs=new Map(),batchMap=new Map(),plans=new Map(),planPending=new Map(),details=new Map(),collectionPages=new Map();
  const workPages=new Map();
  const trashRefresh=new WeakMap();
  const fieldWrites=new Map(),fieldStatus=new WeakMap();
  const workState=tab=>{if(!workPages.has(tab))workPages.set(tab,{ids:[],offset:0,total:0,ready:false,loading:false,error:false});return workPages.get(tab);};
  const workItems=tab=>workState(tab).ids.map(id=>assets.get(id)).filter(a=>a&&!a.deleted&&(tab==='favorites'?a.fav:a.kind==='reference'));
  async function loadWorks(tab,more=false){
    if(!['references','favorites'].includes(tab))return;const page=workState(tab);if(page.loading)return;const epoch=sessionEpoch,offset=more?page.offset:0;page.loading=true;page.error=false;
    if(S.tab==='works'&&!S.coll&&S.worksTab===tab)refresh();
    try{const d=await api(`/api/assets?kind=${tab==='references'?'reference':'all'}${tab==='favorites'?'&favorite=true':''}&limit=80&offset=${offset}`);if(epoch!==sessionEpoch)return;d.items.forEach(a=>rememberAsset(a));page.ids=[...new Set([...(more?page.ids:[]),...d.items.map(a=>a.id)])];page.offset=offset+d.items.length;page.total=d.total;page.ready=true;projectImages();}
    catch(error){page.error=true;throw error;}finally{page.loading=false;if(epoch===sessionEpoch&&S.tab==='works'&&!S.coll&&S.worksTab===tab&&!V.open)refresh();}
  }
  let batchOffset=0,batchTotal=0,stopped=false,firstSync=true,lastActive=new Set(),syncWaiters=[];
  const factor=v=>Number(String(v).replace('×',''))||0,ratio=v=>v==='自动'?'auto':v,size=v=>({'自动':'auto','1K':'1024','2K':'2048','4K':'4096'}[v]||v);
  const labelRatio=v=>v==='auto'?'自动':v,labelSize=v=>({auto:'自动',1024:'1K',2048:'2K',4096:'4K'}[v]||v);
  const bytes=n=>n>=1073741824?(n/1073741824).toFixed(2)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round((n||0)/1024)+' KB';
  const state=s=>({succeeded:'done',retrying:'queued'}[s]||s);
  const active=j=>['queued','running','retrying'].includes(j.status);
  function report(error){if(error?.name==='AbortError')return;console.error(error);toast(error?.message||'操作失败，请重试',{ms:6000});}
  async function api(path,options={}){
    const epoch=sessionEpoch,headers=new Headers(options.headers||{});if(csrf)headers.set('X-CSRF-Token',csrf);
    let body=options.body;if(body&&!(body instanceof FormData)){headers.set('Content-Type','application/json');body=JSON.stringify(body);}
    const response=await fetch(path,{...options,body,headers,credentials:'same-origin',cache:'no-store'});
    let data;try{data=await response.json();}catch{throw new Error(`服务器返回异常（${response.status}）`);}
    if(epoch!==sessionEpoch){const error=new Error("会话已变化");error.name="AbortError";throw error;}
    if(!response.ok){if(response.status===401&&authenticated){authenticated=false;clearTimeout(polling);login();}
      const message=Array.isArray(data.detail)?data.detail.map(x=>x.msg).join('；'):data.detail;
      const error=new Error(message||`请求失败（${response.status}）`);error.status=response.status;throw error;}
    if(data.csrf)csrf=data.csrf;return data;
  }
  const post=(path,body={})=>api(path,{method:'POST',body});
  function bindPendingForm(form,key,send){
    const button=$('button[type="submit"]',form)||$('button',form);button.dataset.pendingKey=key;StudioFeedback.hydrate(form);
    form.onsubmit=event=>{
      event.preventDefault();if(StudioFeedback.busy(key))return;
      const values=Object.fromEntries(new FormData(form)),error=$('.form-err',form);if(error)error.textContent='';
      return StudioFeedback.run(key,button,()=>send(values)).catch(failure=>{if(error&&form.isConnected)error.textContent=failure.message;else report(failure);});
    };
  }
  async function closeOwnedSheet(layer,revision){if(layer?.isConnected&&layer.style.pointerEvents!=='none'&&layer.dataset.revision===revision&&layers.at(-1)?.type==='sheet'&&topSheet()===layer)await back();}
  function rememberAsset(a,origin){if(!a)return null;const previous=assets.get(a.id)||{};
    const j=origin||jobs.get(a.job_id),cid=j?.collection_id||previous.coll;
    const mapped={...previous,...a,w:a.width,h:a.height,fav:!!a.favorite,created:a.created*1000,coll:cid,
      batch:j?.batch_id||previous.batch,prompt:j?.prompt||previous.prompt||'',ratio:actualRatio(a.width,a.height),
      src:j?.options?.source_asset_id,badge:a.operation==='quick-edit'?'速改':j?.options?.stitch?j.options.stitch+'×':j?.options?.regions?'重绘×'+j.options.regions.length:j?.options?.region?'重绘':undefined};
    assets.set(a.id,mapped);return mapped;
  }
  function actualRatio(w,h){const gcd=(a,b)=>b?gcd(b,a%b):a,g=gcd(w,h)||1;return `${w/g}:${h/g}`;}
  function rememberJob(j){jobs.set(j.id,{...jobs.get(j.id),...j});for(const a of j.references||[])rememberAsset(a);for(const a of j.outputs||[])rememberAsset(a,j);}
  function projectImages(){S.images=[...assets.values()].filter(a=>!a.deleted&&a.kind==='generated'&&!jobs.get(a.job_id)?.options.system_probe).sort((a,b)=>b.created-a.created);S.library=[...assets.values()].filter(a=>!a.deleted&&a.kind==='reference').sort((a,b)=>b.created-a.created);}
  function upModel(j){const p=j.upscale_plan||details.get(j.id)?.upscale_plan,source=j.source_image||details.get(j.id)?.source_image;
    if(source?.id)rememberAsset(source);
    if(!p?.stages?.length)return null;
    const stages=p.stages.map(s=>{const history=j.progress?.timeline?.find(level=>level.index===s.index)||s.progress,children=history?.tiles?.length?history.tiles:(j.progress?.level===s.index?j.progress.children:[])||[];return {from:s.input_size,to:s.output_size,grid:[s.columns,s.rows],phase:s.status==='succeeded'?'done':history?.status==='failed'?'failed':s.status==='running'?'tiles':'pending',
      tiles:(children.length?children:Array.from({length:s.tile_count},(_,i)=>({index:i+1}))).map((t,i)=>({i:(t.index??i+1)-1,state:s.status==='succeeded'?'done':state(t.state||'queued'),stage:Math.max(0,['sending','thinking','generating','receiving'].indexOf(t.stage)),reason:t.label||'',checkpoint:!!t.checkpoint})),raw:s};});
    let cur=p.stages.findIndex(s=>s.status==='failed'||s.status==='running');if(cur<0)cur=p.stages.findIndex(s=>s.status!=='succeeded');if(cur<0)cur=stages.length-1;
    return {factor:j.options.stitch+'×',levels:stages,cur,injection:j.options.upscale_injection||'',src:source?.id||j.options.source_asset_id,plan:{},raw:p};
  }
  function task(j){const p=j.progress||{},t={id:j.id,status:state(j.status),stage:Math.max(0,['sending','thinking','generating','receiving'].indexOf(p.stage||j.stage)),err:j.error,attempt:j.attempt,img:j.outputs?.[0]?.id,raw:j};
    t.waitingForSlot=p.stage==='call_wait';
    if(j.options.stitch)t.up=upModel(j);
    if(j.options.regions)t.multi={src:j.options.source_asset_id,phase:p.label?.includes('合成')?'merge':t.status==='done'?'done':'parts',parts:j.options.regions.map((r,i)=>{const a=p.regions?.find(x=>x.index===i)||{};return {i,text:r.prompt,state:state(a.status||'queued'),stage:['sending','thinking','generating','receiving'].indexOf(a.stage)};})};return t;
  }
  function projectBatches(){S.batches=[...batchMap.values()].sort((a,b)=>b.created-a.created).filter(b=>!b.jobs.every(j=>j.options.system_probe)).map(b=>{
    const js=b.jobs.map(j=>jobs.get(j.id)||j),j=js[0],o=j.options,kind=js.every(j=>j.options.stitch)?'upscale':o.regions||o.region?'redraw':o.quick_edit?'quick':'image';
    return {id:b.id,prompt:j.prompt,created:j.created*1000,coll:j.collection_id,ratio:labelRatio(o.ratio),kind,tasks:js.map(task),src:o.source_asset_id};});
  }
  function mapSettings(data){prefs=data;const d=data.defaults,q=data.quick,u=data.upscale;
    StudioUpscalePrompts.configure(data);
    for(const [k,v] of Object.entries({call:data.default_call_prompt,polish:data.default_polish_prompt,tile:data.default_stitch_prompt}))DEFAULT_PROMPTS[k]=v;
    S.settings={concurrency:config.concurrency,maxAttempts:config.max_attempts,notify:data.notify,appearance:data.appearance||{mode:'system',accent:'#5d7350'},motion:['system','reduce','full'].includes(data.motion_mode)?data.motion_mode:data.motion===false?'reduce':'system',
      defaults:{...d,ratio:labelRatio(d.ratio),size:labelSize(d.size),stitch:d.stitch?d.stitch+'×':'关',effort:config.effort,model:config.model},
      quick:{...q,effort:q.effort||config.effort,keepSpec:q.keep_spec??true,useRef:q.use_ref??true,into:q.use_source_template?'same':'none',notify:q.notify??true},
      upscale:{factor:u.factor+'×',autoSelect:u.auto_select,injection:u.default_injection,appendSystem:u.append_system??true,includeSourceContext:u.include_source_context??false},prompts:{call:data.call_prompt,polish:data.polish_prompt,tile:data.stitch_prompt},cache:S.settings.cache};applyMotion();if(typeof StudioTheme!=='undefined')StudioTheme.apply(S.settings.appearance);
  }
  function defaultComposer(){const d=S.settings.defaults;return {prompt:'',template:null,refs:[],ratio:d.ratio,count:d.count,size:d.size,polish:d.polish,transparent:d.transparent,stitch:d.stitch,effort:config.effort,model:config.model,ack:false,upscaleRequirements:S.settings.upscale.injection||'',upscalePolicy:{append_system:S.settings.upscale.appendSystem,include_source_context:S.settings.upscale.includeSourceContext}};}
  function draftKey(){return `studio-demo-composer:${authState.cache_scope}`;}
  function saveDraft(){if(!authenticated)return;clearTimeout(draftTimer);draftTimer=setTimeout(()=>{try{localStorage.setItem(draftKey(),JSON.stringify({composer:S.composer,upc:S.upc,mode:S.mode}));}catch{}},250);}
  async function restoreDraft(){let d;try{d=JSON.parse(localStorage.getItem(draftKey())||'null');if(!d){const old=JSON.parse(localStorage.getItem('studio_draft')||'null');if(old)d={composer:{...old,ratio:labelRatio(old.ratio||'auto'),size:labelSize(old.size||'auto'),stitch:old.stitch?old.stitch+'×':'关',template:old.template?.id||null},mode:'gen'};}}catch{}
    const ids=[...new Set([...(Array.isArray(d?.composer?.refs)?d.composer.refs:[]),d?.upc?.src].filter(Boolean))];
    await Promise.all(ids.filter(id=>!assets.has(id)).map(async id=>{try{const data=await api('/api/assets/'+id+'/info');if(data.job)rememberJob(data.job);rememberAsset(data.asset,data.job);}catch(error){if(error.status!==404)throw error;}}));
    const tid=d?.composer?.template;if(tid&&!tpl(tid)){try{const t=await api('/api/templates/'+tid);S.templates.push({id:t.id,name:t.title,text:t.text,ratio:labelRatio(t.options.ratio||'auto'),refs:t.refs.length,referenceIds:t.refs,options:t.options,raw:t});t.references.forEach(a=>rememberAsset(a));}catch(error){if(error.status!==404)throw error;}}projectImages();
    S.composer=defaultComposer();S.upc={src:null,factor:S.settings.upscale.factor,inj:S.settings.upscale.injection,policy:{append_system:S.settings.upscale.appendSystem,include_source_context:S.settings.upscale.includeSourceContext}};
    if(d?.composer){const c=d.composer;Object.assign(S.composer,c,{refs:(c.refs||[]).filter(id=>assets.has(id)),template:tpl(c.template)?c.template:null});if(!models.some(m=>m.id===c.model))S.composer.model=config.model;const m=models.find(m=>m.id===S.composer.model);if(m&&!m.efforts.includes(S.composer.effort))S.composer.effort=m.default_effort;}
    if(d?.upc)Object.assign(S.upc,d.upc,{src:assets.has(d.upc.src)?d.upc.src:null});if(['gen','up'].includes(d?.mode))S.mode=d.mode;
  }
  async function fetchBatches(offset=0){const data=await api(`/api/batches?limit=30&offset=${offset}`);batchTotal=data.total;batchOffset=Math.max(batchOffset,offset+data.items.length);ingestBatches(data.items);return data;}
  function ingestBatches(list){for(const b of list){batchMap.set(b.id,b);b.jobs.forEach(rememberJob);}}
  async function allCollections(){const data=await api('/api/collections?limit=100');while(data.items.length<data.total){const more=await api('/api/collections?limit=100&offset='+data.items.length);if(!more.items.length)break;data.items.push(...more.items);}return data;}
  async function sync({initial=false}={}){if(!authenticated)return;if(loading)return new Promise((resolve,reject)=>syncWaiters.push({resolve,reject}));loading=true;let failure;
    try{const [st,cs,ts]=await Promise.all([api('/api/state'),allCollections(),api('/api/templates')]);config=st;S.paused=st.paused;
      S.collections=cs.items.map(c=>({...c,template:c.template_id||null}));for(const c of cs.items)for(const a of c.covers||c.cover_assets||[]){const v=rememberAsset(a);if(v)v.coll=c.id;}
      S.templates=ts.map(t=>({id:t.id,name:t.title,text:t.text,ratio:labelRatio(t.options.ratio||'auto'),refs:t.refs.length,referenceIds:t.refs,options:t.options,raw:t}));ts.forEach(t=>t.references.forEach(a=>rememberAsset(a)));
      const [normal,...act]=await Promise.all([fetchBatches(),...['queued','running','retrying'].map(status=>api(`/api/batches?status=${status}&limit=100`))]);act.forEach(d=>ingestBatches(d.items));
      // A previously running old batch can finish outside the recent page.
      const current=new Set([...batchMap.values()].flatMap(b=>b.jobs).filter(active).map(j=>j.id));
      await Promise.all([...lastActive].filter(id=>!normal.items.some(b=>b.jobs.some(j=>j.id===id))&&!act.some(d=>d.items.some(b=>b.jobs.some(j=>j.id===id)))).map(async id=>rememberJob(await api('/api/jobs/'+id))));lastActive=current;
      const ups=[...batchMap.values()].flatMap(b=>b.jobs).filter(j=>j.options.stitch);
      await Promise.all(ups.filter(j=>initial||active(j)||!details.has(j.id)||details.get(j.id).status!==j.status).slice(0,20).map(async j=>{try{const d=await api('/api/upscale/jobs/'+j.id);details.set(j.id,d);rememberJob(d);}catch{}}));
      projectImages();projectBatches();if(!firstSync){notifyChanges();if(S.coll&&!coll(S.coll)){await closeOverlays();S.coll=null;S.tab='works';renderPage();}else if(!V.open&&!topScreen())refresh();}
      S.offline=false;updateChrome();StudioTasks.update();firstSync=false;
    }catch(error){failure=error;throw error;}finally{loading=false;const waiting=syncWaiters;syncWaiters=[];waiting.forEach(w=>failure?w.reject(failure):w.resolve());}
  }
  const knownStates=new Map();
  function notifyChanges(){for(const j of jobs.values()){const old=knownStates.get(j.id);knownStates.set(j.id,j.status);if(old&&active({status:old})&&!active(j)&&S.settings.notify&&(!j.options.quick_edit||S.settings.quick.notify)){
      const output=j.outputs?.[0],text=j.status==='succeeded'?'任务已完成':j.status==='failed'?'任务失败':'任务已取消';toast(text,{action:output?'查看':'查看任务',run:()=>output?closeOverlays().then(()=>openViewer(output.id,'recent')):goBatch(j.batch_id)});}}}
  async function refreshData(){if(loading)await sync();await sync();saveDraft();}
  function schedule(){clearTimeout(polling);if(!authenticated||stopped)return;polling=setTimeout(async()=>{if(!document.hidden&&!StudioZoom.isInteracting()){try{await sync();}catch(error){if(authenticated){S.offline=true;updateChrome();}}}schedule();},2500);}
  async function boot(){try{$('#tabbar').hidden=true;authState=await api('/api/auth/state');csrf=authState.csrf||'';authenticated=authState.authenticated;if(!authenticated)return login();
      $('#page').innerHTML='<div class="boot-state"><span class="spin"></span>正在打开工作台</div>';
      const [settingsData,ac,sub,catalog,library]=await Promise.all([api('/api/settings'),api('/api/account'),api('/api/setup/status'),api('/api/models'),api('/api/assets?kind=all&limit=200')]);
      account=ac;setup=sub;S.disconnected=!sub.authenticated;models=catalog.items;library.items.forEach(a=>rememberAsset(a));await sync({initial:true});mapSettings(settingsData);await restoreDraft();notifyChanges();renderPage();$('#tabbar').hidden=false;schedule();
      navigator.serviceWorker?.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});
    }catch(error){if(!authenticated&&authState)return login();$('#page').innerHTML=`<div class="boot-state"><p>${esc(error.message)}</p><button class="secondary" data-act="boot-retry">重新连接</button></div>`;}}
  function login(){StudioSelection.reset();releaseReferenceOwners();StudioChrome.leaveViewer();StudioDownloads.cancel();StudioZoom.reset();workPages.clear();sessionEpoch++;csrf="";clearTimeout(polling);$('#tabbar').hidden=true;$('#screens').innerHTML='';$('#layers').innerHTML='';vw.classList.remove('open');V.open=false;layers.splice(0);history.replaceState({depth:0},'');
    $('#page').innerHTML=`<div class="auth-wrap"><div class="auth-brand">${icon('sparkle',28)}<h1>Image Studio</h1><p>${authState?.initialized?'登录私人图片工作台':'设置私人图片工作台'}</p></div><form id="login-form" class="card"><div class="field-label">用户名</div><input class="input" name="username" autocomplete="username" minlength="2" maxlength="64" required><div class="field-label">密码</div><input class="input" name="password" type="password" autocomplete="${authState?.initialized?'current-password':'new-password'}" minlength="10" maxlength="256" required>${authState?.initialized?'':'<div class="field-label">初始化密钥</div><input class="input" name="setup_token" type="password" required>'}<p class="form-err" role="alert"></p><button class="primary" type="submit">${authState?.initialized?'登录':'创建工作台'}</button></form></div>`;
    bindPendingForm($('#login-form'),'form:login',async values=>{await post('/api/auth/'+(authState.initialized?'login':'setup'),values);$('#tabbar').hidden=false;firstSync=true;await boot();});
  }
  function jobInput(){const c=S.composer;return {prompt:c.prompt,refs:[...c.refs],count:c.count,ratio:ratio(c.ratio),size:size(c.size),polish:c.polish,transparent:c.transparent,after_upscale:factor(c.stitch),upscale_requirements:c.upscaleRequirements??'',...StudioUpscalePrompts.entryValue('composer'),model:c.model||config.model,effort:c.effort,template_id:c.template||null};}
  async function submit(path,body,onAccepted){const result=await post(path,body);holdBadge();onAccepted?.(result);try{await refreshData();}catch(error){S.offline=true;updateChrome();toast('任务已提交，等待更新状态');}return result;}
  async function generate(){if(!S.composer.prompt.trim()){toast('先写下画面要求');$('#prompt')?.focus();return;}const btn=$('#gen');if(btn?.disabled||btn?.classList.contains('done')||StudioFeedback.busy('generate'))return;const input=jobInput();
    return StudioFeedback.run('generate',btn,()=>submit('/api/jobs',input,()=>{if(!btn.isConnected)return;$('#gen-done').textContent=`已加入 ${input.count} 张`;btn.classList.add('done');flyDot(btn,$('.tab[data-tab="queue"] .ti'));setTimeout(()=>btn.classList.remove('done'),1700);}));}
  async function sendQuick(id,text){if(!text?.trim()||StudioFeedback.busy('quick:'+id))return false;return StudioFeedback.run('quick:'+id,null,async()=>{const result=await submit(`/api/assets/${id}/quick-edit`,{prompt:text.trim(),spec:{ratio:ratio(S.composer.ratio),size:size(S.composer.size)}});toast('速改已加入任务',{action:'查看任务',run:()=>goBatch(result.batch_id)});return true;});}
  function reroll(id,button=null){const key='reroll:'+id;if(StudioFeedback.busy(key))return false;return StudioFeedback.run(key,button,async()=>{await rerollRequest(id);return true;});}
  async function rerollRequest(id){const im=assets.get(id),data=await api('/api/assets/'+id+'/info'),j=data.job;if(!j)throw new Error('这张图片没有生成记录，请用作参考图创作');
    const o=j.options,input={prompt:j.prompt,refs:j.refs,count:1,ratio:o.ratio,size:o.size,polish:o.polish,transparent:o.transparent,model:j.model,effort:j.effort,template_id:j.template_id||null};
    if(o.stitch){const policy=o.upscale_prompts?.policy||o.upscale_prompt_summary?.policy||{append_system:S.settings.upscale.appendSystem??true,include_source_context:S.settings.upscale.includeSourceContext??false};await startUpscale(o.source_asset_id,o.stitch+'×',o.upscale_requirements??o.upscale_injection??'',null,'reroll',{upscale_policy:{...policy}});return;}
    if(o.region||o.regions){const result=await submit('/api/assets/'+o.source_asset_id+'/inpaint',{prompt:j.prompt,region:o.region,regions:o.regions,model:j.model,effort:j.effort});toast('局部重绘已重新加入',{action:'查看',run:()=>goBatch(result.batch_id)});return;}
    if(o.quick_edit){const result=await submit('/api/jobs',{...input,source_asset_id:o.source_asset_id,quick_edit:true,quick_keep_spec:o.quick_keep_spec??true,quick_use_ref:o.quick_use_ref??true});toast('速改已重新加入',{action:'查看',run:()=>goBatch(result.batch_id)});return;}
    const result=await submit('/api/jobs',input);toast('已再抽一张',{action:'查看任务',run:()=>goBatch(result.batch_id)});}
  function deleteImage(id,button=null){const key='delete-image:'+id;if(StudioFeedback.busy(key))return false;const owner=button?.closest?.('.sheet-layer'),revision=owner?.dataset.revision;return StudioFeedback.run(key,button,async()=>{await closeOwnedSheet(owner,revision);if(V.open&&V.list[V.i]===id&&layers.at(-1)?.type==='viewer')await back();toast('正在移入最近删除…');await deleteImageRequest(id);return true;});}
  async function deleteImageRequest(id){await api('/api/assets/'+id,{method:'DELETE'});if(assets.has(id))assets.get(id).deleted=true;projectImages();refresh();toast('已移到最近删除',{action:'撤销',ms:5000,run:()=>post('/api/assets/'+id+'/restore').then(()=>{if(assets.has(id))assets.get(id).deleted=false;projectImages();refresh();}).catch(report)});}
  async function bulkAssets(operation,ids){
    if(!['favorite','unfavorite','delete'].includes(operation))throw new Error('不支持的批量操作');
    const result={succeeded:[],failed:[]};let cursor=0;
    await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{while(cursor<ids.length){const id=ids[cursor++];try{const value=await api('/api/assets/'+id,operation==='delete'?{method:'DELETE'}:{method:'PATCH',body:{favorite:operation==='favorite'}});if(operation==='delete'){if(assets.has(id))assets.get(id).deleted=true;}else rememberAsset(value);result.succeeded.push(id);}catch(error){result.failed.push({id,error:error.message});}}}));
    projectImages();refresh();return result;
  }
  function editImage(input){
    const id=input.dataset.id,field=input.dataset.edit,key=id+':'+field,value=input.value;
    if(!assets.has(id)||!['name','tags'].includes(field))return Promise.reject(new Error('图片或编辑字段不存在'));
    let state=fieldWrites.get(key);if(state&&state.value===value){state.inputs.add(input);input.setAttribute('aria-busy','true');return state.tail;}
    if(!state){state={tail:Promise.resolve(),revision:0,inputs:new Set()};fieldWrites.set(key,state);}
    const revision=++state.revision;state.value=value;state.inputs.add(input);input.setAttribute('aria-busy','true');
    let status=fieldStatus.get(input);
    if(!status){status=document.createElement('button');status.type='button';status.className='field-save-state';status.setAttribute('aria-live','polite');input.insertAdjacentElement('afterend',status);fieldStatus.set(input,status);status.onclick=()=>editImage(input).catch(report);}
    status.disabled=true;status.classList.remove('error');status.innerHTML='<span class="spin"></span>正在保存…';
    const request=state.tail.catch(()=>{}).then(async()=>{
      try{
        const result=await api('/api/assets/'+id,{method:'PATCH',body:{[field]:value}}),asset=assets.get(id);if(asset)asset[field]=result[field];projectImages();
        if(revision===state.revision){for(const element of state.inputs){const current=element.value===value,indicator=fieldStatus.get(element);if(indicator){indicator.textContent=current?'已保存':'尚有修改 · 点击保存';indicator.classList.remove('error');indicator.disabled=current;}if(current)element.value=result[field];}}
        return result;
      }catch(error){
        if(revision===state.revision){for(const element of state.inputs){const indicator=fieldStatus.get(element);if(indicator){indicator.textContent='保存失败 · 点击重试';indicator.classList.add('error');indicator.disabled=false;}}throw error;}
      }finally{
        if(revision===state.revision){for(const element of state.inputs)element.setAttribute('aria-busy','false');if(fieldWrites.get(key)===state)fieldWrites.delete(key);}
      }
    });
    state.tail=request;return request;
  }
  async function loadTemplate(id){const t=tpl(id);if(!t)throw new Error('模板不存在');const c=S.composer,keepPrompt=!!c.prompt.trim(),text=keepPrompt?c.prompt:t.text,refs=[...new Set([...c.refs,...t.referenceIds])],omitted=Math.max(0,refs.length-8);
    const upscaleDraft={upscaleRequirements:c.upscaleRequirements??'',upscalePolicy:{...(c.upscalePolicy||StudioUpscalePrompts.entryValue('composer').upscale_policy)}};
    Object.assign(c,{...defaultComposer(),...t.options,...upscaleDraft,prompt:text,template:id,refs:refs.slice(0,8),ratio:labelRatio(t.options.ratio||'auto'),size:labelSize(t.options.size||'auto'),stitch:t.options.stitch?t.options.stitch+'×':'关',ack:false});
    await closeOverlays();S.tab==='create'?renderPage():await go('create');S.mode='gen';renderPage();flashChip();saveDraft();toast(`已载入模板：${t.name}${keepPrompt?' · 已保留现有提示词':''}${omitted?` · 已有参考图保留，另有 ${omitted} 张超出 8 张上限`:''}`);}
  function tplSaveForm(L,editing=null){const t=editing&&tpl(editing),c=S.composer,text=t?.text??c.prompt;
    const refs=[...(t?.referenceIds||c.refs)];
    const html=`<div class="field-label">名称</div><input class="input" id="tpl-name" maxlength="100" value="${esc(t?.name||text.slice(0,10)||'新模板')}"><div class="field-label">可复用正文</div><textarea class="input" id="tpl-text" maxlength="24000" placeholder="可留空，仅复用参考图与参数">${esc(text)}</textarea><div class="field-label">参考图 <span class="muted" id="tpl-ref-count"></span></div><p class="note">点图放大，长按图片后左右拖动排序。</p><div class="ref-strip template-refs" id="tpl-refs"></div>${t?'':`<button class="row" data-act="sw-bind" data-layout="width:100%"><span class="rl">本次创作归入该模板<small>之后用它生成的图片会进入同名列表</small></span><span class="switch on" id="bind-sw"></span></button>`}<button class="primary" data-act="tpl-save" ${t?`data-id="${t.id}"`:''}>保存模板</button>${t?`<button class="secondary danger" data-act="tpl-delete" data-id="${t.id}">删除模板</button>`:''}`;
    if(L)swapSheet(L,t?'编辑模板':'保存为模板',html);else L=openSheet({title:t?'编辑模板':'新建模板',html});L.dataset.templateRefs=JSON.stringify(refs);
    const read=()=>JSON.parse(L.dataset.templateRefs||'[]'),write=ids=>{L.dataset.templateRefs=JSON.stringify(ids);paint();};
    const paint=()=>{if(!L.isConnected)return;$('#tpl-ref-count',L).textContent=read().length+' / 8';StudioReferences.render($('#tpl-refs',L),{read,write,add:()=>pickerSheet({title:'选择模板参考图',refs:read(),onCommit:write})});};paint();}
  function tplSheet(id){const t=tpl(id),c=S.collections.find(x=>x.template===id);if(!t)return;
    const html=`${t.text?.trim()?`<div class="prompt-box">${esc(t.text)}</div>`:''}<div class="chips" data-layout="margin-top:12px"><span class="chip">${t.ratio}</span><span class="chip">${t.refs} 张参考图</span><span class="chip">${labelSize(t.options.size||'auto')}尺寸</span></div><div class="template-preview-refs">${(t.referenceIds||[]).map(ref=>`<button data-act="tpl-preview-ref" data-id="${ref}" data-template-id="${id}" aria-label="放大参考图"><img src="${src(assets.get(ref))}" alt=""></button>`).join('')}</div><p class="note">用该模板生成的图片归入「${esc(c?.name||t.name)}」列表（${c?.image_count||0} 张）。已有提示词会保留，参考图按现有顺序去重补充（最多 8 张）；模板参数会应用到本次创作。可在创作页解除归属。</p><button class="primary" data-act="tpl-load" data-id="${id}">载入到创作${icon('arrow',18)}</button><div class="btn-row"><button class="secondary" data-act="tpl-edit" data-id="${id}" data-layout="flex:1;justify-content:center">${icon('edit',16)}编辑</button>${c?`<button class="secondary" data-act="open-coll" data-id="${c.id}" data-layout="flex:1;justify-content:center">${icon('layers',16)}查看作品</button>`:''}</div>`;
    return openSheet({title:t.name,html});
  }

  async function infoSheet(id){const im=assets.get(id);if(!im)return;const L=openSheet({title:'图片信息',html:'<p class="note">正在读取图片信息…</p>'});
    const revision=L.dataset.revision,data=await api('/api/assets/'+id+'/info');if(!L.isConnected||L.style.pointerEvents==='none'||revision!==L.dataset.revision)return;const j=data.job,c=coll(im.coll),o=j?.options||{};if(j)rememberJob(j);
    swapSheet(L,'图片信息',`<div class="prompt-box">${esc(j?.prompt||im.prompt||'上传图片')}</div><div class="btn-row"><button class="secondary" data-act="copy-prompt" data-id="${id}">${icon('copy',16)}复制</button><button class="secondary" data-act="use-prompt" data-id="${id}">${icon('sparkle',16)}用此提示词创作</button></div>${j?.polished_prompt?`<div class="field-label">润色后的提示词</div><div class="prompt-box">${esc(j.polished_prompt)}</div>`:''}<dl class="kv"><dt>尺寸</dt><dd>${im.w} × ${im.h} · ${bytes(im.bytes)}</dd>${j?`<dt>参数</dt><dd>${esc(labelRatio(o.ratio))} · ${labelSize(o.size)}尺寸 · ${esc(modelName(j.model))} / ${esc(j.effort)}</dd>`:''}<dt>归入</dt><dd>${esc(c?.name||'参考图库')}</dd>${im.src?`<dt>来源</dt><dd>${esc(assets.get(im.src)?.name||im.src)}</dd>`:''}<dt>生成于</dt><dd>${fmtTime(im.created)}</dd>${j?`<dt>任务</dt><dd><button class="link-btn" data-act="task-info" data-id="${j.id}">查看任务记录 ›</button></dd>`:''}</dl><div class="field-label">名称</div><input class="input" data-edit="name" data-id="${id}" value="${esc(im.name)}" maxlength="200"><div class="field-label">标签</div><input class="input" data-edit="tags" data-id="${id}" value="${esc(im.tags)}" maxlength="200" placeholder="例如：产品，材质，构图"><p class="note">修改后自动保存。</p>`);}
  function modelName(id){return models.find(m=>m.id===id)?.name||id||'模型';}
  function taskAdapter(){return {api,modelName,task,planHTML,budget,bytes,report,openFailure,asset:id=>assets.get(id),latest:id=>details.get(id)||jobs.get(id),accept:j=>{if(j.upscale_plan)details.set(j.id,j);rememberJob(j);projectBatches();}};}
  function taskInfo(id,showLog=false){return StudioTasks.open(id,taskAdapter(),{showLog});}
  function planKey(im,f){return `${im.id}:${factor(f)}:${config.max_attempts}`;}
  function getPlan(im,f){const k=planKey(im,f);if(plans.has(k))return plans.get(k);if(!planPending.has(k)){const promise=api(`/api/assets/${im.id}/upscale-plan?factor=${factor(f)}`).then(p=>{plans.set(k,p);refresh();for(const L of $$('#layers .sheet-layer[data-up-source]'))if(L.dataset.upSource===im.id)paintSheetPlan(L);}).catch(error=>{plans.set(k,{error:error.message});refresh();}).finally(()=>planPending.delete(k));planPending.set(k,promise);}return null;}
  function makeUp(im,f,inj){const p=getPlan(im,f);return p?.stages?{factor:f,levels:p.stages.map(s=>({from:s.input_size,to:s.output_size,tiles:Array.from({length:s.tile_count}),grid:[s.columns,s.rows]}))}:null;}
  function cutSvg(s,source,previous){const [w,h]=s.input_size,cuts=s.cuts||{},old=previous?.cuts||{},lines=(cuts.x||[]).map(x=>`M${x} 0V${h}`).concat((cuts.y||[]).map(y=>`M0 ${y}H${w}`)).join(' '),older=(old.x||[]).map(x=>`M${x*2} 0V${h}`).concat((old.y||[]).map(y=>`M0 ${y*2}H${w}`)).join(' ');
    return `<svg class="plan-cut" viewBox="0 0 ${w} ${h}" role="img" aria-label="第 ${s.index} 级切法：${s.columns} 列 ${s.rows} 行，${s.tile_count} 块"><image href="${esc(s.preview_url||picture(source))}" width="${w}" height="${h}" preserveAspectRatio="none"/><path d="${older}" stroke="#e5a45b" stroke-dasharray="5 4" fill="none" vector-effect="non-scaling-stroke"/><path d="${lines}" stroke="#fffefa" stroke-width="1.5" fill="none" vector-effect="non-scaling-stroke"/></svg>`;}
  function budget(b){return b?`${b.images} 次生图 + ${b.reviews} 次验收`:'—';}
  function planHTML(im,f,provided){if(!im&&!provided)return '<p class="note">尚无可用的原图或分级检查点</p>';const p=provided||getPlan(im,f);if(!p)return '<div class="up-plan"><div><span class="muted">正在计算切法、尺寸与调用预算…</span></div></div>';if(p.error)return `<div class="up-plan"><div class="danger">${esc(p.error)}</div></div>`;
    return `<div class="up-plan">${p.stages.map((s,i)=>`<div class="plan-level">${cutSvg(s,im,p.stages[i-1])}<span class="plan-level-copy"><b>第 ${s.index} 级 · ${s.columns}×${s.rows} · ${s.tile_count} 块</b><span>${s.input_size.join('×')} → ${s.output_size.join('×')}</span><span>${budget(s.budget)}</span>${s.actual_size?`<span>实际 ${s.actual_size.join('×')}</span>`:''}</span></div>`).join('')}<div class="tot"><span>总预算</span><b>${budget(p.budget)}</b></div><div class="tot"><span>预期最终</span><b>${p.output_size.join('×')}</b></div>${p.actual_size?`<div class="tot"><span>实际最终</span><b>${p.actual_size.join('×')}</b></div>`:''}<div><span class="muted">含重试最多 ${p.budget.max_calls} 次调用 · 每级重新切图</span></div></div>`;}
  function paintSheetPlan(L){if(!$('#up-plan',L))return;const im=assets.get(L.dataset.upSource),p=im&&getPlan(im,L.dataset.f);setHTML($('#up-plan',L),planHTML(im,L.dataset.f));const btn=$('[data-act="up-go"]',L);btn.disabled=!p?.stages;}
  function upscaleSheet(id){const im=assets.get(id);if(!im)return;const f=S.settings.upscale.factor,scope=StudioUpscalePrompts.newScope();
    return openSheet({title:'发送到超分',cls:'up-entry-sheet',html:`<div class="up-entry-workspace"><main><div class="up-src"><img src="${src(im)}" alt=""><div><b>${esc(im.name)}</b><span>${im.w} × ${im.h}</span></div></div><div class="field-label">面积倍率</div><div class="opts" id="upo">${Object.keys(FACTORS).map(v=>`<button class="opt tall${v===f?' on':''}" data-act="up-f" data-v="${v}">${v}<small>宽高 ×${2**FACTORS[v]} · ${FACTORS[v]} 级</small></button>`).join('')}</div><div id="up-plan"></div></main><aside><div class="field-label">任务统一要求</div><textarea class="input" id="up-inj" rows="3" maxlength="12000" placeholder="统一细节、材质与画风；留空按原图保真增强">${esc(S.settings.upscale.injection)}</textarea>${StudioUpscalePrompts.entry(scope,{source:id})}<p class="note">每级重新切图，通过验收后进入下一级。失败会保留已完成图块。</p><button class="primary" data-act="up-go" data-id="${id}" disabled>加入任务${icon('arrow',18)}</button></aside></div>`,onMount:L=>{L.dataset.f=f;L.dataset.upSource=id;L.dataset.promptScope=scope;L.cleanup=()=>StudioUpscalePrompts.release(scope);paintSheetPlan(L);}});}
  async function startUpscale(id,f,inj,onAccepted,scope='upscale',promptOptions=null){const result=await submit(`/api/assets/${id}/upscale`,{factor:factor(f),upscale_requirements:inj||'',...(promptOptions||StudioUpscalePrompts.entryValue(scope)),model:S.composer.model,effort:S.composer.effort},onAccepted);if(!onAccepted)toast(`${f} 超分已加入任务`,{action:'查看',run:()=>goBatch(result.batch_id)});return result;}
  function upDetail(id,inspectOnly=false){return StudioTasks.open(id,taskAdapter(),{mode:'upscale',inspectOnly});}
  async function cloneUpscale(id){
    const job=await api('/api/upscale/jobs/'+id),source=job.options.source_asset_id||job.source_image?.id;
    if(!source)throw new Error('原图尚未生成，请在原图可用后复制任务');
    if(job.source_image?.id)rememberAsset(job.source_image);
    S.upc={src:source,factor:job.options.stitch+'×',inj:job.options.upscale_requirements??job.options.upscale_injection??'',policy:{...(job.options.upscale_prompts?.policy||{append_system:S.settings.upscale.appendSystem,include_source_context:S.settings.upscale.includeSourceContext})}};
    await closeOverlays();if(S.coll)await back();S.mode='up';if(S.tab==='create')renderPage();else await go('create');saveDraft();toast('已复制要求与原图；新任务采用当前系统模板，不复用旧任务图块');
  }
  function setComposerRefs(refs){S.composer.refs=[...new Set(refs)].slice(0,8);refresh();saveDraft();}
  function pickerSheet(opt={}){return StudioPicker.open(opt,{api,asset:id=>assets.get(id),remember:rememberAsset,project:projectImages,commit:setComposerRefs,report});}

  function avatar(){return account.avatar_url?`<img class="avatar-image" src="${esc(account.avatar_url)}" alt="">`:esc(account.username?.slice(0,1).toUpperCase());}
  function appearanceHTML(){return `<div class="s-row col">${lbl('主题色','选中项、开关与强调色')}<div class="accent-options">${['#5d7350','#3973bf','#8362b1','#bb5277','#b16b2d','#26807b'].map(color=>`<button class="accent-swatch" data-act="accent-set" data-color="${color}" data-layout="--swatch:${color}" aria-label="主题色 ${color}" aria-pressed="${S.settings.appearance.accent.toLowerCase()===color}">${icon('check',16)}</button>`).join('')}<label class="accent-custom">自定义<input type="color" id="accent-custom" aria-label="自定义主题色" value="${S.settings.appearance.accent}"></label></div><span class="accent-sample">已选择 · <span id="accent-value">${S.settings.appearance.accent}</span></span></div>`;}
  function paintAccent(){for(const el of $$('[data-act="accent-set"]'))el.setAttribute('aria-pressed',String(el.dataset.color===S.settings.appearance.accent));const input=$('#accent-custom');if(input)input.value=S.settings.appearance.accent;const label=$('#accent-value');if(label)label.textContent=S.settings.appearance.accent;}
  function settingsHTML(){const st=S.settings,ef=(models.find(m=>m.id===config.model)?.efforts||[config.effort]).map(v=>[v,v]),qef=(models.find(m=>m.id===(st.quick.model||config.model))?.efforts||[st.quick.effort]).map(v=>[v,v]);
  return `<header class="top scr-top"><button class="icon-btn" data-act="scr-back" aria-label="返回">${icon("back")}</button><h1>设置</h1><span class="grow"></span><span class="saved" id="saved">${icon("check",14)}已保存</span></header>
<div class="scroll set-scroll">
${group("set-account","账户",`<button class="s-row" data-act="account-edit"><span class="prof"><span class="avatar" data-user-avatar>${avatar()}</span>${lbl(esc(account.username),"管理员 · 本设备已登录")}</span></button>${sLink("更换头像","","avatar-edit")}${sLink("修改密码","","password")}${sLink("退出其他设备",Math.max(0,account.session_count-1)+" 台","sessions")}`)}
${group("set-sub","ChatGPT 订阅",`<div class="s-row">${lbl("连接状态","服务器上的 Codex CLI 会话")}<span id="sub-pill" class="${!setup.authenticated?"pill-warn":"pill-ok"}">${!setup.authenticated?"已断开":"已连接"}</span></div>${sLink(!setup.authenticated?"重新连接":"重新授权","","reconnect-set")}${sLink("运行生图检查","会使用一次额度","probe")}`)}
${group("set-defaults","生成默认值",sSeg("defaults.ratio",["1:1","3:2","2:3","16:9","9:16","自动"].map(v=>[v,v]),"画幅")+sStep("defaults.count","数量","每张为独立会话",1,20)+sLink("模型",esc(modelName(config.model)),"model-settings")+sSeg("defaults.effort",ef,"思考强度")+sSwitch("defaults.polish","帮我润色","默认关闭"),`<p class="g-foot">新建创作和“恢复默认值”使用这些参数；参数面板里的“设为默认”会写回这里。</p>`)}
${group("set-quick","速改",sSwitch("quick.keepSpec","保持原图规格","画幅与尺寸跟随原图")+sSwitch("quick.useRef","以原图为参考","关闭后只按文字重新生成")+sSeg("quick.into",[["same","原列表"],["none","无模板"]],"结果归入")+sLink("模型",esc(st.quick.model?modelName(st.quick.model):"跟随生成设置"),"model-quick")+sSeg("quick.effort",qef,"思考强度","速改通常不需要最高强度")+sSwitch("quick.notify","完成后提示","带“查看”按钮的提示"),`<p class="g-foot" id="qe-preview">${quickPreview()}</p>`)}
${group("set-upscale","超分",sSeg("upscale.factor",Object.keys(FACTORS).map(v=>[v,`${v} · ${FACTORS[v]} 级`]),"默认倍率")+sSwitch("upscale.autoSelect","失败时预选问题块","打开失败处理时自动勾选")+sSwitch("upscale.appendSystem","默认拼接超分系统提示","每个入口仍可单独选择")+sSwitch("upscale.includeSourceContext","默认附带原图历史描述","作为背景，不重复执行历史编辑")+sLink("默认任务统一要求",esc(st.upscale.injection.slice(0,12))+"…","inj-edit"))}
${group("set-queue","任务队列",sStep("concurrency","并发会话","生成、速改与超分子块共用",1,4)+sStep("maxAttempts","单块最多尝试","临时错误退避重试；鉴权与额度错误立即停止",1,5)+sSwitch("notify","完成与失败提示"))}
${group("set-prompts","生成与润色提示词",['call','polish'].map(k=>sLink(PROMPT_META[k][0],`<span id="pb-${k}">${promptBadge(k)}</span>`,"prompt-edit",`data-k="${k}"`)).join(""),`<p class="g-foot">只影响之后的新任务；已提交的任务保留配置快照。</p>`)}
${group("set-upscale-prompts","超分系统提示词",StudioUpscalePrompts.settingsHTML(),`<p class="g-foot">图块、拼接格式、重试反馈、验收与产物协议分别配置，提交时冻结完整版本。</p>`)}
${group("set-appearance","外观",sSeg("appearance.mode",[["system","跟随系统"],["light","浅色"],["dark","暗色"]],"颜色模式")+appearanceHTML())}
${group("set-display","显示与存储",sSeg("motion",[["system","跟随系统"],["reduce","减少动效"],["full","完整动效"]],"动效")+`<div class="s-row col"><div data-layout="display:flex;align-items:center;gap:12px">${lbl("图片缓存",`<span id="cache-txt">${st.cache.mb.toFixed(1)} MB / 192 MB · ${st.cache.files} 个文件</span>`)}<button class="pill-btn" id="cache-btn" data-act="cache-clear">清理</button></div><div class="cache-bar"><i id="cache-bar" data-layout="width:${st.cache.mb/192*100}%"></i></div></div>`)}
${group("set-storage","服务器存储",`<div id="server-storage"><p class="note">正在读取空间使用情况…</p></div>`)}
${group("set-more","其他",sLink("最近删除","","trash")+sLink("安装应用","Android / 主屏幕","install"))}
<div class="g-card" data-layout="margin-bottom:12px"><button class="s-row danger" data-act="logout">退出登录</button></div>
<p class="g-foot" data-layout="text-align:center">Image Studio</p>
</div>`;}

  function meSheet(){openSheet({html:`<div class="sheet-hd"><button class="avatar" data-user-avatar data-act="avatar-edit" aria-label="更换头像" data-layout="width:48px;height:48px;font-size:18px">${avatar()}</button><div><b>${esc(account.username)}</b><span>${setup.authenticated?'订阅已连接':'订阅未连接'} · ${S.settings.concurrency} 路并发</span></div></div><button class="menu-row" data-act="settings">${icon('sliders',20)}<span>设置</span><span class="rt">账户、默认值、调用提示词</span></button><button class="menu-row" data-act="trash">${icon('archive',20)}<span>最近删除</span></button><button class="menu-row" data-act="install">${icon('phone',20)}<span>安装应用</span></button><div class="menu-sep"></div><button class="menu-row danger" data-act="logout">${icon('logout',20)}<span>退出登录</span></button>`});}
  let settingsVersion=0;
  function settingsPayload(){const d=S.settings.defaults,q=S.settings.quick,u=S.settings.upscale;return {
    concurrency:S.settings.concurrency,max_attempts:S.settings.maxAttempts,model:config.model,effort:d.effort,
    defaults:{...prefs.defaults,ratio:ratio(d.ratio),count:d.count,size:size(d.size),transparent:d.transparent,polish:d.polish,stitch:factor(d.stitch)},
    quick:{...prefs.quick,keep_spec:q.keepSpec,use_ref:q.useRef,use_source_template:q.into==='same',effort:q.effort,notify:q.notify},
    upscale:{...prefs.upscale,factor:factor(u.factor),auto_select:u.autoSelect,default_injection:u.injection,append_system:u.appendSystem,include_source_context:u.includeSourceContext},
    appearance:S.settings.appearance,motion:S.settings.motion!=='reduce',motion_mode:S.settings.motion,notify:S.settings.notify,call_prompt:S.settings.prompts.call,polish_prompt:S.settings.prompts.polish,stitch_prompt:S.settings.prompts.tile};}
  function settingChanged(p){const version=++settingsVersion,payload=settingsPayload(),el=topScreen(),sv=el&&$('#saved',el);if(sv){sv.innerHTML='保存中…';sv.classList.add('on');}
    if(p==='motion')applyMotion();if(p.startsWith('appearance'))StudioTheme.apply(S.settings.appearance);if(p.startsWith('quick')){updQuickMeta();const qp=el&&$('#qe-preview',el);if(qp)qp.textContent=quickPreview();}
    const promise=saveQueue.catch(()=>{}).then(()=>api('/api/settings',{method:'PATCH',body:payload}));saveQueue=promise;
    promise.then(()=>{prefs={...prefs,...payload};config.effort=payload.effort;config.concurrency=payload.concurrency;config.max_attempts=payload.max_attempts;if(version===settingsVersion&&sv?.isConnected){sv.innerHTML=icon('check',14)+'已保存';sv.classList.remove('save-error');setTimeout(()=>sv.classList.remove('on'),1400);}refresh();}).catch(error=>{if(sv?.isConnected){sv.textContent='保存失败';sv.classList.add('save-error');}report(error);});return promise;}
  async function refreshSettings(el){try{const [cache,storage]=await Promise.all([StudioImages.status(),api('/api/storage')]);if(!el.isConnected)return;S.settings.cache={mb:(cache.bytes||0)/1048576,files:cache.count||0};const text=$('#cache-txt',el);if(text)text.textContent=`${S.settings.cache.mb.toFixed(1)} MB / 192 MB · ${cache.count||0} 个文件`;const bar=$('#cache-bar',el);if(bar)bar.style.width=Math.min(100,S.settings.cache.mb/192*100)+'%';renderStorage(storage,el);}catch(e){report(e);}}
  function renderStorage(st,el=topScreen()){const slot=el&&$('#server-storage',el);if(!slot)return;
    const used=st.bytes||0,free=st.available_bytes??Math.min(st.free_bytes||0,st.limit_bytes?Math.max(0,st.limit_bytes-used):Infinity),capacity=used+free;
    const total=st.disk_total_bytes||used+(st.free_bytes||0),other=Math.max(0,total-used-(st.free_bytes||0));
    const width=(n,d)=>Math.min(100,Math.max(0,n/Math.max(1,d)*100));
    slot.innerHTML=`<div class="s-row col"><span class="s-l">数据库与图片总空间<small>数据库文件 ${bytes(st.groups.database)} · 图片、缓存和任务文件一并计入限额</small></span></div>
      <div class="storage-meter"><div><div class="storage-scale">服务器总空间<b>${bytes(total)}</b></div><div class="storage-track" role="img" aria-label="服务器总空间 ${bytes(total)}，其他占用 ${bytes(other)}，本工作台 ${bytes(used)}，磁盘可用 ${bytes(st.free_bytes)}"><i class="other" data-layout="width:${width(other,total)}%"></i><i class="used" data-layout="width:${width(used,total)}%"></i></div></div>
      <div><div class="storage-scale">本工作台额度<b>${bytes(used)} 已用 · ${bytes(free)} 可用</b></div><div class="storage-track" role="img" aria-label="工作台已用 ${bytes(used)}，可用 ${bytes(free)}"><i class="used" data-layout="width:${width(used,capacity)}%"></i><i class="available" data-layout="width:${width(free,capacity)}%"></i></div></div>
      <div class="storage-key"><span><i class="other"></i>服务器其他占用</span><span><i></i>工作台已用</span><span><i class="available"></i>工作台可用</span></div><p class="note">${st.limit_bytes?'上限 '+bytes(st.limit_bytes):'未设置工作台上限'}；可用量取剩余额度与磁盘空闲中的较小值。</p>
      <label class="storage-limit">上限（GB，0 为不限）<input class="input" id="storage-limit" type="number" min="0" step="0.1" value="${st.limit_bytes/1073741824}"><button class="pill-btn" data-act="storage-limit">保存</button></label></div>
      <button class="s-row" data-act="empty-trash">${lbl('清空回收站',`${st.trash.assets} 张图片 · ${st.trash.collections} 个列表`)}<span class="s-r">${icon('trash',16)}</span></button>${st.tasks.map(t=>`<button class="s-row" data-act="clear-task-cache" data-id="${t.id}" ${t.clearable?'':'disabled'}>${lbl('超分任务缓存 · '+esc(t.prompt.slice(0,25)),t.clearable?'保留原图、最终作品与任务记录':'任务进行中')}<span class="s-r">${bytes(t.bytes)}${icon('chevr',16)}</span></button>`).join('')}`;}
  function confirmSheet(title,text,label,run){const L=openSheet({title,html:`<p class="note">${esc(text)}</p><button class="primary danger-soft" id="confirm-operation">${esc(label)}</button>`}),revision=L.dataset.revision,key='confirm:'+uid('op');$('#confirm-operation',L).onclick=async()=>{const btn=$('#confirm-operation',L);if(StudioFeedback.busy(key))return;try{await StudioFeedback.run(key,btn,async()=>{await run();await closeOwnedSheet(L,revision);});}catch(e){report(e);}};return L;}
  async function trash(){const el=openScreen(`<header class="top scr-top"><button class="icon-btn" data-act="scr-back" aria-label="返回">${icon('back')}</button><h1>最近删除</h1><span class="grow"></span><button class="ghost-btn danger" data-act="empty-trash">清空</button></header><div class="scroll set-scroll" id="trash-content"><p class="note">正在读取…</p></div>`,{cls:'trash-screen'});let offset=0,loadRevision=0;const operationKey='trash:'+uid('op');
    async function load(){const revision=++loadRevision,requestedOffset=offset,[as,cs]=await Promise.all([api(`/api/assets?kind=all&deleted=true&limit=100&offset=${requestedOffset}`),api('/api/collections?deleted=true')]);if(!el.isConnected||revision!==loadRevision)return;const slot=$('#trash-content',el);if(!requestedOffset)slot.innerHTML=cs.items.map(c=>`<div class="s-row">${lbl(esc(c.name),'已删除的列表')}<button class="pill-btn" data-restore-coll="${c.id}">恢复</button></div>`).join('');slot.insertAdjacentHTML('beforeend',as.items.map(a=>`<div class="s-row"><img class="trash-thumb" src="${esc(a.thumbnail)}" alt="">${lbl(esc(a.name),`${a.width} × ${a.height}`)}<button class="pill-btn" data-restore-img="${a.id}">恢复</button></div>`).join(''));offset=requestedOffset+as.items.length;let more=$('[data-trash-more]',el);more?.remove();if(offset<as.total)slot.insertAdjacentHTML('beforeend','<button class="secondary load-more" data-trash-more>加载更多</button>');if(!as.total&&!cs.items.length)slot.innerHTML='<p class="empty">最近删除为空</p>';}
    trashRefresh.set(el,async()=>{offset=0;await load();});
    el.addEventListener('click',async e=>{
      const button=e.target.closest('[data-restore-img],[data-restore-coll],[data-trash-more]');if(!button||StudioFeedback.busy(operationKey))return;
      const peers=$$('[data-restore-img],[data-restore-coll],[data-trash-more],[data-act="empty-trash"]',el).filter(b=>b!==button).map(b=>[b,b.disabled]);for(const [b] of peers)b.disabled=true;
      try{await StudioFeedback.run(operationKey,button,async()=>{if(button.hasAttribute('data-trash-more')){await load();return;}
        await post(button.dataset.restoreImg?`/api/assets/${button.dataset.restoreImg}/restore`:`/api/collections/${button.dataset.restoreColl}/restore`);
        try{if(button.dataset.restoreImg){const data=await api('/api/assets/'+button.dataset.restoreImg+'/info');rememberAsset(data.asset,data.job);}await refreshData();offset=0;await load();toast('已恢复');}
        catch(error){toast('已恢复，列表暂未刷新，请重新打开最近删除',{ms:5000});}
      });}catch(error){report(error);}finally{for(const [b,disabled] of peers)if(b.isConnected)b.disabled=disabled;}
    });await load();}
  function accountEditor(){const L=openSheet({title:'账户名称',html:`<form id="account-form"><div class="field-label">用户名</div><input class="input" name="username" value="${esc(account.username)}" minlength="2" maxlength="64" autocomplete="username" required><div class="field-label">当前密码</div><input class="input" name="current_password" type="password" autocomplete="current-password" required><p class="form-err"></p><button class="primary" type="submit">保存账户名称</button></form>`}),revision=L.dataset.revision;bindPendingForm($('#account-form',L),'form:account-name',async values=>{await api('/api/account',{method:'PATCH',body:values});account=await api('/api/account');await closeOwnedSheet(L,revision);renderPage();toast('账户名称已保存，其他设备已退出');});}
  function passwordSheet(){const L=openSheet({title:'修改密码',html:'<form id="password-form"><div class="field-label">当前密码</div><input class="input" name="current" type="password" autocomplete="current-password" required><div class="field-label">新密码</div><input class="input" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required><p class="form-err"></p><button class="primary" type="submit">保存密码</button></form>'}),revision=L.dataset.revision;bindPendingForm($('#password-form',L),'form:password',async values=>{await post('/api/auth/password',values);await closeOwnedSheet(L,revision);toast('密码已修改，其他设备已退出');});}
  async function connection(){const L=openSheet({title:'连接 ChatGPT 订阅',html:'<p class="note">正在检查服务器连接…</p>'});await paintConnection(L);}
  async function paintConnection(L){
    const initial=L.dataset.revision,d=await api('/api/setup/status');
    if(!L.isConnected||L.style.pointerEvents==='none'||initial!==L.dataset.revision)return;
    setup=d;S.disconnected=!d.authenticated;updateChrome();
    swapSheet(L,'连接 ChatGPT 订阅',`<p class="note" id="connect-state">${d.authenticated?'ChatGPT 已连接':'尚未连接 ChatGPT'} · ${esc(d.version||'')}</p><div id="login-status">${loginStatusHTML(d.login)}</div><div class="btn-row"><button class="secondary" data-connect="browser">浏览器授权</button><button class="secondary" data-connect="device">设备码授权</button></div><p class="note">授权使用服务器的 Codex CLI。设备码和链接以服务器实际返回为准。</p><label class="field-label">授权回调地址</label><input class="input" id="oauth-callback" placeholder="粘贴浏览器最终跳转的完整地址"><button class="secondary" data-connect="callback">完成浏览器回调</button><div class="btn-row"><button class="secondary" data-connect="refresh">刷新状态</button><button class="secondary" data-connect="cancel">取消本次授权</button></div>`,()=>{
      let timer,generation=0;const revision=L.dataset.revision,key='subscription-action',valid=()=>L.isConnected&&L.dataset.revision===revision&&L.style.pointerEvents!=='none';L.cleanup=()=>clearTimeout(timer);
      const check=async()=>{
        if(!valid())return;if(StudioFeedback.busy(key)){timer=setTimeout(check,1000);return;}
        const observed=generation;
        try{const st=await api('/api/setup/status');if(!valid()||observed!==generation)return;if(StudioFeedback.busy(key)){timer=setTimeout(check,1000);return;}
          setup=st;S.disconnected=!st.authenticated;updateChrome();$('#login-status',L).innerHTML=loginStatusHTML(st.login);$('#connect-state',L).textContent=st.authenticated?'ChatGPT 已连接':st.login.running?'正在等待官方授权':'尚未连接 ChatGPT';if(st.login.running)timer=setTimeout(check,2000);
        }catch(error){if(valid())report(error);}
      };
      L.onclick=async event=>{
        const button=event.target.closest('[data-connect]');if(!button||StudioFeedback.busy(key)||!valid())return;
        generation++;clearTimeout(timer);
        const mode=button.dataset.connect,callback=$('#oauth-callback',L).value,peers=$$('[data-connect]',L).filter(b=>b!==button).map(b=>[b,b.disabled]);for(const [b] of peers)b.disabled=true;
        try{await StudioFeedback.run(key,button,async()=>{
          if(mode==='browser'||mode==='device'){const result=await post('/api/setup/login',{mode});if(valid()){$('#login-status',L).innerHTML=loginStatusHTML(result);clearTimeout(timer);timer=setTimeout(check,1500);}}
          if(mode==='callback')await post('/api/setup/callback',{url:callback});
          if(mode==='cancel')await post('/api/setup/login/cancel');
          if(mode!=='browser'&&mode!=='device'&&valid())await paintConnection(L);
        });}catch(error){if(valid()){report(error);timer=setTimeout(check,1500);}}finally{for(const [b,disabled] of peers)if(b.isConnected)b.disabled=disabled;}
      };
      if(d.login?.running)timer=setTimeout(check,1500);
    });
  }
  function loginStatusHTML(value){const v=value||{},url=typeof v.url==='string'&&v.url.startsWith('https://auth.openai.com/')?v.url:null;return `${v.output?`<pre class="prompt-box task-log">${esc(v.output)}</pre>`:''}${url?`<a class="primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">在浏览器中继续授权${icon('arrow',18)}</a>`:''}`;}
  async function loadCollection(cid,more=false){const offset=more?(collectionPages.get(cid)||0):0,data=await api(`/api/jobs?collection=${cid}&limit=100&offset=${offset}`);data.items.forEach(rememberJob);collectionPages.set(cid,offset+data.items.length);projectImages();if(S.coll===cid){refresh();const hint=$('#grid')?.nextElementSibling;if(hint){let button=$('[data-act="collection-more"]',hint.parentElement);if(!button){button=document.createElement('button');button.className='secondary load-more';button.dataset.act='collection-more';hint.before(button);}button.dataset.id=cid;button.textContent='加载更多作品';button.hidden=offset+data.items.length>=data.total;}}}
  async function batchOperation(bid,verb,only){const b=S.batches.find(b=>b.id===bid);if(!b)return;const tasks=b.tasks.filter(t=>!only||t.id===only).filter(t=>verb==='cancel'?['queued','running'].includes(t.status):['failed','cancelled'].includes(t.status));let failed=0;for(const t of tasks){try{await post(`/api/jobs/${t.id}/${verb}`);}catch(e){failed++;report(e);}}await refreshData();toast(failed?`${tasks.length-failed} 项已处理，${failed} 项未完成`:(verb==='cancel'?'已取消':'已重新排队'));}
  async function redraw(){const im=img(V.list[V.i]),r=rectOf(curImg()),regions=V.regions.map(g=>({x:Math.round((g.x-r.x)/r.w*im.w),y:Math.round((g.y-r.y)/r.h*im.h),width:Math.round(g.w/r.w*im.w),height:Math.round(g.h/r.h*im.h),prompt:(V.shared?V.sharedText:g.text).trim()}));for(const q of regions){q.x=clamp(q.x,0,im.w);q.y=clamp(q.y,0,im.h);q.width=Math.min(q.width,im.w-q.x);q.height=Math.min(q.height,im.h-q.y);if(q.width<16||q.height<16)throw new Error('每个选区的原图宽高至少需要 16 像素');if(!q.prompt)throw new Error('请填写每个选区的重绘要求');}
    const result=await submit(`/api/assets/${im.id}/inpaint`,{regions,model:S.composer.model,effort:S.composer.effort});await back();toast(`${regions.length} 个区域已加入重绘任务`,{action:'查看',run:()=>goBatch(result.batch_id)});}

  function renderFailure(bid){
  const t=FX.task,u=t.up,lv=u.levels[u.cur];
  Object.assign(FX,{bid,pane:"affine",cmp:null,side:"output",showOk:false,latest:false,appendSystem:true,page:0,
    sel:new Set(S.settings.upscale.autoSelect?lv.tiles.filter(x=>x.state!=="done").map(x=>x.i):[])});
  const issues=upIssues(t);
  openScreen(`<header class="top scr-top"><button class="icon-btn" data-act="scr-back" aria-label="返回">${icon("back")}</button><div class="ct"><h1>失败处理 · 选块重绘</h1><span>${u.factor} · 第 ${u.cur+1}/${u.levels.length} 级 · ${lv.from.join("×")} → ${lv.to.join("×")}</span></div></header>
  <div class="scroll fx-scroll">
    <div class="failure-checkpoints">${StudioProgress.html(t,{all:true,key:'failure'})}</div>
    <details class="inspection-budget"><summary>尺寸、切法与预算</summary>${planHTML(assets.get(u.src),u.factor,t.raw.upscale_plan)}</details>
    <div class="fx-err">${icon("alert",20)}<div><b>本级验收未通过</b><ul>${issues.slice(0,6).map(i=>`<li>${esc(i)}</li>`).join("")}</ul>${issues.length>6?`<p>另有 ${issues.length-6} 个问题，请在下方分页定位图块。</p>`:''}<details><summary>原始错误</summary><code>${esc(t.err||"")}</code></details></div></div>
    <div class="seg" id="fx-seg"><span class="ind"></span><button data-act="fx-pane" data-v="source">原图对照</button><button data-act="fx-pane" data-v="raw">直接拼接</button><button data-act="fx-pane" data-v="affine">仿射诊断</button></div>
    <div id="fx-view"></div>
    <div class="fx-quick"><button data-act="fx-sel" data-v="problems">选择问题块</button><button data-act="fx-sel" data-v="all">全选</button><button data-act="fx-sel" data-v="none">清除</button></div>
    <div id="fx-list"></div><div id="fx-warn"></div>
    <div class="field-label">本次所选图块的修复要求</div><textarea class="input" id="fx-inj" rows="2" maxlength="12000" placeholder="例如：修复窗框断线，保留其余内容"></textarea>
    <p class="note">仅作用于本级所选图块；后续级接收修复后的图像，不重复执行这段局部指令。</p>
    <details class="task-disclosure"><summary>任务统一要求 · 保留原快照</summary><div class="prompt-box">${esc(u.injection||'无额外统一要求')}</div></details>
    <div class="g-card repair-composition" data-layout="margin-top:12px"><button class="s-row" data-act="fx-repair-system">${lbl("拼接局部修复系统模板","关闭时仅附加你填写的修复要求")}<span class="switch on" id="fx-repair-system-sw"></span></button><button class="s-row" data-act="fx-latest">${lbl("采用最新修复模板","只影响所选图块的局部修复；整图超分与验收仍用任务快照")}<span class="switch" id="fx-latest-sw"></span></button></div>
  </div>
  <div class="fx-bar"><div class="fx-sum" id="fx-sum"></div><button class="primary" id="fx-go" data-act="fx-go">重绘所选</button></div>`,
  {cls:"fail-screen",onMount:el=>{FX.screen=el;fxRender(el);StudioProgress.hydrate(el);}});
}

  let failureVersion=0;
  async function openFailure(id){const version=++failureVersion,b=S.batches.find(b=>b.id===id),jid=b?.tasks.find(t=>t.raw.options.stitch&&['failed','cancelled'].includes(t.raw.status))?.id||id;
    const wait=openSheet({title:'失败处理',html:'<p class="note">正在准备真实诊断拼图…</p>'}),revision=wait.dataset.revision;
    try{const d=await api('/api/upscale/jobs/'+jid);if(version!==failureVersion||wait.style.pointerEvents==='none'||wait.dataset.revision!==revision)return;details.set(jid,d);rememberJob(d);projectBatches();const u=upModel(d);if(!u)throw new Error('该任务尚未生成分块检查点，请从任务详情重试');
      const stage=d.upscale_plan.stages[u.cur];if(!stage.diagnostic_available)throw new Error(d.upscale_plan.cache_cleared?'任务缓存已清理，请从检查点重新开始任务':'本级尚无可用的切图检查点，请从任务详情重试');
      const diagnostic=await api(`/api/upscale/jobs/${jid}/diagnostics?level=${stage.index}`);if(version!==failureVersion||wait.style.pointerEvents==='none'||wait.dataset.revision!==revision)return;
      u.levels[u.cur].tiles=diagnostic.tiles.map(t=>({...t,i:t.index,state:{ready:'done'}[t.state]||t.state,stage:0}));FX.task={...task(d),up:u};FX.diag=diagnostic;FX.level=stage.index;FX.comparison=null;FX.jid=jid;
      await back();renderFailure(b?.id||d.batch_id);
    }catch(e){if(wait.isConnected&&wait.style.pointerEvents!=='none'&&wait.dataset.revision===revision)swapSheet(wait,'失败处理',`<p class="form-err">${esc(e.message)}</p><button class="primary" data-act="up-detail" data-id="${jid}" data-inspect-only="true">查看尺寸、预算与检查点</button>`);else report(e);}}
  function fxView(t){const lv=t.up.levels[t.up.cur],d=FX.diag,[w,h]=d.input_size;
    if(FX.cmp!==null){const x=lv.tiles.find(x=>x.i===FX.cmp),c=FX.comparison;return `<div class="cmp-bar"><button class="ghost-btn" data-act="fx-cmp-close">${icon('back',14)}全图</button><span>第 ${x.i+1} 块 · <b class="st-${x.state}">${TSTATE[x.state]}</b></span><span class="grow"></span><div class="mini-seg" data-layout="flex-wrap:nowrap"><button data-act="fx-side" data-v="input" class="${FX.side==='input'?'on':''}">输入</button><button data-act="fx-side" data-v="output" class="${FX.side==='output'?'on':''}">输出</button></div></div><div class="cmp side-${FX.side}" data-layout="aspect-ratio:${c?.input_size?.join('/')||'4/3'}"><div class="cmp-l in">${c?`<img src="${esc(c.images.input)}" alt="超分输入（含重叠）">`:'<span>正在读取对比…</span>'}</div><div class="cmp-l out">${c?.images.output?`<img src="${esc(c.images.output)}" alt="模型原始返回">`:`<span>${c?'此块尚未返回':'正在读取对比…'}</span>`}</div><span class="cmp-tag" id="cmp-tag">${FX.side==='input'?'输入（含重叠）':'模型原始返回'}</span></div><p class="fx-cap">${c?`输入 ${c.input_size.join('×')} · 输出 ${c.output_size?.join('×')||'未返回'} · `:''}${esc(x.reason)}</p>`;}
    return `<div class="fx-stage bounded-map pane-${FX.pane}" data-layout="aspect-ratio:${w}/${h}"><img src="${esc(d.images[FX.pane])}" alt="${PANE_CAP[FX.pane]}"><canvas data-failure-map tabindex="0" role="img" aria-label="诊断切图，点击图块选择"></canvas></div><p class="fx-cap">${PANE_CAP[FX.pane]} · 点击切图选择，或在下方按编号选择</p>`;}
  async function compareTile(i){const id=FX.jid,version=failureVersion;FX.cmp=i;FX.side='output';FX.comparison=null;fxRender();const d=await api(`/api/upscale/jobs/${id}/comparison?level=${FX.level}&tile=${i}`);if(FX.jid!==id||FX.cmp!==i||failureVersion!==version||!FX.screen?.isConnected||FX.screen.style.pointerEvents==='none')return;FX.comparison=d;fxRender(FX.screen);$('#fx-view',FX.screen)?.scrollIntoView({block:'start',behavior:RM?'auto':'smooth'});}
  async function fxSubmit(){const el=topScreen(),btn=$('#fx-go',el);if(!FX.sel.size)return;btn.disabled=true;try{const selected=[...FX.sel].sort((a,b)=>a-b);await post(`/api/upscale/jobs/${FX.jid}/redraw`,{level:FX.level,tiles:selected,repair_request:$('#fx-inj',el).value.trim(),repair_template_source:FX.latest?'current':'task',append_system:FX.appendSystem});const bid=FX.bid;await back();await refreshData();S.expanded.add(bid);goBatch(bid);toast(`${selected.length} 块已加入重绘，其余图块保留`);}finally{btn.disabled=false;}}
  function download(id){const im=assets.get(id);if(!im)throw new Error('图片不存在');return StudioDownloads.open(im);}
  async function performAction(k,a,e){const id=a.dataset.id;
    switch(k){
      case 'boot-retry':await boot();break;
      case 'avatar-edit':StudioAvatar.open({api,current:()=>account.avatar_url,updated:url=>{account.avatar_url=url;$$('[data-user-avatar]').forEach(el=>el.innerHTML=avatar());},report});break;
      case 'accent-set':S.settings.appearance.accent=a.dataset.color;paintAccent();await settingChanged('appearance.accent');break;
      case 'settings':await back();openSettings();break;
      case 'params-reset':Object.assign(S.composer,defaultComposer(),{prompt:S.composer.prompt,refs:S.composer.refs,template:S.composer.template,ack:S.composer.ack});if(a.closest('.sheet-layer'))swapSheet(a.closest('.sheet-layer'),null,paramsBody());refresh();toast('已恢复默认参数');break;
      case 'params-default':{const c=S.composer;Object.assign(S.settings.defaults,{ratio:c.ratio,count:c.count,size:c.size,polish:c.polish,transparent:c.transparent,stitch:c.stitch,effort:c.effort});config.model=c.model;await settingChanged('defaults');toast('已设为默认',{action:'去设置',run:()=>closeOverlays().then(()=>openSettings('set-defaults'))});break;}
      case 'pe-save':{const key=a.dataset.k,text=$('#pe-text').value;if(text.trim().length<20||!text.includes('{prompt}'))throw new Error('至少 20 字符，且必须包含 {prompt}');const old=S.settings.prompts[key];S.settings.prompts[key]=text;try{await settingChanged('prompts');await back();const badge=$('#pb-'+key);if(badge)badge.innerHTML=promptBadge(key);toast('已保存，只影响之后的新任务');}catch(e){S.settings.prompts[key]=old;}break;}
      case 'inj-save':S.settings.upscale.injection=$('#inj-text').value.trim();await settingChanged('upscale.injection');await back();{const r=$('[data-act="inj-edit"] .s-r',topScreen());if(r)r.innerHTML=esc(S.settings.upscale.injection.slice(0,12))+'…'+icon('chevr',16);}break;
      case 'sessions':await post('/api/account/revoke-sessions');account=await api('/api/account');a.querySelector('.s-r').innerHTML='0 台'+icon('chevr',16);toast('其他设备已退出');break;
      case 'password':passwordSheet();break;
      case 'account-edit':accountEditor();break;
      case 'reconnect':case 'reconnect-set':await connection();break;
      case 'probe':confirmSheet('运行生图检查','会提交一次真实生图检查并使用额度。','开始检查',async()=>{const d=await post('/api/setup/probe');await refreshData();toast('检查已加入任务');});break;
      case 'pause':case 'unpause':await api('/api/settings',{method:'PATCH',body:{paused:k==='unpause'?false:!S.paused}});await refreshData();break;
      case 'cache-clear':if(!a.classList.contains('danger-soft')){a.classList.add('danger-soft');a.textContent='确认清理？';setTimeout(()=>{if(a.isConnected){a.classList.remove('danger-soft');a.textContent='清理';}},3000);break;}await StudioImages.clear();S.settings.cache={mb:0,files:0};await refreshSettings(topScreen());a.classList.remove('danger-soft');a.textContent='已清理';toast('本机图片缓存已清理');break;
      case 'storage-limit':{const value=Number($('#storage-limit',topScreen()).value);if(!Number.isFinite(value)||value<0)throw new Error('请输入有效的存储上限');await api('/api/settings',{method:'PATCH',body:{storage_limit_bytes:Math.round(value*1073741824)}});await refreshSettings(topScreen());toast('存储上限已保存');break;}
      case 'empty-trash':{const parent=topScreen();confirmSheet('清空回收站','永久删除最近删除中的图片与列表，释放服务器空间。','永久清空',async()=>{await post('/api/storage/empty-trash',{confirm:'empty-trash'});await refreshData();if(parent?.isConnected){await trashRefresh.get(parent)?.();await refreshSettings(parent);}toast('回收站已清空');});break;}
      case 'clear-task-cache':confirmSheet('清理超分任务缓存','删除中间图、补绘检查点与工作文件，保留原图、最终作品、任务记录与日志。清理后重试需要重新执行补绘。','清理缓存',async()=>{await post(`/api/upscale/jobs/${id}/clear-cache`);details.delete(id);await refreshData();await refreshSettings(topScreen());toast('任务缓存已清理');});break;
      case 'trash':await trash();break;
      case 'install':if(installPrompt){await installPrompt.prompt();installPrompt=null;}else openSheet({title:'安装应用',html:'<p class="note">在浏览器菜单中选择“安装应用”或“添加到主屏幕”。iPhone 请在 Safari 的分享菜单中选择“添加到主屏幕”。</p><a class="primary" href="/downloads/image-studio.apk" download>下载 Android 安装包</a>'});break;
      case 'logout':await post('/api/auth/logout');authenticated=false;clearTimeout(polling);await StudioImages.clear();assets.clear();jobs.clear();batchMap.clear();details.clear();knownStates.clear();login();break;
      case 'tpl-new':tplSaveForm(null);break;
      case 'tpl-save-form':tplSaveForm(a.closest('.sheet-layer'));break;
      case 'tpl-edit':tplSaveForm(a.closest('.sheet-layer'),id);break;
      case 'tpl-preview-ref':openViewer(id,null,{reference:true,ids:[...(tpl(a.dataset.templateId)?.referenceIds||[id])]});break;
      case 'tpl-save':{const t=id&&tpl(id),c=S.composer,L=a.closest('.sheet-layer');const data=await api('/api/templates'+(id?'/'+id:''),{method:id?'PUT':'POST',body:{title:$('#tpl-name',L).value.trim(),text:$('#tpl-text',L).value.trim(),refs:L.dataset.templateRefs?JSON.parse(L.dataset.templateRefs):(t?t.referenceIds:c.refs),options:t?t.options:{ratio:ratio(c.ratio),size:size(c.size),polish:c.polish,transparent:c.transparent,stitch:factor(c.stitch),model:c.model,effort:c.effort}}});if(!t&&$('#bind-sw',L)?.classList.contains('on')){c.template=data.id;c.ack=false;}await back();await refreshData();refresh();flashChip();toast('模板已保存');break;}
      case 'tpl-rm-ref':{const L=a.closest('.sheet-layer');L.dataset.templateRefs=JSON.stringify(JSON.parse(L.dataset.templateRefs||'[]').filter(x=>x!==id));a.closest('.ref').remove();break;}
      case 'tpl-delete':confirmSheet('删除模板','删除模板后，已有作品与任务记录仍会保留。','删除模板',async()=>{await api('/api/templates/'+id,{method:'DELETE'});if(S.composer.template===id)S.composer.template=null;await refreshData();toast('模板已删除');});break;
      case 'coll-more':{const c=coll(S.coll);openSheet({html:`<div class="sheet-hd"><div><b>${esc(c.name)}</b><span>${c.image_count} 张</span></div></div>${c.template?`<button class="menu-row" data-act="tpl-load" data-id="${c.template}">${icon('book',20)}<span>载入该模板去创作</span></button>`:''}<button class="menu-row" data-act="coll-rename" data-id="${c.id}">${icon('edit',20)}<span>重命名</span></button><div class="menu-sep"></div><button class="menu-row danger" data-act="coll-delete" data-id="${c.id}">${icon('trash',20)}<span>删除列表</span><span class="rt">进行中的任务不受影响</span></button>`});break;}
      case 'coll-rename':{const L=a.closest('.sheet-layer');swapSheet(L,'重命名列表',`<input class="input" id="coll-name" maxlength="120" value="${esc(coll(id).name)}"><button class="primary" data-act="coll-rename-save" data-id="${id}">保存</button>`);break;}
      case 'coll-rename-save':await api('/api/collections/'+id,{method:'PATCH',body:{name:$('#coll-name').value}});await back();await refreshData();if(S.coll===id)renderPage();break;
      case 'coll-delete':await api('/api/collections/'+id,{method:'DELETE'});await closeOverlays();if(S.coll)await back();await refreshData();toast('列表已移到最近删除');break;
      case 'collection-more':a.disabled=true;try{await loadCollection(id,true);}finally{a.disabled=false;}break;
      case 'batch-more':a.disabled=true;try{await fetchBatches(batchOffset);projectImages();projectBatches();refresh();}finally{a.disabled=false;}break;
      case 'retry-coll':for(const b of S.batches.filter(b=>b.coll===S.coll))await batchOperation(b.id,'retry');break;
      case 'cancel-task':await batchOperation(a.dataset.b,'cancel',a.dataset.t);break;
      case 'cancel-batch':await batchOperation(id,'cancel');break;
      case 'retry-task':await batchOperation(a.dataset.b,'retry',a.dataset.t);break;
      case 'retry-batch':await batchOperation(id,'retry');break;
      case 'retry-job':await post('/api/jobs/'+id+'/retry');await back();await refreshData();break;
      case 'log':{const jid=a.dataset.t||S.batches.find(b=>b.id===a.dataset.b)?.tasks.find(t=>t.status==='failed')?.id||id;await taskInfo(jid,true);break;}
      case 'task-info':await taskInfo(id);break;
      case 'im-native':await back();StudioZoom.toggleNative(true);break;
      case 'v-dl':download(V.list[V.i]);break;
      case 'im-dl':download(id);break;
      case 'works-tab':{const tab=a.dataset.v;if(!['generated','references','favorites'].includes(tab))break;if(StudioSelection.active())await StudioSelection.leave();S.worksTab=tab;renderPage();if(tab!=='generated')await loadWorks(tab);break;}
      case 'works-more':await loadWorks(S.worksTab,workState(S.worksTab).ready&&!workState(S.worksTab).error);break;
      case 'im-fav':rememberAsset(await api('/api/assets/'+id,{method:'PATCH',body:{favorite:!assets.get(id).fav}}));projectImages();await back();if(S.worksTab==='favorites')await loadWorks('favorites');if(!V.open)refresh();toast(assets.get(id).fav?'已收藏':'已取消收藏');break;
      case 'copy-prompt':await navigator.clipboard.writeText(assets.get(id)?.prompt||'');toast('提示词已复制');break;
      case 'rd-submit':a.disabled=true;try{await redraw();}finally{if(a.isConnected)a.disabled=false;}break;
      case 'up-f':{const L=a.closest('.sheet-layer');L.dataset.f=a.dataset.v;$$('#upo .opt',L).forEach(b=>b.classList.toggle('on',b===a));paintSheetPlan(L);break;}
      case 'up-go':a.disabled=true;try{const L=a.closest('.sheet-layer');await startUpscale(id,L.dataset.f,$('#up-inj',L).value.trim(),null,L.dataset.promptScope);await back();}finally{a.disabled=false;}break;
      case 'up-start':{if(!S.upc.src)throw new Error('先选择要超分的原图');if(!getPlan(assets.get(S.upc.src),S.upc.factor)?.stages)throw new Error('请等待切图预算计算完成');a.disabled=true;try{const f=S.upc.factor;await startUpscale(S.upc.src,f,$('#cu-inj').value.trim(),()=>{if(!a.isConnected)return;$('#gen-done').textContent='已加入 '+f;a.classList.add('done');flyDot(a,$('.tab[data-tab="queue"] .ti'));setTimeout(()=>a.classList.remove('done'),1700);});}finally{a.disabled=false;}break;}
      case 'up-detail':await upDetail(id,a.dataset.inspectOnly==='true');break;
      case 'failure':await closeOverlays();await openFailure(a.dataset.t||id);break;
      case 'failure-job':await closeOverlays();await openFailure(id);break;
      case 'fx-cmp':await compareTile(+a.dataset.i);break;
      case 'fx-go':await fxSubmit();break;
      case 'model-select':{S.composer.model=id;const m=models.find(m=>m.id===id);if(!m.efforts.includes(S.composer.effort))S.composer.effort=m.default_effort;await back();const L=topSheet();if(L)swapSheet(L,null,paramsBody());refresh();break;}
      case 'model-quick':openSheet({title:'速改模型',html:`<button class="menu-row" data-act="model-quick-save" data-id="">${icon('sparkle',20)}<span>跟随生成设置</span></button>`+models.map(m=>`<button class="menu-row" data-act="model-quick-save" data-id="${m.id}">${icon('sparkle',20)}<span>${esc(m.name)}</span></button>`).join('')});break;
      case 'model-quick-save':{S.settings.quick.model=id||null;const m=models.find(m=>m.id===(id||config.model));if(!m.efforts.includes(S.settings.quick.effort))S.settings.quick.effort=m.default_effort;await settingChanged('quick.model');await back();const el=topScreen();if(el){const scroll=$('.scroll',el).scrollTop;el.innerHTML=settingsHTML();hydrateIcons(el);$('.scroll',el).scrollTop=scroll;refreshSettings(el);}break;}
      case 'model-settings':case 'model-composer':openSheet({title:'选择模型',html:models.map(m=>`<button class="menu-row" data-act="${k==='model-settings'?'model-default':'model-select'}" data-id="${m.id}">${icon('sparkle',20)}<span>${esc(m.name)}</span><span class="rt">${(k==='model-settings'?config.model:S.composer.model)===m.id?'当前':''}</span></button>`).join('')});break;
      case 'model-default':{config.model=id;const m=models.find(m=>m.id===id);if(!m.efforts.includes(S.settings.defaults.effort))S.settings.defaults.effort=m.default_effort;if(!S.settings.quick.model&&!m.efforts.includes(S.settings.quick.effort))S.settings.quick.effort=m.default_effort;await settingChanged('defaults');await back();const el=topScreen();if(el){const scroll=$('.scroll',el).scrollTop;el.innerHTML=settingsHTML();hydrateIcons(el);$('.scroll',el).scrollTop=scroll;refreshSettings(el);}break;}
      default:return false;
    }
    saveDraft();return true;
  }
  const guardedActions=new Set(['tpl-save','tpl-delete','pe-save','inj-save','storage-limit','sessions','pause','unpause','retry-task','retry-batch','retry-job','retry-coll','cancel-task','cancel-batch','coll-rename-save','coll-delete','up-go','up-start','rd-submit','fx-go','fx-cmp','task-info','log','up-detail','failure','failure-job','collection-more','batch-more','works-tab','works-more','im-fav','copy-prompt','cache-clear','logout','model-default','model-quick-save','params-default','accent-set']);
  async function action(k,a,e){if(!guardedActions.has(k))return performAction(k,a,e);const key=StudioFeedback.keyFor(a);if(StudioFeedback.busy(key))return true;return StudioFeedback.run(key,a,()=>performAction(k,a,e));}
  app.addEventListener('input',e=>{if(e.target.id==='accent-custom'){S.settings.appearance.accent=e.target.value;StudioTheme.apply(S.settings.appearance);paintAccent();}});
  app.addEventListener('change',e=>{if(e.target.id==='accent-custom')settingChanged('appearance.accent');});
  globalThis.studioBack=()=>{if(/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||'')){document.activeElement.blur();return true;}if(layers.length){back();return true;}return false;};
  function keyboardViewport(){const v=globalThis.visualViewport,editing=/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||'');if(v&&editing&&innerHeight-v.height>120){app.style.setProperty('--studio-vh',v.height+'px');app.style.setProperty('--studio-vv-top',Math.max(0,v.offsetTop)+'px');}else{app.style.removeProperty('--studio-vh');app.style.removeProperty('--studio-vv-top');}}
  globalThis.visualViewport?.addEventListener('resize',keyboardViewport);globalThis.visualViewport?.addEventListener('scroll',keyboardViewport);document.addEventListener('focusin',keyboardViewport);document.addEventListener('focusout',()=>requestAnimationFrame(keyboardViewport));
  addEventListener('online',()=>refreshData().catch(report));addEventListener('offline',()=>{S.offline=true;updateChrome();});
  addEventListener('beforeinstallprompt' ,e=>{e.preventDefault();installPrompt=e;});
  app.addEventListener('input',saveDraft);app.addEventListener('click',()=>setTimeout(saveDraft,0));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&authenticated)refreshData().catch(report);});
  const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(report);
  return {boot,api,report,action,makeUp,planHTML,settingsHTML,avatar,setComposerRefs,saveDraft,taskInfo,cloneUpscale,username:()=>account.username||"",requestedRatio:id=>labelRatio(jobs.get(assets.get(id)?.job_id)?.options.ratio||"auto"),settingChanged,refreshSettings,modelName,models:()=>models,config:()=>config,loadCollection,batchMore:()=>batchOffset<batchTotal,
    generate:safe(generate),reroll:safe(reroll),deleteImage:safe(deleteImage),loadTemplate:safe(loadTemplate),infoSheet:safe(infoSheet),upscaleSheet,pickerSheet:safe(pickerSheet),meSheet,tplSheet,tplSaveForm,openFailure:safe(openFailure),fxView,fxSubmit:safe(fxSubmit),sendQuick,editImage,
    workItems,workState,loadWorks,bulkAssets,stop(){stopped=true;clearTimeout(polling);}};
})();
const studioReady=StudioService.boot();
