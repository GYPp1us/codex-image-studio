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
      this.asset=asset;this.options=options;this.region=null;this.regions=[];this.editing=false;this.selecting=false;this.busy=false;this.points.clear();this.gesture=null;this.zoom=1;this.x=0;this.y=0;
      const dialog=document.createElement('dialog');dialog.className='image-viewer';dialog.setAttribute('aria-label','图片放大预览');
      dialog.innerHTML=`<div class="viewer-shell"><header class="viewer-header"><button class="icon-btn viewer-close" aria-label="返回">←</button><div><strong>图片</strong><span class="viewer-dimensions"></span></div><button class="icon-btn" data-view="info" aria-label="图片信息">ⓘ</button><button class="icon-btn" data-view="more" aria-label="更多图片操作">···</button></header><div class="viewer-stage" data-image-view tabindex="0" aria-label="双指缩放，拖动查看图片"><div class="viewer-plane"><img draggable="false" data-full-image width="${asset.width}" height="${asset.height}" alt="图片预览"><div class="viewer-saved-selections"></div><div class="viewer-selection" hidden></div></div>${globalThis.StudioImages?.markup("viewer-loading")||'<span class="viewer-loading">正在加载原图…</span>'}</div><div class="viewer-tools"><button data-view="previous" aria-label="上一张">‹</button><button data-view="minus" aria-label="缩小">−</button><button data-view="fit">适应</button><button data-view="native">100%</button><button data-view="plus" aria-label="放大">＋</button><button data-view="next" aria-label="下一张">›</button></div><div class="viewer-actions"><a class="viewer-download" download>下载</a><button data-view="reference">用作参考</button><button data-view="reroll">再抽</button><button class="viewer-edit-toggle" data-view="edit">局部重绘</button><button data-view="upscale">超分</button></div><form class="viewer-quick"><div class="viewer-quick-row"><input class="viewer-quick-prompt" maxlength="24000" placeholder="一句话修改这张图…" aria-label="速改要求"><button class="btn primary" type="submit">速改</button></div><button type="button" class="viewer-quick-spec" data-view="quick-settings"></button><span class="viewer-feedback" role="status"></span></form><section class="viewer-editor" hidden><div class="viewer-mode"><button data-view="select" class="selected">框选</button><button data-view="pan">移动 / 缩放</button><button data-view="reset">重选</button><span class="viewer-region-label">拖动框选修改区域</span></div><div class="viewer-regions"></div><label class="switch"><input class="viewer-shared" type="checkbox" checked>所有区域共用要求</label><textarea class="viewer-prompt" rows="2" maxlength="24000" placeholder="描述选区里需要修改的内容…" aria-label="局部重绘要求"></textarea><button data-view="add-region">＋ 保留此区域，继续框选（最多 6 个）</button><div class="viewer-submit-row">${options.modelHTML||''}<button class="btn primary viewer-submit" disabled>提交重绘</button></div><p class="viewer-note">区域不能重叠；并行重绘后合成一张图片，只修改选区内像素。</p></section></div>`;
      document.body.append(dialog);this.dialog=dialog;this.stage=dialog.querySelector('.viewer-stage');this.plane=dialog.querySelector('.viewer-plane');this.image=dialog.querySelector('img');this.overlay=dialog.querySelector('.viewer-selection');
      dialog.querySelector('.viewer-dimensions').textContent=`${asset.width} × ${asset.height}`;
      dialog.querySelector('.viewer-download').href=asset.url+'?download=1';
      dialog.querySelector('.viewer-quick-spec').textContent=`${asset.width} × ${asset.height} · 原图画幅 · 设置 ›`;
      if(!asset.id)dialog.querySelector('.viewer-download').remove();
      const editButton=dialog.querySelector('[data-view=edit]');editButton.disabled=!asset.id&&!asset.source_job_id;editButton.title=editButton.disabled?'生成完成后可对保存的作品重绘':'';
      this.image.addEventListener('load',()=>{dialog.querySelector('.viewer-loading').hidden=true;this.layout();});
      this.image.src=asset.preview||asset.url;
      this.tileImages=new Map();this.tileLayer=null;
      if(asset.tile_template){
        this.tileLayer=document.createElement('div');this.tileLayer.className='viewer-tile-layer';this.plane.insertBefore(this.tileLayer,this.overlay);
        const status=document.createElement('span');status.className='viewer-detail-status';status.textContent='放大后加载原生细节';dialog.querySelector('.viewer-header>div').append(status);
      }
      dialog.querySelector('.viewer-close').onclick=()=>this.close();
      dialog.addEventListener('cancel',e=>{e.preventDefault();this.close();});
      dialog.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>this.action(button.dataset.view));
      dialog.querySelector('.viewer-prompt').oninput=()=>this.updateSelection();
      dialog.querySelector('.viewer-shared').onchange=()=>this.updateSelection();
      dialog.querySelector('.viewer-quick').onsubmit=async event=>{event.preventDefault();const input=dialog.querySelector('.viewer-quick-prompt'),button=dialog.querySelector('.viewer-quick button[type=submit]');if(!input.value.trim()||this.busy)return;button.disabled=true;try{await this.options.onAction?.('quick-edit',this.asset,input.value.trim());input.value='';dialog.querySelector('.viewer-feedback').textContent='速改已加入任务';}catch(error){this.options.onError?.(error.message);}finally{button.disabled=false;}};
      dialog.querySelector('.viewer-submit').onclick=()=>this.submit();
      this.stage.addEventListener('pointerdown',e=>this.down(e));this.stage.addEventListener('pointermove',e=>this.move(e));
      for(const type of ['pointerup','pointercancel','lostpointercapture'])this.stage.addEventListener(type,e=>this.up(e));
      this.stage.addEventListener('wheel',e=>{e.preventDefault();this.setZoom(this.zoom*(e.deltaY<0?1.18:1/1.18),this.point(e));},{passive:false});
      this.stage.addEventListener('dblclick',e=>{if(!this.selecting)this.setZoom(this.zoom>1?1:2.5,this.point(e));});
      this.resize=new ResizeObserver(()=>this.layout());this.resize.observe(this.stage);
      dialog.showModal();document.documentElement.classList.add('viewer-open');this.layout();globalThis.StudioImages?.hydrate(dialog);
      if(globalThis.StudioLayers)StudioLayers.push('viewer',()=>this.close(false));
      else history.pushState({...history.state,studioViewer:true},'',location.href);
      if(options.initialRegion){this.action('edit');this.region={...options.initialRegion};dialog.querySelector('.viewer-prompt').value=options.initialPrompt||'';this.updateSelection();}
      this.animateOpen(options.origin);
      this.options.onImageChange?.(this.asset);
    }
    close(pop=true){
      if(!this.dialog)return;
      if(pop&&globalThis.StudioLayers){if(StudioLayers.close())return;}
      if(typeof requestAnimationFrame!=='undefined'&&this.asset?.id){const target=document.querySelector(`.asset-open[data-id="${CSS.escape(this.asset.id)}"] img`);this.animateClose(target);}
      this.resize?.disconnect();this.dialog.close();this.dialog.remove();this.dialog=null;this.points.clear();document.documentElement.classList.remove('viewer-open');
      this.tileImages?.clear();this.tileLayer=null;clearTimeout(this.tileTimer);
      if(pop&&!globalThis.StudioLayers&&history.state?.studioViewer)history.back();
    }
    animateOpen(origin){
      if(!origin?.getBoundingClientRect||document.documentElement.classList.contains('reduce-motion')||typeof requestAnimationFrame==='undefined')return;
      const from=origin.getBoundingClientRect(),to=this.image.getBoundingClientRect();if(!from.width||!to.width)return;
      const clone=document.createElement('img');clone.src=origin.currentSrc||origin.src;clone.className='viewer-hero';document.body.append(clone);const start=performance.now();
      const frame=now=>{const t=Math.min(1,(now-start)/360),p=1-(1-t)**3;for(const k of ['left','top','width','height'])clone.style[k]=(from[k]+(to[k]-from[k])*p)+'px';if(t<1)requestAnimationFrame(frame);else clone.remove();};requestAnimationFrame(frame);
    }
    animateClose(target){
      if(!target||document.documentElement.classList.contains('reduce-motion'))return;
      const from=this.image.getBoundingClientRect(),to=target.getBoundingClientRect();if(!to.width||to.bottom<0||to.top>innerHeight)return;
      const clone=document.createElement('img');clone.src=this.image.currentSrc||this.image.src;clone.className='viewer-hero';document.body.append(clone);const start=performance.now();
      const frame=now=>{const t=Math.min(1,(now-start)/280),p=1-(1-t)**3;for(const k of ['left','top','width','height'])clone.style[k]=(from[k]+(to[k]-from[k])*p)+'px';if(t<1)requestAnimationFrame(frame);else clone.remove();};requestAnimationFrame(frame);
    }
    change(direction){
      if(this.editing||this.busy)return;const items=this.options.sequence||[],index=items.findIndex(a=>a.id===this.asset.id),asset=items[index+direction];if(!asset)return;
      this.asset=asset;this.region=null;this.regions=[];this.zoom=1;this.x=0;this.y=0;this.image.width=asset.width;this.image.height=asset.height;this.image.src=asset.preview||asset.url;
      this.dialog.querySelector('.viewer-dimensions').textContent=`${asset.width} × ${asset.height}`;this.dialog.querySelector('.viewer-download').href=asset.url+'?download=1';this.dialog.querySelector('.viewer-quick-spec').textContent=`${asset.width} × ${asset.height} · 原图画幅 · 设置 ›`;
      this.tileLayer?.remove();this.tileImages.clear();this.tileLayer=null;
      if(asset.tile_template){this.tileLayer=document.createElement('div');this.tileLayer.className='viewer-tile-layer';this.plane.insertBefore(this.tileLayer,this.overlay);if(!this.dialog.querySelector('.viewer-detail-status')){const status=document.createElement('span');status.className='viewer-detail-status';this.dialog.querySelector('.viewer-header>div').append(status);}}
      this.layout();globalThis.StudioImages?.hydrate(this.dialog);
      this.options.onImageChange?.(this.asset);
    }
    point(e){const r=this.stage.getBoundingClientRect();return {x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2};}
    native(point){return project(point,{x:this.x,y:this.y,scale:this.base*this.zoom},this.asset);}
    layout(){if(!this.dialog)return;this.base=Math.min(this.stage.clientWidth*.96/this.asset.width,this.stage.clientHeight*.96/this.asset.height,1);this.maxZoom=Math.max(64,2/Math.max(this.base,1e-12));this.paint();}
    paint(){
      if(!this.base)return;
      const scale=this.base*this.zoom,w=this.asset.width*scale,h=this.asset.height*scale;
      this.x=clamp(this.x,-Math.max(0,(w-this.stage.clientWidth)/2),Math.max(0,(w-this.stage.clientWidth)/2));
      this.y=clamp(this.y,-Math.max(0,(h-this.stage.clientHeight)/2),Math.max(0,(h-this.stage.clientHeight)/2));
      Object.assign(this.plane.style,{width:w+'px',height:h+'px',transform:`translate(calc(-50% + ${this.x}px),calc(-50% + ${this.y}px))`});
      this.dialog.querySelector('[data-view=native]').textContent=Math.round(scale*100)+'%';this.updateSelection();
      if(this.tileLayer){clearTimeout(this.tileTimer);this.tileTimer=setTimeout(()=>this.paintTiles(),70);}
    }
    paintTiles(){
      if(!this.dialog||!this.tileLayer)return;
      const a=this.asset,scale=this.base*this.zoom,maximum=Math.ceil(Math.log2(Math.max(a.width,a.height)));
      const level=clamp(Math.ceil(maximum+Math.log2(scale)),0,maximum),divisor=2**(maximum-level),span=512*divisor;
      const left=clamp(a.width/2+(-this.stage.clientWidth/2-this.x)/scale,0,a.width),right=clamp(a.width/2+(this.stage.clientWidth/2-this.x)/scale,0,a.width);
      const top=clamp(a.height/2+(-this.stage.clientHeight/2-this.y)/scale,0,a.height),bottom=clamp(a.height/2+(this.stage.clientHeight/2-this.y)/scale,0,a.height);
      const wanted=new Set();
      for(let y=Math.max(0,Math.floor(top/span));y<Math.min(Math.ceil(a.height/span),Math.floor(bottom/span)+1);y++){
        for(let x=Math.max(0,Math.floor(left/span));x<Math.min(Math.ceil(a.width/span),Math.floor(right/span)+1);x++){
          const key=`${level}/${x}/${y}`;wanted.add(key);if(this.tileImages.has(key))continue;
          const image=document.createElement('img');image.alt='';image.draggable=false;
          Object.assign(image.style,{left:100*x*span/a.width+'%',top:100*y*span/a.height+'%',width:100*Math.min(span,a.width-x*span)/a.width+'%',height:100*Math.min(span,a.height-y*span)/a.height+'%'});
          image.onload=()=>{if(this.dialog)this.dialog.querySelector('.viewer-detail-status').textContent='按需显示原生细节';};
          image.onerror=()=>{image.style.display='none';if(this.dialog)this.dialog.querySelector('.viewer-detail-status').textContent='细节暂不可用，可下载完整原图';};
          image.src=a.tile_template.replace('{level}',level).replace('{x}',x).replace('{y}',y);this.tileLayer.append(image);this.tileImages.set(key,image);
        }
      }
      for(const [key,image] of this.tileImages)if(!wanted.has(key)){image.remove();this.tileImages.delete(key);}
    }
    setZoom(zoom,point={x:0,y:0}){
      const anchor=this.native(point);this.zoom=clamp(zoom,1,this.maxZoom||64);const scale=this.base*this.zoom;
      this.x=point.x-(anchor.x-this.asset.width/2)*scale;this.y=point.y-(anchor.y-this.asset.height/2)*scale;this.paint();
    }
    down(e){
      if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();this.stage.setPointerCapture(e.pointerId);this.points.set(e.pointerId,this.point(e));
      if(this.points.size===2){const [a,b]=[...this.points.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};this.gesture={kind:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom,anchor:this.native(mid)};}
      else if(this.points.size===1)this.gesture={kind:this.selecting?'select':'pan',start:this.point(e),anchor:this.native(this.point(e)),x:this.x,y:this.y};
    }
    move(e){
      if(!this.points.has(e.pointerId)||!this.gesture)return;e.preventDefault();this.points.set(e.pointerId,this.point(e));const g=this.gesture;
      if(this.points.size>=2){const [a,b]=[...this.points.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if(g.kind!=='pinch')return;this.zoom=clamp(g.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,g.distance),1,this.maxZoom||64);const scale=this.base*this.zoom;this.x=mid.x-(g.anchor.x-this.asset.width/2)*scale;this.y=mid.y-(g.anchor.y-this.asset.height/2)*scale;this.paint();}
      else if(g.kind==='select'){this.region=rectangle(g.anchor,this.native(this.point(e)),this.asset);this.updateSelection();}
      else if(g.kind==='pan'){const p=this.point(e);this.x=g.x+p.x-g.start.x;this.y=g.y+p.y-g.start.y;this.paint();}
    }
    up(e){if(!this.points.has(e.pointerId))return;const g=this.gesture,p=this.point(e);this.points.delete(e.pointerId);if(this.points.size===1){const point=[...this.points.values()][0];this.gesture={kind:'pan',start:point,x:this.x,y:this.y};}else{this.gesture=null;if((!e.type||e.type==='pointerup')&&g?.kind==='pan'&&!this.editing&&this.zoom===1){const dx=p.x-g.start.x,dy=p.y-g.start.y;if(Math.abs(dx)>75&&Math.abs(dx)>Math.abs(dy)*1.4)this.change(dx<0?1:-1);else if(dy>120&&dy>Math.abs(dx)*1.4)this.close();}}}
    updateSelection(){
      if(!this.dialog)return;const r=this.region;this.overlay.hidden=!r;
      if(r)Object.assign(this.overlay.style,{left:100*r.x/this.asset.width+'%',top:100*r.y/this.asset.height+'%',width:100*r.width/this.asset.width+'%',height:100*r.height/this.asset.height+'%'});
      this.dialog.querySelector('.viewer-region-label').textContent=r?`${r.width} × ${r.height} · (${r.x}, ${r.y})`:'拖动框选修改区域';
      const items=[...this.regions,...(r?[r]:[])],shared=this.dialog.querySelector('.viewer-prompt').value.trim();
      const overlap=items.some((a,i)=>items.slice(0,i).some(b=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height));
      this.dialog.querySelector('.viewer-submit').disabled=this.busy||!items.length||items.length>6||overlap||items.some(a=>a.width<16||a.height<16||!(this.dialog.querySelector('.viewer-shared').checked?shared:(a.prompt||shared).trim()));
      if(overlap)this.dialog.querySelector('.viewer-region-label').textContent='区域重叠，请重选当前区域';
      this.dialog.querySelector('[data-view=add-region]').disabled=!r||items.length>=6||overlap||r.width<16||r.height<16;
    }
    paintRegions(){
      const list=this.dialog.querySelector('.viewer-regions'),saved=this.dialog.querySelector('.viewer-saved-selections');list.replaceChildren();saved.replaceChildren();
      this.regions.forEach((region,index)=>{const row=document.createElement('div');row.className='viewer-region-row';const label=document.createElement('span');label.textContent=`${index+1} · ${region.width} × ${region.height}`;const input=document.createElement('input');input.placeholder='此区域要求（可使用共用要求）';input.value=region.prompt||'';input.oninput=()=>{region.prompt=input.value;this.updateSelection();};const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label',`移除区域 ${index+1}`);remove.onclick=()=>{this.regions.splice(index,1);this.paintRegions();this.updateSelection();};row.append(label,input,remove);list.append(row);const box=document.createElement('div');box.className='viewer-saved-region';box.textContent=index+1;Object.assign(box.style,{left:100*region.x/this.asset.width+'%',top:100*region.y/this.asset.height+'%',width:100*region.width/this.asset.width+'%',height:100*region.height/this.asset.height+'%'});saved.append(box);});
    }
    action(action){
      if(action==='plus'||action==='minus')this.setZoom(this.zoom*(action==='plus'?1.5:1/1.5));
      if(action==='fit'){this.x=0;this.y=0;this.setZoom(1);}
      if(action==='native')this.setZoom(1/this.base);
      if(action==='edit'){
        if(this.editing&&globalThis.StudioLayers){StudioLayers.close('editor');return;}
        const toggle=enabled=>{this.editing=enabled;this.selecting=enabled;this.dialog.querySelector('.viewer-editor').hidden=!enabled;this.dialog.querySelector('.viewer-quick').hidden=enabled;this.dialog.querySelector('.viewer-actions').hidden=enabled;this.stage.classList.toggle('selecting',enabled);this.layout();};
        toggle(!this.editing);if(this.editing&&globalThis.StudioLayers)StudioLayers.push('editor',()=>toggle(false));
      }
      if(action==='add-region'&&!this.dialog.querySelector('[data-view=add-region]').disabled){this.regions.push({...this.region,prompt:this.dialog.querySelector('.viewer-shared').checked?'':this.dialog.querySelector('.viewer-prompt').value.trim()});this.region=null;this.paintRegions();this.updateSelection();}
      if(action==='previous'||action==='next')this.change(action==='previous'?-1:1);
      if(['info','more','reference','reroll','upscale','quick-settings'].includes(action))Promise.resolve(this.options.onAction?.(action,this.asset)).catch(error=>this.options.onError?.(error.message));
      if(action==='select'||action==='pan'||action==='reset'){
        this.selecting=action!=='pan';if(action==='reset')this.region=null;
        this.stage.classList.toggle('selecting',this.selecting);this.dialog.querySelector('[data-view=select]').classList.toggle('selected',this.selecting);this.dialog.querySelector('[data-view=pan]').classList.toggle('selected',!this.selecting);this.updateSelection();
      }
    }
    async submit(){
      if(this.busy||this.dialog.querySelector('.viewer-submit').disabled)return;
      this.busy=true;this.updateSelection();const button=this.dialog.querySelector('.viewer-submit');button.textContent='正在提交…';
      try{const prompt=this.dialog.querySelector('.viewer-prompt').value.trim(),items=[...this.regions,...(this.region?[this.region]:[])];await this.options.onSubmit?.({asset:this.asset,region:this.regions.length?undefined:{...this.region},regions:this.regions.length?items.map(a=>({...a,prompt:this.dialog.querySelector('.viewer-shared').checked?prompt:(a.prompt||prompt)})):undefined,prompt});}
      catch(error){this.options.onError?.(error.message);}
      finally{this.busy=false;if(this.dialog){button.textContent='提交重绘';this.updateSelection();}}
    }
  }
  const viewer=new Viewer();globalThis.StudioViewer=viewer;globalThis.StudioViewGeometry={project,rectangle};
  if(typeof window!=='undefined')window.addEventListener('popstate',()=>{if(!globalThis.StudioLayers&&viewer.isOpen)viewer.close(false);});
})();
