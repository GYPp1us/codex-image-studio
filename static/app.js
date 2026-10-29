"use strict";

const $ = (s, root = document) => root.querySelector(s);
const updateHTML = StudioDOM.updateHTML;
const esc = (v = "") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icons = {
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="16" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  queue:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3V4Z"/>',
  settings:'<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3H9Z"/><circle cx="12" cy="12" r="3"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  retry:'<path d="M3 10a9 9 0 1 1 1.5 7M3 4v6h6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  logout:'<path d="M9 3H4v18h5m0-9h12m-5-5 5 5-5 5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  play:'<path d="m7 4 13 8-13 8V4Z"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  shield:'<path d="m12 3 9 4v6c0 5-9 8-9 8s-9-3-9-8V7l9-4Z"/><path d="m8 12 3 3 5-6"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  terminal:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 8 4 4-4 4m7 0h3"/>'
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n] || icons.image}</svg>`;
const navs = [["create","spark","创作"],["works","layers","作品"],["queue","queue","任务"],["prompts","book","模板"]];
const labels = {queued:"等待中",running:"生成中",retrying:"等待重试",succeeded:"已完成",failed:"失败",cancelled:"已取消"};
const statusPill = status => `<span class="pill ${status === "succeeded" ? "green" : status === "failed" ? "red" : status === "running" ? "amber" : ""}"><span class="dot"></span>${labels[status] || esc(status)}</span>`;
const fmtTime = t => new Date(t * 1000).toLocaleString("zh-CN", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
const fmtSize = n => n >= 1073741824 ? `${(n/1073741824).toFixed(2)} GB` : n > 1048576 ? `${(n/1048576).toFixed(1)} MB` : `${Math.round(n/1024)} KB`;
function modelItems(){return S.models?.items||[{id:S.config?.model||"gpt-6.1-sol",name:"GPT-6.1 Sol",efforts:["low","medium","high","xhigh","max"]}];}
function modelOptions(){return modelItems().map(m=>`<option value="${esc(m.id)}" ${m.id===S.config.model?"selected":""}>${esc(m.name)}</option>`).join("");}
function effortOptions(){const m=modelItems().find(m=>m.id===S.config.model)||modelItems()[0];return m.efforts.map(v=>`<option value="${esc(v)}" ${v===S.config.effort?"selected":""}>${esc(v)}</option>`).join("");}
function modelControls(prefix){return `<div class="model-controls"><label><span class="sr-only">执行模型</span><select id="${prefix}-model" aria-label="执行模型">${modelOptions()}</select></label><label><span class="sr-only">思考强度</span><select id="${prefix}-effort" aria-label="思考强度">${effortOptions()}</select></label></div>`;}
const S = {auth:null,config:null,page:"create",jobs:[],totalJobs:0,assets:[],assetTotal:0,assetKind:"reference",assetFavorite:false,search:"",prompts:[],refs:[],count:1,ratio:"1:1",transparent:false,polish:false,size:"auto",stitch:0,prompt:"",setup:null,setupStep:1,setupSignature:"",queueFilter:"",submitting:false,picker:[],assetMap:new Map(),modalJob:null,polling:false};
let toastTimer;
const toastNode=document.getElementById('toast');
function toast(text) {
  const host=StudioLayers.top==='panel'?$('#modal'):['failure','comparison'].includes(StudioLayers.top)?$('#upscale-failure'):StudioViewer.isOpen?StudioViewer.dialog:document.body;
  if(host&&toastNode.parentElement!==host)host.append(toastNode);
  toastNode.textContent=text;toastNode.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastNode.classList.remove('show'),4000);
}
async function api(path, options = {}) {
  const headers = {...options.headers};
  if (options.body && !(options.body instanceof FormData)) { headers["Content-Type"]="application/json"; options.body=JSON.stringify(options.body); }
  if (S.auth?.csrf) headers["X-CSRF-Token"]=S.auth.csrf;
  const response = await fetch(path, {...options,headers});
  const data = await response.json().catch(()=>({detail:"服务器返回了意外响应"}));
  if (!response.ok) {
    if (response.status===401 && !path.startsWith("/api/auth/")) { StudioLayers.reset();StudioViewer.close(false);await StudioImages.clear();S.auth=null; renderAuth(true); }
    let detail = data.detail;
    if (Array.isArray(detail)) detail = "请检查输入内容：密码至少 10 位，提示词不能为空。";
    throw new Error(detail || `请求失败 (${response.status})`);
  }
  return data;
}
const post = (path,body={}) => api(path,{method:"POST",body});
function rememberAssets(assets) { for(const asset of assets) if(asset) S.assetMap.set(asset.id,asset); }
function rememberJobs(jobs) { for (const j of jobs) { rememberAssets(j.outputs); rememberAssets(j.references);if(j.source_image?.id)rememberAssets([j.source_image]); } }
function draft() { localStorage.setItem("studio_draft",JSON.stringify({prompt:S.prompt,refs:S.refs,ratio:S.ratio,count:S.count,transparent:S.transparent,polish:S.polish,size:S.size,stitch:S.stitch,template:S.template||null})); }
function loadDraft() { try { const d=JSON.parse(localStorage.getItem("studio_draft")); if(d) { S.prompt=String(d.prompt||"");S.refs=Array.isArray(d.refs)?d.refs.slice(0,8):[];S.ratio=d.ratio||"1:1";S.count=Math.max(1,Math.min(20,Number(d.count)||1));S.transparent=Boolean(d.transparent);S.polish=Boolean(d.polish);S.stitch=[0,4,16,64].includes(d.stitch)?d.stitch:0;S.size=["auto","1024","2048","4096"].includes(d.size)?d.size:"auto";S.template=d.template?.id?{id:String(d.template.id),title:String(d.template.title||"模板"),text:String(d.template.text||"")}:null; } } catch{} }
function closeModal(){ StudioPanels.close();S.modalJob=null;renderGenerationSummary(); }

function modal(title,html){ return StudioPanels.show(title,html); }

function renderAuth(initialized){
  $("#app").innerHTML=`<main class="login-screen compact-auth"><form class="login-form" id="auth-form" data-initialized="${initialized}"><div class="brand"><span class="brand-mark">${icon("image")}</span><span>Image Studio</span></div><h2>${initialized?"登录":"创建账户"}</h2>${!initialized?'<div class="form-field"><label for="setup-token">初始化密钥</label><input id="setup-token" name="setup_token" type="password" autocomplete="off" required></div>':""}<div class="form-field"><label for="username">用户名</label><input id="username" name="username" autocomplete="username" minlength="2" maxlength="64" required></div><div class="form-field"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="${initialized?"current-password":"new-password"}" minlength="10" maxlength="256" required></div><p class="form-error hidden" id="auth-error"></p><button class="btn primary" type="submit">${initialized?"登录":"创建账户"}${icon("arrow")}</button></form></main>`;
}

function renderShell(){
  const nav=navs.filter(n=>n[0]!=="settings");
  $("#app").innerHTML=`<div class="shell compact-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${icon("image")}</span><span>Image Studio</span></div><nav class="nav" aria-label="主导航">${nav.map(([id,i,label])=>`<button class="nav-btn ${(S.page===id||id==="create"&&S.page==="upscale")?"active":""}" data-action="nav" data-page="${id}">${icon(i)}<span>${label}</span>${id==="queue"?'<span class="nav-count" id="nav-count">0</span>':""}</button>`).join("")}</nav><button class="side-user row between user-trigger" data-action="user-menu" aria-label="用户菜单" aria-expanded="false"><span class="row"><span class="avatar">${esc(S.auth.username?.slice(0,1).toUpperCase()||"U")}</span><span class="username">${esc(S.auth.username)}</span></span><span class="user-more">···</span></button></aside><main class="main"><header class="topbar"><button class="mobile-avatar user-trigger" data-action="user-menu" aria-label="用户菜单" aria-expanded="false">${esc(S.auth.username?.slice(0,1).toUpperCase()||"U")}</button><strong id="breadcrumb">创作</strong><div class="workspace-label" id="topbar-model">${esc(S.config.model)} · ${esc(S.config.effort)}</div></header><footer class="statusbar" id="statusbar" role="status"></footer><div class="page" id="page"></div></main><nav class="mobile-nav" aria-label="移动端导航">${nav.map(([id,i,label])=>`<button data-action="nav" data-page="${id}" class="${(S.page===id||id==="create"&&S.page==="upscale")?"active":""}">${icon(i)}<span>${label}</span>${id==="queue"?'<span class="mobile-nav-count" id="mobile-nav-count">0</span>':""}</button>`).join("")}</nav><div id="user-menu" class="user-menu hidden" role="menu"><button role="menuitem" data-action="nav" data-page="settings">${icon("settings")}设置</button><button role="menuitem" data-action="nav" data-page="trash">${icon("trash")}最近删除</button><button role="menuitem" data-action="install-app">${icon("download")}安装应用</button><div class="menu-divider"></div><button role="menuitem" data-action="logout">${icon("logout")}退出登录</button></div></div>`;
  updateNav();
}
function updateNav(){
  document.querySelectorAll('[data-action="nav"]').forEach(el=>el.classList.toggle("active",el.dataset.page===S.page));
  const names={create:"创作",works:"作品",queue:"任务",upscale:"渐进超分",library:"参考图库",prompts:"模板",account:"账户设置",settings:"设置",trash:"最近删除",setup:"连接引导"};
  if($("#breadcrumb"))$("#breadcrumb").textContent=names[S.page]||"创作";
  const counts=Object.fromEntries((S.config?.counts||[]).map(c=>[c.status,c.count]));
  const active=(counts.running||0)+(counts.retrying||0),sessions=S.config?.calls?.active??active;
  if($("#nav-count"))$("#nav-count").textContent=active+(counts.queued||0);
  if($("#topbar-model"))$("#topbar-model").textContent=`${S.config.model} · ${S.config.effort}`;
  const mobile=$("#mobile-nav-count");if(mobile)mobile.textContent=active+(counts.queued||0);
  const status=$("#statusbar"),problem=!navigator.onLine?"当前离线":S.setup&&!S.setup.authenticated?"订阅未连接":S.config.paused?"任务调度已暂停":"";
  if(status){status.hidden=!problem;status.innerHTML=problem?`<span>${problem}</span><button data-action="settings-section" data-section="${S.config.paused?'queue':'subscription'}">查看设置 ›</button>`:"";}

}

function renderWorks(){
  $("#page").innerHTML='<section class="gallery-section works-layout"><div class="gallery-heading" id="gallery-heading"></div><div id="recent-gallery"></div></section>';
  renderRecent();
}
const sizeLabel = size => ({auto:"自动尺寸","1024":"1K 长边","2048":"2K 长边","4096":"4K 长边"})[size||"auto"]||"自动尺寸";
function stitchOptions(prefix){return `<label class="stitch-control" for="${prefix}-stitch"><span>生成后超分</span><select id="${prefix}-stitch">${[[0,"关闭"],[4,"4× · 1级"],[16,"16× · 2级"],[64,"64× · 3级"]].map(([v,t])=>`<option value="${v}" ${S.stitch===v?"selected":""}>${t}</option>`).join("")}</select></label><p class="stitch-note">倍率按面积计算；每级宽高放大2倍并重新切图，预算见超分工作区。</p>`;}
function creativeOptions(prefix){return `<div class="creative-options"><label class="switch"><input type="checkbox" id="${prefix}-polish" ${S.polish?"checked":""}>帮我润色</label><button type="button" class="polish-info" data-action="polish-details" aria-label="帮我润色详情">${icon("info")}</button><label class="size-field" for="${prefix}-size"><span>图像尺寸</span><select id="${prefix}-size">${["auto","1024","2048","4096"].map(v=>`<option value="${v}" ${S.size===v?"selected":""}>${sizeLabel(v)}</option>`).join("")}</select></label></div><span class="size-note">尺寸由生图工具原生生成，实际尺寸见图片详情。</span>`;}
async function renderTrash(){
  const [assets,groups]=await Promise.all([api("/api/assets?kind=all&deleted=true&limit=200"),api("/api/collections?deleted=true&limit=100")]);rememberAssets(assets.items);
  $("#page").innerHTML=`<div class="trash-list">${groups.items.map(g=>`<article class="queue-item"><span class="trash-icon">${icon("layers")}</span><div class="queue-main"><span>${esc(g.name)}</span><p class="small muted">图集 · ${g.image_count} 张图片</p></div><button class="btn secondary" data-action="restore-collection" data-id="${g.id}">恢复</button></article>`).join("")}${assets.items.map(a=>`<article class="queue-item"><img class="queue-thumb" src="${a.thumbnail}" alt="${esc(a.name)}"><div class="queue-main"><span>${esc(a.name)}</span><p class="small muted">${a.width} × ${a.height}</p></div><button class="btn secondary" data-action="restore-asset" data-id="${a.id}">恢复</button></article>`).join("")}${!assets.items.length&&!groups.items.length?'<div class="empty-list minimal-empty">'+icon("trash")+'</div>':""}</div>`;
}
function renderGenerationSummary(){
  const el=$(".generation-summary");if(!el||!S.config)return;
  el.innerHTML=`<span class="row">${icon("settings")}${esc(S.ratio==="auto"?"自动画幅":S.ratio)} · ${S.count} 张${S.stitch?` · ${S.stitch}×拼接`:""}${S.polish?" · 润色":""}${S.transparent?" · 透明":""}</span><small>${sizeLabel(S.size)} · ${esc(S.config.model)} · ${esc(S.config.effort)}</small>`;
}
function syncModelControls(){
  for(const prefix of ["composer","setting","sheet","upscale","edit"]){const m=$("#"+prefix+"-model"),e=$("#"+prefix+"-effort");if(m)m.innerHTML=modelOptions();if(e)e.innerHTML=effortOptions();}
  StudioPanels.refresh?.(document);renderGenerationSummary();
}
function openGenerationOptions(){
  modal("生成参数",`<div class="mobile-parameters"><div><div class="section-label">画幅</div><div class="ratio-list">${["1:1","3:2","2:3","16:9","9:16","auto"].map(r=>`<button class="ratio-btn ${S.ratio===r?"selected":""}" data-action="ratio" data-ratio="${r}" aria-pressed="${S.ratio===r}">${r==="auto"?"自动":r}</button>`).join("")}</div></div><div class="row between"><label for="sheet-count">生成数量</label><div class="stepper"><button data-action="count" data-delta="-1" aria-label="减少数量">−</button><input type="number" inputmode="numeric" data-generation-count id="sheet-count" min="1" max="20" value="${S.count}" aria-label="生成数量"><button data-action="count" data-delta="1" aria-label="增加数量">+</button></div></div>${creativeOptions("sheet")}${stitchOptions("sheet")}<label class="switch"><input id="sheet-transparent" type="checkbox" ${S.transparent?"checked":""}>透明背景</label><div><div class="section-label">模型与思考强度</div>${modelControls("sheet")}</div></div>`);
}
window.studioBack=()=>{
  const menu=$("#user-menu");if(menu&&!menu.classList.contains("hidden")){if(!StudioLayers.close("menu"))menu.classList.add("hidden");return true;}
  if(StudioLayers.depth){StudioLayers.close();return true;}return false;
};

function renderCreate(){ return StudioWorkspace.render(); }

function renderReferences(){
  const el=$("#reference-strip");if(!el)return;
  el.innerHTML=S.refs.map(id=>{const a=S.assetMap.get(id);return `<div class="ref-chip"><img src="/media/${esc(id)}?thumbnail=1" data-action="image-preview" data-id="${esc(id)}" alt="${esc(a?.name||"参考图")}"><button data-action="remove-reference" data-id="${esc(id)}" aria-label="移除参考图">×</button></div>`;}).join("");
}
function assetCard(a,picker=false){ return StudioWorkspace.assetCard(a,picker); }

function renderRecent(){
  if(!$("#recent-gallery"))return;
  if(S.collection){renderCollectionDetail();return;}
  updateHTML($("#gallery-heading"),`<span>产物列表</span><span class="pill">${S.collectionTotal||0}</span>`);
  const groups=(S.collections||[]).filter(group=>group.image_count>0);
  if(!groups.length){updateHTML($("#recent-gallery"),StudioWorkspace.workStatus()+'<div class="empty-list">完成的图片会显示在这里。</div>');return;}
  updateHTML($("#recent-gallery"),groups.length?`${StudioWorkspace.workStatus()}<div class="collection-grid">${groups.map(g=>`<article class="collection-card" data-id="${g.id}"><button class="collection-open" data-action="open-collection" data-id="${g.id}" title="${g.kind==='template'?'模板':'无模板'}"><div class="collection-stack">${g.covers.length?g.covers.slice().reverse().map((a,i)=>`<img class="stack-image layer-${g.covers.length-i}" loading="lazy" src="${a.thumbnail}" alt="${esc(g.name)}">`).join(""):`<div class="stack-empty">${g.active?'<span class="spinner"></span>':icon("image")}</div>`}</div><div class="collection-label"><strong>${esc(g.name)}</strong><span>${icon("image")}${g.image_count}${g.active?'<span class="spinner small"></span>':""}</span></div></button><button class="icon-btn collection-delete" data-action="delete-collection" data-id="${g.id}" aria-label="删除列表">${icon("trash")}</button><button class="icon-btn collection-rename" data-action="rename-collection" data-id="${g.id}" aria-label="重命名列表">···</button></article>`).join("")}</div>${groups.length<(S.collectionTotal||0)?'<button class="btn secondary load-more" data-action="more-collections">加载更多</button>':""}`:'<div class="empty-list minimal-empty">'+icon("image")+'</div>');
}

function renderQueue(){ return StudioTasks.render(); }

function taskProgress(j,details=false){
  if(!["running","retrying","queued"].includes(j.status)&&!details&&!j.options.stitch)return "";
  if(j.progress?.regions)return StudioTasks.progress(j);
  const p=j.progress||{stage:j.status,label:labels[j.status],step:0,total:4};
  const percent=Math.max(0,Math.min(100,Math.round(p.stitch?p.percent:(j.status==="succeeded"?100:(p.step||0)/4*100))));
  const waiting=j.status==="running"&&(p.indeterminate||p.waiting);
  return `<div class="task-progress ${details?"expanded":""} ${waiting?"waiting":""}" role="progressbar" aria-label="${p.stitch?"超分工作量进度":"任务阶段"}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${esc(p.label)}" title="按完成阶段与块数计算，非剩余用时预测"><div class="progress-caption"><span>${esc(p.label)}${p.stitch&&p.units>1?` · ${p.done}/${p.units}`:""}</span><span>${p.stitch?`${p.factor}× · ${percent}%`:`${p.step||0} / ${p.total} 阶段`}</span></div><div class="motion-track"><span class="motion-fill p${percent}"></span></div>${p.substage?`<div class="progress-substage">${esc(p.substage)}</div>`:""}${details?`<div class="progress-substage">${p.stitch?"原图 → 切图 → 补绘 → 配准 → 色调 → 接缝 → 融合 → 检查 → 回传":"传递 → 思考 → 生图 → 回传"}</div>`:""}</div>`;
}
function renderQueueItems(){ StudioTasks.paint(); }

async function renderPrompts(){
  $("#page").innerHTML=`<div class="toolbar"><div class="search">${icon("search")}<input id="prompt-search" placeholder="搜索模板" aria-label="搜索模板"></div><button class="btn primary toolbar-end" data-action="new-prompt">${icon("plus")}新建</button></div><div class="prompt-grid" id="prompt-grid"></div>`;
  await loadPrompts();
}
async function loadPrompts(search=""){
  S.prompts=await api(`/api/templates?search=${encodeURIComponent(search)}`);
  for(const p of S.prompts)rememberAssets(p.references||[]);
  if(!$("#prompt-grid"))return;
  $("#prompt-grid").innerHTML=S.prompts.length?S.prompts.map(p=>`<article class="prompt-card"><div class="row between"><h3>${esc(p.title)}</h3><button class="icon-btn" data-action="favorite-prompt" data-id="${p.id}" aria-label="收藏提示词">${icon(p.favorite?"check":"star")}</button></div><p>${esc(p.text)}</p>${presetReferences(p)}<div class="row between"><button class="icon-btn" data-action="edit-prompt" data-id="${p.id}" aria-label="编辑模板">${icon("settings")}</button><button class="icon-btn" data-action="delete-prompt" data-id="${p.id}" aria-label="删除提示词">${icon("trash")}</button><button class="btn secondary" data-action="use-prompt" data-id="${p.id}">载入${icon("arrow")}</button></div></article>`).join(""):'<div class="empty-list minimal-empty">'+icon("book")+'</div>';
}

async function fetchSetup(){ S.setup=await api("/api/setup/status");updateNav();return S.setup; }
async function renderSettings(){ return StudioSettings.render(S.settingsSection||"account"); }

async function renderSetup(){
  if(!S.setup)await fetchSetup();
  const p=S.setup;
  $("#page").innerHTML=`<div class="setup-wrap"><h1>连接引导</h1><div class="setup-steps">${[[1,"检查 CLI"],[2,"连接订阅"],[3,"验证生图"]].map(([n,t])=>`<div class="setup-step ${S.setupStep===n?"active":S.setupStep>n?"done":""}"><span>${S.setupStep>n?"✓":n}</span>${t}</div>`).join("")}</div><section class="setup-body" id="setup-body">${setupBody(p)}</section></div>`;
}
function subscriptionLoginBody(p){
  const mode=S.loginMode||"browser";
  const current=p.login.mode===mode;
  const running=current&&p.login.running;
  const link=current?p.login.url:"";
  const intro=mode==="browser"?"在 OpenAI 官方页面完成账户登录，无需启用设备码功能。":"使用官方设备码授权，适合已启用设备登录的账户。";
  return `<h2>${p.authenticated?"订阅已经连接。":"ChatGPT 账户"}</h2><p class="muted">${intro}</p><div class="tabs"><button data-action="login-mode" data-mode="browser" class="${mode==="browser"?"active":""}">浏览器链接登录</button><button data-action="login-mode" data-mode="device" class="${mode==="device"?"active":""}">设备码登录</button></div>${p.authenticated?`<div class="connection-check"><span class="check-mark">${icon("check")}</span><div><h3>ChatGPT 登录有效</h3><p>${esc(p.auth_message)}</p></div></div>`:mode==="browser"?`<div class="notice">1. 获取链接，并打开 OpenAI 官方页面完成授权。<br>2. 授权后会跳转到 <span class="mono">localhost:1455</span>。如果提示无法访问，请复制浏览器地址栏里的完整回调链接，粘贴到下面。<br>3. 点击“完成连接”。若已设置 SSH 转发，授权后会自动完成。</div>${link?`<div class="row wrap"><a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">打开 OpenAI 官方登录${icon("external")}</a><button class="btn secondary" data-action="copy-login-link">${icon("copy")}复制链接</button></div><form id="callback-form"><div class="form-field"><label for="callback-url">授权后的完整回调链接</label><input id="callback-url" name="url" type="url" autocomplete="off" placeholder="http://localhost:1455/auth/callback?code=…&state=…" required></div><button class="btn secondary" type="submit">${icon("check")}完成连接</button></form>`:""}${!running?`<button class="btn primary" data-action="start-login" data-mode="browser">${icon("lock")}${link?"重新获取登录链接":"获取浏览器登录链接"}</button>`:'<p class="small muted row"><span class="spinner small"></span>正在等待官方授权，登录成功后会自动更新。</p>'}<details class="login-help"><summary>可选：使用 SSH 自动接收回调</summary><p>在打开登录链接的电脑上运行以下命令，并保持终端开启：</p><pre class="login-output">ssh -N -L 1455:127.0.0.1:1455 user@your-server</pre><p>完成授权后即可关闭 SSH 转发。手动粘贴回调链接不需要这一步。</p></details>`:`<div class="notice">先获取设备码，再到 OpenAI 官方页面输入设备码并授权。账户需要允许设备码登录。</div>${current&&p.login.code?`<div class="device-code">${esc(p.login.code)}</div><div class="row wrap"><button class="btn secondary" data-action="copy-code">${icon("copy")}复制设备码</button>${link?`<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">打开官方登录页面${icon("external")}</a>`:""}</div>`:""}${running?'<p class="small muted row"><span class="spinner small"></span>等待官方授权，页面会自动检查登录状态。</p>':'<button class="btn primary" data-action="start-login" data-mode="device">'+icon("lock")+'获取设备登录码</button>'}`}${current&&p.login.output&&!p.authenticated?`<details class="login-help"><summary>查看 CLI 登录信息</summary><pre class="login-output">${esc(p.login.output)}</pre></details>`:""}<div class="setup-actions"><button class="btn" data-action="setup-step" data-step="1">上一步</button>${p.login.running&&!p.authenticated?'<button class="btn" data-action="cancel-login">取消本次登录</button>':""}<button class="btn primary" data-action="setup-step" data-step="3" ${!p.authenticated?"disabled":""}>下一步${icon("arrow")}</button></div>`;
}
function setupBody(p){
  if(S.setupStep===1) return `<h2>Codex CLI</h2><p class="muted">工作台通过官方 Codex CLI 创建全新任务，无需手动打开聊天窗口。</p><div class="connection-check"><span class="check-mark">${icon(p.installed?"check":"terminal")}</span><div><h3>${p.installed?"Codex CLI 已安装":"尚未找到 Codex CLI"}</h3><p>${esc(p.version)}</p></div></div><div class="connection-check"><span class="check-mark">${icon("spark")}</span><div><h3>${esc(p.model)} · ${esc(p.effort)}</h3><p>每张图片、每次重试都会使用独立会话。</p></div></div><div class="notice">下一步会让你在 OpenAI 官方页面授权 ChatGPT 订阅。工作台不收集你的 OpenAI 密码，也不会自动切换到付费 API。</div><div class="setup-actions"><button class="btn" data-action="finish-setup">稍后连接</button><button class="btn primary" data-action="setup-step" data-step="2" ${!p.installed?"disabled":""}>下一步${icon("arrow")}</button></div>`;
  if(S.setupStep===2)return subscriptionLoginBody(p);
  const job=S.jobs.find(j=>j.id===p.probe);
  return `<h2>生图检查</h2><p class="muted">一次真实生成，用于确认当前账号和服务器 CLI 能完成内置生图。</p><div class="notice">检查会使用一次订阅生图额度。只有成功取回图片文件才会通过；不会用占位图或其他绘图方式代替结果。</div>${job?`<div class="connection-check"><div class="queue-thumb">${job.outputs[0]?`<img src="${job.outputs[0].thumbnail}" alt="测试生图结果">`:job.status==="failed"?icon("close"):'<span class="spinner"></span>'}</div><div><h3>${job.status==="succeeded"?"生图链路验证成功":labels[job.status]}</h3><p>${job.status==="succeeded"?"已取回真实生成图片。可以开始创作了。":"测试任务已加入队列，结果会自动更新。"}</p></div></div>${job.error?`<div class="notice error">${esc(job.error)}</div><button class="link-btn" data-action="job-detail" data-id="${job.id}">查看诊断日志</button>`:""}`:""}<div class="setup-actions"><button class="btn" data-action="setup-step" data-step="2">上一步</button>${!job||["failed","cancelled"].includes(job.status)?'<button class="btn secondary" data-action="probe">'+icon("spark")+'运行生图检查</button>':""}<button class="btn primary" data-action="finish-setup">${job?.status==="succeeded"?"进入工作台":"稍后验证"}${icon("arrow")}</button></div>`;
}

async function navigate(page,options={}){
  if(page==="library"){await referencePicker();return;}
  if(page==="upscale"){S.createMode="upscale";page="create";}
  if(page==="account"){S.settingsSection="account";page="settings";}
  const previous={page:S.page,collection:S.collection,mode:S.createMode,scroll:window.scrollY};
  const internal=["settings","trash","setup"].includes(page);
  if(!options.fromHistory&&internal&&page!==S.page)StudioLayers.push("page",()=>{S.collection=previous.collection;S.createMode=previous.mode;navigate(previous.page,{fromHistory:true,scroll:previous.scroll});});
  else if(!options.fromHistory&&!internal&&page!==S.page)StudioLayers.reset();
  S.page=page;$("#user-menu")?.classList.add("hidden");document.querySelectorAll(".user-trigger").forEach(el=>el.setAttribute("aria-expanded","false"));updateNav();window.scrollTo({top:0,behavior:"instant"});
  const paint=async()=>{if(page==="create")renderCreate();else if(page==="works")renderWorks();else if(page==="queue")renderQueue();else if(page==="prompts")await renderPrompts();else if(page==="trash")await renderTrash();else if(page==="settings")await renderSettings();else if(page==="setup")await renderSetup();};
  if(!options.initial&&!options.fromHistory&&!matchMedia("(max-width:760px)").matches&&!["settings","prompts","trash","setup"].includes(page)&&document.startViewTransition&&!document.documentElement.classList.contains("reduce-motion")){const transition=document.startViewTransition(paint);await transition.updateCallbackDone;}else{await paint();if(!document.documentElement.classList.contains("reduce-motion"))$("#page").animate?.([{opacity:.4,transform:"translateY(8px)"},{opacity:1,transform:"translateY(0)"}],{duration:200,easing:"cubic-bezier(.32,.72,0,1)"});}
  if(page!=="settings")window.scrollTo({top:options.scroll||0,behavior:"instant"});
}

async function refresh(more=false){
  const requested=more?50:Math.max(50,S.jobs.length);
  const pages=[];
  for(let offset=0;offset<requested;offset+=100)pages.push(api(`/api/jobs?limit=${Math.min(100,requested-offset)}&offset=${more?S.jobs.length:offset}`));
  const [config,results,groups]=await Promise.all([api("/api/state"),Promise.all(pages),fetchPaged("/api/collections",S.collectionLimit||50)]);
  S.config=config;S.jobs=more?S.jobs.concat(results.flatMap(p=>p.items)):results.flatMap(p=>p.items);S.totalJobs=results[0].total;rememberJobs(S.jobs);S.collections=groups.items;S.collectionTotal=groups.total;
  for(const g of S.collections)rememberAssets(g.covers);
  if(S.collection&&["create","works"].includes(S.page)){const data=await fetchPaged(`/api/jobs?collection=${encodeURIComponent(S.collection)}`,S.collectionJobLimit||50);S.collectionJobs=data.items;S.collectionJobTotal=data.total;rememberJobs(data.items);}
  StudioTasks.observe(S.jobs);StudioSettings.applyMotion();updateNav();renderRecent();renderQueueItems();StudioWorkspace.submission();
  if(S.page==="queue")await StudioTasks.refresh();
  if(S.page==="create"&&S.createMode==="upscale")await StudioUpscale.refresh();
}
async function fetchPaged(path,limit){
  const requests=[];const separator=path.includes("?")?"&":"?";
  for(let offset=0;offset<limit;offset+=100)requests.push(api(`${path}${separator}limit=${Math.min(100,limit-offset)}&offset=${offset}`));
  const pages=await Promise.all(requests);return {items:pages.flatMap(p=>p.items),total:pages[0].total};
}
async function poll(){
  if(!S.auth?.authenticated||S.polling||document.hidden)return;
  S.polling=true;
  try{
    await refresh();
    if(S.modalJob&&$("#modal").open){const fresh=await api(`/api/jobs/${S.modalJob.id}`);S.modalJob=fresh;rememberJobs([fresh]);updateHTML($("#job-progress-slot"),taskProgress(fresh,true));updateHTML($("#job-image-slot"),jobImages(fresh));updateHTML($("#job-dimensions-slot"),jobDimensions(fresh));updateHTML($("#job-polished-slot"),StudioPolish.markup(fresh,true));StudioImages.hydrate($("#modal-content"));}
    await StudioPolish.refresh();
    if(S.page==="setup"){
      await fetchSetup();
      const signature=JSON.stringify([S.setupStep,S.setup,S.jobs.find(j=>j.id===S.setup.probe)?.status]);
      const editingCallback=document.activeElement?.id==="callback-url"&&!S.setup.authenticated;
      if(signature!==S.setupSignature&&!editingCallback){S.setupSignature=signature; if($("#setup-body"))$("#setup-body").innerHTML=setupBody(S.setup);}
    }
  }catch(e){if(S.auth)console.warn("刷新暂时失败",e.message);}finally{S.polling=false;}
}

async function uploadFiles(files,attach){
  for(const file of Array.from(files)){
    if(attach&&S.refs.length>=8){toast("每次最多使用 8 张参考图，剩余图片未上传");break;}

    const body=new FormData();body.append("file",file);
    try{toast(`正在上传 ${file.name}…`);const r=await api("/api/assets",{method:"POST",body});rememberAssets([r.asset]);if(attach&&!S.refs.includes(r.asset.id))S.refs.push(r.asset.id);draft();renderReferences();toast(r.cached?"已复用图库中的同一张图片":"参考图已保存到图库");}catch(e){toast(e.message);}
  }

}
async function generate(body){
  if(S.submitting)return;
  if(!body)body={prompt:S.prompt,refs:S.refs,count:S.count,ratio:S.ratio,transparent:S.transparent,polish:S.polish,size:S.size,after_upscale:S.stitch,upscale_injection:S.config.preferences?.upscale?.default_injection||"",model:$("#composer-model")?.value||S.config.model,effort:$("#composer-effort")?.value||S.config.effort,template_id:S.template?.id||null};
  if(!body.prompt.trim()){toast("先写下你想生成的画面");$("#prompt")?.focus();return;}
  if(!navigator.onLine){toast("当前离线，请连接网络后提交");return;}
  S.submitting=true;const button=$(".generate-btn");if(button){button.disabled=true;button.textContent="加入任务…";}
  try{const submitted=await post("/api/jobs",body);S.lastSubmission={...submitted,name:(S.collections||[]).find(g=>g.id===submitted.collection_id)?.name||S.template?.title||"无模板",after_upscale:body.after_upscale||0};draft();await refresh();StudioWorkspace.submission();toast(`已加入 ${body.count||1} 张`);StudioWorkspace.animateSubmission(button);}
  catch(error){toast(error.message);}finally{S.submitting=false;if(button){button.disabled=false;button.textContent=`生成 ${S.count} 张`;}}
}

async function referencePicker(){ return StudioWorkspace.action("reference-picker",{dataset:{}}); }

async function promptPicker(){
  S.prompts=await api("/api/templates");for(const p of S.prompts)rememberAssets(p.references||[]);
  modal("模板",`<div class="queue-list">${S.prompts.length?S.prompts.map(p=>`<button class="queue-item preset-picker-item" data-action="use-prompt" data-id="${p.id}"><div class="queue-main"><h3>${esc(p.title)}</h3><p class="queue-prompt muted">${esc(p.text)}</p>${presetReferences(p)}</div>${icon("arrow")}</button>`).join(""):'<div class="empty-list minimal-empty">'+icon("book")+'</div>'}</div>`);
}
function imagePreviewButton(a,label="点击放大"){
  return `<button class="image-open-button" data-action="image-preview" data-id="${a.id||""}" ${a.id?"":'data-source="true"'} aria-label="放大预览图片"><span class="detail-image-frame" data-image-view><img class="modal-image" data-full-image width="${a.width}" height="${a.height}" src="${esc(a.preview||a.url)}" alt="${esc(a.name||"生成结果")}">${StudioImages.markup()}<span class="viewer-caption">${esc(label)}</span></span></button>`;
}
function jobImages(j){
  return `${j.outputs[0]?imagePreviewButton(j.outputs[0]):""}${j.source_image?`<button class="image-before" data-action="image-preview" data-id="${j.source_image.id||""}" ${j.source_image.id?"":'data-source="true"'}><img src="${esc(j.source_image.thumbnail||j.source_image.url)}" alt="原图"><span>${j.options.stitch?"超分前":"重绘前"}<small>${j.source_image.width} × ${j.source_image.height} · 点击放大</small></span></button>`:""}`;
}
function jobDimensions(j){
  const sizes=j.image_dimensions||{},size=s=>`${s.width} × ${s.height}`;
  return `<div class="image-dimensions">${sizes.source?`<span>原图 ${size(sizes.source)}</span>`:""}${sizes.target&&j.options.stitch?`<span>目标 ${size(sizes.target)}</span>`:""}${sizes.result?`<span>${j.options.stitch?"超分后":j.options.region?"重绘后":"图片尺寸"} ${size(sizes.result)}</span>`:""}</div>`;
}
function openImagePreview(id,source=false,initial={}){ return StudioWorkspace.openImage(id,source,initial); }

async function jobDetail(id){
  const j=await api(`/api/jobs/${id}`);rememberJobs([j]);S.modalJob=j;
  modal("生成记录",`${j.options.after_upscale_job_id?`<button class="btn secondary" data-action="upscale-open" data-id="${j.options.after_upscale_job_id}">查看后续超分任务 →</button>`:""}${j.options.stitch?`<button class="btn secondary" data-action="upscale-open" data-id="${j.id}">打开超分工作区 →</button>`:""}<div id="job-image-slot">${jobImages(j)}</div><div id="job-dimensions-slot">${jobDimensions(j)}</div><div class="row between">${statusPill(j.status)}<span class="tiny muted mono">${j.id.slice(0,12)}</span></div><div id="job-progress-slot">${taskProgress(j,true)}</div>${j.options.stitch?`<div class="stitch-artifacts"><button data-action="stitch-artifact" data-id="${j.id}" data-artifact="inspection" ${j.progress.step<8?"disabled":""}>局部检查图</button><button data-action="stitch-artifact" data-id="${j.id}" data-artifact="report" ${j.progress.step<8?"disabled":""}>配准与检查报告</button><button data-action="stitch-artifact" data-id="${j.id}" data-artifact="candidate" ${j.progress.step<8?"disabled":""}>查看候选图</button></div>`:""}<div class="detail-grid"><span>创建时间：${fmtTime(j.created)}</span><span>模型：${esc(j.model)} / ${esc(j.effort)}</span><span>画幅：${j.options.ratio} · ${sizeLabel(j.options.size)}${j.options.polish?" · 帮我润色":""} · ${j.options.transparent?"透明背景":"普通背景"}</span><span>参考图：${j.refs.length} 张 · 尝试 ${j.attempt} / ${j.max_attempts}</span></div><div class="reference-strip">${j.references.map(a=>`<button class="ref-chip" data-action="asset-detail" data-id="${a.id}"><img src="${a.thumbnail}" alt="${esc(a.name)}"></button>`).join("")}</div><div class="detail-prompt">${esc(j.prompt)}</div><div id="job-polished-slot">${StudioPolish.markup(j,true)}</div>${j.error?`<div class="notice error">${esc(j.error)}</div>`:""}<div class="row wrap"><button class="btn secondary" data-action="reuse-job" data-id="${j.id}">${icon("copy")}载入创作设置</button><button class="btn secondary" data-action="show-log" data-id="${j.id}">${icon("terminal")}诊断日志</button>${j.outputs[0]?`<a class="btn primary" href="${j.outputs[0].url}?download=1" download>${icon("download")}下载图片</a>`:""}${["failed","cancelled"].includes(j.status)?`<button class="btn primary" data-action="retry-job" data-id="${j.id}">重试</button>`:""}</div><details class="call-details"><summary>调用提示词</summary><pre class="log">${esc(j.call_instruction||j.options.call_prompt||"")}</pre></details><div class="detail-grid">${j.attempts.map(a=>`<span>第 ${a.number} 次 · ${labels[a.status]||esc(a.status)} · ${fmtTime(a.started)}</span>`).join("")}</div><div id="job-log"></div>`);
}
async function assetDetail(id){ return StudioWorkspace.info(id); }

async function saveSettings(){const body={concurrency:S.config.concurrency,max_attempts:S.config.max_attempts,paused:S.config.paused,model:S.config.model,effort:S.config.effort};const pending=(S.settingsQueue||Promise.resolve()).catch(()=>{}).then(()=>api("/api/settings",{method:"PATCH",body}));S.settingsQueue=pending;await pending;updateNav();renderGenerationSummary();toast("设置已保存");}


function presetReferences(p){return p.references?.length?`<div class="preset-references">${p.references.map(a=>`<img src="${a.thumbnail}" alt="${esc(a.name)}" title="${esc(a.name)}">`).join("")}</div>`:"";}
function presetOptions(){return {ratio:S.ratio,transparent:S.transparent,polish:S.polish,size:S.size,stitch:S.stitch,model:$("#composer-model")?.value||S.config.model,effort:$("#composer-effort")?.value||S.config.effort};}
async function restorePreset(p){
  S.prompt=p.text;S.refs=[...(p.refs||[])];rememberAssets(p.references||[]);
  S.template=Object.prototype.hasOwnProperty.call(p,"template_id")?(p.template_id?{id:p.template_id,title:p.template_title||p.title||"模板"}:null):(p.id?{id:p.id,title:p.title,text:p.text}:null);
  const o=p.options||{};if(o.ratio)S.ratio=o.ratio;if(o.transparent!==undefined)S.transparent=o.transparent;S.polish=Boolean(o.polish);S.stitch=[0,4,16,64].includes(o.after_upscale||o.stitch)?(o.after_upscale||o.stitch):0;S.size=["auto","1024","2048","4096"].includes(o.size)?o.size:"auto";
  const m=modelItems().find(m=>m.id===o.model);if(m&&m.efforts.includes(o.effort)){S.config.model=o.model;S.config.effort=o.effort;await saveSettings();}
  if(S.template?.id&&!S.template.text){try{S.template.text=(await api(`/api/templates/${S.template.id}`)).text;}catch{}}
  S.createMode="generate";draft();closeModal();await navigate("create");
}
async function openCollection(id){
  if(S.page!=="works")await navigate("works");
  if(!S.collection)StudioLayers.push("collection",()=>{S.collection=null;renderRecent();});
  const cover=document.querySelector(`[data-action="open-collection"][data-id="${CSS.escape(id)}"] .stack-image.layer-1`),hero=cover?{rect:cover.getBoundingClientRect(),src:cover.currentSrc||cover.src}:null;
  S.collection=id;S.collectionJobs=[];S.collectionLoading=true;S.collectionJobLimit=50;renderRecent();StudioWorkspace.collectionHero(hero);
  try{const data=await api(`/api/jobs?collection=${encodeURIComponent(id)}&limit=50`);if(S.collection!==id)return;S.collectionJobs=data.items;S.collectionJobTotal=data.total;rememberJobs(data.items);}finally{S.collectionLoading=false;renderRecent();}
}

function renderCollectionDetail(){
  const g=(S.collections||[]).find(g=>g.id===S.collection);if(!g){S.collection=null;renderRecent();return;}
  updateHTML($("#gallery-heading"),`<div class="row"><button class="icon-btn" data-action="close-collection" aria-label="返回列表">${icon("arrow")}</button>${g.covers[0]?`<img class="collection-header-image" style="view-transition-name:collection-hero" src="${esc(g.covers[0].thumbnail)}" alt="">`:""}<strong class="collection-title">${esc(g.name)}</strong></div><div class="row"><button class="icon-btn" data-action="load-collection" title="载入提示词和参考图" aria-label="载入列表设置">${icon("copy")}</button><button class="icon-btn" data-action="rename-collection" data-id="${g.id}" aria-label="重命名列表">···</button></div>`);
  if(S.collectionLoading){updateHTML($("#recent-gallery"),'<p class="small muted">正在读取图片…</p>');return;}
  const seen=new Set();const cards=[];
  for(const job of S.collectionJobs||[])for(const asset of job.outputs)if(!seen.has(asset.id)){seen.add(asset.id);cards.push(assetCard(asset));}
  updateHTML($("#recent-gallery"),`${StudioWorkspace.workStatus(S.collectionJobs||[])}<div class="gallery-grid">${cards.join("")||'<p class="empty-list">结果会显示在这里。</p>'}</div>${(S.collectionJobs||[]).length<S.collectionJobTotal?'<button class="btn secondary load-more" data-action="more-collection-jobs">加载更多</button>':""}`);

}
async function renderAccount(){ return StudioSettings.render("account",Boolean(StudioViewer.isOpen)); }

function renderTemplateChip(){ StudioWorkspace.destination(); }

function renderTemplateEditorRefs(){if($("#template-reference-count"))$("#template-reference-count").textContent=S.templateEditorRefs.length;const slot=$("#template-editor-refs");if(slot)slot.innerHTML=(S.templateEditorRefs||[]).map(id=>{const a=S.assetMap.get(id);return `<div class="ref-chip"><img src="/media/${esc(id)}?thumbnail=1" alt="${esc(a?.name||"参考图")}"><button type="button" data-action="remove-template-reference" data-id="${esc(id)}" aria-label="从模板移除参考图">×</button></div>`;}).join("");}
function openTemplateEditor(p=null,fromComposer=false){
  S.templateEditorRefs=[...(p?.refs||(fromComposer?S.refs:[]))];S.templateEditorOptions=p?.options||presetOptions();S.templateEditorFromComposer=fromComposer;rememberAssets(p?.references||[]);
  const text=p?.text??(fromComposer?S.prompt:"");const title=p?.title??(fromComposer?(S.template?.title||S.prompt.trim().slice(0,28)):"");
  modal(p?"编辑模板":"保存模板",`<form id="template-form" data-id="${esc(p?.id||"")}"><div class="form-field"><label for="template-name">名称</label><input id="template-name" name="title" value="${esc(title)}" maxlength="100" placeholder="模板名称"></div><div class="form-field"><label for="template-text">模板正文</label><textarea id="template-text" name="text" rows="9" maxlength="24000" placeholder="保留需要复用的部分…">${esc(text)}</textarea></div><div class="section-label"><span>参考图</span><span id="template-reference-count">${S.templateEditorRefs.length}</span></div><div class="reference-strip" id="template-editor-refs"></div><button class="btn primary" type="submit">保存模板</button></form>`);renderTemplateEditorRefs();
}


document.addEventListener("click",async e=>{
  const el=e.target.closest("[data-action]");if(!e.target.closest(".user-menu")&&!e.target.closest('[data-action="user-menu"]')){if(StudioLayers.top==="menu")StudioLayers.close("menu");else $("#user-menu")?.classList.add("hidden");}if(!el||el.disabled)return;
  const a=el.dataset.action,id=el.dataset.id;
  try{
    if(await StudioWorkspace.action(a,el)||await StudioSettings.action(a,el)||await StudioTasks.action(a,el))return;
    if(a.startsWith("upscale-")){await StudioUpscale.action(a,el);return;}
    if(a.startsWith("storage-")){await StudioUpscale.storageAction(a,el);return;}
    if(a==="user-menu"){const menu=$("#user-menu");if(!menu.classList.contains("hidden"))StudioLayers.close("menu");else{menu.classList.remove("hidden");StudioLayers.push("menu",()=>{menu.classList.add("hidden");document.querySelectorAll(".user-trigger").forEach(t=>t.setAttribute("aria-expanded","false"));});}document.querySelectorAll(".user-trigger").forEach(t=>t.setAttribute("aria-expanded",!$("#user-menu").classList.contains("hidden")));}
    else if(a==="polish-details")await StudioPolish.open(id);
    else if(a==="copy-polished")await StudioPolish.copy(id);
    else if(a==="nav"){if(StudioLayers.top==="menu")StudioLayers.close("menu");if(el.dataset.page===S.page&&S.collection){StudioLayers.close("collection");}else{if(el.dataset.page==="create"&&S.page==="create")S.createMode="generate";await navigate(el.dataset.page);}}
    else if(a==="install-app"){ if(StudioLayers.top==="menu")StudioLayers.close("menu");await installStudio(); }
    else if(a==="generation-options")openGenerationOptions();
    else if(a==="open-collection")await openCollection(id);
    else if(a==="close-collection"){if(!StudioLayers.close("collection")){S.collection=null;renderRecent();}}
    else if(a==="more-collections"){S.collectionLimit=(S.collectionLimit||50)+50;await refresh();}
    else if(a==="more-collection-jobs"){S.collectionJobLimit=(S.collectionJobLimit||50)+50;await refresh();}
    else if(a==="restore-collection"){await post(`/api/collections/${id}/restore`);await refresh();await renderTrash();toast("列表已恢复");}
    else if(a==="restore-asset"){await post(`/api/assets/${id}/restore`);await refresh();await renderTrash();toast("图片已恢复");}
    else if(a==="rename-collection"){const g=S.collections.find(g=>g.id===id);modal("重命名列表",`<form id="collection-form" data-id="${id}"><div class="form-field"><label for="collection-name">名称</label><input id="collection-name" name="name" value="${esc(g.name)}" maxlength="120" required></div><button class="btn primary" type="submit">保存</button></form>`);}
    else if(a==="load-collection"){const j=S.collectionJobs?.[0];if(j)await restorePreset({text:j.prompt,refs:j.refs,references:j.references,options:j.options,template_id:j.template_id,template_title:j.template_title});}
    else if(a==="revoke-sessions"){await post("/api/account/revoke-sessions");toast("其他设备已退出");await renderAccount();}
    else if(a==="close-modal")closeModal();
    else if(a==="logout"){await post("/api/auth/logout");StudioLayers.reset();StudioViewer.close(false);await StudioImages.clear();closeModal();S.auth=null;renderAuth(true);}
    else if(a==="upload")$("#file-input").click();
    else if(a==="ratio"){S.ratio=el.dataset.ratio;document.querySelectorAll(".ratio-btn").forEach(b=>{b.classList.toggle("selected",b===el);b.setAttribute("aria-pressed",b===el);});draft();renderGenerationSummary();}
    else if(a==="count"){S.count=Math.max(1,Math.min(20,S.count+Number(el.dataset.delta)));document.querySelectorAll("[data-generation-count]").forEach(i=>i.value=S.count);draft();renderGenerationSummary();}
    else if(a==="remove-reference"){S.refs=S.refs.filter(v=>v!==id);draft();renderReferences();}
    else if(a==="generate")await generate();
    else if(a==="save-prompt")openTemplateEditor(null,true);
    else if(a==="picker-toggle"){
      if(S.picker.includes(id))S.picker=S.picker.filter(v=>v!==id);else if(S.picker.length<8)S.picker.push(id);else return toast("最多选择 8 张参考图");
      el.closest(".asset-card").classList.toggle("selected",S.picker.includes(id));$("#picker-count").textContent=`已选择 ${S.picker.length} / 8 张`;
    }
    else if(a==="picker-confirm"){S.refs=[...S.picker];draft();closeModal();renderReferences();}
    else if(a==="prompt-picker")await promptPicker();
    else if(a==="detach-template"){S.template=null;draft();renderTemplateChip();}
    else if(a==="edit-prompt"){const p=S.prompts.find(p=>p.id===id);if(p)openTemplateEditor(p);}
    else if(a==="remove-template-reference"){S.templateEditorRefs=S.templateEditorRefs.filter(a=>a!==id);renderTemplateEditorRefs();}
    else if(a==="use-prompt"){const p=S.prompts.find(p=>p.id===id);if(p)await restorePreset(p);}
    else if(a==="favorite-prompt"){const p=S.prompts.find(p=>p.id===id);await api(`/api/templates/${id}`,{method:"PATCH",body:{favorite:!p.favorite}});await loadPrompts();}
    else if(a==="delete-prompt"){await api(`/api/templates/${id}`,{method:"DELETE"});await loadPrompts();toast("已移除提示词记录");}
    else if(a==="new-prompt")openTemplateEditor();
    else if(a==="clear-image-cache"){const state=await StudioImages.clear();if($("#image-cache-status"))$("#image-cache-status").textContent="0 KB";toast("本机图片缓存已清除");}
    else if(a==="stitch-artifact"){const kind=el.dataset.artifact;if(kind==="report"){const report=await api(`/api/jobs/${id}/stitch/report`);modal("配准与检查报告",`<pre class="log">${esc(JSON.stringify(report,null,2))}</pre>`);}else if(["inspection","candidate"].includes(kind))modal(kind==="inspection"?"局部检查图":"拼接候选图",`<img class="modal-image" src="/api/jobs/${id}/stitch/${kind}" alt="拼接检查">`);}

    else if(a==="favorite-asset"){const asset=S.assetMap.get(id);const updated=await api(`/api/assets/${id}`,{method:"PATCH",body:{favorite:!asset.favorite}});rememberAssets([updated]);renderRecent();}
    else if(a==="save-asset"){const updated=await api(`/api/assets/${id}`,{method:"PATCH",body:{name:$("#asset-name").value,tags:$("#asset-tags").value}});rememberAssets([updated]);toast("图片信息已保存");}
    else if(a==="pause"){S.config.paused=!S.config.paused;await saveSettings();await navigate(S.page);}
    else if(a==="job-detail")await jobDetail(id);
    else if(a==="show-log"){const r=await api(`/api/jobs/${id}/log`);$("#job-log").innerHTML=`<pre class="log">${esc(r.text)}</pre>`;}
    else if(a==="cancel-job"){await post(`/api/jobs/${id}/cancel`);await refresh();toast("任务已取消");}
    else if(a==="retry-job"){await post(`/api/jobs/${id}/retry`);closeModal();await refresh();toast("已重新加入队列");}
    else if(a==="reroll"||a==="reuse-job"){const j=S.modalJob?.id===id?S.modalJob:S.jobs.find(j=>j.id===id);if(!j)return;if(a==="reroll")await generate({prompt:j.prompt,refs:j.refs,count:1,ratio:j.options.ratio,transparent:j.options.transparent,polish:Boolean(j.options.polish),size:j.options.size||"auto",stitch:j.options.stitch||0,after_upscale:j.options.after_upscale||0,source_asset_id:j.options.source_asset_id||null,region:j.options.region||null,model:j.model,effort:j.effort,template_id:j.template_id||null});else if(j.options.region){openImagePreview(j.options.source_asset_id,false,{initialRegion:j.options.region,initialPrompt:j.prompt});}else{S.prompt=j.prompt;S.refs=[...j.refs];S.template=j.template_id?{id:j.template_id,title:j.template_title||"模板"}:null;S.ratio=j.options.ratio;S.transparent=j.options.transparent;S.polish=Boolean(j.options.polish);S.stitch=j.options.after_upscale||j.options.stitch||0;S.size=j.options.size||"auto";S.count=1;S.config.model=j.model;S.config.effort=j.effort;await saveSettings();draft();closeModal();await navigate("create");}}
    else if(a==="open-setup"){await fetchSetup();S.setupStep=S.setup.authenticated?3:1;await navigate("setup");}
    else if(a==="setup-step"){S.setupStep=Number(el.dataset.step);await fetchSetup();await renderSetup();}
    else if(a==="login-mode"){S.loginMode=el.dataset.mode;await renderSetup();}
    else if(a==="start-login"){el.disabled=true;S.loginMode=el.dataset.mode||"browser";await post("/api/setup/login",{mode:S.loginMode});await fetchSetup();await renderSetup();}
    else if(a==="cancel-login"){await post("/api/setup/login/cancel");await fetchSetup();await renderSetup();}
    else if(a==="copy-code"){await navigator.clipboard.writeText(S.setup.login.code);toast("设备码已复制");}
    else if(a==="copy-login-link"){await navigator.clipboard.writeText(S.setup.login.url);toast("官方登录链接已复制");}
    else if(a==="probe"){el.disabled=true;await post("/api/setup/probe");await Promise.all([fetchSetup(),refresh()]);await renderSetup();}
    else if(a==="finish-setup"){await post("/api/setup/finish");S.config.onboarded=true;await navigate("create");}
    else if(a==="password")modal("修改登录密码",'<form id="password-form"><div class="form-field"><label>当前密码<input type="password" name="current" autocomplete="current-password" required></label></div><div class="form-field"><label>新密码<input type="password" name="password" minlength="10" maxlength="256" autocomplete="new-password" required></label></div><button class="btn primary" type="submit">更新密码</button></form>');
  }catch(error){toast(error.message);el.disabled=false;}
});

let inputTimer;
document.addEventListener("input",e=>{
  if(e.target.id==="prompt"){S.prompt=e.target.value;$("#prompt-count").textContent=`${S.prompt.length.toLocaleString()} / 24,000`;draft();}
  if(e.target.matches("[data-generation-count]")){S.count=Math.max(1,Math.min(20,Number(e.target.value)||1));draft();renderGenerationSummary();}
  if(["prompt-search","picker-search"].includes(e.target.id)){
    const target=e.target;clearTimeout(inputTimer);inputTimer=setTimeout(async()=>{try{
      if(target.id==="prompt-search")await loadPrompts(target.value);
      else {const r=await api(`/api/assets?kind=${S.pickerKind||"reference"}&limit=200&search=${encodeURIComponent(target.value)}`);rememberAssets(r.items);$("#picker-grid").innerHTML=r.items.map(a=>assetCard(a,true)).join("");}
    }catch(e){toast(e.message);}},250);
  }
});
document.addEventListener("change",async e=>{try{
  if(e.target.id==="upscale-upload"){await StudioUpscale.upload(e.target.files[0]);e.target.value="";return;}
  if(e.target.id==="file-input"){await uploadFiles(e.target.files,S.page==="create");e.target.value="";}
  if(["composer-stitch","sheet-stitch"].includes(e.target.id)){S.stitch=Number(e.target.value);document.querySelectorAll("#composer-stitch,#sheet-stitch").forEach(i=>i.value=String(S.stitch));draft();renderGenerationSummary();}
  if(["composer-polish","sheet-polish"].includes(e.target.id)){S.polish=e.target.checked;document.querySelectorAll("#composer-polish,#sheet-polish").forEach(i=>i.checked=S.polish);draft();renderGenerationSummary();}
  if(["composer-size","sheet-size"].includes(e.target.id)){S.size=e.target.value;document.querySelectorAll("#composer-size,#sheet-size").forEach(i=>i.value=S.size);draft();renderGenerationSummary();}
  if(["transparent","sheet-transparent"].includes(e.target.id)){S.transparent=e.target.checked;document.querySelectorAll("#transparent,#sheet-transparent").forEach(i=>i.checked=S.transparent);draft();renderGenerationSummary();}
  if(e.target.id==="setting-concurrency"){S.config.concurrency=Number(e.target.value);await saveSettings();}
  if(e.target.id==="setting-attempts"){S.config.max_attempts=Number(e.target.value);await saveSettings();}
  if(["composer-model","setting-model","sheet-model","upscale-model","edit-model"].includes(e.target.id)){
    S.config.model=e.target.value;const m=modelItems().find(m=>m.id===S.config.model);if(!m.efforts.includes(S.config.effort))S.config.effort=m.efforts.includes("xhigh")?"xhigh":m.default_effort||m.efforts[0];
    syncModelControls();await saveSettings();
  }
  if(["composer-effort","setting-effort","sheet-effort","upscale-effort","edit-effort"].includes(e.target.id)){S.config.effort=e.target.value;syncModelControls();await saveSettings();}
}catch(error){toast(error.message);}});
document.addEventListener("submit",async e=>{
  if(!['auth-form','new-prompt-form','password-form','template-form','collection-form','call-settings-form','account-form','callback-form'].includes(e.target.id))return;
  e.preventDefault();const form=e.target;const btn=$("button[type=submit]",form);btn.disabled=true;
  try{
    const body=Object.fromEntries(new FormData(form));
    if(form.id==="auth-form"){
      await post(form.dataset.initialized==="true"?"/api/auth/login":"/api/auth/setup",body);
      await start();
    }else if(form.id==="new-prompt-form"){await post("/api/templates",{...body,refs:[...S.refs],options:presetOptions()});closeModal();await loadPrompts();toast("提示词已保存");}
    else if(form.id==="password-form"){const r=await post("/api/auth/password",body);S.auth.csrf=r.csrf;closeModal();toast("密码已更新，其他会话已退出");}
    else if(form.id==="template-form"){
      const payload={text:body.text,title:body.title,refs:S.templateEditorRefs,options:S.templateEditorOptions};const saved=form.dataset.id?await api(`/api/templates/${form.dataset.id}`,{method:"PUT",body:payload}):await post("/api/templates",payload);
      if(S.templateEditorFromComposer||S.template?.id===saved.id){S.template={id:saved.id,title:saved.title,text:saved.text};draft();}closeModal();renderTemplateChip();if(S.page==="prompts")await loadPrompts();toast("模板已保存");
    }
    else if(form.id==="collection-form"){await api(`/api/collections/${form.dataset.id}`,{method:"PATCH",body});closeModal();await refresh();toast("列表已重命名");}
    else if(form.id==="call-settings-form"){await api("/api/settings",{method:"PATCH",body:{concurrency:S.config.concurrency,max_attempts:S.config.max_attempts,paused:S.config.paused,model:S.config.model,effort:S.config.effort,call_prompt:body.call_prompt,polish_prompt:body.polish_prompt,stitch_prompt:body.stitch_prompt}});toast("调用设置已保存");}
    else if(form.id==="account-form"){const r=await api("/api/account",{method:"PATCH",body});S.auth=await api("/api/auth/state");renderShell();await navigate("account");toast("账户已更新");}
    else if(form.id==="callback-form"){await post("/api/setup/callback",body);toast("回调已提交，正在检查登录状态");await fetchSetup();await renderSetup();}
  }catch(error){if(form.id==="auth-form"){$("#auth-error").textContent=error.message;$("#auth-error").classList.remove("hidden");}else toast(error.message);}finally{btn.disabled=false;}
});
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"&&S.page==="create"&&S.auth?.authenticated&&!$("#modal").open){e.preventDefault();generate();}});
$("#modal").addEventListener("click",e=>{if(e.target===$("#modal")){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll();});

async function start(){
  S.auth=await api("/api/auth/state");
  if(!S.auth.authenticated){StudioLayers.reset();await StudioImages.clear();renderAuth(S.auth.initialized);return;}
  StudioLayers.reset();await refresh();if(!localStorage.getItem("studio_draft"))Object.assign(S,S.config.preferences?.defaults||{});loadDraft();S.models=await api("/api/models");if(S.template?.id&&!S.template.text){try{S.template.text=(await api(`/api/templates/${S.template.id}`)).text;draft();}catch{}}await fetchSetup();S.setupStep=S.setup.authenticated?3:1;renderShell();
  await navigate(S.config.onboarded?"create":"setup",{initial:true});
}
start().catch(e=>{$("#app").innerHTML=`<div class="boot">${esc(e.message)}，请刷新页面。</div>`;});
setInterval(poll,4000);
