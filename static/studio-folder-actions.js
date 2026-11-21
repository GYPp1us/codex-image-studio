"use strict";
globalThis.StudioFolderActions=(function folderActions(){
  const F=StudioFolders,recent=[],waiting=new Map();
  const row=(act,label,ic,id='')=>`<button type="button" class="menu-row" data-dir="${act}" data-id="${esc(id)}">${icon(ic,19)}<span>${esc(label)}</span></button>`;
  const directory=()=>S.coll&&!S.coll.startsWith('~')?S.coll:'';
  const selected=()=>StudioSelection.chosen();
  const chosenFrom=ids=>Object.fromEntries(ids.filter(id=>img(id)?.folder_id).map(id=>[id,img(id).folder_id]));
  const textPath=id=>F.path(id).map(n=>n.name).join(' › ');
  function reportError(layer,error){
    const field=layer?.querySelector('.dir-feedback');
    if(field?.isConnected)field.textContent=error.message;else StudioService.report(error);
  }
  async function write(data){
    const signature=JSON.stringify(data);
    let oid=waiting.get(signature);
    if(oid){
      try{const result=await StudioService.api('/api/library/operations/'+oid);waiting.delete(signature);return result;}
      catch(error){if(error.status!==404)throw error;}
    }else{oid=crypto.randomUUID();waiting.set(signature,oid);}
    try{
      const result=await StudioService.api('/api/library/operations',{method:'POST',body:{...data,operation_id:oid}});
      waiting.delete(signature);return result;
    }catch(error){
      if(error.status&&error.status<500)waiting.delete(signature);
      throw error;
    }
  }
  function form(title,html,submit,focus){
    const l=openSheet({title,html:`<form class="dir-form">${html}<p class="dir-feedback" role="alert"></p><div class="dir-tools"><button class="icon-btn dir-icon" type="submit" title="确认" aria-label="确认">${icon('check')}</button></div></form>`});
    const f=$('form',l);
    f.onsubmit=e=>{e.preventDefault();const b=$('[type=submit]',f);if(b.disabled)return;b.disabled=true;
      submit(l).catch(error=>reportError(l,error)).finally(()=>{b.disabled=false;});};
    if(focus)$(focus,l)?.focus();
    return l;
  }
  async function refreshAfter(result,layer,{leave=false,target='',message='',recipe=false}={}){
    if(layer?.isConnected&&topSheet()===layer)await back();
    if(leave&&StudioSelection.active())await StudioSelection.leave();
    if(recipe)await StudioService.ensureTemplates(true);
    F.invalidate().catch(()=>{});
    if(target){const i=recent.indexOf(target);if(i>=0)recent.splice(i,1);recent.unshift(target);recent.splice(5);}
    if(!message)return;
    toast(message,{ms:6500,...(result.can_undo?{action:'撤销',run:async()=>{
      try{await write({action:'undo',original:result.operation_id});await F.invalidate();toast('已撤销，作品回到原位置');}catch(error){StudioService.report(error);}
    }}:{})});
    if(target){
      const el=$('#toast .toast'),b=document.createElement('button');b.textContent=F.node(target)?.name||'查看';b.title='查看目标文件夹';
      b.onclick=()=>{el.remove();F.open(target).catch(StudioService.report);};el.insertBefore(b,el.querySelector('button'));
    }
  }
  function newFolder(parent,ids=selected()){
    const original=chosenFrom(ids);
    form(ids.length?`用 ${ids.length} 张作品建组`:'新建文件夹',`<label class="field-label">文件夹名称<input class="input" name="folder-name" maxlength="100" enterkeyhint="done" required></label><p class="note">${esc(textPath(parent))}</p>`,async l=>{
      const name=$('input',l).value.trim(),r=await write({action:'create',name,target:parent||null,assets:ids,expected:original});
      F.applyMove(r.folder,ids,original,{name,parent});
      await refreshAfter(r,l,{leave:!!ids.length,target:r.folder,message:ids.length?`已移动 ${ids.length} 张作品`:'已创建文件夹'});
    },'input');
  }
  async function picker({initial='',title='移动到',confirm,newGroup,allowRoot=false,folder=null,ids=[],showDefault=false}){
    let at=initial,token=0,searchRows=[],query='',busy=false,ready=false;
    const l=openSheet({title,cls:'location-picker',html:`
      <label class="pick-search">${icon('search',18)}<input class="input" type="search" aria-label="搜索文件夹" placeholder="搜索文件夹"></label>
      <nav class="dir-picker-path" aria-label="当前位置"></nav>
      <div class="dir-picker-list"></div>
      <p class="dir-feedback" role="alert"></p>
      <footer class="pick-footer"><div><small>目标位置</small><strong></strong></div><button type="button" class="icon-btn dir-icon" data-pick="confirm" title="确认位置" aria-label="确认位置" disabled>${icon('check')}</button></footer>`});
    const list=$('.dir-picker-list',l),feedback=$('.dir-feedback',l),ok=$('[data-pick="confirm"]',l);
    const seenScopes=new Set();
    for(const fid of new Set(ids.map(aid=>img(aid)?.folder_id).filter(Boolean))){
      if(!F.node(fid))await F.load(fid,'folders');
      const scope=F.path(fid).findLast(n=>n.template_id);if(scope)seenScopes.add(scope.id);
    }
    if(folder){const owner=F.path(folder).slice(0,-1).findLast(n=>n.template_id);if(owner)seenScopes.add(owner.id);}
    function allowed(){const trail=F.path(at),scope=trail.findLast(n=>n.template_id);return !query&&!(folder&&trail.some(n=>n.id===folder))&&[...seenScopes].every(id=>id===scope?.id);}
    function location(f,detail='',shortcut=false){
      const glyph=icon(f.template_id?'book':'folder',18);
      return `<button type="button" class="${shortcut?'pick-shortcut':'pick-row'}" data-pick="go" data-id="${esc(f.id)}">${glyph}<span><b>${esc(f.name)}</b>${detail?`<small>${esc(detail)}</small>`:''}</span>${shortcut?'':icon('chevr',16)}</button>`;
    }
    function section(title,items,cls=''){
      return items?`<section class="pick-section"><h3>${title}</h3><div class="${cls}">${items}</div></section>`:'';
    }
    function canConfirm(){return ready&&!busy&&(!!at||allowRoot)&&allowed();}
    async function render(append=false){
      const n=++token;ready=false;ok.disabled=true;feedback.textContent='';
      list.setAttribute('aria-busy','true');
      try{
        let values,total;
        if(query){
          const d=await StudioService.api(`/api/library?part=folders&search=${encodeURIComponent(query)}&folder_offset=${append?searchRows.length:0}&limit=30`,{background:true});
          if(n!==token)return;searchRows=append?[...searchRows,...d.folders]:d.folders;values=searchRows;total=d.folder_total;
        }else{
          const p=await F.load(at,'folders',append);values=p.folders.map(F.node);total=p.total.folders;
        }
        if(n!==token||!l.isConnected||!list.isConnected)return;
        const trail=F.path(at);
        ready=true;ok.disabled=!canConfirm();
        $('.pick-footer strong',l).textContent=trail.map(f=>f.name).join(' › ');
        let hint='目标位置';
        if(query)hint='进入搜索结果以选择位置';
        else if(seenScopes.size>1)hint='所选作品分属不同模板';
        else if(folder&&trail.some(n=>n.id===folder))hint='请选择当前文件夹之外的位置';
        else if(!allowed())hint='请在「'+F.node([...seenScopes][0]).name+'」内选择';
        else if(!at&&!allowRoot)hint='请选择文件夹';
        $('.pick-footer small',l).textContent=hint;
        const pathBar=$('.dir-picker-path',l);
        pathBar.hidden=trail.length===1;
        pathBar.innerHTML=trail.map((f,i)=>i===trail.length-1
          ?`<strong aria-current="page">${esc(f.name)}</strong>`
          :`<button type="button" data-pick="go" data-id="${esc(f.id)}">${esc(f.name)}</button>${icon('chevr',13)}`).join('');
        const shortcuts=!at&&!query?recent.map(F.node).filter(f=>f&&!f.deleted):[];
        const shown=new Set(shortcuts.map(f=>f.id));
        const matches=values.filter(f=>!shown.has(f.id));
        const parentPath=f=>(f.path||F.path(f.id)).slice(0,-1).map(n=>n.name).join(' › ');
        list.innerHTML=(showDefault?`<button class="pick-default" data-pick="default">${icon('refresh',16)}随当前模板</button>`:'')+
          section('最近使用',shortcuts.map(f=>location(f,f.parent_id?parentPath(f):'',true)).join(''),'pick-recents')+
          section(query?'搜索结果':'文件夹',matches.map(f=>location(f,query?parentPath(f):'')).join(''))+
          (query&&!values.length?'<p class="pick-empty">没有匹配的文件夹</p>':'')+
          (values.length<total?'<button class="menu-row" data-pick="more">更多文件夹</button>':'')+
          (newGroup&&allowed()?`<button class="pick-default" data-pick="new">${icon('folderplus',18)}在此建组</button>`:'');
        if(!append)list.scrollTop=0;
      }catch(error){
        if(n!==token||!list.isConnected)return;
        list.innerHTML='<button class="pick-default" data-pick="retry">'+icon('refresh',18)+'重新读取文件夹</button>';
        reportError(l,error);
      }finally{if(n===token)list.removeAttribute('aria-busy');}
    }
    $('input',l).oninput=e=>{query=e.target.value.trim();searchRows=[];render();};
    l.onclick=async e=>{
      const b=e.target.closest('[data-pick]');if(!b||busy)return;
      if(!ready&&['new','go','more'].includes(b.dataset.pick)&&list.contains(b))return;
      try{
        switch(b.dataset.pick){
          case 'go':at=b.dataset.id;query='';$('input',l).value='';await render();break;
          case 'retry':await render();break;
          case 'more':await render(true);break;
          case 'new':newGroup(at);break;
          case 'default':busy=true;ok.disabled=true;await confirm(null,l);break;
          case 'confirm':if(!ok.disabled){busy=true;ok.disabled=true;await confirm(at,l);}break;
        }
      }catch(error){if(list.isConnected)reportError(l,error);}finally{
        if(b.dataset.pick==='default'||b.dataset.pick==='confirm')busy=false;
        if(list.isConnected&&topSheet()===l)ok.disabled=!canConfirm();
      }
    };
    await render();return l;
  }
  function move(ids,initial=directory()){
    const expected=chosenFrom(ids);
    return picker({initial,ids,newGroup:parent=>newFolder(parent,ids),confirm:async(target,l)=>{
      const r=await write({action:'move',target,assets:ids,expected});
      F.applyMove(target,ids,expected);
      await refreshAfter(r,l,{leave:!!selected().length,target,message:`已移动 ${r.count} 张作品`});
    }});
  }
  function menu(id){
    const f=F.node(id),scope=F.path(id).slice(0,-1).findLast(n=>n.template_id);
    const html=row('compose','在此创作','sparkle',id)+(scope?row('use-parent',`用「${scope.name}」配方在此创作`,'book',id):'')+(f.template_id?row('use-recipe','用此模板创作','book',id)+row('origin','查看此模板生成的作品','layers',f.template_id):'')+
      (id==='untemplated'?'':row('recipe',f.template_id?'编辑模板':'设为模板','book',id)+row('rename','重命名','edit',id)+row('relocate','移动文件夹','folder',id)+
      (scope?row('detach-folder',`移出模板 ${scope.name}`,'arrow',id):'')+(f.template_id?row('unrecipe','转回普通文件夹','folder',id):row('dissolve','解散分组','layers',id))+row('trash-folder','移到最近删除','trash',id));
    openSheet({title:f.name,html});
  }
  async function recipe(id){
    const f=F.node(id),parent=F.path(id).slice(0,-1).findLast(n=>n.template_id);
    const initial=f.template_id?await StudioService.api('/api/templates/'+f.template_id):null;
    if(initial?.references)StudioService.ingestLibrary(initial.references);
    let refs=[...(initial?.refs||[])],options={...(initial?.options||{})};
    const l=form(f.template_id?'编辑模板':'设为模板',`<label class="field-label">提示词<textarea class="input" maxlength="24000" name="text">${esc(initial?.text||'')}</textarea></label><div class="ref-strip" id="dir-refs"></div><div class="dir-tools"><button type="button" class="ghost-btn" data-seed="art">从作品带入</button>${parent?'<button type="button" class="ghost-btn" data-seed="parent">带入上级配方</button>':''}</div>`,async layer=>{
      const r=await write({action:'recipe',folder:id,text:$('textarea',layer).value,refs,options});
      await refreshAfter(r,layer,{recipe:true,message:'已在原位置保存模板'});
    });
    function paint(){StudioReferences.render($('#dir-refs',l),{read:()=>refs,write:v=>{refs=v;paint();},
      add:()=>StudioService.pickerSheet({title:'选择模板参考图',refs,onCommit:v=>{refs=v;paint();}})});}
    function fill(t){if(t.references)StudioService.ingestLibrary(t.references);$('textarea',l).value=t.text??t.prompt??'';refs=[...(t.refs||[])];options={...t.options};paint();}
    l.addEventListener('click',async e=>{
      const seed=e.target.closest('[data-seed]')?.dataset.seed;if(!seed)return;
      try{
        if(seed==='parent'){fill(await StudioService.api('/api/templates/'+parent.template_id));return;}
        await F.load(id,'assets');
        const pick=openSheet({stack:true,title:'选择配方来源',html:'<div class="grid dir-seeds"></div><button class="secondary" data-seed-more>加载更多</button>'});
        const show=()=>{const p=F.page(id);$('.dir-seeds',pick).innerHTML=p.assets.map(a=>`<button class="tile" type="button" data-seed-id="${esc(a)}" aria-label="${esc(img(a).name)}"><img src="${src(img(a))}" loading="lazy" alt=""></button>`).join('');$('[data-seed-more]',pick).hidden=p.assets.length>=p.total.assets;};
        show();pick.onclick=async ev=>{try{if(ev.target.closest('[data-seed-more]')){await F.load(id,'assets',true);show();return;}
          const aid=ev.target.closest('[data-seed-id]')?.dataset.seedId;if(!aid)return;const d=await StudioService.api('/api/assets/'+aid+'/info');
          if(!d.job)throw new Error('这张作品没有可用的生成记录');await back();fill(d.job);
        }catch(error){StudioService.report(error);}};
      }catch(error){reportError(l,error);}
    });
    paint();
  }
  function tree(full=false){
    const l=openSheet({title:full?'完整路径':'目录树',html:'<div class="dir-navigation"></div>'});
    const update=()=>{if(l.isConnected)$('.dir-navigation',l).innerHTML=full?F.path(S.coll||'').map(f=>row('ancestor',f.name,'folder',f.id)).join(''):row('open','作品','layers','')+F.treeHTML();};
    l.dirUpdate=update;F.load('','folders').then(update).catch(e=>reportError(l,e));update();
  }
  async function act(a){
    const k=a.dataset.dir,id=a.dataset.id||'',fid=directory(),ids=selected();
    switch(k){
      case 'open':case 'locate':return F.open(id);
      case 'up':return F.ancestor(F.path(S.coll||'').at(-2)?.id||'');
      case 'ancestor':if(topSheet())await back();return F.ancestor(id);
      case 'all':return F.open('~all');
      case 'origin':return F.open('~origin:'+id);
      case 'tree':return tree();
      case 'path':return tree(true);
      case 'expand':if(F.expanded.has(id))F.expanded.delete(id);else{F.expanded.add(id);await F.load(id,'folders');}F.changed();topSheet()?.dirUpdate?.();return;
      case 'tree-more':await F.load(id,'folders',true);F.changed();topSheet()?.dirUpdate?.();return;
      case 'more':return F.load(S.coll||'',a.dataset.type,true);
      case 'retry':return F.load(S.coll||'',a.dataset.type,false,30,true);
      case 'select':return StudioSelection.begin();
      case 'create':if(!fid&&ids.length)return picker({title:'在此建组',allowRoot:true,ids,confirm:async at=>newFolder(at,ids)});return newFolder(fid,ids);
      case 'move':return move(ids);
      case 'single-move':return move([id],img(id)?.folder_id||'');
      case 'menu':return menu(id);
      case 'recipe':return recipe(id);
      case 'rename':return form('重命名',`<input class="input" required maxlength="100" aria-label="文件夹名称" value="${esc(F.node(id).name)}">`,async l=>refreshAfter(await write({action:'rename',folder:id,name:$('input',l).value.trim()}),l,{message:'已重命名'}),'input');
      case 'relocate':return picker({title:'移动文件夹',initial:F.node(id).parent_id||'',allowRoot:true,folder:id,confirm:async(target,l)=>refreshAfter(await write({action:'relocate',folder:id,target:target||null}),l,{message:'文件夹已移动'})});
      case 'detach-folder':{
        const owner=F.path(id).slice(0,-1).findLast(n=>n.template_id),target=owner.parent_id||'';
        return form(`移出模板 ${owner.name}`,`<p>${esc(textPath(id))}</p><p>移至 ${esc(textPath(target))} › ${esc(F.node(id).name)}</p>`,async l=>refreshAfter(await write({action:'detach',folder:id,target:target||null}),l,{message:'已移出模板，作品来源已保留'}));
      }
      case 'unrecipe':return form('转回普通文件夹','<p>目录和已有作品将保留在原位置。</p>',async l=>refreshAfter(await write({action:'unrecipe',folder:id}),l,{recipe:true,message:'已转回普通文件夹'}));
      case 'trash-folder':return form('移到最近删除',`<p>移入「${esc(F.node(id).name)}」及其内容，可从最近删除恢复。</p>`,async l=>{const parent=F.node(id).parent_id||'';await write({action:'trash',folder:id});await back();await F.ancestor(parent);await F.invalidate();toast('已移到最近删除');});
      case 'dissolve':{
        const parent=F.node(id).parent_id||'';
        return form('解散分组',`<p>子文件夹移至 ${esc(textPath(parent))}，直属作品移至 ${esc(parent?textPath(parent):'待整理')}。</p>`,async l=>{
          await write({action:'dissolve',folder:id});await back();await F.ancestor(parent);await F.invalidate();toast('已解散分组');
        });
      }
      case 'add':{
        await F.open('~all');StudioSelection.begin();const bar=$('#selection-toolbar');if(bar){const b=bar.querySelector('[data-dir=move]');b.dataset.dir='add-confirm';b.dataset.id=id;}return;
      }
      case 'add-confirm':{
        const r=await write({action:'move',assets:ids,target:id,expected:chosenFrom(ids)});await refreshAfter(r,null,{leave:true,target:id,message:`已添加 ${ids.length} 张作品`});return F.open(id);
      }
      case 'compose':case 'use-recipe':case 'use-parent':{
        const f=F.node(id);await closeOverlays();if(k!=='compose'){const pid=k==='use-parent'?F.path(id).slice(0,-1).findLast(n=>n.template_id)?.template_id:f.template_id;await StudioService.useFolderRecipe(pid);}
        else{S.composer.template=null;await go('create');}
        S.composer.folderId=id;S.composer.folderName=f.name;S.composer.ack=false;StudioService.saveDraft();refresh();return;
      }
      case 'save-target':return picker({initial:S.composer.folderId||'',title:'作品保存位置',showDefault:true,confirm:async(to,l)=>{S.composer.folderId=to;S.composer.folderName=F.node(to)?.name;if(!to)S.composer.folderName=null;await back();StudioService.saveDraft();refresh();}});
      case 'filter':{
        const origins=await StudioService.api('/api/library/origins');
        F.rememberOrigins(origins);
        openSheet({title:'按来源筛选',html:row('all','全部作品','layers')+row('open','待整理','folder','~inbox')+row('origin','无模板','book','')+origins.map(t=>row('origin',t.title,'book',t.id)).join('')});return;
      }
    }
  }
  app.addEventListener('click',e=>{const a=e.target.closest('[data-dir]');if(!a)return;e.preventDefault();act(a).catch(StudioService.report);});
  return {write,reset(){recent.length=0;waiting.clear();}};
})();
