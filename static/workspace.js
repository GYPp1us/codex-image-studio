"use strict";
globalThis.StudioWorkspace = (() => {
  let clearDraft=null,infoVersion=0,pressTimer=null,pressPoint=null,suppressClick=0;
  const modeTabs=()=>`<div class="create-mode-tabs" role="tablist" aria-label="创作模式"><button role="tab" aria-selected="${S.createMode!=='upscale'}" class="${S.createMode!=='upscale'?'selected':''}" data-action="create-mode" data-mode="generate">生成</button><button role="tab" aria-selected="${S.createMode==='upscale'}" class="${S.createMode==='upscale'?'selected':''}" data-action="create-mode" data-mode="upscale">超分</button></div>`;
  function destination(){const el=$('#draft-destination');if(!el)return;const template=S.template;el.innerHTML=`<span>归入</span><strong>${esc(template?.title||'无模板')}</strong><button class="link-btn" data-action="prompt-picker">${template?'更换模板':'选择模板'}</button>${template?'<button class="link-btn" data-action="detach-template">解除关联</button>':''}`;const warn=$('#template-difference');if(warn){const saved=S.prompts.find(p=>p.id===template?.id)?.text||template?.text||'',tokens=v=>new Set(v.toLowerCase().replace(/\s/g,'').match(/.{1,3}/g)||[]),a=tokens(saved),b=tokens(S.prompt),common=[...a].filter(t=>b.has(t)).length;warn.hidden=!(saved.length>20&&S.prompt.length>20&&common/Math.max(1,a.size,b.size)<.2);}}
  function render(){
    if(S.createMode==='upscale'){StudioUpscale.render();return;}
    $('#page').innerHTML=`<section class="create-workspace">${modeTabs()}<div class="create-layout"><section class="composer"><div class="composer-body"><div class="composer-section"><div class="section-label"><label for="prompt">描述下一张画面</label><div class="row"><button class="link-btn" data-action="draft-templates">模板 ▾</button><button class="link-btn" id="clear-draft" data-action="clear-draft" ${S.prompt||S.refs.length||S.template?'':'hidden'}>清空</button></div></div><textarea class="prompt-area" id="prompt" maxlength="24000" placeholder="画面、主体、光线，还有你在意的细节…">${esc(S.prompt)}</textarea><span class="sr-only" id="prompt-count">${S.prompt.length} / 24,000</span><div class="draft-destination" id="draft-destination"></div><p id="template-difference" class="notice" hidden>正文与模板已有较大差异，结果仍会归入此模板；可解除关联后提交。</p></div><div class="composer-section"><div class="section-label"><span>参考图 <small>${S.refs.length} / 8</small></span><button class="link-btn" data-action="reference-picker">选择或上传 ＋</button></div><div id="reference-strip" class="reference-strip"></div><div class="dropzone" id="dropzone" tabindex="0" role="button" data-action="reference-picker">${icon('plus')}添加参考图</div><input type="file" id="file-input" hidden accept="image/png,image/jpeg,image/webp,image/tiff" multiple></div><div id="submission-status"></div></div><footer class="composer-footer"><button class="generation-summary" data-action="generation-options" aria-label="调整生成参数"></button><button class="btn primary generate-btn" data-action="generate">生成 ${S.count} 张${icon('arrow')}</button></footer></section><aside class="draft-parameters"><div class="section-label">生成参数</div><div class="ratio-list">${['1:1','3:2','2:3','16:9','9:16','auto'].map(r=>`<button class="ratio-btn ${S.ratio===r?'selected':''}" data-action="ratio" data-ratio="${r}">${r==='auto'?'自动':r}</button>`).join('')}</div>${creativeOptions('composer')}${stitchOptions('composer')}<div class="option-row"><label>数量</label><div class="stepper"><button data-action="count" data-delta="-1">−</button><input data-generation-count type="number" value="${S.count}" min="1" max="20" aria-label="生成数量"><button data-action="count" data-delta="1">＋</button></div></div><label class="switch"><input id="transparent" type="checkbox" ${S.transparent?'checked':''}>透明背景</label>${modelControls('composer')}<button class="link-btn" data-action="settings-section" data-section="defaults">生成默认值 ›</button></aside></div></section>`;
    renderReferences();renderGenerationSummary();destination();submission();
    const zone=$('#dropzone');zone.ondragover=event=>event.preventDefault();zone.ondrop=event=>{event.preventDefault();uploadFiles(event.dataTransfer.files,true);};
  }
  function assetCard(asset,picker=false){return `<article class="asset-card ${picker&&S.picker.includes(asset.id)?'selected':''}" data-id="${esc(asset.id)}"><button class="asset-open" data-action="${picker?'picker-toggle':'image-preview'}" data-id="${esc(asset.id)}" aria-label="${picker?'选择':'查看'} ${esc(asset.name)}"><img class="asset-image" loading="lazy" src="${esc(asset.thumbnail)}" width="${asset.width}" height="${asset.height}" alt="${esc(asset.name)}">${asset.operation==='quick-edit'?'<span class="asset-badge">速改</span>':''}</button></article>`;}
  function submission(){
    const slot=$('#submission-status');if(!slot||!S.lastSubmission)return;
    const value=S.lastSubmission,jobs=S.jobs.filter(j=>value.ids.includes(j.id)),done=jobs.filter(j=>j.status==='succeeded').length,children=S.jobs.filter(j=>value.ids.includes(j.options.parent_job_id)),upscaled=children.filter(j=>j.status==='succeeded').length;
    updateHTML(slot,`<button class="submission-bar" data-action="submission-results"><span class="submission-dot"></span><span><strong>已加入 ${value.ids.length} 张</strong><small>${value.after_upscale?`原图 ${done}/${value.ids.length} · ${value.after_upscale}× 超分 ${upscaled}/${value.ids.length}`:`${done} 张完成`} · ${esc(value.name||'无模板')}</small></span><span>查看结果 ›</span></button>`);
  }

  function animateSubmission(button){
    if(document.documentElement.classList.contains('reduce-motion')||!button?.animate)return;
    const target=matchMedia('(max-width:760px)').matches?$('.mobile-nav [data-page=queue]'):$('.sidebar [data-page=queue]');if(!target)return;
    const from=button.getBoundingClientRect(),to=target.getBoundingClientRect(),dot=document.createElement('span');dot.className='submission-flight';Object.assign(dot.style,{left:from.left+from.width/2+'px',top:from.top+from.height/2+'px'});document.body.append(dot);
    const animation=dot.animate([{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:`translate(${to.left+to.width/2-from.left-from.width/2}px,${to.top+to.height/2-from.top-from.height/2}px) scale(.4)`,opacity:.2}],{duration:420,easing:'cubic-bezier(.32,.72,0,1)'});animation.finished.catch(()=>{}).finally(()=>dot.remove());target.animate([{transform:'scale(1)'},{transform:'scale(1.1)'},{transform:'scale(1)'}],{duration:360,delay:250});
  }
  function workStatus(jobs=S.jobs){const pending=jobs.filter(j=>['queued','running','retrying','failed'].includes(j.status)&&!j.options.system_probe);if(!pending.length)return '';const active=pending.filter(j=>j.status!=='failed').length,failed=pending.length-active;return `<button class="works-status" data-action="nav" data-page="queue">${active?`${active} 张图片正在处理`:''}${failed?`${active?' · ':''}${failed} 张需要处理`:''}<span>前往任务 ›</span></button>`;}
  function sequence(){const assets=S.page==='library'?S.assets:S.collection?(S.collectionJobs||[]).flatMap(j=>j.outputs):S.jobs.flatMap(j=>j.outputs);return [...new Map(assets.map(a=>[a.id,a])).values()];}
  function collectionHero(source){
    const target=$('.collection-header-image');if(!source||!target||document.documentElement.classList.contains('reduce-motion'))return;
    const from=source.rect,to=target.getBoundingClientRect(),clone=document.createElement('img');clone.src=source.src;clone.className='viewer-hero';document.body.append(clone);const start=performance.now();
    const frame=now=>{const t=Math.min(1,(now-start)/360),p=1-(1-t)**3;for(const key of ['left','top','width','height'])clone.style[key]=(from[key]+(to[key]-from[key])*p)+'px';if(t<1)requestAnimationFrame(frame);else clone.remove();};requestAnimationFrame(frame);
  }
  async function openImage(id,source=false,initial={},origin){
    const asset=source?S.modalJob?.source_image:S.assetMap.get(id);if(!asset)return;
    if(StudioViewer.isOpen)closeViewer();else closeModal();
    StudioViewer.open(asset,{...initial,origin,sequence:sequence(),onImageChange:viewerSpec,modelHTML:modelControls('edit'),onError:toast,onAction:viewerAction,onSubmit:async({asset,region,regions,prompt})=>{
      const saved=asset.id?asset:await post(`/api/jobs/${asset.source_job_id}/source-asset`);rememberAssets([saved]);
      const result=await post(`/api/assets/${saved.id}/inpaint`,{prompt,region,regions,model:$('#edit-model')?.value||S.config.model,effort:$('#edit-effort')?.value||S.config.effort});
      S.lastSubmission={...result,name:'局部重绘'};await refresh();toast(`${regions?.length||1} 个区域已加入重绘队列`);
      const feedback=StudioViewer.dialog?.querySelector('.viewer-note');if(feedback)feedback.textContent='已加入任务；完成后合成为一张图片。';
    }});
  }
  async function info(id){
    const token=++infoVersion;modal('图片信息','<p class="small muted">正在读取图片信息…</p>');const panelVersion=StudioPanels.version;const data=await api(`/api/assets/${id}/info`);if(token!==infoVersion||!$('#modal').open||panelVersion!==StudioPanels.version)return;const a=data.asset,j=data.job;rememberAssets([a]);
    modal('图片信息',`<p class="small muted">${a.width} × ${a.height} · ${fmtSize(a.bytes)} · ${fmtTime(a.created)}</p><div class="form-field"><label for="asset-name">名称</label><input id="asset-name" maxlength="160" value="${esc(a.name)}"></div><div class="form-field"><label for="asset-tags">标签</label><input id="asset-tags" maxlength="200" value="${esc(a.tags||'')}"></div><button class="btn secondary" data-action="save-asset" data-id="${a.id}">保存名称与标签</button>${j?`<h4>原始提示词</h4><p class="detail-prompt">${esc(j.prompt)}</p>${StudioPolish.markup(j,true)}<p class="small muted">${esc(j.model)} · ${esc(j.effort)} · ${esc(j.options.ratio)} · ${sizeLabel(j.options.size)}</p><div class="row wrap"><button class="link-btn" data-action="info-create" data-id="${j.id}">用此提示词创作</button><button class="link-btn" data-action="job-detail" data-id="${j.id}">任务记录</button>${j.options.source_asset_id?`<button class="link-btn" data-action="image-preview" data-id="${j.options.source_asset_id}">查看原图</button>`:''}</div>`:'<p class="small muted">这张图片来自上传，没有生成记录。</p>'}`);
  }
  async function menu(id){const asset=S.assetMap.get(id);if(!asset)return;modal('图片操作',`<div class="image-menu">${[['image-preview','打开图片'],['asset-info','图片信息'],['viewer-quick-focus','速改'],['asset-to-composer','用作参考'],['viewer-reroll','再抽一张'],['viewer-edit','局部重绘'],['send-upscale','超分'],['favorite-asset',asset.favorite?'取消收藏':'收藏'],['delete-asset','移入最近删除']].map(([action,label])=>`<button class="${action==='delete-asset'?'danger':''}" data-action="${action}" data-id="${id}">${label}</button>`).join('')}<a href="${esc(asset.url)}?download=1" download>下载图片</a></div>`);}
  async function viewerSpec(asset){
    const field=StudioViewer.dialog?.querySelector('.viewer-quick-spec');if(!field)return;
    const quick=S.config.preferences?.quick||{},job=S.jobs.find(j=>j.id===asset.job_id);
    const paint=origin=>{if(StudioViewer.asset?.id!==asset.id||!StudioViewer.isOpen)return;field.textContent=`${asset.width} × ${asset.height} · ${quick.model||S.config.model} / ${quick.effort||S.config.effort} · 归入${quick.use_source_template!==false?(origin?.template_title||'无模板'):'无模板'} · 设置 ›`;};
    if(job||!asset.job_id)paint(job);else{field.textContent=`${asset.width} × ${asset.height} · 读取归入列表…`;try{paint((await api(`/api/assets/${asset.id}/info`)).job);}catch{if(StudioViewer.asset?.id===asset.id)field.textContent=`${asset.width} × ${asset.height} · 原图所属列表 · 设置 ›`;}}
  }
  async function viewerAction(action,asset,prompt){
    if(action==='info')return info(asset.id);
    if(action==='more')return menu(asset.id);
    if(action==='quick-settings')return StudioSettings.open('quick');
    if(action==='quick-edit'){const result=await post(`/api/assets/${asset.id}/quick-edit`,{prompt});S.lastSubmission={...result,name:'速改'};await refresh();toast('速改已加入任务');return;}
    if(action==='reference'){await addReference(asset.id);return;}
    if(action==='upscale'){closeViewer();await StudioUpscale.selectSource(asset.id);return;}
    if(action==='reroll'){const data=await api(`/api/assets/${asset.id}/info`);if(!data.job)return toast('上传的图片没有生成提示词，可使用速改');const j=data.job;await generate({prompt:j.prompt,refs:j.refs,count:1,ratio:j.options.ratio,transparent:j.options.transparent,polish:j.options.polish,size:j.options.size||'auto',stitch:j.options.stitch||0,after_upscale:j.options.after_upscale||0,source_asset_id:j.options.source_asset_id||null,region:j.options.region||null,regions:j.options.regions||null,quick_edit:j.options.quick_edit||false,template_id:j.template_id||null});}
  }
  function closeViewer(){if(StudioLayers.top==='panel')closeModal();if(StudioLayers.top==='editor')StudioLayers.close('editor');if(StudioViewer.isOpen)StudioViewer.close();}
  async function addReference(id){if(!S.refs.includes(id)){if(S.refs.length>=8)return toast('最多选择 8 张参考图');S.refs.push(id);}draft();closeModal();closeViewer();S.createMode='generate';await navigate('create');renderReferences();toast('已加入参考图');}
  async function picker(kind='reference'){
    S.picker=[...S.refs];S.pickerKind=kind;const data=await api(`/api/assets?kind=${kind}&limit=200`);rememberAssets(data.items);
    modal('选择参考图',`<div class="picker-tabs">${[['reference','参考图库'],['generated','作品']].map(([value,label])=>`<button class="${kind===value?'selected':''}" data-action="picker-kind" data-kind="${value}">${label}</button>`).join('')}<button data-action="picker-upload">上传</button><input id="picker-upload" hidden type="file" accept="image/*" multiple></div><div class="search"><input id="picker-search" placeholder="搜索图片" aria-label="搜索参考图"></div><div id="picker-grid" class="modal-library">${data.items.map(a=>assetCard(a,true)).join('')||'<p class="empty-list">还没有图片，可以先上传。</p>'}</div><footer class="modal-footer"><span id="picker-count">已选择 ${S.picker.length} / 8 张</span><button class="btn primary" data-action="picker-confirm">使用参考图</button></footer>`);
  }
  async function action(name,element){const id=element.dataset.id;
    if(name==='create-mode'){S.createMode=element.dataset.mode;S.collection=null;render();}
    else if(name==='clear-draft'){clearDraft={prompt:S.prompt,refs:[...S.refs],template:S.template,until:Date.now()+5000};S.prompt='';S.refs=[];S.template=null;draft();render();undoToast('草稿已清空','撤销',()=>{if(clearDraft&&Date.now()<=clearDraft.until){Object.assign(S,{prompt:clearDraft.prompt,refs:clearDraft.refs,template:clearDraft.template});draft();render();}clearDraft=null;},5000);}
    else if(name==='draft-templates')modal('模板',`<div class="image-menu"><button data-action="prompt-picker">载入模板</button><button data-action="save-prompt">将当前草稿保存为模板</button></div>`);
    else if(name==='picker-kind'){const saved=[...S.picker];await picker(element.dataset.kind);S.picker=saved;document.querySelectorAll('#picker-grid .asset-card').forEach(card=>card.classList.toggle('selected',saved.includes(card.dataset.id)));$('#picker-count').textContent=`已选择 ${saved.length} / 8 张`;}
    else if(name==='picker-upload')$('#picker-upload').click();
    else if(name==='asset-info')await info(id);
    else if(name==='viewer-quick-focus'){await openImage(id);StudioViewer.dialog?.querySelector('.viewer-quick-prompt')?.focus();}
    else if(name==='image-preview'||name==='asset-detail'){if(Date.now()<suppressClick)return true;await openImage(id,element.dataset.source==='true',{},element.querySelector('img')||element.closest('.asset-open')?.querySelector('img'));}
    else if(name==='reference-picker')await picker();
    else if(name==='asset-to-composer')await addReference(id);
    else if(name==='asset-menu')await menu(id);
    else if(name==='viewer-edit'){closeModal();if(StudioViewer.isOpen&&StudioViewer.asset.id===id)StudioViewer.action('edit');else{await openImage(id);StudioViewer.action('edit');}}
    else if(name==='viewer-reroll'){closeModal();await viewerAction('reroll',S.assetMap.get(id));}
    else if(name==='send-upscale'){closeViewer();await StudioUpscale.selectSource(id);}
    else if(name==='submission-results'){if(S.lastSubmission){await navigate('works');await openCollection(S.lastSubmission.collection_id);}}
    else if(name==='info-create'){const j=await api(`/api/jobs/${id}`);closeViewer();await restorePreset({text:j.prompt,refs:j.refs,references:j.references,options:j.options,template_id:j.template_id,template_title:j.template_title});}
    else if(name==='delete-asset'){await api(`/api/assets/${id}`,{method:'DELETE'});S.refs=S.refs.filter(value=>value!==id);draft();closeModal();closeViewer();await refresh();undoToast('图片已移入最近删除','撤销',async()=>{await post(`/api/assets/${id}/restore`);await refresh();});}
    else if(name==='delete-collection'){await api(`/api/collections/${id}`,{method:'DELETE'});if(S.collection===id)S.collection=null;await refresh();undoToast('列表已移入最近删除','撤销',async()=>{await post(`/api/collections/${id}/restore`);await refresh();});}
    else if(name==='show-log'&&!$('#job-log')){const log=await api(`/api/jobs/${id}/log`);modal('诊断日志',`<pre class="log">${esc(log.text)}</pre>`);}
    else return false;return true;
  }
  function undoToast(message,label,undo,duration=5000){toast(message);const button=document.createElement('button');button.textContent=label;button.onclick=async()=>{button.disabled=true;try{await undo();toast('已撤销');}catch(error){toast(error.message);}};$('#toast').append(button);clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastNode.classList.remove('show'),duration);}
  document.addEventListener('input',event=>{if(event.target.id==='prompt'){S.prompt=event.target.value;destination();const button=$('#clear-draft');if(button)button.hidden=!(event.target.value||S.refs.length||S.template);}});
  document.addEventListener('change',async event=>{if(event.target.id==='picker-upload'){await uploadFiles(event.target.files,true);closeModal();renderReferences();}});
  document.addEventListener('contextmenu',event=>{const card=event.target.closest?.('.asset-open');if(card){event.preventDefault();menu(card.dataset.id).catch(error=>toast(error.message));}});
  document.addEventListener('pointerdown',event=>{const card=event.target.closest?.('.asset-open');if(!card||event.pointerType==='mouse')return;pressPoint={x:event.clientX,y:event.clientY};pressTimer=setTimeout(()=>{suppressClick=Date.now()+700;menu(card.dataset.id).catch(error=>toast(error.message));},550);});
  for(const name of ['pointerup','pointercancel'])document.addEventListener(name,()=>{clearTimeout(pressTimer);pressPoint=null;});
  document.addEventListener('pointermove',event=>{if(pressPoint&&Math.hypot(event.clientX-pressPoint.x,event.clientY-pressPoint.y)>10){clearTimeout(pressTimer);pressPoint=null;}});
  return {render,assetCard,destination,submission,animateSubmission,workStatus,collectionHero,openImage,info,menu,action,modeTabs,viewerSpec,viewerAction,closeViewer};
})();
