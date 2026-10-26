"use strict";
(() => {
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const project=(point,view,size)=>({x:clamp((point.x-view.x)/view.scale+size.width/2,0,size.width),y:clamp((point.y-view.y)/view.scale+size.height/2,0,size.height)});
  const rectangle=(a,b,size)=>{const x=Math.floor(Math.min(a.x,b.x)),y=Math.floor(Math.min(a.y,b.y));return {x,y,width:Math.min(size.width-x,Math.ceil(Math.max(a.x,b.x))-x),height:Math.min(size.height-y,Math.ceil(Math.max(a.y,b.y))-y)};};
  class Viewer {
    constructor(){this.dialog=null;this.points=new Map();this.region=null;this.asset=null;this.options={};}
    get isOpen(){return Boolean(this.dialog?.open);}
    open(asset,options={}){
      if(this.isOpen)this.close(false);
      this.asset=asset;this.options=options;this.region=null;this.editing=false;this.selecting=false;this.busy=false;this.points.clear();this.gesture=null;this.zoom=1;this.x=0;this.y=0;
      const dialog=document.createElement('dialog');dialog.className='image-viewer';dialog.setAttribute('aria-label','图片放大预览');
      dialog.innerHTML=`<div class="viewer-shell"><header class="viewer-header"><button class="icon-btn viewer-close" aria-label="返回详情">←</button><div><strong>图片预览</strong><span class="viewer-dimensions"></span></div><a class="icon-btn viewer-download" download aria-label="下载图片">↓</a></header><div class="viewer-stage" tabindex="0" aria-label="双指缩放，拖动查看图片"><div class="viewer-plane"><img draggable="false" alt="图片预览"><div class="viewer-selection" hidden></div></div><span class="viewer-loading">正在加载原图…</span></div><div class="viewer-tools"><button data-view="minus" aria-label="缩小">−</button><button data-view="fit">适应</button><button data-view="native">100%</button><button data-view="plus" aria-label="放大">＋</button><button class="viewer-edit-toggle" data-view="edit">矩形局部重绘</button></div><section class="viewer-editor" hidden><div class="viewer-mode"><button data-view="select" class="selected">框选</button><button data-view="pan">移动 / 缩放</button><button data-view="reset">重选</button><span class="viewer-region-label">拖动框选修改区域</span></div><textarea class="viewer-prompt" rows="2" maxlength="24000" placeholder="描述选区里需要修改的内容…" aria-label="局部重绘要求"></textarea><div class="viewer-submit-row">${options.modelHTML||''}<button class="btn primary viewer-submit" disabled>提交重绘</button></div><p class="viewer-note">只替换矩形内的内容，选区外保持原图。</p></section></div>`;
      document.body.append(dialog);this.dialog=dialog;this.stage=dialog.querySelector('.viewer-stage');this.plane=dialog.querySelector('.viewer-plane');this.image=dialog.querySelector('img');this.overlay=dialog.querySelector('.viewer-selection');
      dialog.querySelector('.viewer-dimensions').textContent=`${asset.width} × ${asset.height}`;
      dialog.querySelector('.viewer-download').href=asset.url+'?download=1';
      if(!asset.id)dialog.querySelector('.viewer-download').remove();
      const editButton=dialog.querySelector('[data-view=edit]');editButton.disabled=!asset.id&&!asset.source_job_id;editButton.title=editButton.disabled?'生成完成后可对保存的作品重绘':'';
      this.image.addEventListener('load',()=>{dialog.querySelector('.viewer-loading').hidden=true;this.layout();});
      this.image.addEventListener('error',()=>{dialog.querySelector('.viewer-loading').textContent='原图加载失败，请关闭后重试';});
      this.image.src=asset.url;
      dialog.querySelector('.viewer-close').onclick=()=>this.close();
      dialog.addEventListener('cancel',e=>{e.preventDefault();this.close();});
      dialog.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>this.action(button.dataset.view));
      dialog.querySelector('.viewer-prompt').oninput=()=>this.updateSelection();
      dialog.querySelector('.viewer-submit').onclick=()=>this.submit();
      this.stage.addEventListener('pointerdown',e=>this.down(e));this.stage.addEventListener('pointermove',e=>this.move(e));
      for(const type of ['pointerup','pointercancel','lostpointercapture'])this.stage.addEventListener(type,e=>this.up(e));
      this.stage.addEventListener('wheel',e=>{e.preventDefault();this.setZoom(this.zoom*(e.deltaY<0?1.18:1/1.18),this.point(e));},{passive:false});
      this.stage.addEventListener('dblclick',e=>{if(!this.selecting)this.setZoom(this.zoom>1?1:2.5,this.point(e));});
      this.resize=new ResizeObserver(()=>this.layout());this.resize.observe(this.stage);
      dialog.showModal();document.documentElement.classList.add('viewer-open');this.layout();
      if(options.initialRegion){this.action('edit');this.region={...options.initialRegion};dialog.querySelector('.viewer-prompt').value=options.initialPrompt||'';this.updateSelection();}
      history.pushState({...history.state,studioViewer:true},'',location.href);
    }
    close(pop=true){
      if(!this.dialog)return;
      this.resize?.disconnect();this.dialog.close();this.dialog.remove();this.dialog=null;this.points.clear();document.documentElement.classList.remove('viewer-open');
      if(pop&&history.state?.studioViewer)history.back();
    }
    point(e){const r=this.stage.getBoundingClientRect();return {x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2};}
    native(point){return project(point,{x:this.x,y:this.y,scale:this.base*this.zoom},this.asset);}
    layout(){if(!this.dialog)return;this.base=Math.min(this.stage.clientWidth*.96/this.asset.width,this.stage.clientHeight*.96/this.asset.height,1);this.paint();}
    paint(){
      if(!this.base)return;
      const scale=this.base*this.zoom,w=this.asset.width*scale,h=this.asset.height*scale;
      this.x=clamp(this.x,-Math.max(0,(w-this.stage.clientWidth)/2),Math.max(0,(w-this.stage.clientWidth)/2));
      this.y=clamp(this.y,-Math.max(0,(h-this.stage.clientHeight)/2),Math.max(0,(h-this.stage.clientHeight)/2));
      Object.assign(this.plane.style,{width:w+'px',height:h+'px',transform:`translate(calc(-50% + ${this.x}px),calc(-50% + ${this.y}px))`});
      this.dialog.querySelector('[data-view=native]').textContent=Math.round(scale*100)+'%';this.updateSelection();
    }
    setZoom(zoom,point={x:0,y:0}){
      const anchor=this.native(point);this.zoom=clamp(zoom,1,64);const scale=this.base*this.zoom;
      this.x=point.x-(anchor.x-this.asset.width/2)*scale;this.y=point.y-(anchor.y-this.asset.height/2)*scale;this.paint();
    }
    down(e){
      if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();this.stage.setPointerCapture(e.pointerId);this.points.set(e.pointerId,this.point(e));
      if(this.points.size===2){const [a,b]=[...this.points.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};this.gesture={kind:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom,anchor:this.native(mid)};}
      else if(this.points.size===1)this.gesture={kind:this.selecting?'select':'pan',start:this.point(e),anchor:this.native(this.point(e)),x:this.x,y:this.y};
    }
    move(e){
      if(!this.points.has(e.pointerId)||!this.gesture)return;e.preventDefault();this.points.set(e.pointerId,this.point(e));const g=this.gesture;
      if(this.points.size>=2){const [a,b]=[...this.points.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if(g.kind!=='pinch')return;this.zoom=clamp(g.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,g.distance),1,64);const scale=this.base*this.zoom;this.x=mid.x-(g.anchor.x-this.asset.width/2)*scale;this.y=mid.y-(g.anchor.y-this.asset.height/2)*scale;this.paint();}
      else if(g.kind==='select'){this.region=rectangle(g.anchor,this.native(this.point(e)),this.asset);this.updateSelection();}
      else if(g.kind==='pan'){const p=this.point(e);this.x=g.x+p.x-g.start.x;this.y=g.y+p.y-g.start.y;this.paint();}
    }
    up(e){if(!this.points.has(e.pointerId))return;this.points.delete(e.pointerId);if(this.points.size===1){const p=[...this.points.values()][0];this.gesture={kind:'pan',start:p,x:this.x,y:this.y};}else this.gesture=null;}
    updateSelection(){
      if(!this.dialog)return;const r=this.region;this.overlay.hidden=!r;
      if(r)Object.assign(this.overlay.style,{left:100*r.x/this.asset.width+'%',top:100*r.y/this.asset.height+'%',width:100*r.width/this.asset.width+'%',height:100*r.height/this.asset.height+'%'});
      this.dialog.querySelector('.viewer-region-label').textContent=r?`${r.width} × ${r.height} · (${r.x}, ${r.y})`:'拖动框选修改区域';
      this.dialog.querySelector('.viewer-submit').disabled=this.busy||!r||r.width<16||r.height<16||!this.dialog.querySelector('.viewer-prompt').value.trim();
    }
    action(action){
      if(action==='plus'||action==='minus')this.setZoom(this.zoom*(action==='plus'?1.5:1/1.5));
      if(action==='fit'){this.x=0;this.y=0;this.setZoom(1);}
      if(action==='native')this.setZoom(1/this.base);
      if(action==='edit'){this.editing=!this.editing;this.selecting=this.editing;this.dialog.querySelector('.viewer-editor').hidden=!this.editing;this.stage.classList.toggle('selecting',this.selecting);this.layout();}
      if(action==='select'||action==='pan'||action==='reset'){
        this.selecting=action!=='pan';if(action==='reset')this.region=null;
        this.stage.classList.toggle('selecting',this.selecting);this.dialog.querySelector('[data-view=select]').classList.toggle('selected',this.selecting);this.dialog.querySelector('[data-view=pan]').classList.toggle('selected',!this.selecting);this.updateSelection();
      }
    }
    async submit(){
      if(this.busy||this.dialog.querySelector('.viewer-submit').disabled)return;
      this.busy=true;this.updateSelection();const button=this.dialog.querySelector('.viewer-submit');button.textContent='正在提交…';
      try{await this.options.onSubmit?.({asset:this.asset,region:{...this.region},prompt:this.dialog.querySelector('.viewer-prompt').value.trim()});}
      catch(error){this.options.onError?.(error.message);}
      finally{this.busy=false;if(this.dialog){button.textContent='提交重绘';this.updateSelection();}}
    }
  }
  const viewer=new Viewer();globalThis.StudioViewer=viewer;globalThis.StudioViewGeometry={project,rectangle};
  if(typeof window!=='undefined')window.addEventListener('popstate',()=>{if(viewer.isOpen)viewer.close(false);});
})();
