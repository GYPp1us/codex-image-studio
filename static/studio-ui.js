/* UI transplanted from PR #1 demo. Data/actions live in studio-service.js. */

"use strict";
/* ================= utils ================= */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const sysRM=matchMedia("(prefers-reduced-motion: reduce)").matches;let RM=sysRM;
const D=ms=>RM?1:ms;
const E={std:"cubic-bezier(.2,.8,.2,1)",emph:"cubic-bezier(.32,.72,0,1)",exit:"cubic-bezier(.4,0,1,1)"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
let uidN=0;const uid=p=>p+(++uidN).toString(36)+Math.random().toString(36).slice(2,6);
const app=$("#app");
const sc=()=>app.getBoundingClientRect().width/app.offsetWidth;
function rectOf(el){const r=el.getBoundingClientRect(),a=app.getBoundingClientRect(),s=sc();return{x:(r.left-a.left)/s,y:(r.top-a.top)/s,w:r.width/s,h:r.height/s};}
const pad=n=>String(n).padStart(2,"0");
const fmtTime=t=>{const d=new Date(t);return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;};

const P={
  sparkle:'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  layers:'<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 12.5l10 5 10-5"/><path d="M2 17l10 5 10-5"/>',
  list:'<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  chevr:'<path d="M9 6l6 6-6 6"/>',chevd:'<path d="M6 9l6 6 6-6"/>',back:'<path d="M15 18l-6-6 6-6"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',check:'<path d="M5 12.5l4.5 4.5L19 7"/>',
  download:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  imgplus:'<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/><path d="M16 5h6M19 2v6"/><path d="M21 16l-5-5L5 21"/><circle cx="9" cy="9" r="2"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
  select:'<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M9 12h6M12 9v6"/>',
  grid:'<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4.5M12 8h.01"/>',
  more:'<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  star:'<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sliders:'<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert:'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  user:'<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',code:'<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12"/>',
  archive:'<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  logout:'<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  phone:'<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  upload:'<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  arrowup:'<path d="M12 19V5M6 11l6-6 6 6"/>',
  doc:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
};
const icon=(n,s=22)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]||""}</svg>`;
function hydrateIcons(root=document){StudioLayout.hydrate(root);$$("[data-ic]",root).forEach(e=>{if(e.firstChild)return;const m=e.dataset.ic.match(/^([a-z]+)(\d*)$/);e.innerHTML=icon(m[1],m[2]?+m[2]:e.classList.contains("qe-send")?18:22);});}

const RATIO={"1:1":1,"3:2":1.5,"2:3":2/3,"16:9":16/9,"9:16":9/16,"自动":1};
const src=im=>im?.thumbnail||im?.preview||im?.url||"";
const picture=im=>im?.preview||im?.thumbnail||im?.url||"";
/* ================= state ================= */
const DEFAULT_PROMPTS={
  call:"使用内置生图工具生成一张图片。\n画面要求：{prompt}\n画幅：{ratio} · 尺寸：{size}\n只返回图片，不执行其他操作。",
  polish:"先为下面的画面补全构图、层次、光线、配色与风格标签，再调用生图工具：\n{prompt}",
  tile:"这是超分第 {tile_index}/{tile_count} 块，范围 {bounds}，目标尺寸 {target_size}。\n只增加细节，保持所有边界与元素位置不变。\n原始要求：{prompt}\n统一约束：{injection}"};
const PROMPT_META={call:["外层调用提示词",["{prompt}","{ratio}","{size}"]],polish:["帮我润色提示词",["{prompt}"]],tile:["超分 · 分块重绘提示词",["{prompt}","{target_size}","{tile_index}","{tile_count}","{bounds}","{injection}"]]};
const S={tab:"create",coll:null,filter:"active",expanded:new Set(),paused:false,offline:false,worksScroll:0,worksTab:"generated",worksScrolls:{},
  images:[],batches:[],templates:[],collections:[],library:[],
  composer:{prompt:"",template:null,refs:[],ratio:"3:2",count:3,size:"自动",polish:false,transparent:false,stitch:"关",effort:"xhigh",ack:false},
  mode:"gen",upc:{src:null,factor:"16×",inj:""},
  settings:{concurrency:2,maxAttempts:3,notify:true,motion:"system",
    defaults:{ratio:"3:2",count:3,effort:"xhigh",polish:false},
    quick:{effort:"medium",keepSpec:true,useRef:true,into:"same",notify:true},
    upscale:{factor:"16×",autoSelect:true,injection:""},
    prompts:{...DEFAULT_PROMPTS},cache:{mb:0,files:0}}};
const STAGE=["正在传递","主模型正在思考","等待生图返回","正在回传"];
const KIND={image:"生成",redraw:"局部重绘",upscale:"超分",reroll:"再抽",quick:"速改"};
const TSTATE={done:"正常",offset:"偏移",untrusted:"低可信",coverage:"覆盖缺失",missing:"未返回",running:"补绘中",queued:"等待"};
const img=id=>S.images.find(i=>i.id===id)||S.library.find(i=>i.id===id);
const coll=id=>S.collections.find(c=>c.id===id);
const tpl=id=>S.templates.find(t=>t.id===id);
const imagesOf=cid=>S.images.filter(i=>i.coll===cid);
/* ---- progressive upscale model (mirrors upscale_workflow.py) ---- */
const FACTORS={"4×":1,"16×":2,"64×":3};
function makeUp(...args){return StudioService.makeUp(...args);}
function upError(t){return t.err||"验收未通过";}
function upIssues(t){const bad=t.up?.levels[t.up.cur]?.tiles.filter(x=>x.state!=="done")||[];return bad.length?bad.map(x=>`第 ${x.i+1} 块：${x.reason||TSTATE[x.state]}`):[t.err||"请查看任务日志"]; }
const tileGrid=(t,big)=>{const lv=t.up.levels[t.up.cur];return `<span class="tg${big?" big":""}" data-layout="grid-template-columns:repeat(${lv.grid[0]},1fr)">${lv.tiles.map(x=>`<i data-s="${x.state}"></i>`).join("")}</span>`;};
function upLabel(t){return t.raw?.progress?.label||"等待调度";}
const units=t=>t.up?t.up.levels[t.up.cur].tiles.map(x=>({status:x.state,stage:x.stage})):t.multi?t.multi.parts.map(x=>({status:x.state,stage:x.stage})):[t];
const pctOf=x=>x.status==="running"?Math.round((Math.min(x.stage,3)+.5)/4*100):x.status==="queued"||x.status==="cancelled"?0:100;
const segBar=(list,w)=>`<span class="bbar${list.length>10?" dense":""}"${w?` data-layout="width:${w}px"`:""}>${list.map(x=>`<i data-st="${x.status}" data-layout="--p:${pctOf(x)}%"></i>`).join("")}</span>`;
function multiLabel(t){const m=t.multi,n=m.parts.length,done=m.parts.filter(x=>x.state==="done").length,run=m.parts.filter(x=>x.state==="running").length;
  if(t.status==="queued")return S.paused?"已暂停":"等待调度";if(t.status==="cancelled")return"已取消";
  if(t.status==="done")return n>1?`已合成 ${n} 个区域`:"完成";
  if(m.phase==="merge")return `合成 ${n} 个区域…`;
  return n>1?`${n} 个区域 · ${done}/${n} 完成${run>1?` · ${run} 并行`:""}`:(run?STAGE[m.parts[0].stage]:"等待调度");}
const taskBar=t=>t.up?tileGrid(t):segBar(units(t),40);
const taskLabel=t=>t.multi?multiLabel(t):t.up?upLabel(t):t.status==="running"?STAGE[t.stage]:t.status==="queued"?(S.paused?"调度已暂停":"等待调度"):"";
/* ================= history / layers ================= */
const layers=[];let waiters=[];
history.replaceState({depth:0},"");
function pushLayer(type,close){layers.push({type,close});history.pushState({depth:layers.length},"");}
addEventListener("popstate",e=>{const depth=e.state?.depth||0;while(layers.length>depth){layers.pop().close();}const w=waiters;waiters=[];w.forEach(f=>f());});
let historyQueue=Promise.resolve();
function traverseHistory(count){historyQueue=historyQueue.then(()=>new Promise(resolve=>{const k=count();if(!k)return resolve();waiters.push(resolve);history.go(-k);}));return historyQueue;}
function back(){return traverseHistory(()=>layers.length?1:0);}
function closeOverlays(){return traverseHistory(()=>{let k=0;for(let i=layers.length-1;i>=0&&layers[i].type!=="coll";i--)k++;return k;});}

/* ================= keyed list sync with FLIP ================= */
function syncList(box,items,key,html){
  if(!box)return;const ready=box.dataset.ready==="1";
  const old=new Map([...box.children].filter(e=>e.dataset.k).map(e=>[e.dataset.k,e]));
  const first=new Map();if(ready&&!RM)for(const [k,e] of old)first.set(k,e.getBoundingClientRect());
  const next=[];
  for(const it of items){const k=key(it),h=html(it);let el=old.get(k);
    if(!el){const t=document.createElement("template");t.innerHTML=h.trim();el=t.content.firstElementChild;el.dataset.k=k;el.dataset.h=h;
      if(ready){el.classList.add("enter");el.addEventListener("animationend",()=>el.classList.remove("enter"),{once:true});}}
    else if(el.dataset.h!==h){const t=document.createElement("template");t.innerHTML=h.trim();const n=t.content.firstElementChild;el.innerHTML=n.innerHTML;el.className=n.className;for(const a of n.attributes)if(a.name!=="class")el.setAttribute(a.name,a.value);el.dataset.h=h;}
    old.delete(k);next.push(el);}
  for(const e of old.values())e.remove();
  next.forEach((el,i)=>{if(box.children[i]!==el)box.insertBefore(el,box.children[i]||null);});
  if(ready&&!RM){const s=sc();for(const el of next){const f=first.get(el.dataset.k);if(!f)continue;const l=el.getBoundingClientRect(),dx=(f.left-l.left)/s,dy=(f.top-l.top)/s;
    if(Math.abs(dx)>1||Math.abs(dy)>1)el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:"none"}],{duration:380,easing:E.emph});}}
  box.dataset.ready="1";
}

/* ================= view transitions ================= */
function vt(kind,fn){
  if(RM||!document.startViewTransition){fn();return Promise.resolve();}
  document.documentElement.dataset.vt=kind;
  const t=document.startViewTransition(fn);
  return t.finished.catch(()=>{}).finally(()=>{if(document.documentElement.dataset.vt===kind)delete document.documentElement.dataset.vt;});
}

/* ================= render ================= */
const topBar=(title,right="")=>`<header class="top"><button class="avatar" data-act="me" aria-label="账户">${esc(StudioService.username().slice(0,1).toUpperCase())}</button><h1>${title}</h1><span class="grow"></span>${right}</header><div class="banner-slot"></div>`;
function renderPage(){
  const p=$("#page");
  if(S.tab==="create")p.innerHTML=createHTML();
  else if(S.tab==="works")p.innerHTML=S.coll?collHTML():worksHTML();
  else if(S.tab==="queue")p.innerHTML=queueHTML();
  else p.innerHTML=tplsHTML();
  hydrateIcons(p);
  if(S.tab==="works"&&!S.coll){const s=$("#page .scroll"),tab=S.worksTab;if(s){s.scrollTop=S.worksScrolls[tab]||0;s.addEventListener("scroll",()=>{S.worksScrolls[tab]=s.scrollTop;if(tab==="generated")S.worksScroll=s.scrollTop;},{passive:true});}}
  updatePage();updateChrome();
}
function refresh(){updatePage();updateChrome();}
function updatePage(){
  if(S.tab==="create")updateCreate();
  else if(S.tab==="works")S.coll?updateColl():updateWorks();
  else if(S.tab==="queue")updateQueue();
  else updateTpls();
}
const activeTasks=()=>S.batches.flatMap(b=>b.tasks).filter(t=>t.status==="queued"||t.status==="running");
let lastBadge=-1,badgeHold=0;
function updateChrome(){
  $$(".tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===S.tab));
  const i=["create","works","queue","templates"].indexOf(S.tab);$("#tab-ind").style.transform=`translateX(${i*100}%)`;
  if(Date.now()>=badgeHold){const n=activeTasks().length,b=$("#badge");b.textContent=n;b.classList.toggle("zero",n===0);
    if(lastBadge>=0&&n>lastBadge&&!RM){b.classList.remove("bump");void b.offsetWidth;b.classList.add("bump");}lastBadge=n;}
  const slot=$("#page .banner-slot");if(slot){const want=S.disconnected?`<div class="banner">${icon("alert",18)}<span>订阅尚未连接</span><button data-act="reconnect">连接订阅</button></div>`:S.offline?`<div class="banner">${icon("alert",18)}<span>与服务器的连接已断开</span><button data-act="reconnect">重新连接</button></div>`:S.paused&&S.tab!=="queue"?`<div class="banner">${icon("clock",18)}<span>调度已暂停，新任务不会开始</span><button data-act="unpause">恢复</button></div>`:"";
    if(slot.dataset.h!==want){slot.innerHTML=want;slot.dataset.h=want;}}
  placeToast();
}

/* ---------- create ---------- */
const modeSeg=()=>`<div class="mode-seg" id="mode-seg"><span class="ind"></span><button data-act="mode" data-v="gen" class="${S.mode==="gen"?"on":""}">生成</button><button data-act="mode" data-v="up" class="${S.mode==="up"?"on":""}">超分</button></div>`;
function placeInd(seg,instant){const on=$("button.on",seg),ind=$(".ind",seg);if(!on)return;if(instant){ind.style.transition="none";}ind.style.width=on.offsetWidth+"px";ind.style.transform=`translateX(${on.offsetLeft}px)`;if(instant){void ind.offsetWidth;ind.style.transition="";}}
function createHTML(){return S.mode==="up"?upModeHTML():genHTML();}
function upModeHTML(){const u=S.upc;return `${topBar("创作",modeSeg())}
<div class="scroll" id="scroll">
  <section class="card" id="cu-card"><div class="card-head"><span class="label">原图</span><span class="grow"></span><button class="ghost-btn" data-act="cu-pick" id="cu-change"></button></div><div id="cu-src"></div></section>
  <section class="card"><div class="card-head"><span class="label">面积倍率</span><span class="muted small">宽高 ×2 / ×4 / ×8</span></div><div class="opts" id="cu-f">${Object.keys(FACTORS).map(v=>`<button class="opt tall${v===u.factor?" on":""}" data-act="cu-f" data-v="${v}">${v}<small>${FACTORS[v]} 级</small></button>`).join("")}</div><div id="cu-plan"></div></section>
  <section class="card"><div class="card-head"><span class="label">统一细节与画风约束</span><span class="muted small">可选</span></div><textarea class="input" id="cu-inj" rows="2" placeholder="注入每一级每一块，并作为验收依据">${esc(u.inj)}</textarea></section>
  <p class="note" data-layout="margin:0 4px">每级逐块补绘并行进行，通过验收才进入下一级；失败会保留已完成的块，可在任务里选块重绘。</p>
</div>
<div class="gen-bar"><button class="bp hide" id="bp" data-act="bp"></button><div class="sum static"><span class="st"><b id="sum1"></b><span id="sum2"></span></span></div><button class="gen-btn" id="gen" data-act="up-start"><span class="lab a">开始超分${icon("arrow",18)}</span><span class="lab b">${icon("check",18)}<span id="gen-done">已加入</span></span></button></div>`;}
function planHTML(...args){return StudioService.planHTML(...args);}
function setHTML(el,h){if(el&&el.dataset.h!==h){el.innerHTML=h;el.dataset.h=h;}}
function updateUpCreate(){
  const u=S.upc,im=u.src&&img(u.src);
  setHTML($("#cu-src"),im?`<div class="cu-hero"><img src="${src(im)}" alt="" data-layout="aspect-ratio:${im.w}/${im.h}"><div><b>${esc(im.name)}</b><span>${im.w} × ${im.h} · ${esc(coll(im.coll)?.name||"参考图")}</span></div></div>`
    :`<button class="cu-empty" data-act="cu-pick">${icon("imgplus",26)}<b>选择要超分的图片</b><span>作品、参考图库，或从相册上传</span></button><div class="cu-recent-h">最近作品 · 点一下即可选中</div><div class="cu-recent">${S.images.slice(0,10).map(i=>`<button data-act="cu-src" data-id="${i.id}" aria-label="${esc(i.name)}"><img src="${src(i)}" alt=""></button>`).join("")}</div>`);
  setHTML($("#cu-change"),im?`${icon("refresh",16)}更换`:`${icon("imgplus",16)}选择`);
  setHTML($("#cu-plan"),im?planHTML(im,u.factor):`<div class="up-plan"><div><span class="muted">选好原图后，这里显示每级尺寸与调用预算</span></div></div>`);
  if(im){const m=makeUp(im,u.factor,"");$("#gen").disabled=!m;$("#sum1").textContent=`${u.factor} · ${FACTORS[u.factor]} 级`;$("#sum2").textContent=m?`→ ${m.levels.at(-1).to.join("×")} · ${m.levels.reduce((a,l)=>a+l.tiles.length,0)+m.levels.length} 次调用`:"正在计算切图预算…";}
  else{$("#sum1").textContent=`${u.factor} 超分`;$("#sum2").textContent="尚未选择原图";}
  const seg=$("#mode-seg");if(seg&&!seg.dataset.ready){placeInd(seg,true);seg.dataset.ready=1;}
  updBp();
}
function genHTML(){const c=S.composer;return `${topBar("创作",modeSeg())}
<div class="scroll" id="scroll">
  <section class="card" id="prompt-card">
    <div class="card-head"><span class="label">提示词</span><span class="grow"></span><button class="clear-btn off" id="clear-btn" data-act="clear-all" aria-label="清空提示词与参考图">${icon("x",14)}清空</button><button class="ghost-btn" data-act="tpl-menu">${icon("book",16)}模板${icon("chevd",14)}</button></div>
    <textarea id="prompt" placeholder="描述你想要的画面…" maxlength="24000">${esc(c.prompt)}</textarea>
    <div id="into"></div>
  </section>
  <section class="card">
    <div class="card-head"><span class="label">参考图</span><span class="muted small" id="ref-count"></span></div>
    <div class="ref-strip" id="refs"></div>
  </section>
</div>
<div class="gen-bar">
  <button class="bp hide" id="bp" data-act="bp"></button>
  <button class="sum" data-act="params"><span class="st"><b id="sum1"></b><span id="sum2"></span></span>${icon("sliders",18)}</button>
  <button class="gen-btn" id="gen" data-act="generate"><span class="lab a">生成${icon("arrow",18)}</span><span class="lab b">${icon("check",18)}<span id="gen-done">已加入</span></span></button>
</div>`;}
function bigrams(s){s=s.replace(/[\s，。,.、·]/g,"");const o=new Set();for(let i=0;i<s.length-1;i++)o.add(s.slice(i,i+2));return o;}
function similarity(a,b){const A=bigrams(a),B=bigrams(b);if(!A.size||!B.size)return 1;let n=0;A.forEach(x=>B.has(x)&&n++);return n/Math.min(A.size,B.size);}
function updateInto(){
  const c=S.composer,t=tpl(c.template),box=$("#into");if(!box)return;
  const cn=t?(S.collections.find(x=>x.template===t.id)?.name||t.name):null;
  const div=t&&!c.ack&&c.prompt.trim().length>4&&similarity(c.prompt,t.text)<.25;
  const h=`<div class="file-into"><span>${icon("folder",14)}归入</span>${t?`<span class="into-chip" id="into-chip"><span class="t">${esc(cn)}</span><button data-act="detach" aria-label="解除模板">${icon("x",14)}</button></span>`:`<span class="into-chip none">无模板</span>`}</div>${div?`<div class="diverge">${icon("alert",16)}<div>正文与模板「${esc(t.name)}」差异较大，结果仍会归入该列表。<div class="dv-actions"><button data-act="detach">改为无模板</button><button data-act="dv-keep">保持归入</button></div></div></div>`:""}`;
  if(box.dataset.h!==h){box.innerHTML=h;box.dataset.h=h;}
}
function updateCreate(){
  if(S.mode==="up")return updateUpCreate();
  {const seg=$("#mode-seg");if(seg&&!seg.dataset.ready){placeInd(seg,true);seg.dataset.ready=1;}}
  const c=S.composer;updateInto();
  $("#clear-btn")?.classList.toggle("off",!(c.prompt.trim()||c.refs.length||c.template));
  $("#ref-count").textContent=`${c.refs.length} / 8`;
  syncList($("#refs"),[...c.refs.map(id=>({id})),{id:"__add"}],x=>x.id,x=>x.id==="__add"?`<button class="ref-add" data-act="pick-refs" aria-label="添加参考图">${icon("plus",22)}</button>`:`<div class="ref"><img src="${src(img(x.id))}" alt=""><button class="rm" data-act="rm-ref" data-id="${x.id}" aria-label="移除">${icon("x",12)}</button></div>`);
  $("#sum1").textContent=`${c.ratio} · ${c.count} 张`;
  $("#sum2").textContent=[c.size==="自动"?"自动尺寸":c.size+" 长边",c.polish&&"润色",c.transparent&&"透明",c.stitch!=="关"&&"生成后 "+c.stitch+" 超分",StudioService.modelName(c.model)+" · "+c.effort].filter(Boolean).join(" · ");
  updBp();
}
function updBp(){
  const act=S.batches.filter(b=>b.tasks.some(t=>t.status==="queued"||t.status==="running")),bp=$("#bp");
  if(act.length){const n=act.reduce((s,b)=>s+b.tasks.filter(t=>t.status==="queued"||t.status==="running").length,0),b=act[0];
    const h=`<span class="spin"></span><span><b>${n} 项进行中</b>${act.length>1?` · ${act.length} 批`:""}</span>${segBar(act.flatMap(x=>x.tasks.flatMap(units)),48)}<span class="to">${esc(coll(b.coll)?.name||"")}${icon("chevr",14)}</span>`;
    if(bp.dataset.h!==h){bp.innerHTML=h;bp.dataset.h=h;}bp.dataset.coll=b.coll;bp.classList.remove("hide");}
  else bp.classList.add("hide");
}

/* ---------- works ---------- */
function worksHTML(){return `${topBar("作品")}<div class="scroll"><div class="seg" id="works-seg"><span class="ind"></span>${[["generated","作品"],["references","参考图"],["favorites","收藏"]].map(([key,label])=>`<button class="${S.worksTab===key?"on":""}" data-act="works-tab" data-v="${key}">${label}</button>`).join("")}</div>${S.worksTab==="generated"?'<div class="section-h"><h2>最近生成</h2></div><div class="recent" id="recent"></div><div class="section-h"><h2>列表</h2><span class="muted small" id="coll-count"></span></div><div class="colls" id="colls"></div>':'<div class="section-h"><h2 id="works-title"></h2><span class="muted small" id="works-count"></span></div><div class="grid" id="works-grid"></div><p class="empty" id="works-empty"></p><button class="secondary load-more" data-act="works-more">加载更多</button>'}</div>`;}
const liveIn=cid=>S.batches.filter(b=>b.coll===cid).flatMap(b=>b.tasks).filter(t=>t.status==="queued"||t.status==="running").length;
const tileHTML=(im,list)=>`<button class="tile${im.fav?" fav":""}"${im.badge?` data-badge="${esc(im.badge)}"`:""} data-act="img" data-id="${im.id}" data-list="${list}" aria-label="${esc(im.name)}"><img src="${src(im)}" alt="" draggable="false"></button>`;
function updateWorks(){
  const seg=$("#works-seg"),on=$("button.on",seg),ind=$(".ind",seg);if(on){ind.style.width=on.offsetWidth+"px";ind.style.transform=`translateX(${on.offsetLeft-3}px)`;}
  if(S.worksTab!=="generated"){
    const tab=S.worksTab,items=StudioService.workItems(tab),state=StudioService.workState(tab);
    $("#works-title").textContent=tab==="references"?"参考图":"已收藏";$("#works-count").textContent=state.ready?`${items.length}${state.offset<state.total?" / "+state.total:""} 张`:"";
    syncList($("#works-grid"),items,i=>i.id,im=>tileHTML(im,tab));const empty=$("#works-empty");empty.hidden=!!items.length;empty.textContent=state.loading?"正在读取…":state.error?"读取失败，请重试":tab==="references"?"添加的参考图会显示在这里":"长按图片或在更多菜单中收藏";
    const more=$('[data-act="works-more"]');more.hidden=state.ready&&state.offset>=state.total;more.disabled=state.loading;more.textContent=state.loading?"正在读取…":state.error?"重新读取":"加载更多";return;
  }
  syncList($("#recent"),S.images.slice(0,10),i=>i.id,im=>tileHTML(im,"recent"));
  const cs=S.collections;
  $("#coll-count").textContent=`${cs.length} 个`;
  syncList($("#colls"),cs,c=>c.id,c=>{const ims=c.covers||imagesOf(c.id),live=c.active||0,k=Math.min(3,ims.length);
    return `<button class="coll" data-act="coll" data-id="${c.id}"><div class="cover n${k}">${ims.slice(0,3).map(i=>`<img src="${src(i)}" alt="">`).join("")}</div><div class="coll-name">${esc(c.name)}</div><div class="coll-meta"><span>${c.image_count??ims.length} 张</span>${live?`<span class="live">${live} 生成中</span>`:""}</div></button>`;});
}
function collHTML(){const c=coll(S.coll),first=imagesOf(c.id)[0];return `<header class="top coll-top"><button class="icon-btn" data-act="coll-back" aria-label="返回">${icon("back")}</button><div class="hero" id="hero">${first?`<img src="${src(first)}" alt="">`:""}</div><div class="ct"><h1>${esc(c.name)}</h1><span id="coll-sub"></span></div><button class="icon-btn" data-act="coll-more" aria-label="更多">${icon("more")}</button></header><div class="banner-slot"></div>
<div class="scroll"><div id="live"></div><div class="grid" id="grid"></div><p class="hint">长按图片可收藏、删除或直接执行操作</p></div>`;}
function updateColl(){
  const c=coll(S.coll);if(!c)return;const ims=imagesOf(c.id),bs=S.batches.filter(b=>b.coll===c.id);
  $("#coll-sub").textContent=`${c.image_count??ims.length} 张${c.template?" · 模板身份":" · 未绑定模板"}`;
  const live=bs.flatMap(b=>b.tasks.map(t=>({b,t}))).filter(x=>x.t.status==="queued"||x.t.status==="running");
  const failed=bs.flatMap(b=>b.tasks.map(t=>({b,t}))).filter(x=>x.t.status==="failed");
  const lead=live.find(x=>x.t.up&&x.t.status==="running")||live.reduce((m,x)=>x.t.status==="running"&&x.t.stage>=(m?.t.stage??-1)?x:m,null);
  const upFail=failed.find(x=>x.t.up),plainFail=failed.filter(x=>!x.t.up);
  const h=(live.length?`<button class="live-strip" data-act="goto-batch" data-id="${(lead||live[0]).b.id}"><span class="spin"></span><span><b>${live.length} 项进行中</b> · ${lead?taskLabel(lead.t):(S.paused?"调度已暂停":"等待调度")}</span><span class="stk">${segBar(live.flatMap(x=>units(x.t)),72)}</span>${icon("chevr",16)}</button>`:"")
   +(upFail?`<div class="live-strip fail-strip">${icon("alert",18)}<span>超分未通过 · 点击诊断定位问题</span><span class="grow"></span><button data-act="failure" data-id="${upFail.b.id}">处理</button></div>`:"")
   +(plainFail.length?`<div class="live-strip fail-strip">${icon("alert",18)}<span>${plainFail.length} 张失败</span><span class="grow"></span><button data-act="retry-coll">重试</button><button data-act="goto-batch" data-id="${plainFail[0].b.id}">详情</button></div>`:"");
  const lv=$("#live");if(lv.dataset.h!==h){lv.innerHTML=h;lv.dataset.h=h;}
  syncList($("#grid"),ims,i=>i.id,im=>tileHTML(im,"coll"));
}

/* ---------- queue ---------- */
function queueHTML(){return `${topBar("任务",`<button class="pause-ctl" data-act="pause"><span>暂停调度</span><span class="switch ${S.paused?"on":""}" id="pause-sw"></span></button>`)}
<div class="scroll"><div id="paused-note"></div><div class="seg" id="qseg"><span class="ind"></span><button data-act="qf" data-f="active">进行中<em></em></button><button data-act="qf" data-f="done">已完成<em></em></button><button data-act="qf" data-f="failed">失败<em></em></button></div><div id="batches"></div><p class="empty" id="qempty" hidden></p></div>`;}
const stagesHTML=t=>`<span class="stages" data-st="${t.status}" data-s="${Math.min(t.stage,3)}"><i></i><i></i><i></i><i></i></span>`;
function bstate(b){const st=b.tasks.map(t=>t.status);return{active:st.some(s=>s==="queued"||s==="running"),failed:st.filter(s=>s==="failed").length,done:st.filter(s=>s==="done").length,n:st.length};}
const bfilter=(b,f)=>{const s=bstate(b);return f==="active"?s.active:f==="failed"?!s.active&&s.failed>0:!s.active&&!s.failed;};
function batchHTML(b){
  if(b.kind==="upscale"&&b.tasks.length===1&&b.tasks[0].up)return upBatchHTML(b);
  const s=bstate(b),c=coll(b.coll),open=S.expanded.has(b.id),thumb=b.tasks.find(t=>t.img&&img(t.img)),t0=b.tasks[0],m=t0.multi;
  const cnt=k=>b.tasks.filter(t=>t.status===k).length,run=cnt("running"),q=cnt("queued");
  const sum=m?multiLabel(t0):s.active?[`${s.done}/${s.n} 完成`,run&&`${run} 生成中${s.n===1?` · ${STAGE[t0.stage]}`:""}`,q&&`${q} ${S.paused?"已暂停":"等待"}`].filter(Boolean).join(" · "):s.failed?`${s.failed} 张失败 · ${s.done} 张完成` :`${s.done} 张完成${cnt("cancelled")?` · ${cnt("cancelled")} 已取消`:""}`;
  const srcIm=b.src&&img(b.src);
  const rows=m?m.parts.map(x=>`<div class="trow"><span class="n">#${x.i+1}</span>${stagesHTML({status:x.state,stage:x.stage})}<span class="lbl">${esc(x.text)}</span><span class="muted small">${x.state==="running"?STAGE[x.stage]:x.state==="done"?"完成":x.state==="failed"?"失败":x.state==="cancelled"?"已取消":"等待"}</span></div>`).join("")
      +(t0.status==="done"&&img(t0.img)?`<div class="trow"><span class="n"></span><span class="lbl">已合成为一张新图，选区外像素保持原图</span><button class="link-btn" data-act="img" data-id="${t0.img}" data-list="batch:${b.id}">查看</button></div>`:m.phase==="merge"?`<div class="trow"><span class="n"></span><span class="spin"></span><span class="lbl">合成中：只替换各选区内像素</span></div>`:"")
    :b.tasks.map((t,i)=>{const lbl=t.status==="queued"?"等待调度":t.status==="running"?(t.raw?.progress?.label||STAGE[t.stage]):t.status==="done"?"完成":t.status==="failed"?`失败 · ${t.err}`:"已取消";
      const a=t.status==="queued"||t.status==="running"?`<button class="link-btn danger" data-act="cancel-task" data-b="${b.id}" data-t="${t.id}">取消</button>`:t.status==="failed"?`<button class="link-btn" data-act="log" data-b="${b.id}" data-t="${t.id}">日志</button><button class="link-btn" data-act="${t.raw?.options.stitch?"failure-job":"retry-task"}" data-id="${t.id}" data-b="${b.id}" data-t="${t.id}">${t.raw?.options.stitch?"处理":"重试"}</button>`:t.status==="done"&&img(t.img)?`<button class="link-btn" data-act="img" data-id="${t.img}" data-list="batch:${b.id}">查看</button>`:"";
      return `<div class="trow"><button class="n" data-act="task-info" data-id="${t.id}" aria-label="任务 ${i+1} 详情">#${i+1}</button>${stagesHTML(t)}<span class="lbl${t.status==="failed"?" err":""}">${esc(lbl)}</span>${t.raw?.options.stitch?`<button class="link-btn" data-act="up-detail" data-id="${t.id}">超分进度</button>`:""}${a}</div>`;}).join("");
  const bars=m?m.parts.map(x=>({status:x.state,stage:x.stage})):b.tasks;
  const thumbSrc=thumb?src(img(thumb.img)):srcIm?src(srcIm):null;
  return `<article class="batch${open?" open":""}" data-id="${b.id}"><button class="b-main" data-act="bt" data-id="${b.id}"><span class="b-thumb">${thumbSrc?`<img src="${thumbSrc}" alt="">`:icon(s.active?"clock":"alert",20)}</span><span class="b-text"><span class="b-prompt"><span class="kind ${b.kind}">${KIND[b.kind]}${m&&m.parts.length>1?` ×${m.parts.length}`:""}</span>${esc(b.prompt)}</span><span class="b-meta">归入 ${esc(c?.name||"—")} · ${b.ratio} · ${b.tasks.length>1?b.tasks.length+" 张 · ":""}${fmtTime(b.created)}</span><span class="b-status col">${segBar(bars)}<span class="b-sum">${sum}</span></span></span><span class="chev">${icon("chevd",18)}</span></button><div class="b-more"><div>${rows}<div class="b-actions">${b.tasks.length===1?`<button class="pill-btn" data-act="task-info" data-id="${t0.id}">详情</button>`:""}${s.active?`<button class="pill-btn" data-act="cancel-batch" data-id="${b.id}">${b.tasks.length>1?"全部取消":"取消"}</button>`:""}${s.failed?`<button class="pill-btn" data-act="retry-batch" data-id="${b.id}">重试失败</button>`:""}<button class="pill-btn" data-act="open-coll" data-id="${b.coll}">打开列表</button></div></div></div></article>`;
}
function upBatchHTML(b){
  const t=b.tasks[0],u=t.up,c=coll(b.coll),open=S.expanded.has(b.id),srcIm=img(u.src),done=t.img&&img(t.img);
  const active=t.status==="queued"||t.status==="running";
  const lv=u.levels.map((l,i)=>{const cls=i<u.cur||t.status==="done"?"done":i===u.cur?(t.status==="failed"?"bad":"cur"):"";return `<span class="lvl ${cls}">第 ${i+1} 级 · ${l.from.join("×")} → ${l.to.join("×")} · ${l.tiles.length} 块</span>`;}).join("");
  const acts=(active?`<button class="pill-btn" data-act="cancel-batch" data-id="${b.id}">取消</button>`:"")
    +(t.status==="failed"?`<button class="pill-btn" data-act="log" data-b="${b.id}" data-t="${t.id}">日志</button><button class="pill-btn strong" data-act="failure" data-id="${b.id}">失败处理 · 选块重绘</button>`:"")
    +(done?`<button class="pill-btn" data-act="img" data-id="${t.img}" data-list="batch:${b.id}">查看结果</button>`:"");
  return `<article class="batch${open?" open":""}" data-id="${b.id}"><button class="b-main" data-act="bt" data-id="${b.id}"><span class="b-thumb">${srcIm?`<img src="${src(done?img(t.img):srcIm)}" alt="">`:""}</span><span class="b-text"><span class="b-prompt"><span class="kind upscale">${KIND.upscale} ${u.factor}</span>${esc(srcIm?.name||b.prompt)}</span><span class="b-meta">归入 ${esc(c?.name||"—")} · ${u.levels.length} 级 · ${fmtTime(b.created)}</span><span class="b-status col up">${tileGrid(t)}<span class="b-sum"${t.status==="failed"?' data-layout="color:var(--red)"':""}>${upLabel(t)}</span></span></span><span class="chev">${icon("chevd",18)}</span></button><div class="b-more"><div><div class="up-detail"><span class="up-levels">${lv}</span>${tileGrid(t,true)}</div>${t.status==="failed"&&t.err?`<p class="err-sum">${esc(t.err)}</p>`:""}<div class="b-actions"><button class="pill-btn" data-act="up-detail" data-id="${t.id}">尺寸与预算</button><button class="pill-btn" data-act="task-info" data-id="${t.id}">详情</button>${acts}</div></div></div></article>`;
}
function updateQueue(){
  const counts={active:0,done:0,failed:0};S.batches.forEach(b=>["active","done","failed"].forEach(f=>bfilter(b,f)&&counts[f]++));
  $$("#qseg button").forEach(b=>{b.classList.toggle("on",b.dataset.f===S.filter);b.querySelector("em").textContent=counts[b.dataset.f]||"";});
  const on=$("#qseg button.on"),ind=$("#qseg .ind");if(on){ind.style.width=on.offsetWidth+"px";ind.style.transform=`translateX(${on.offsetLeft-3}px)`;}
  $("#pause-sw").classList.toggle("on",S.paused);
  const pn=$("#paused-note"),ph=S.paused?`<div class="paused-note">调度已暂停：进行中的任务会完成，等待中的不会开始。</div>`:"";if(pn.dataset.h!==ph){pn.innerHTML=ph;pn.dataset.h=ph;}
  const list=S.batches.filter(b=>bfilter(b,S.filter));
  syncList($("#batches"),list,b=>b.id,batchHTML);
  const e=$("#qempty");e.hidden=!!list.length;e.textContent={active:"没有进行中的任务",done:"还没有完成的任务",failed:"没有失败的任务"}[S.filter];let more=$("[data-act=\"batch-more\"]");if(!more){more=document.createElement("button");more.className="secondary load-more";more.dataset.act="batch-more";more.textContent="加载更多任务";e.after(more);}more.hidden=!StudioService.batchMore();
}

/* ---------- templates ---------- */
function tplsHTML(){return `${topBar("模板",`<button class="ghost-btn" data-act="tpl-new">${icon("plus",16)}新建</button>`)}<div class="scroll"><div id="tpls"></div></div>`;}
function updateTpls(){
  syncList($("#tpls"),S.templates,t=>t.id,t=>{const c=S.collections.find(x=>x.template===t.id),ims=c?imagesOf(c.id):[];
    return `<button class="tpl" data-act="tpl" data-id="${t.id}"><span class="tpl-cover">${ims[0]?`<img src="${src(ims[0])}" alt="">`:""}</span><span class="tpl-body"><b>${esc(t.name)}</b><span class="ex">${esc(t.text)}</span><span class="chips"><span class="chip">${t.ratio}</span><span class="chip">${t.refs} 张参考</span><span class="chip">${c?.image_count??ims.length} 张作品</span></span></span></button>`;});
}

/* ================= navigation ================= */
function go(tab){
  if(tab===S.tab){if(tab==="works"&&S.coll)back();else $("#page .scroll")?.scrollTo({top:0,behavior:RM?"auto":"smooth"});return Promise.resolve();}
  return vt("tab",()=>{S.tab=tab;renderPage();});
}
function openColl(cid){
  StudioService.loadCollection(cid).catch(StudioService.report);if(!coll(cid)){StudioService.report(new Error("列表不存在"));return Promise.resolve();}
  const cover=S.tab==="works"&&!S.coll?$(`.coll[data-id="${cid}"] .cover`):null;
  if(cover)cover.style.viewTransitionName="hero";
  pushLayer("coll",closeColl);
  return vt("push",()=>{if(cover)cover.style.viewTransitionName="";S.tab="works";S.coll=cid;renderPage();const h=$("#hero");if(h&&cover)h.style.viewTransitionName="hero";})
    .then(()=>{const h=$("#hero");if(h)h.style.viewTransitionName="";});
}
function closeColl(){
  if(!S.coll)return;const cid=S.coll;
  if(S.tab!=="works"){S.coll=null;return;}
  const h=$("#hero");if(h)h.style.viewTransitionName="hero";
  vt("pop",()=>{if(h)h.style.viewTransitionName="";S.coll=null;renderPage();const c=$(`.coll[data-id="${cid}"] .cover`);if(c)c.style.viewTransitionName=h?"hero":"";})
    .then(()=>{const c=$(`.coll[data-id="${cid}"] .cover`);if(c)c.style.viewTransitionName="";});
}

/* ================= sheets ================= */
function openSheet({title,html,cls="",onMount}){
  const existing=layers.at(-1)?.type==="sheet"&&topSheet();
  if(existing){const sh=$(".sheet",existing);sh.className="sheet "+cls;sh.setAttribute("aria-label",title||"");delete existing.dataset.upSource;swapSheet(existing,title||"",html,onMount);placeToast();return existing;}

  const L=document.createElement("div");L.className="sheet-layer";
  L.dataset.revision="1";L.innerHTML=`<div class="scrim" data-act="sheet-close"></div><section class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title||"")}"><div class="grab"><i></i></div>${title?`<header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="sheet-close" aria-label="关闭">${icon("x",20)}</button></header>`:""}<div class="sheet-body">${html}</div></section>`;
  $("#layers").append(L);hydrateIcons(L);
  const sh=$(".sheet",L),scr=$(".scrim",L);
  scr.animate([{opacity:0},{opacity:1}],{duration:D(220),easing:E.std});
  sh.animate([{transform:"translateY(100%)"},{transform:"translateY(0)"}],{duration:D(360),easing:E.emph});
  dragDismiss(L);pushLayer("sheet",()=>dismissSheet(L));onMount&&onMount(L);placeToast();return L;
}
function dismissSheet(L){
  L.cleanup?.();L.cleanup=null;L.onclick=null;const sh=$(".sheet",L),scr=$(".scrim",L),y=parseFloat(L.dataset.y||0);L.style.pointerEvents="none";
  sh.animate([{transform:`translateY(${y}px)`},{transform:`translateY(${sh.offsetHeight+20}px)`}],{duration:D(220),easing:E.exit,fill:"forwards"});
  scr.animate([{opacity:getComputedStyle(scr).opacity},{opacity:0}],{duration:D(220),fill:"forwards"}).finished.then(()=>{L.remove();placeToast();});
}
function swapSheet(L,title,html,onMount){
  L.cleanup?.();L.cleanup=null;L.onclick=null;
  const sh=$(".sheet",L),body=$(".sheet-body",L),h1=sh.offsetHeight;
  L.dataset.revision=String(+(L.dataset.revision||0)+1);
  if(title!==null&&title!==undefined){let header=$(".sheet-head",L);if(title&&!header){header=document.createElement("header");header.className="sheet-head";header.innerHTML=`<h2></h2><button class="icon-btn" data-act="sheet-close" aria-label="关闭">${icon("x",20)}</button>`;$(".grab",L).after(header);}if(title)$("h2",header).textContent=title;else header?.remove();}
  body.innerHTML=html;hydrateIcons(body);const h2=sh.offsetHeight;
  sh.animate([{height:h1+"px"},{height:h2+"px"}],{duration:D(300),easing:E.emph});
  body.animate([{opacity:0,transform:"translateX(16px)"},{opacity:1,transform:"none"}],{duration:D(260),easing:E.emph});onMount&&onMount(L);
}
function topSheet(){return $$("#layers .sheet-layer").filter(l=>l.style.pointerEvents!=="none").pop();}
function dragDismiss(L){
  const sh=$(".sheet",L),scr=$(".scrim",L);let d=null;
  const start=e=>{if(e.target.closest("button"))return;d={y:e.clientY,t:performance.now(),dy:0};sh.setPointerCapture(e.pointerId);};
  sh.addEventListener("pointerdown",e=>{if(e.target.closest(".grab,.sheet-head"))start(e);});
  sh.addEventListener("pointermove",e=>{if(!d)return;let dy=(e.clientY-d.y)/sc();dy=dy<0?dy*.2:dy;d.dy=dy;sh.style.transform=`translateY(${dy}px)`;scr.style.opacity=String(1-Math.max(0,dy)/(sh.offsetHeight*1.4));});
  const end=()=>{if(!d)return;const v=d.dy/(performance.now()-d.t);
    if(d.dy>110||(v>.6&&d.dy>30)){L.dataset.y=d.dy;sh.style.transform="";back();}
    else{sh.animate([{transform:`translateY(${d.dy}px)`},{transform:"translateY(0)"}],{duration:D(260),easing:E.emph});sh.style.transform="";scr.style.opacity="";}d=null;};
  sh.addEventListener("pointerup",end);sh.addEventListener("pointercancel",end);
}

/* ================= toast ================= */
let toastT;
function toast(msg,o={}){
  const host=$("#toast");host.innerHTML=`<div class="toast"><span>${esc(msg)}</span>${o.action?`<button>${esc(o.action)}</button>`:""}</div>`;
  const el=host.firstChild;el.animate([{opacity:0,transform:"translateY(16px) scale(.97)"},{opacity:1,transform:"none"}],{duration:D(280),easing:E.emph});
  const hide=()=>{el.animate([{opacity:1},{opacity:0,transform:"translateY(8px)"}],{duration:D(180),easing:E.exit,fill:"forwards"}).finished.then(()=>el.remove());};
  if(o.action)el.querySelector("button").onclick=()=>{clearTimeout(toastT);hide();o.run();};
  clearTimeout(toastT);toastT=setTimeout(hide,o.ms||3400);placeToast();
}
function placeToast(){const t=$("#toast"),sheet=topSheet(),scr=typeof topScreen==="function"&&topScreen();
  if(scr&&!sheet){t.style.top="auto";t.style.bottom=scr.classList.contains("fail-screen")?"128px":"24px";return;}
  t.style.top=sheet?"calc(var(--safe-top) + 8px)":"auto";
  t.style.bottom=sheet?"auto":V.open?(vw.classList.contains("qe-on")?"108px":"236px"):S.tab==="create"?(app.classList.contains("typing")?"84px":$("#bp")&&!$("#bp").classList.contains("hide")?"calc(var(--tab-h) + 128px)":"calc(var(--tab-h) + 88px)"):"calc(var(--tab-h) + 12px)";}

/* ================= fly helper ================= */
function bezier(x1,y1,x2,y2){const cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;
  const X=t=>((ax*t+bx)*t+cx)*t,Y=t=>((ay*t+by)*t+cy)*t,dX=t=>(3*ax*t+2*bx)*t+cx;
  return x=>{let t=x;for(let i=0;i<6;i++){const d=dX(t);if(Math.abs(d)<1e-6)break;t-=(X(t)-x)/d;}return Y(Math.max(0,Math.min(1,t)));};}
const easeEmph=bezier(.32,.72,0,1);
// rAF-driven so it always progresses; left/top/size keep the cover crop "uncropping" smoothly.
function fly(from,to,url,dur,r0,r1,parent){
  const f=document.createElement("div");f.className="v-fly";f.style.backgroundImage=`url("${url}")`;parent.append(f);
  const set=k=>{const l=(a,b)=>a+(b-a)*k;Object.assign(f.style,{left:l(from.x,to.x)+"px",top:l(from.y,to.y)+"px",width:l(from.w,to.w)+"px",height:l(from.h,to.h)+"px",borderRadius:l(r0,r1)+"px"});};
  set(0);const T=D(dur);let t0=null;
  return new Promise(res=>{const step=now=>{if(t0===null)t0=now;const p=Math.min(1,(now-t0)/T);set(easeEmph(p));if(p<1)requestAnimationFrame(step);else{f.remove();res();}};requestAnimationFrame(step);});
}
function flyDot(fromEl,toEl){
  if(RM)return;const a=rectOf(fromEl),b=rectOf(toEl),x0=a.x+a.w/2,y0=a.y+a.h/2,x1=b.x+b.w/2,y1=b.y+b.h/2-6,xm=(x0+x1)/2,ym=Math.min(y0,y1)-90;
  const d=document.createElement("div");d.className="fly-dot";app.append(d);
  d.animate([{transform:`translate(${x0}px,${y0}px) scale(.6)`,opacity:0},{transform:`translate(${x0}px,${y0-10}px) scale(1.1)`,opacity:1,offset:.12},{transform:`translate(${xm}px,${ym}px) scale(1)`,offset:.5},{transform:`translate(${x1}px,${y1}px) scale(.5)`,opacity:.9}],{duration:620,easing:"cubic-bezier(.45,0,.55,1)"}).finished.then(()=>d.remove());
}

/* ================= viewer ================= */
const V={gen:0,open:false,list:[],i:0,redraw:false,sel:null,bgAnim:null,hidden:null};
const vw=$("#viewer"),track=$("#v-track"),stage=$("#v-stage"),vbg=$(".v-bg",vw);
function listFor(kind,id){
  if(kind==="references"||kind==="favorites")return StudioService.workItems(kind).map(i=>i.id);
  if(kind==="recent")return S.images.slice(0,10).map(i=>i.id);
  if(kind==="coll")return imagesOf(S.coll).map(i=>i.id);
  if(kind?.startsWith("batch:")){const b=S.batches.find(x=>x.id===kind.slice(6));return b?b.tasks.filter(t=>t.img&&img(t.img)).map(t=>t.img):[id];}
  return [id];
}
// While a viewer input has focus (and until its keyboard has closed) the image keeps the geometry it had
// before the keyboard appeared, so the keyboard and the input panel float over a still picture instead of
// squeezing it; IME candidate bars that change the keyboard height no longer move the image or its regions.
const KB={hold:false,w:0,h:0,until:0};
function viewerEditing(){const a=document.activeElement;return !!(V.open&&a&&vw.contains(a)&&/^(INPUT|TEXTAREA)$/.test(a.tagName));}
function viewerHeight(){
  const h=app.offsetHeight;if(!KB.hold)return h;const t=performance.now();
  if(app.offsetWidth===KB.w&&(viewerEditing()||t<KB.until||(h<KB.h&&t<KB.until+2500)))return KB.h;
  KB.hold=false;return h;
}
document.addEventListener("focusin",e=>{if(!KB.hold&&V.open&&vw.contains(e.target)&&/^(INPUT|TEXTAREA)$/.test(e.target.tagName)){KB.hold=true;KB.w=app.offsetWidth;KB.h=app.offsetHeight;KB.until=0;}});
document.addEventListener("focusout",()=>{if(KB.hold)KB.until=performance.now()+800;});
// An Enter that only confirms an IME composition must not submit the quick-edit (or any other) form.
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.isComposing||e.keyCode===229)&&e.target?.form)e.preventDefault();},true);
function fitRect(im){const W=app.offsetWidth,H=viewerHeight(),top=parseFloat(getComputedStyle(app).getPropertyValue("--safe-top"))+58,bot=200,aw=W-0,ah=H-top-bot,R=im.w/im.h;
  let w=aw,h=w/R;if(h>ah){h=ah;w=h*R;}return{x:(W-w)/2,y:top+(ah-h)/2,w,h};}
// The grid thumbnail is already decoded, so it paints on the first frame; the preview replaces it
// only once fully decoded, so open, swipe and the fly handoff never show a blank or half-drawn slide.
function showProgressive(image,im,urgent){
  const low=src(im),high=picture(im);
  if(!high||high===low||typeof Image!=="function"){image.src=high||low;return;}
  image.src=low;image.dataset.want=high;
  const loader=new Image();loader.decoding="async";if("fetchPriority" in loader)loader.fetchPriority=urgent?"high":"low";
  const clear=()=>{loader.onload=loader.onerror=null;};
  const swap=()=>{clear();if(image.dataset.want===high&&image.getAttribute("src")!==high)image.src=high;};
  const canDecode=typeof loader.decode==="function";loader.onerror=clear;if(!canDecode)loader.onload=swap;loader.src=high;
  if(canDecode)loader.decode().then(swap,clear);
}
function layoutSlides(){
  if(typeof StudioZoom!=="undefined")StudioZoom.reset();
  track.style.transform="";
  const old=new Map($$(".slide",track).map(el=>[el.dataset.id,el]));
  for(const o of [-1,0,1]){const id=V.list[V.i+o];if(!id||!img(id))continue;const im=img(id),r=fitRect(im);let slide=old.get(id);old.delete(id);
    if(!slide){slide=document.createElement("div");slide.className="slide";slide.dataset.id=id;const image=document.createElement("img");image.alt="";image.draggable=false;image.decoding="async";showProgressive(image,im,o===0);slide.append(image);}
    slide.dataset.o=o;slide.style.transform=`translateX(calc(${o} * (100% + 20px)))`;Object.assign($("img",slide).style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px',transform:''});track.append(slide);
  }
  for(const el of old.values())el.remove();
  const im=img(V.list[V.i]),c=coll(im?.coll);
  $("#v-count").textContent=V.list.length>1?`${V.i+1} / ${V.list.length}`:"1 / 1";
  $("#v-sub").textContent=c?c.name:"参考图";
  updQuickMeta();
}
const curImg=()=>$('.slide[data-o="0"] img',track);
const srcTile=id=>{const t=$(`#page .tile[data-id="${id}"]`);if(!t)return null;const s=t.closest(".scroll,.recent");const r=t.getBoundingClientRect(),a=$("#page .scroll").getBoundingClientRect();return r.bottom>a.top+4&&r.top<a.bottom-4&&r.right>a.left&&r.left<a.right?t:null;};
function openViewer(id,listKind,opts={}){
  if(V.open)return;V.gen++;V.list=listFor(listKind,id);V.i=Math.max(0,V.list.indexOf(id));V.open=true;
  vw.classList.add("open");vw.classList.remove("chrome-off","redraw");app.classList.add("dark-sb");layoutSlides();
  const cur=curImg(),tile=srcTile(id),to=rectOf(cur);
  V.bgAnim?.cancel();vbg.style.opacity="0";
  V.bgAnim=vbg.animate([{opacity:0},{opacity:1}],{duration:D(280),easing:E.std,fill:"forwards"});
  V.bgAnim.finished.then(()=>{vbg.style.opacity="1";V.bgAnim?.cancel();V.bgAnim=null;}).catch(()=>{});
  $$(".v-top,.v-actions",vw).forEach(e=>e.animate([{opacity:0},{opacity:1}],{duration:D(220),delay:D(160),fill:"backwards",easing:E.std}));
  if(tile&&!RM){const from=rectOf(tile);cur.style.visibility="hidden";tile.style.visibility="hidden";V.hidden=tile;
    fly(from,to,src(img(id)),380,12,3,vw).then(()=>{cur.style.visibility="";});}
  else cur.animate([{opacity:0,transform:"scale(.94)"},{opacity:1,transform:"none"}],{duration:D(260),easing:E.emph});
  pushLayer("viewer",closeViewer);placeToast();
  if(opts.redraw)setTimeout(enterRedraw,D(420));
}
function closeViewer(){
  if(!V.open)return;cancelViewerDrag();finishSlide?.();exitRedraw();V.open=false;
  const id=V.list[V.i],cur=curImg(),zoomed=StudioZoom.isZoomed(),visual=StudioZoom.stop()||cur;if(V.hidden){V.hidden.style.visibility="";V.hidden=null;}
  const tile=srcTile(id),from=cur?rectOf(cur):null;
  const op=getComputedStyle(vbg).opacity;V.bgAnim?.cancel();
  vbg.animate([{opacity:op},{opacity:0}],{duration:D(260),easing:E.std,fill:"forwards"});vbg.style.opacity="0";
  $$(".v-top,.v-actions",vw).forEach(e=>e.animate([{opacity:1},{opacity:0}],{duration:D(120),fill:"forwards"}).finished.then(a=>a.cancel()));
  app.classList.remove("dark-sb");
  const g=V.gen,finish=()=>{if(V.gen!==g||V.open)return;vw.classList.remove("open");StudioZoom.reset();track.innerHTML="";placeToast();if($("#page .top")&&!topScreen())refresh();};
  if(!zoomed&&tile&&from&&!RM){cur.style.visibility="hidden";tile.style.visibility="hidden";
    fly(from,rectOf(tile),src(img(id)),320,3,12,vw).then(()=>{tile.style.visibility="";finish();});}
  else if(visual)visual.animate(zoomed?[{opacity:1},{opacity:0}]:[{opacity:1,transform:visual.style.transform||"none"},{opacity:0,transform:"scale(.9)"}],{duration:D(220),easing:E.exit,fill:"forwards"}).finished.then(finish);
  else finish();
}
let finishSlide=null,viewerFrame=null,tapTimer=null,lastTap=null;
function viewerTap(e){
  const t=performance.now(),p={clientX:e.clientX,clientY:e.clientY};
  if(lastTap&&t-lastTap.t<280&&Math.hypot(p.clientX-lastTap.clientX,p.clientY-lastTap.clientY)<32){clearTimeout(tapTimer);tapTimer=null;lastTap=null;StudioZoom.toggleAt(p);return;}
  lastTap={...p,t};clearTimeout(tapTimer);
  tapTimer=setTimeout(()=>{tapTimer=null;lastTap=null;if(V.open&&!V.redraw)vw.classList.toggle("chrome-off");},260);
}
function slideTo(dir,dx=0,velocity=0){
  const W=app.offsetWidth+20,target=-dir*W,generation=V.gen;
  const animation=track.animate([{transform:`translate3d(${dx}px,0,0)`},{transform:`translate3d(${target}px,0,0)`}],{duration:D(clamp(Math.abs(target-dx)/Math.max(1.4,Math.abs(velocity)),140,260)),easing:E.emph});
  track.style.transform=`translate3d(${target}px,0,0)`;
  const commit=()=>{if(finishSlide!==commit)return;finishSlide=null;animation.cancel();if(!V.open||V.gen!==generation)return;V.i+=dir;layoutSlides();};finishSlide=commit;animation.finished.then(commit,()=>{});
}
let drag=null;
function cancelViewerDrag(){if(viewerFrame!==null)cancelAnimationFrame(viewerFrame);viewerFrame=null;drag=null;}
function paintViewerDrag(){viewerFrame=null;if(!drag||!V.open||V.redraw)return;const d=drag;
  if(d.axis==="x")track.style.transform=`translate3d(${d.dx}px,0,0)`;
  else if(d.axis==="y"){const c=curImg();if(c)c.style.transform=`translate3d(${d.dx*.6}px,${d.dy}px,0) scale(${Math.max(.72,1-d.dy/1100)})`;vbg.style.opacity=String(1-Math.min(d.dy/420,.9));}
}
stage.addEventListener("pointerdown",e=>{if(!V.open||e.button>0)return;if(V.redraw){if(e.pointerType!=="touch")selStart(e);return;}finishSlide?.();track.getAnimations?.().forEach(a=>a.cancel());curImg()?.getAnimations?.().forEach(a=>a.cancel());const r=app.getBoundingClientRect();drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now(),lastX:e.clientX,lastT:performance.now(),s:r.width/app.offsetWidth||1,axis:null,dx:0,dy:0,velocity:0};stage.setPointerCapture(e.pointerId);});
stage.addEventListener("pointermove",e=>{
  if(V.redraw){if(e.pointerType!=="touch")selMove(e);return;}if(!drag||e.pointerId!==drag.pointer)return;const s=drag.s;let dx=(e.clientX-drag.x)/s,dy=(e.clientY-drag.y)/s;
  const time=performance.now(),dt=Math.max(1,time-drag.lastT);drag.velocity=drag.velocity*.4+(e.clientX-drag.lastX)/s/dt*.6;drag.lastX=e.clientX;drag.lastT=time;
  if(!drag.axis){if(Math.hypot(dx,dy)<8)return;drag.axis=Math.abs(dx)>Math.abs(dy)?"x":dy>0?"y":"n";if(drag.axis==="y")vw.classList.add("chrome-off");}
  if(drag.axis==="x"){if((V.i===0&&dx>0)||(V.i===V.list.length-1&&dx<0))dx*=.3;drag.dx=dx;}
  else if(drag.axis==="y"){drag.dy=Math.max(0,dy);drag.dx=dx;}
  if(viewerFrame===null)viewerFrame=requestAnimationFrame(paintViewerDrag);
});
const dragEnd=e=>{
  if(V.redraw){if(e.pointerType!=="touch"){if(e.type==="pointercancel")selCancel();else selEnd();}return;}if(!drag||e.pointerId!==drag.pointer)return;if(viewerFrame!==null)cancelAnimationFrame(viewerFrame);paintViewerDrag();const d=drag;cancelViewerDrag();
  if(!d.axis){if(e.type!=="pointercancel"&&performance.now()-d.t<350)viewerTap(e);return;}
  if(d.axis==="x"){const velocity=performance.now()-d.lastT<90?d.velocity:0,advance=Math.abs(d.dx)>64||Math.abs(d.dx)>24&&Math.abs(velocity)>.35&&Math.sign(velocity)===Math.sign(d.dx);
    if(e.type!=="pointercancel"&&advance&&d.dx<0&&V.i<V.list.length-1)slideTo(1,d.dx,velocity);else if(e.type!=="pointercancel"&&advance&&d.dx>0&&V.i>0)slideTo(-1,d.dx,velocity);
    else{track.animate([{transform:`translate3d(${d.dx}px,0,0)`},{transform:"none"}],{duration:D(180),easing:E.emph});track.style.transform="";}}
  else if(d.axis==="y"){if(e.type!=="pointercancel"&&d.dy>110)back();else{const c=curImg();c.animate([{transform:c.style.transform},{transform:"none"}],{duration:D(280),easing:E.emph});c.style.transform="";vbg.style.opacity="1";vw.classList.remove("chrome-off");}}
};
stage.addEventListener("pointerup",dragEnd);stage.addEventListener("pointercancel",dragEnd);

/* ---- redraw ---- */
function enterRedraw(){if(!V.open||V.redraw)return;document.activeElement?.blur();cancelViewerDrag();finishSlide?.();track.getAnimations?.().forEach(a=>a.cancel());track.style.transform='';StudioZoom.fit();V.fitRect=fitRect(img(V.list[V.i]));V.redraw=true;Object.assign(V,{regions:[],active:-1,shared:false,sharedText:""});
  vw.classList.add("redraw");vw.classList.remove("chrome-off");$("#rd-text").value="";$("#rd-shared-sw").classList.remove("on");renderRegions();updRedraw();pushLayer("redraw",exitRedraw);placeToast();}
function exitRedraw(){if(!V.redraw)return;selCancel();document.activeElement?.blur();V.redraw=false;vw.classList.remove("redraw");$$(".sel",stage).forEach(e=>e.remove());$("#rd-dim")?.remove();V.regions=[];}
let sd=null;
const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
function selStart(e){
  if(e.target.closest(".sel .rm")||sd)return;
  const c=curImg();if(!c)return;const r=V.fitRect||fitRect(img(V.list[V.i])),a=app.getBoundingClientRect(),screenScale=a.width/app.offsetWidth||1,p={x:(e.clientX-a.left)/screenScale,y:(e.clientY-a.top)/screenScale};
  if(p.x<r.x||p.x>r.x+r.w||p.y<r.y||p.y>r.y+r.h)return;document.activeElement?.blur();e.preventDefault?.();
  const hit=V.regions.findIndex(g=>p.x>=g.x&&p.x<=g.x+g.w&&p.y>=g.y&&p.y<=g.y+g.h);
  if(hit>=0){selectRegion(hit);return;}
  if(V.regions.length>=6){toast("最多 6 个区域");return;}
  sd={r,a,screenScale,pointer:e.pointerId,x0:p.x,y0:p.y,t:{x:0,y:0,w:0,h:0}};if(e.pointerId!==undefined)stage.setPointerCapture(e.pointerId);
  const el=document.createElement("div");el.className="sel";el.innerHTML='<b class="no"></b><span class="sz"></span>';stage.append(el);sd.el=el;selDraw(sd.x0,sd.y0);}
function selMove(e){if(!sd)return;const p={x:(e.clientX-sd.a.left)/sd.screenScale,y:(e.clientY-sd.a.top)/sd.screenScale};selDraw(clamp(p.x,sd.r.x,sd.r.x+sd.r.w),clamp(p.y,sd.r.y,sd.r.y+sd.r.h));}
function selCancel(){selectionTouch=null;if(!sd)return;sd.el.remove();sd=null;updDim();}
function selDraw(x1,y1){const t=sd.t;t.x=Math.min(sd.x0,x1);t.y=Math.min(sd.y0,y1);t.w=Math.abs(x1-sd.x0);t.h=Math.abs(y1-sd.y0);
  Object.assign(sd.el.style,{left:t.x+"px",top:t.y+"px",width:t.w+"px",height:t.h+"px"});
  const im=img(V.list[V.i]),k=im.w/sd.r.w,ov=V.regions.findIndex(g=>overlaps(g,t));
  sd.el.classList.toggle("bad",ov>=0);$(".no",sd.el).textContent=ov>=0?`与 #${ov+1} 重叠`:`#${V.regions.length+1}`;$(".sz",sd.el).textContent=`${Math.round(t.w*k)}×${Math.round(t.h*k)}`;updDim(t);}
function selEnd(){if(!sd)return;const t={...sd.t},el=sd.el;sd=null;
  if(t.w<14||t.h<14){el.remove();updDim();return;}
  if(V.regions.some(g=>overlaps(g,t))){el.animate([{opacity:1},{opacity:0,transform:"scale(.96)"}],{duration:D(220),fill:"forwards"}).finished.then(()=>{el.remove();updDim();});toast("选区不能重叠：合成时无法确定像素归属");return;}
  el.remove();V.regions.push({...t,text:"",fresh:true});selectRegion(V.regions.length-1);
}
let selectionTouch=null;
for(const type of ["touchstart","touchmove","touchend","touchcancel"])stage.addEventListener(type,e=>{
  if(!V.open||!V.redraw||e.target.closest(".sel .rm"))return;
  if(type==="touchstart"){
    if(e.touches.length!==1){selCancel();selectionTouch=null;e.preventDefault();return;}
    selectionTouch=e.changedTouches[0].identifier;
  }
  const touch=Array.from(e.changedTouches).find(t=>t.identifier===selectionTouch);if(!touch)return;e.preventDefault();e.stopImmediatePropagation();
  const point={clientX:touch.clientX,clientY:touch.clientY,target:e.target};
  if(type==="touchstart")selStart(point);else if(type==="touchmove")selMove(point);else{if(type==="touchcancel")selCancel();else{selMove(point);selEnd();}selectionTouch=null;}
},{capture:true,passive:false});
function selectRegion(i){V.active=i;renderRegions();const ta=$("#rd-text");ta.value=V.shared?V.sharedText:(V.regions[i]?.text||"");
  ta.placeholder=V.shared?"描述所有区域要做的修改…":i>=0?`描述区域 #${i+1} 需要修改的内容…`:"描述选区里需要修改的内容…";updRedraw();}
function rdInput(){const v=$("#rd-text").value;if(V.shared)V.sharedText=v;else if(V.regions[V.active])V.regions[V.active].text=v;renderChips();updRedraw();}
function renderRegions(){
  $$(".sel",stage).forEach(e=>e.remove());const c=curImg();if(!c)return;const im=img(V.list[V.i]),k=im.w/rectOf(c).w;
  V.regions.forEach((g,i)=>{const el=document.createElement("div");el.className=`sel${i===V.active?" on":""}${g.fresh?" enter":""}`;g.fresh=false;
    Object.assign(el.style,{left:g.x+"px",top:g.y+"px",width:g.w+"px",height:g.h+"px"});
    el.innerHTML=`<b class="no">#${i+1}</b><span class="sz">${Math.round(g.w*k)}×${Math.round(g.h*k)}</span><button class="rm" data-act="rd-rm" data-i="${i}" aria-label="删除区域 ${i+1}">${icon("x",12)}</button>`;stage.append(el);});
  updDim();renderChips();}
function renderChips(){const box=$("#rd-chips"),n=V.regions.length;box.style.display=n?"flex":"none";
  box.innerHTML=V.regions.map((g,i)=>{const ok=(V.shared?V.sharedText:g.text).trim();return `<button class="rd-chip${i===V.active?" on":""}" data-act="rd-pick" data-i="${i}">#${i+1}${ok?icon("check",13):""}</button>`;}).join("");}
function updDim(tmp){let d=$("#rd-dim");const list=[...V.regions,...(tmp?[tmp]:[])];if(!list.length){d?.remove();return;}
  const W=app.offsetWidth,H=viewerHeight();
  if(!d){d=document.createElementNS("http://www.w3.org/2000/svg","svg");d.id="rd-dim";d.setAttribute("class","rd-dim");d.innerHTML='<path fill-rule="evenodd" fill="rgba(0,0,0,.5)"/>';stage.append(d);}
  d.style.width=W+"px";d.style.height=H+"px";
  d.setAttribute("viewBox",`0 0 ${W} ${H}`);d.firstChild.setAttribute("d",`M0 0H${W}V${H}H0Z`+list.map(g=>`M${g.x} ${g.y}h${g.w}v${g.h}h${-g.w}Z`).join(""));}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function local(e){const a=app.getBoundingClientRect(),s=sc();return{x:(e.clientX-a.left)/s,y:(e.clientY-a.top)/s};}
function updRedraw(){const n=V.regions.length,cap=S.settings.concurrency,missing=V.shared?(V.sharedText.trim()?[]:V.regions):V.regions.filter(g=>!g.text.trim());
  const b=$("#rd-submit");b.disabled=!n||missing.length>0;
  b.textContent=!n?"提交重绘":missing.length&&!V.shared&&n>1?`#${V.regions.indexOf(missing[0])+1} 还没写要求`:n>1?`并行重绘 ${n} 个区域`:"提交重绘";
  $("#rd-hint").textContent=n?`已框选 ${n} 个区域 · 点区域编辑，空白处继续框选`:"在图上拖动框选区域，可以框选多个";
  $("#rd-note").textContent=n>1?`${n} 个区域并行${n>cap?`（并发 ${cap} 路）`:""} · 完成后合成为一张新图`:"只替换选区内像素，选区外保持原图";
  $("#rd-shared").style.display=n>1?"flex":"none";}

/* ================= actions ================= */

function collForTemplate(tid){return coll(tid?"tpl-"+tid:"untemplated")||{id:tid?"tpl-"+tid:"untemplated",name:tpl(tid)?.name||"无模板"};}
function holdBadge(){badgeHold=Date.now()+D(560);setTimeout(updateChrome,D(580));}
function generate(...args){return StudioService.generate(...args);}
function goBatch(bid){const b=S.batches.find(x=>x.id===bid);if(!b)return;
  S.filter=["active","failed","done"].find(f=>bfilter(b,f));S.expanded.add(bid);
  closeOverlays().then(()=>vt("tab",()=>{S.tab="queue";renderPage();})).then(()=>{const el=$(`.batch[data-id="${bid}"]`);if(el){el.scrollIntoView({block:"center",behavior:RM?"auto":"smooth"});el.classList.add("hl");setTimeout(()=>el.classList.remove("hl"),1700);}});}
function flashChip(){setTimeout(()=>{const c=$("#into-chip")||$(".into-chip");if(c){c.classList.remove("flash");void c.offsetWidth;c.classList.add("flash");}},D(260));}
function useAsRef(id){const c=S.composer;if(!c.refs.includes(id)){if(c.refs.length>=8)return toast("最多 8 张参考图");c.refs.push(id);}
  toast(`已加入参考图（${c.refs.length}/8）`,{action:"去创作",run:()=>closeOverlays().then(()=>{S.mode="gen";if(S.tab==="create")renderPage();else return go("create");})});}
function reroll(...args){return StudioService.reroll(...args);}
function deleteImage(...args){return StudioService.deleteImage(...args);}
function loadTemplate(...args){return StudioService.loadTemplate(...args);}

/* ---- sheets content ---- */
function paramsSheet(){openSheet({title:"生成参数",html:paramsBody()});}
function paramsBody(){
  const c=S.composer,o=(k,v,lab=v,sub="")=>`<button class="opt${sub?" tall":""}${c[k]===v?" on":""}" data-act="opt" data-k="${k}" data-v="${v}">${lab}${sub?`<small>${sub}</small>`:""}</button>`;
  const sw=(k,lab,sub)=>`<button class="row" data-act="sw" data-k="${k}" data-layout="width:100%"><span class="rl">${lab}<small>${sub}</small></span><span class="switch ${c[k]?"on":""}"></span></button>`;
  return `
    <div class="field-label">画幅</div><div class="opts">${["1:1","3:2","2:3","16:9","9:16","自动"].map(v=>o("ratio",v)).join("")}</div>
    <div class="row" data-layout="margin-top:8px"><span class="rl">数量<small>每张为独立会话</small></span><span class="stepper"><button data-act="cnt" data-d="-1" aria-label="减少">${icon("minus",18)}</button><output id="cnt">${c.count}</output><button data-act="cnt" data-d="1" aria-label="增加">${icon("plus",18)}</button></span></div>
    <div class="field-label">图像尺寸</div><div class="opts c4">${["自动","1K","2K","4K"].map(v=>o("size",v)).join("")}</div>
    <p class="note">作为原生生图要求传给模型；实际尺寸以图片详情为准。</p>
    ${sw("polish","帮我润色","由模型补全构图、光线与风格")}${sw("transparent","透明背景","由生图工具决定是否支持")}
    <div class="field-label">生成后超分</div><div class="opts c4">${o("stitch","关")}${Object.keys(FACTORS).map(v=>o("stitch",v,v,FACTORS[v]+" 级")).join("")}</div>
    <p class="note">每张生成完成后自动加入该倍率的超分任务。只超分已有图片，请用创作页顶部的“超分”。</p>
    <button class="field-label model-choice" data-act="model-composer">思考强度 · ${esc(StudioService.modelName(c.model))}${icon("chevd",14)}</button><div class="opts c5">${(StudioService.models().find(m=>m.id===c.model)?.efforts||[c.effort]).map(v=>o("effort",v)).join("")}</div>
    <div class="btn-row" data-layout="margin-top:18px"><button class="secondary" data-act="params-reset" data-layout="flex:1;justify-content:center">${icon("refresh",16)}恢复默认值</button><button class="secondary" data-act="params-default" data-layout="flex:1;justify-content:center">${icon("check",16)}设为默认</button></div>`;
}
function tplMenuSheet(){
  const L=openSheet({title:"模板",html:`${S.templates.map(t=>`<button class="menu-row" data-act="tpl-load" data-id="${t.id}">${icon("book",20)}<span>${esc(t.name)}</span><span class="rt">${S.composer.template===t.id?"当前":""}</span></button>`).join("")}<div class="menu-sep"></div><button class="menu-row" data-act="tpl-save-form">${icon("plus",20)}<span>将当前内容保存为模板</span></button>`});
  return L;
}
function tplSaveForm(...args){return StudioService.tplSaveForm(...args);}
function imageMenu(id,fromViewer){
  const im=img(id);if(!im)return;
  const rows=fromViewer?[["native","以原始像素查看","select"],["fav",im.fav?"取消收藏":"收藏","star"],["info","名称与标签","edit"],["dl","下载原图","download"]]
    :[["quick","速改…","edit"],["fav",im.fav?"取消收藏":"收藏","star"],["ref","用作参考图","imgplus"],["reroll","再抽一张","refresh"],["redraw","局部重绘","select"],["up","发送到超分","grid"],["dl","下载","download"]];
  openSheet({html:`<div class="sheet-hd"><img src="${src(im)}" alt=""><div><b>${esc(im.name)}</b><span>${im.w} × ${im.h} · ${esc(coll(im.coll)?.name||"")}</span></div></div>
    ${rows.map(([a,l,i])=>`<button class="menu-row" data-act="im-${a}" data-id="${id}">${icon(i,20)}<span>${l}</span></button>`).join("")}
    <div class="menu-sep"></div><button class="menu-row danger" data-act="im-del" data-id="${id}">${icon("trash",20)}<span>删除</span><span class="rt">可在最近删除恢复</span></button>`});
}
function infoSheet(...args){return StudioService.infoSheet(...args);}
function upscaleSheet(...args){return StudioService.upscaleSheet(...args);}
function pickerSheet(...args){return StudioService.pickerSheet(...args);}
function meSheet(...args){return StudioService.meSheet(...args);}
function tplSheet(...args){return StudioService.tplSheet(...args);}

/* ---- dispatcher ---- */
let lp=null,lpFired=false;
app.addEventListener("pointerdown",e=>{const t=e.target.closest("#page .tile");if(!t||e.button>0)return;
  lp={t,x:e.clientX,y:e.clientY,timer:setTimeout(()=>{lpFired=true;t.classList.remove("pressing");t.animate([{transform:"scale(.94)"},{transform:"scale(1.03)"},{transform:"scale(1)"}],{duration:D(320),easing:E.std});navigator.vibrate?.(10);imageMenu(t.dataset.id);lp=null;},480)};t.classList.add("pressing");});
const lpCancel=()=>{if(lp){clearTimeout(lp.timer);lp.t.classList.remove("pressing");lp=null;}};
app.addEventListener("pointermove",e=>{if(lp&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>10)lpCancel();});
app.addEventListener("pointerup",lpCancel);app.addEventListener("pointercancel",lpCancel);
app.addEventListener("contextmenu",e=>{const t=e.target.closest("#page .tile");if(t){e.preventDefault();lpCancel();imageMenu(t.dataset.id);}});

app.addEventListener("click",async e=>{
  try{
  const a=e.target.closest("[data-act]");if(!a)return;
  if(lpFired){lpFired=false;if(a.dataset.act==="img")return;}
  const k=a.dataset.act,id=a.dataset.id;
  if(await StudioService.action(k,a,e))return;
  switch(k){
    case"tab":go(a.dataset.tab);break;
    case"clear-all":{const c=S.composer,snap={prompt:c.prompt,refs:[...c.refs],template:c.template,ack:c.ack},ta=$("#prompt");
      const apply=()=>{Object.assign(c,{prompt:"",refs:[],template:null,ack:false});if(ta)ta.value="";refresh();};
      if(ta&&!RM)ta.animate([{opacity:1,filter:"blur(0)"},{opacity:0,filter:"blur(4px)"}],{duration:160,easing:E.exit}).finished.then(()=>{apply();ta.animate([{opacity:0},{opacity:1}],{duration:180});});else apply();
      toast("已清空正文、参考图与模板 · 参数保留",{action:"撤销",ms:5000,run:()=>{Object.assign(c,snap);if(S.tab==="create"){$("#prompt").value=c.prompt;refresh();flashChip();}}});break;}
    case"settings":await back();openSettings();break;
    case"scr-back":back();break;
    case"set-toggle":{const p=a.dataset.p,v=!getP(p);setP(p,v);$(".switch",a).classList.toggle("on",v);settingChanged(p);break;}
    case"set-seg":{const p=a.dataset.p;setP(p,a.dataset.v);$$("button",a.parentElement).forEach(x=>x.classList.toggle("on",x===a));settingChanged(p);break;}
    case"set-step":{const p=a.dataset.p,v=clamp(getP(p)+ +a.dataset.d,+a.dataset.min,+a.dataset.max);if(v===getP(p)){a.parentElement.animate([{transform:"translateX(0)"},{transform:`translateX(${a.dataset.d*4}px)`},{transform:"none"}],{duration:D(200)});break;}
      setP(p,v);const o=$(`[data-out="${p}"]`,topScreen());o.textContent=v;o.animate([{transform:`translateY(${a.dataset.d>0?6:-6}px)`,opacity:.3},{transform:"none",opacity:1}],{duration:D(200),easing:E.emph});settingChanged(p);break;}
    case"prompt-edit":promptEditor(a.dataset.k);break;
    case"inj-edit":injEditor();break;
    case"qe-chip":{const inp=$("#qe-input");inp.value=a.textContent;$("#qe-send").disabled=false;inp.focus();break;}
    case"qe-settings":if(topSheet())await back();openSettings("set-quick");break;
    case"im-quick":await back();quickSheet(id);break;
    case"failure":await closeOverlays();openFailure(id);break;
    case"fx-pane":FX.pane=a.dataset.v;FX.cmp=null;fxRender();{const st=$(".fx-stage",topScreen());st&&st.animate([{opacity:.4},{opacity:1}],{duration:D(220),easing:E.std});}break;
    case"fx-tile":{const i=+a.dataset.i;FX.sel.has(i)?FX.sel.delete(i):FX.sel.add(i);fxSel();break;}
    case"fx-sel":{const lv=fxTask().up.levels[fxTask().up.cur],v=a.dataset.v;FX.sel=new Set(v==="none"?[]:lv.tiles.filter(x=>v==="all"||x.state!=="done").map(x=>x.i));if(v==="all")FX.showOk=true;fxRender();break;}
    case"fx-showok":FX.showOk=!FX.showOk;fxRender();break;
    case"fx-cmp-close":FX.cmp=null;fxRender();break;
    case"fx-side":{FX.side=a.dataset.v;const c=$(".cmp",topScreen());c.classList.toggle("side-input",FX.side==="input");c.classList.toggle("side-output",FX.side==="output");$$('[data-act="fx-side"]',topScreen()).forEach(x=>x.classList.toggle("on",x===a));$("#cmp-tag").textContent=FX.side==="input"?"输入（含重叠）":"模型原始返回";break;}
    case"fx-latest":$("#fx-latest-sw").classList.toggle("on");FX.latest=!FX.latest;break;
    case"fx-cc":openSettings("set-queue");break;
    case"me":meSheet();break;
    case"sheet-close":back();break;
    case"generate":generate();break;
    case"params":paramsSheet();break;
    case"opt":{const kk=a.dataset.k;S.composer[kk]=a.dataset.v;$$(`.opt[data-k="${kk}"]`,a.closest(".sheet")).forEach(x=>x.classList.toggle("on",x===a));refresh();break;}
    case"sw":{const kk=a.dataset.k;S.composer[kk]=!S.composer[kk];$(".switch",a).classList.toggle("on",S.composer[kk]);refresh();break;}
    case"cnt":{const c=S.composer;c.count=clamp(c.count+ +a.dataset.d,1,20);const o=$("#cnt");o.textContent=c.count;o.animate([{transform:`translateY(${a.dataset.d>0?6:-6}px)`,opacity:.3},{transform:"none",opacity:1}],{duration:D(200),easing:E.emph});refresh();break;}
    case"tpl-menu":tplMenuSheet();break;
    case"tpl-load":loadTemplate(id);break;
    case"sw-bind":$("#bind-sw").classList.toggle("on");break;
    case"detach":S.composer.template=null;S.composer.ack=false;updateInto();toast("已改为无模板");break;
    case"dv-keep":S.composer.ack=true;updateInto();break;
    case"pick-refs":pickerSheet();break;
    case"rm-ref":{const el=a.closest(".ref");await el.animate([{opacity:1,transform:"scale(1)"},{opacity:0,transform:"scale(.7)"}],{duration:D(180),easing:E.exit,fill:"forwards"}).finished;S.composer.refs=S.composer.refs.filter(x=>x!==id);refresh();break;}
    case"bp":openColl(a.dataset.coll);break;
    case"coll":openColl(id);break;
    case"coll-back":back();break;
    case"open-coll":await closeOverlays();if(S.coll===id&&S.tab==="works")break;if(S.coll){S.coll=null;}openColl(id);break;
    case"img":openViewer(id,a.dataset.list);break;
    case"goto-batch":goBatch(id);break;
    case"qf":if(S.filter!==a.dataset.f){S.filter=a.dataset.f;$("#batches").dataset.ready="";$("#batches").innerHTML="";updateQueue();$$("#batches .batch").forEach((el,i)=>el.animate([{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"none"}],{duration:D(300),delay:D(i*30),easing:E.emph,fill:"backwards"}));}break;
    case"bt":{const el=a.closest(".batch");el.classList.toggle("open");el.classList.contains("open")?S.expanded.add(id):S.expanded.delete(id);break;}
    case"tpl":tplSheet(id);break;
    case"v-back":back();break;
    case"v-info":infoSheet(V.list[V.i]);break;
    case"v-more":imageMenu(V.list[V.i],true);break;
    case"v-ref":useAsRef(V.list[V.i]);break;
    case"v-reroll":reroll(V.list[V.i]);break;
    case"v-redraw":enterRedraw();break;
    case"v-up":upscaleSheet(V.list[V.i]);break;
    case"rd-cancel":back();break;
    case"rd-rm":{V.regions.splice(+a.dataset.i,1);const k=Math.min(V.active,V.regions.length-1);selectRegion(k);break;}
    case"rd-pick":selectRegion(+a.dataset.i);$("#rd-text").focus({preventScroll:true});break;
    case"rd-shared":{V.shared=!V.shared;$("#rd-shared-sw").classList.toggle("on",V.shared);if(V.shared&&!V.sharedText)V.sharedText=V.regions[V.active]?.text||"";selectRegion(V.active);break;}
    case"mode":{const v=a.dataset.v;if(S.mode===v)break;const seg=a.parentElement;$$("button",seg).forEach(x=>x.classList.toggle("on",x===a));placeInd(seg);
      const sc0=$("#page .scroll"),bar=$("#page .gen-bar");await Promise.all([sc0,bar].map(e=>e.animate([{opacity:1},{opacity:0,transform:"translateY(6px)"}],{duration:D(130),easing:E.exit,fill:"forwards"}).finished));
      S.mode=v;renderPage();$$("#page .scroll,#page .gen-bar").forEach(e=>e.animate([{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"none"}],{duration:D(260),easing:E.emph}));break;}
    case"cu-f":S.upc.factor=a.dataset.v;$$("#cu-f .opt").forEach(x=>x.classList.toggle("on",x===a));refresh();$("#cu-plan .up-plan")?.animate([{opacity:.3},{opacity:1}],{duration:D(220)});break;
    case"cu-src":S.upc.src=id;refresh();break;
    case"cu-pick":pickerSheet({single:true,title:"选择要超分的图片",onPick:pid=>{S.upc.src=pid;refresh();}});break;
    case"use-prompt":{const im=img(id),c=coll(im.coll);Object.assign(S.composer,{prompt:im.prompt,template:c?.template||null,ratio:StudioService.requestedRatio(im.id),ack:false});await closeOverlays();S.tab==="create"?renderPage():await go("create");flashChip();break;}
    // image menu
    case"im-ref":await back();useAsRef(id);break;
    case"im-reroll":await back();reroll(id);break;
    case"im-redraw":await back();openViewer(id,S.coll?"coll":"recent",{redraw:true});break;
    case"im-up":await back();upscaleSheet(id);break;
    case"im-info":await back();infoSheet(id);break;
    case"im-del":{await back();if(V.open&&V.list[V.i]===id){await back();}deleteImage(id);break;}
  }
  }catch(error){StudioService.report(error);}
});
app.addEventListener("input",e=>{
  if(e.target.id==="prompt"){S.composer.prompt=e.target.value;updateInto();}
  if(e.target.id==="cu-inj")S.upc.inj=e.target.value;
  if(e.target.id==="rd-text")rdInput();
});
app.addEventListener("change",e=>{if(e.target.dataset.edit)StudioService.editImage(e.target).catch(StudioService.report);});
app.addEventListener("focusin",e=>{if(e.target.id==="prompt"){app.classList.add("typing");placeToast();}});
app.addEventListener("focusout",e=>{if(e.target.id==="prompt"){app.classList.remove("typing");placeToast();}});


/* ================= quick edit ================= */
const QE_CHIPS=["换成白天","去掉画面里的文字","背景虚化","更有电影感","色调更暖","换成雨天"];
function quickSpec(im){const q=S.settings.quick;
  return q.keepSpec?`按原图规格 · ${im.ratio} · ${im.w}×${im.h} · ${q.effort}`:`按创作参数 · ${S.composer.ratio} · ${q.effort}`;}
function updQuickMeta(){const im=img(V.list[V.i]);if(!im)return;$("#qe-meta").textContent=quickSpec(im)+(S.settings.quick.into==="same"?"":" · 归入无模板");}
$("#qe-chips").innerHTML=QE_CHIPS.map(c=>`<button type="button" data-act="qe-chip">${c}</button>`).join("");
function sendQuick(...args){return StudioService.sendQuick(...args);}
function quickSheet(id){const im=img(id);
  openSheet({title:"速改",cls:"qe-sheet",html:`<div class="sheet-hd"><img src="${src(im)}" alt=""><div><b>${esc(im.name)}</b><span>${quickSpec(im)}</span></div></div>
    <form class="qe-bar" id="qs-form" autocomplete="off"><input id="qs-input" placeholder="一句话描述要改什么" enterkeyhint="send" maxlength="400"><button class="qe-send" type="submit" disabled aria-label="发送速改">${icon("arrowup",18)}</button></form>
    <div class="qe-chips">${QE_CHIPS.map(c=>`<button type="button" data-act="qs-chip">${c}</button>`).join("")}</div>
    <button class="qe-meta" data-act="qe-settings">结果${S.settings.quick.into==="same"?"归入原列表":"归入无模板"} · 在设置中调整 ${icon("chevr",12)}</button>`,
    onMount:L=>{const inp=$("#qs-input",L),btn=$("#qs-form button",L);
      inp.addEventListener("input",()=>btn.disabled=!inp.value.trim());
      $("#qs-form",L).addEventListener("submit",async e=>{e.preventDefault();if(!inp.value.trim())return;const v=inp.value;btn.disabled=true;try{if(await sendQuick(id,v))await back();}catch(e){StudioService.report(e);}finally{btn.disabled=!inp.value.trim();}});
      L.addEventListener("click",e=>{const c=e.target.closest('[data-act="qs-chip"]');if(c){inp.value=c.textContent;btn.disabled=false;inp.focus();}});
      setTimeout(()=>inp.focus({preventScroll:true}),D(360));}});
}
$("#qe-form").addEventListener("submit",async e=>{e.preventDefault();const inp=$("#qe-input"),btn=$("#qe-send");if(btn.disabled)return;btn.disabled=true;try{if(await sendQuick(V.list[V.i],inp.value)){inp.value="";inp.blur();}}catch(e){StudioService.report(e);}finally{btn.disabled=!inp.value.trim();}});
$("#qe-input").addEventListener("input",e=>{$("#qe-send").disabled=!e.target.value.trim();});
$("#qe-input").addEventListener("focus",()=>{vw.classList.add("qe-on");placeToast();});
["#qe-chips","#qe-send"].forEach(sel=>$(sel).addEventListener("mousedown",e=>e.preventDefault()));
$("#qe-input").addEventListener("blur",()=>setTimeout(()=>{if(document.activeElement?.id!=="qe-input"){vw.classList.remove("qe-on");placeToast();}},120));

/* ================= full-screen screens ================= */
function openScreen(html,{cls="",onMount,onClose}={}){
  const el=document.createElement("section");el.className="screen "+cls;el.innerHTML=html;$("#screens").append(el);hydrateIcons(el);
  el.animate([{transform:"translateX(100%)"},{transform:"none"}],{duration:D(380),easing:E.emph});
  let d=null;
  el.addEventListener("pointerdown",e=>{const p=local(e);if(p.x<22){d={x:e.clientX,dx:0};el.setPointerCapture(e.pointerId);}});
  el.addEventListener("pointermove",e=>{if(!d)return;d.dx=Math.max(0,(e.clientX-d.x)/sc());el.style.transform=`translateX(${d.dx}px)`;});
  el.addEventListener("pointerup",()=>{if(!d)return;if(d.dx>110){el.dataset.x=d.dx;back();}else{el.animate([{transform:`translateX(${d.dx}px)`},{transform:"none"}],{duration:D(240),easing:E.emph});el.style.transform="";}d=null;});
  pushLayer("screen",()=>{onClose&&onClose();el.style.pointerEvents="none";const x=+(el.dataset.x||0);el.animate([{transform:`translateX(${x}px)`},{transform:"translateX(100%)"}],{duration:D(260),easing:E.exit,fill:"forwards"}).finished.then(()=>{el.remove();placeToast();});});
  onMount&&onMount(el);placeToast();return el;
}
const topScreen=()=>$$("#screens .screen").filter(e=>e.style.pointerEvents!=="none").pop();

/* ================= settings ================= */
const getP=p=>p.split(".").reduce((o,k)=>o[k],S.settings);
const setP=(p,v)=>{const ks=p.split("."),last=ks.pop();ks.reduce((o,k)=>o[k],S.settings)[last]=v;};
const lbl=(l,sub)=>`<span class="s-l">${l}${sub?`<small>${sub}</small>`:""}</span>`;
const sSwitch=(p,l,sub)=>`<button class="s-row" data-act="set-toggle" data-p="${p}">${lbl(l,sub)}<span class="switch ${getP(p)?"on":""}"></span></button>`;
const sSeg=(p,opts,l,sub)=>`<div class="s-row col">${lbl(l,sub)}<div class="mini-seg">${opts.map(([v,t])=>`<button data-act="set-seg" data-p="${p}" data-v="${v}" class="${getP(p)===v?"on":""}">${t}</button>`).join("")}</div></div>`;
const sStep=(p,l,sub,min,max)=>`<div class="s-row">${lbl(l,sub)}<span class="stepper sm"><button data-act="set-step" data-p="${p}" data-d="-1" data-min="${min}" data-max="${max}" aria-label="减少">${icon("minus",16)}</button><output data-out="${p}">${getP(p)}</output><button data-act="set-step" data-p="${p}" data-d="1" data-min="${min}" data-max="${max}" aria-label="增加">${icon("plus",16)}</button></span></div>`;
const sLink=(l,right,act,extra="",sub="")=>`<button class="s-row" data-act="${act}" ${extra}>${lbl(l,sub)}<span class="s-r">${right}${icon("chevr",16)}</span></button>`;
const group=(id,title,body,foot="")=>`<section class="group" id="${id}"><div class="g-title">${title}</div><div class="g-card">${body}</div>${foot}</section>`;
const promptBadge=k=>S.settings.prompts[k]!==DEFAULT_PROMPTS[k]?`<span class="badge-mod">已修改</span>`:"默认";
function quickPreview(){const q=S.settings.quick;return `例：16:9 原图 → ${q.keepSpec?"16:9 · 1792×1008":S.composer.ratio+" · 自动尺寸"} · ${q.effort} · ${q.useRef?"以原图为参考":"仅文字"} · ${q.into==="same"?"归入原列表":"归入无模板"}`;}
function settingsHTML(...args){return StudioService.settingsHTML(...args);}
function openSettings(section){
  const el=openScreen(settingsHTML(),{cls:"settings"});StudioService.refreshSettings(el);
  if(section){const g=$("#"+section,el);if(g){const sc2=$(".scroll",el);sc2.scrollTop=g.offsetTop-70;setTimeout(()=>{const c=$(".g-card",g);c.classList.add("flash");setTimeout(()=>c.classList.remove("flash"),1700);},D(380));}}
}
let savedT;
function settingChanged(...args){return StudioService.settingChanged(...args);}
function applyMotion(){const m=S.settings.motion;RM=m==="reduce"||(m==="system"&&sysRM);document.documentElement.classList.toggle("rm",RM);}
function promptEditor(k){const [title,vars]=PROMPT_META[k];
  openSheet({title,html:`<textarea class="input mono" id="pe-text" rows="8">${esc(S.settings.prompts[k])}</textarea>
    <div class="var-chips">${vars.map(v=>`<button type="button" data-act="pe-var">${v}</button>`).join("")}</div>
    <p class="form-err" id="pe-err"></p>
    <div class="btn-row"><button class="secondary" data-act="pe-reset" data-layout="flex:1;justify-content:center">恢复默认</button><button class="primary" data-act="pe-save" data-k="${k}" data-layout="flex:1.4;margin:0">保存</button></div>`,
    onMount:L=>{const ta=$("#pe-text",L),err=$("#pe-err",L),sv=$('[data-act="pe-save"]',L);
      const check=()=>{const ok=ta.value.includes("{prompt}")&&ta.value.trim().length>=20;err.textContent=ok?"":"至少 20 字符，且必须包含 {prompt}";sv.disabled=!ok;};check();
      ta.addEventListener("input",check);
      L.addEventListener("click",e=>{const v=e.target.closest('[data-act="pe-var"]');if(v){const a=ta.selectionStart,b=ta.selectionEnd;ta.setRangeText(v.textContent,a,b,"end");ta.focus();check();}
        if(e.target.closest('[data-act="pe-reset"]')){ta.value=DEFAULT_PROMPTS[k];check();ta.animate([{opacity:.4},{opacity:1}],{duration:D(200)});}});}});
}
function injEditor(){
  openSheet({title:"默认画风约束",html:`<textarea class="input" id="inj-text" rows="4">${esc(S.settings.upscale.injection)}</textarea><p class="note">新超分任务默认填入；每个任务仍可单独修改。</p><button class="primary" data-act="inj-save">保存</button>`});
}

/* ================= upscale failure workspace ================= */
const FX={bid:null,sel:new Set(),pane:"affine",cmp:null,side:"output",showOk:false,latest:true};
function fxTask(){return FX.task;}
function openFailure(...args){return StudioService.openFailure(...args);}
const PANE_CAP={source:"仅放大显示，比较原始几何",raw:"按目标大小直接拼接：观察内容偏移与接缝",affine:"红色＝缺失；橙框＝低可信或偏移块"};
function fxView(...args){return StudioService.fxView(...args);}
function fxRow(x){return `<div class="fx-row${FX.sel.has(x.i)?" on":""}" data-i="${x.i}"><button class="fx-ck" data-act="fx-tile" data-i="${x.i}" aria-label="选择第 ${x.i+1} 块">${icon("check",13)}</button><span class="fx-n">#${x.i+1}</span><span class="fx-t"><b class="st-${x.state}">${TSTATE[x.state]}</b><small>${esc(x.reason||"配准与接缝正常，可复用")}</small></span><button class="link-btn" data-act="fx-cmp" data-i="${x.i}">对比</button></div>`;}
function fxRender(el=topScreen()){
  const t=fxTask();if(!t||!el)return;const lv=t.up.levels[t.up.cur];
  $("#fx-view",el).innerHTML=fxView(t);
  const bad=lv.tiles.filter(x=>x.state!=="done"),ok=lv.tiles.filter(x=>x.state==="done");
  $("#fx-list",el).innerHTML=bad.map(fxRow).join("")+`<button class="fx-more${FX.showOk?" open":""}" data-act="fx-showok">其余 ${ok.length} 块正常 · 也可选择重绘 ${icon("chevd",14)}</button>`+(FX.showOk?ok.map(fxRow).join(""):"");
  $$("#fx-seg button",el).forEach(b=>b.classList.toggle("on",b.dataset.v===FX.pane&&FX.cmp===null));
  const on=$("#fx-seg button.on",el),ind=$("#fx-seg .ind",el);ind.style.opacity=on?"1":"0";if(on){ind.style.width=on.offsetWidth+"px";ind.style.transform=`translateX(${on.offsetLeft-3}px)`;}
  fxSel(el);
}
function fxSel(el=topScreen()){
  const t=fxTask();if(!t||!el)return;const lv=t.up.levels[t.up.cur],n=FX.sel.size,cap=S.settings.concurrency;
  $$(".hit",el).forEach(h=>{const on=FX.sel.has(+h.dataset.i);h.classList.toggle("on",on);h.setAttribute("aria-pressed",on);});
  $$(".fx-row",el).forEach(r=>r.classList.toggle("on",FX.sel.has(+r.dataset.i)));
  const left=lv.tiles.filter(x=>x.state!=="done"&&!FX.sel.has(x.i));
  const later=t.up.levels.slice(t.up.cur+1),laterImages=later.reduce((sum,l)=>sum+(l.raw?.tile_count||l.tiles.length),0);
  const w=$("#fx-warn",el),wh=(left.length&&n?`<p class="fx-warn">第 ${left.map(x=>x.i+1).join("、")} 块有问题但未选中，本级验收仍会失败。</p>`:"")+(n&&later.length?`<p class="note">后续 ${later.length} 级将重新执行。预计共 ${n+laterImages} 次生图 + ${1+later.length} 次验收，重试另计。</p>`:"");if(w.dataset.h!==wh){w.innerHTML=wh;w.dataset.h=wh;}
  $("#fx-sum",el).innerHTML=n?`本级已选 ${n} 块 · ${n} 次生图 + 1 次验收${n>cap?` · 并发 ${cap} 路，其余排队<button data-act="fx-cc">调整</button>`:" · 并行重绘"}`:"点选图块或列表来选择要重绘的块";
  const go=$("#fx-go",el);go.disabled=!n;go.textContent=n?`重绘所选 ${n} 块`:"重绘所选";
}
function fxSubmit(...args){return StudioService.fxSubmit(...args);}

// Real data boot is owned by studio-service.js. No simulated jobs or timers.
hydrateIcons();
