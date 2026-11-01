"use strict";
/* Works selection is a page mode. History Back exits it before leaving the gallery. */
const StudioSelection=(()=>{
  let selecting=false,scope='',ids=new Set();
  const currentScope=()=>S.coll?'collection:'+S.coll:'works:'+S.worksTab;
  const visible=()=>[...new Set($$('#page .tile').map(el=>el.dataset.id))];
  function close(){selecting=false;ids.clear();$('#selection-toolbar')?.remove();$('#page').classList.remove('selecting');paint();}
  function begin(id){
    if(!selecting){selecting=true;scope=currentScope();ids=new Set();pushLayer('selection',close);}
    ids.add(id);paint();
  }
  function toggle(id){ids.has(id)?ids.delete(id):ids.add(id);paint();}
  function paint(){
    const page=$('#page');page.classList.toggle('selecting',selecting&&S.tab==='works');
    for(const tile of $$('#page .tile')){const selected=selecting&&ids.has(tile.dataset.id);tile.classList.toggle('batch-selected',selected);if(selecting)tile.setAttribute('aria-pressed',String(selected));else tile.removeAttribute('aria-pressed');}
    if(!selecting||S.tab!=='works'){$('#selection-toolbar')?.remove();return;}
    let bar=$('#selection-toolbar');
    if(!bar){bar=document.createElement('footer');bar.id='selection-toolbar';bar.className='selection-toolbar';bar.innerHTML=`<button class="ghost-btn" data-selection="exit">取消</button><span class="selection-count" role="status" aria-live="polite"></span><button class="ghost-btn" data-selection="all">选已加载</button><button class="pill-btn strong" data-selection="menu">操作${icon('chevd',14)}</button>`;page.append(bar);}
    $('.selection-count',bar).textContent=`已选 ${ids.size} 张`;$('[data-selection="menu"]',bar).disabled=!ids.size;
  }
  async function execute(op,button){
    const chosen=[...ids];if(!chosen.length)return;
    await StudioFeedback.run('asset-selection',button,async()=>{
      if(op==='reference'){
        const next=[...new Set([...S.composer.refs,...chosen])];if(next.length>8)throw new Error('参考图合计最多 8 张，请减少选择');
        StudioService.setComposerRefs(next);await back();await leave();toast(`已加入 ${chosen.length} 张参考图`,{action:'去创作',run:()=>go('create')});return;
      }
      const result=await StudioService.bulkAssets(op,chosen);result.succeeded.forEach(id=>ids.delete(id));
      await back();paint();
      if(!ids.size)await leave();
      toast(result.failed.length?`${result.succeeded.length} 张已处理，${result.failed.length} 张失败并保留选择`:`${result.succeeded.length} 张已${op==='delete'?'移到最近删除':op==='favorite'?'收藏':'取消收藏'}`,{ms:5000});
    });
  }
  function menu(){
    openSheet({title:`批量操作 · ${ids.size} 张`,html:`<p class="note">对当前选中的图片操作，未加载的图片不会自动加入。</p><button class="menu-row" data-selection="favorite">${icon('star',20)}<span>收藏所选图片</span></button><button class="menu-row" data-selection="unfavorite">${icon('star',20)}<span>取消收藏</span></button><button class="menu-row" data-selection="reference">${icon('imgplus',20)}<span>加入创作参考图</span><span class="rt">最多 8 张</span></button><div class="menu-sep"></div><button class="menu-row danger" data-selection="delete-confirm">${icon('trash',20)}<span>移到最近删除</span></button>`});
  }
  async function leave(){if(selecting)await back();}
  app.addEventListener('click',e=>{const button=e.target.closest('[data-selection]');if(!button)return;e.preventDefault();e.stopPropagation();const action=button.dataset.selection;
    Promise.resolve().then(async()=>{
      if(action==='exit')return leave();
      if(action==='all'){const loaded=visible(),all=loaded.every(id=>ids.has(id));loaded.forEach(id=>all?ids.delete(id):ids.add(id));paint();return;}
      if(action==='menu')return menu();
      if(action==='delete-confirm'){const layer=button.closest('.sheet-layer');swapSheet(layer,'移到最近删除',`<p class="note">将选中的 ${ids.size} 张图片移到最近删除，之后可以恢复。</p><button class="primary danger-soft" data-selection="delete">移入最近删除</button>`);return;}
      if(StudioFeedback.busy('asset-selection'))return;
      return execute(action,button);
    }).catch(StudioService.report);
  });
  return {begin,toggle,paint,leave,active:()=>selecting,scope:()=>scope};
})();
