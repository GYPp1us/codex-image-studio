"use strict";
globalThis.StudioFolders=(function folders(){
  const pages=new Map(),nodes=new Map(),originNames=new Map(),anchors=new Map(),expanded=new Set(['']),pendingFrame=new WeakMap();
  const root={id:'',name:'作品'},key=()=>S.coll||'',flow=k=>k.startsWith('~');
  let observer,revision=0,backFrame=false,serverRevision=null,dirty=false;
  function page(k){
    if(!pages.has(k))pages.set(k,{folders:[],assets:[],tasks:{},errors:{},loaded:{},total:{},rev:0});
    return pages.get(k);
  }
  function node(id){return id?nodes.get(id):root;}
  function remember(f){
    const prev=nodes.get(f.id);
    nodes.set(f.id,{...prev,...f,template:f.template_id||null});
  }
  function path(k){
    if(flow(k))return [root,{id:k,name:k==='~all'?'全部作品':k==='~inbox'?'待整理':`来源 · ${tpl(k.slice(8))?.name||originNames.get(k.slice(8))||node('tpl-'+k.slice(8))?.name||(k.slice(8)?'历史模板':'无模板')}`}];
    const result=[],visited=new Set();
    let f=node(k);
    while(f?.id&&!visited.has(f.id)){result.unshift(f);visited.add(f.id);f=node(f.parent_id);}
    return [root,...result];
  }
  function button(act,label,symbol,id='',extra=''){
    return `<button type="button" class="icon-btn dir-icon" data-dir="${act}" data-id="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${icon(symbol,20)}</button>`;
  }
  function crumbs(k){
    const trail=path(k);
    return `<nav aria-label="目录路径" class="dir-crumbs">${trail.map((n,i)=>`${i?'<span aria-hidden="true">›</span>':''}<button type="button" data-dir="ancestor" data-id="${esc(n.id)}" ${i===trail.length-1?'aria-current="page"':''}>${esc(n.name)}</button>`).join('')}${trail.length>2?button('path','完整路径','more'):''}</nav>`;
  }
  function url(k,type,offset,limit){
    const mode=k==='~all'?'all':k==='~inbox'?'inbox':k.startsWith('~origin:')?'origin':'folder';
    return `/api/library?view=${mode}&part=${type}&folder=${encodeURIComponent(flow(k)?'':k)}&origin=${encodeURIComponent(mode==='origin'?k.slice(8):'')}&${type==='assets'?'asset_offset':'folder_offset'}=${offset}&limit=${limit}`;
  }
  function active(){return S.tab==='works'&&(!!S.coll||S.worksTab==='generated');}
  function currentPart(k,t){return active()&&(key()===k||(!key()&&k==='~all'&&t==='assets'));}
  function load(k,type,more=false,limit=30,force=false){
    const p=page(k);
    if(p.tasks[type])return p.tasks[type];
    if(!more&&!force&&p.loaded[type])return Promise.resolve(p);
    if(more&&p.loaded[type]&&p[type].length>=p.total[type])return Promise.resolve(p);
    const offset=more?p[type].length:0;
    const request=StudioService.api(url(k,type,offset,limit),{background:true}).then(data=>{
      if(p.tasks[type]!==request)return p;
      (data.path||[]).forEach(remember);
      const list=data[type]||[];
      if(type==='folders')list.forEach(remember);else StudioService.ingestLibrary(list);
      const ids=list.map(x=>x.id);
      if(!more&&force&&p[type].length>limit&&ids.join()===p[type].slice(0,limit).join()){
        p[type]=p[type].slice(0,data[type==='assets'?'asset_total':'folder_total']);
      }else p[type]=[...new Set(more?[...p[type],...ids]:ids)];
      p.total[type]=data[type==='assets'?'asset_total':'folder_total'];p.loaded[type]=true;delete p.errors[type];p.rev++;revision++;
      return p;
    }).catch(error=>{
      if(error.name!=='AbortError'&&p.tasks[type]===request){p.errors[type]=error.message;p.rev++;if(currentPart(k,type))StudioService.pageConnection(false);}
      throw error;
    }).finally(()=>{
      if(p.tasks[type]===request)delete p.tasks[type];
      if(currentPart(k,type))draw();
    });
    p.tasks[type]=request;return request;
  }
  function required(k,force=false){
    const tasks=[];
    if(!flow(k))tasks.push(load(k,'folders',false,30,force));
    if(k)tasks.push(load(k,'assets',false,30,force));
    else tasks.push(load('~all','assets',false,10,force));
    return Promise.all(tasks).then(()=>{if(currentPart(k,'assets'))StudioService.pageConnection(true);});
  }
  function card(id){
    const f=node(id),covers=f.covers||[];
    return `<button class="coll dir-card" data-dir="open" data-id="${esc(id)}"><span class="cover n${covers.length}">${covers.length?covers.map(a=>`<img src="/media/${encodeURIComponent(a)}?thumbnail=1" loading="lazy" decoding="async" alt="">`).join(''):icon('folder',30)}</span><span class="coll-name">${esc(f.name)}</span><span class="coll-meta">${f.template_id?icon('book',14):''}${f.image_count??0} 张</span></button>`;
  }
  function layout(){
    const k=key(),normal=!flow(k);
    const actions=button('tree','目录树','layers')+(normal?button('create','新建文件夹','folderplus'):'')+button('select','选择作品','select')+(flow(k)?button('filter','筛选作品来源','sliders'):'')+(k&&normal?button('menu','文件夹操作','more',k):'');
    const tabs=!k?`<div class="seg" id="works-seg"><span class="ind"></span>${[['generated','作品'],['references','参考图'],['favorites','收藏']].map(([id,name])=>`<button class="${S.worksTab===id?'on':''}" data-act="works-tab" data-v="${id}">${name}</button>`).join('')}</div>`:'';
    return `${topBar(k?esc(node(k)?.name||path(k).at(-1)?.name||'作品'):'作品',actions).replace('<h1>',k&&normal?`<span class="dir-hero">${node(k)?.covers?.[0]?`<img src="/media/${encodeURIComponent(node(k).covers[0])}?thumbnail=1" alt="">`:icon('folder',18)}</span><h1>`:'<h1>')}<div class="dir-workspace"><aside class="dir-side" aria-label="作品目录"></aside><div class="scroll dir-scroll">${tabs}<div id="dir-path"></div>${!k?`<div class="section-h"><h2>最近生成</h2>${button('all','查看全部作品','chevr')}</div><div class="recent" id="recent"></div>`:''}${normal?'<div class="colls" id="colls"></div><div data-more-slot="folders"></div>':''}<div class="grid" id="grid"></div><div data-more-slot="assets"></div><div id="dir-empty"></div></div></div>`;
  }
  function moreButton(k,type){
    const p=page(k);
    if(p.errors[type])return `<button class="secondary" data-dir="retry" data-type="${type}">${esc(p.errors[type])} · 重试</button>`;
    return p.loaded[type]&&p[type].length<p.total[type]?button('more','加载更多','chevd',k,`data-type="${type}"`):'';
  }
  function setHTML(el,html){if(el&&el._dirHTML!==html){el.innerHTML=html;el._dirHTML=html;}}
  function treeHTML(parent='',depth=0,selected=key()){
    const p=page(parent);
    return p.folders.map(id=>{const f=node(id);return `<div class="dir-branch"><div class="dir-tree-row">${button('expand',expanded.has(id)?'收起':'展开',expanded.has(id)?'chevd':'chevr',id,`aria-expanded="${expanded.has(id)}"`)}<button class="dir-tree-name" data-dir="open" data-id="${esc(id)}" ${id===selected?'aria-current="page"':''}>${icon(f.template_id?'book':'folder',16)}${esc(f.name)}</button></div>${expanded.has(id)?treeHTML(id,depth+1,selected):''}</div>`;}).join('')+(p.folders.length<p.total.folders?button('tree-more','更多文件夹','chevd',parent):'');
  }
  function draw(){
    const box=$('#page .dir-workspace');if(!box||!active()||pendingFrame.has(box))return;
    const schedule=()=>requestAnimationFrame(()=>{
      pendingFrame.delete(box);
      if(!box.isConnected||!active())return;
      const k=key(),p=page(k),recent=page('~all');
      if(StudioSelection.sweeping?.()&&!StudioSelection.canAppend?.())return;
      const token=[k,p.rev,recent.rev,revision].join('/');
      if(box.dataset.paint===token)return;
      box.dataset.paint=token;
      setHTML($('#dir-path',box),crumbs(k));
      if(!flow(k))syncList($('#colls',box),p.folders,id=>id,card);
      if(!k)syncList($('#recent',box),recent.assets.slice(0,10),id=>id,id=>tileHTML(img(id),'dir-recent'));
      syncList($('#grid',box),p.assets,id=>id,id=>tileHTML(img(id),'directory'));
      for(const el of $$('[data-more-slot]',box))setHTML(el,moreButton(k,el.dataset.moreSlot));
      setHTML($('#dir-empty',box),k&&!flow(k)&&p.loaded.assets&&p.loaded.folders&&!p.folders.length&&!p.assets.length?button('add','添加已有作品','imgplus',k):'');
      if(globalThis.matchMedia?.('(min-width: 860px)').matches)setHTML($('.dir-side',box),treeHTML());
      const heading=$('#page .top h1');if(k&&heading)heading.textContent=node(k)?.name||path(k).at(-1)?.name||'作品';
      StudioSelection.paint();
      if(typeof IntersectionObserver!=='undefined'){
        observer?.disconnect();
        observer=new IntersectionObserver(entries=>{for(const {target,isIntersecting} of entries)if(isIntersecting&&target.isConnected)load(k,target.dataset.type,true).catch(()=>{});},{root:$('.dir-scroll',box),rootMargin:'120px'});
        for(const el of $$('[data-dir="more"]',box))observer.observe(el);
      }
      restore(box,k);
    });
    pendingFrame.set(box,true);
    if(pageTransition)pageTransition.finished.catch(()=>{}).then(schedule);else schedule();
  }
  function mount(){
    if(!active())return;
    const box=$('#page .dir-workspace');if(!box)return;
    if(!box.dataset.mounted){box.dataset.mounted='1';box.dataset.restore='1';required(key()).catch(()=>{});if(key()&&globalThis.matchMedia?.('(min-width: 860px)').matches)load('','folders').then(()=>{revision++;draw();}).catch(()=>{});}
    draw();
  }
  function saveAnchor(){
    const scroller=$('#page .scroll');if(!scroller)return;
    const y=scroller.getBoundingClientRect().top;
    const first=$$('.dir-card,.tile',scroller).find(el=>el.getBoundingClientRect().bottom>y);
    anchors.set([S.tab,S.worksTab,key()].join('/'),{top:scroller.scrollTop,id:first?.dataset.id,delta:first?first.getBoundingClientRect().top-y:0});
  }
  function restore(box,k){
    if(box.dataset.restore!=='1')return;
    const a=anchors.get([S.tab,S.worksTab,k].join('/'));if(!a){box.dataset.restore='';return;}
    const scroller=$('.dir-scroll',box),el=a.id&&[...scroller.querySelectorAll('[data-id]')].find(e=>e.dataset.id===a.id);
    if(el){scroller.scrollTop+=el.getBoundingClientRect().top-scroller.getBoundingClientRect().top-a.delta;box.dataset.restore='';}
    else scroller.scrollTop=a.top;
  }
  async function open(id){
    await closeOverlays();
    if(id===key()&&S.tab==='works'&&S.worksTab==='generated')return;
    saveAnchor();
    const previous={tab:S.tab,worksTab:S.worksTab,coll:S.coll};
    pushLayer('coll',()=>{
      Object.assign(S,previous);
      if(!backFrame){backFrame=true;queueMicrotask(()=>{backFrame=false;vt('pop',renderPage);});}
    });
    layers.at(-1).directory=id;layers.at(-1).fromDirectory=previous.tab==='works'&&previous.worksTab==='generated'?(previous.coll||''):null;
    const cover=$$('#page .dir-card').find(el=>el.dataset.id===id)?.querySelector('.cover');
    const shared=cover&&!RM&&cover.getBoundingClientRect().bottom>0&&cover.getBoundingClientRect().top<document.documentElement.clientHeight;
    if(shared)cover.style.viewTransitionName='directory-cover';
    let hero;
    return vt('push',()=>{S.tab='works';S.worksTab='generated';S.coll=id||null;renderPage();hero=$('#page .dir-hero');if(hero&&shared)hero.style.viewTransitionName='directory-cover';})
      .finally(()=>{if(hero)hero.style.viewTransitionName='';if(cover)cover.style.viewTransitionName='';});
  }
  async function ancestor(id){
    if(id===key())return;
    await closeOverlays();
    const ix=layers.findLastIndex(l=>l.type==='coll'&&l.directory===id);
    if(ix>=0)return traverseHistory(()=>layers.length-1-ix);
    if(!id&&layers[0]?.type==='coll'&&layers[0].fromDirectory==='')return traverseHistory(()=>layers.length);
    return open(id);
  }
  function invalidate(){
    for(const p of pages.values()){p.tasks={};p.loaded={};p.errors={};p.rev++;}
    revision++;
    return active()?required(key()):Promise.resolve();
  }
  function resume(){
    for(const p of pages.values())p.tasks={};
    return active()?required(key(),true):Promise.resolve();
  }
  return {active,layout,mount,draw,open,ancestor,page,node,path,button,crumbs,load,treeHTML,expanded,invalidate,resume,
    rememberOrigins(items){for(const item of items)originNames.set(item.id,item.title);},
    observeRevision(value){if(value==null)return;const old=serverRevision;serverRevision=value;if(old!=null&&old!==value){if(StudioSelection.active())dirty=true;else invalidate().catch(()=>{});}},
    changed(){revision++;if(dirty&&!StudioSelection.active()){dirty=false;invalidate().catch(()=>{});}draw();},items:kind=>kind==='dir-recent'?page('~all').assets.slice(0,10):page(key()).assets,
    reset(){observer?.disconnect();pages.clear();nodes.clear();originNames.clear();anchors.clear();expanded.clear();expanded.add('');serverRevision=null;dirty=false;revision++;}};
})();
