"use strict";
const StudioPicker=(()=>{
  async function open(opt,store){
    const single=!!opt.single,selected=new Set(single?[]:(opt.refs||S.composer.refs));
    const initialCount=selected.size;
    const pages={lib:{ids:[],offset:0,total:0,ready:false,busy:false},works:{ids:[],offset:0,total:0,ready:false,busy:false}};
    let tab=single?'works':'lib',disposed=false,observer=null,uploading=false;
    const L=openSheet({stack:true,cls:'reference-picker',title:opt.title||'选择参考图',html:`<div class="seg" id="pk-seg"><span class="ind"></span><button data-pk="tab" data-v="lib">参考图库</button><button data-pk="tab" data-v="works">作品</button></div><button class="secondary pk-upload" data-pk="upload">${icon('upload',16)}从相册上传</button><input type="file" id="pk-file" hidden accept="image/png,image/jpeg,image/webp,image/tiff" ${single?'':'multiple'}><div class="pk-scroll"><p class="note pk-hint">点图片放大预览${single?'':'，点右上角勾选'}</p><div class="pick-grid" id="pk-grid"></div><p class="empty" id="pk-empty" hidden></p><button class="secondary load-more" data-pk="more">加载更多</button></div><footer class="pk-footer"><span id="pk-count" aria-live="polite"></span><button class="primary" id="pk-ok" data-pk="ok" ${single?'hidden':''}>加入</button></footer>`});
    const grid=$('#pk-grid',L),scroll=$('.pk-scroll',L),more=$('[data-pk="more"]',L),file=$('#pk-file',L);
    function paint(){
      if(disposed)return;const page=pages[tab];
      syncList(grid,page.ids.map(id=>store.asset(id)).filter(Boolean),im=>im.id,im=>`<div class="pick" data-id="${im.id}"><button class="pick-preview" data-pk="preview" data-id="${im.id}" aria-label="放大预览 ${esc(im.name)}"><img src="${src(im)}" alt="" loading="lazy" decoding="async"></button>${single?'':`<button class="ck" data-pk="select" data-id="${im.id}" aria-label="选择 ${esc(im.name)}">${icon('check',13)}</button>`}</div>`);
      for(const tile of grid.children){tile.classList.toggle('on',selected.has(tile.dataset.id));tile.querySelector('.ck')?.setAttribute('aria-pressed',String(selected.has(tile.dataset.id)));}
      const empty=$('#pk-empty',L);empty.hidden=!!page.ids.length;empty.textContent=page.busy?'正在读取图片…':page.error?'图片未能加载，请重试':page.ready?'这里还没有图片':'';
      more.hidden=page.ready&&page.offset>=page.total&&!page.error;more.disabled=page.busy;more.textContent=page.busy?'正在加载…':page.error?'重试加载':'加载更多';
      $('#pk-count',L).textContent=single?'预览后选择要使用的图片':`已选 ${selected.size} / 8 张`;
      const ok=$('#pk-ok',L);ok.disabled=uploading||!selected.size&&!initialCount;ok.textContent=selected.size?`加入选中 · ${selected.size} 张`:initialCount?'移除全部参考图':'加入';
      $('[data-pk="upload"]',L).disabled=uploading;
      $$('#pk-seg button',L).forEach(b=>b.classList.toggle('on',b.dataset.v===tab));placeInd($('#pk-seg',L),true);
    }
    async function load(which=tab){
      const page=pages[which];if(disposed||page.busy||page.ready&&page.offset>=page.total&&!page.error)return;
      page.busy=true;page.error=false;paint();
      try{
        const data=await store.api(`/api/assets?kind=${which==='lib'?'reference':'generated'}&limit=40&offset=${page.offset}`);
        if(disposed)return;data.items.forEach(store.remember);store.project();
        page.ids=[...new Set([...page.ids,...data.items.map(im=>im.id)])];page.offset+=data.items.length;page.total=data.total;page.ready=true;
      }catch(error){if(!disposed){page.error=true;store.report(error);}}
      finally{page.busy=false;paint();}
    }
    function toggle(id){if(selected.has(id))selected.delete(id);else if(selected.size<8)selected.add(id);else toast('最多选择 8 张参考图');paint();}
    async function choose(id){if(disposed)return;if(single){await back();opt.onPick?.(id);}else toggle(id);}
    async function click(e){const button=e.target.closest('[data-pk]');if(!button||button.disabled)return;e.preventDefault();e.stopPropagation();
      try{switch(button.dataset.pk){
        case 'tab':{pages[tab].scroll=scroll.scrollTop;tab=button.dataset.v;paint();scroll.scrollTop=pages[tab].scroll||0;if(!pages[tab].ready)await load();break;}
        case 'more':await load();break;
        case 'upload':file.click();break;
        case 'select':toggle(button.dataset.id);break;
        case 'preview':StudioChrome.enterViewer();openViewer(button.dataset.id,null,{reference:true,ids:[...pages[tab].ids],selected:id=>selected.has(id),onSelect:choose});break;
        case 'ok':if(opt.onCommit)opt.onCommit([...selected]);else store.commit([...selected]);await back();break;
      }}catch(error){store.report(error);}
    }
    L.addEventListener('click',click);
    file.addEventListener('change',async()=>{
      const files=[...file.files];if(!files.length)return;uploading=true;paint();let count=0;
      try{for(const item of files){if(disposed)break;if(!single&&selected.size>=8){toast('已选满 8 张，请先移除部分图片');break;}
        const body=new FormData();body.append('file',item);const data=await store.api('/api/assets',{method:'POST',body});if(disposed)return;
        const image=store.remember(data.asset);store.project();count++;if(single){await choose(image.id);return;}selected.add(image.id);
      }
      if(!disposed&&count){tab='lib';pages.lib={ids:[],offset:0,total:0,ready:false,busy:false};scroll.scrollTop=0;await load('lib');toast(`已上传 ${count} 张，可预览后加入`);}
      }catch(error){store.report(error);}finally{uploading=false;file.value='';paint();}
    });
    if(typeof IntersectionObserver!=='undefined'){observer=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting)&&!pages[tab].error)load();},{root:scroll,rootMargin:'160px'});observer.observe(more);}
    L.cleanup=()=>{disposed=true;observer?.disconnect();L.removeEventListener('click',click);};
    paint();await load();return L;
  }
  return {open};
})();
