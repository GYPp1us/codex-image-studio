"use strict";
/* Shortcuts describe values. Applying one changes the current draft immediately. */
const StudioQuickSettings=(()=>{
  const HOLD=420,SLOP=8,MAX=24;
  const imageModels=[['gpt-image-2','Image 2'],['gpt-image-2.5-sunburst','2.5 Sunburst'],['gpt-image-2.5-flare','2.5 Flare'],['gpt-image-2.6-sunburst','2.6 Sunburst'],['gpt-image-2.6-flare','2.6 Flare']];
  const groups={ratio:'画幅',size:'尺寸',count:'数量',stitch:'生成后超分',polish:'帮我润色',transparent:'透明背景',model:'文本模型',effort:'思考强度',image_model:'图片模型',quality:'图片质量',transport:'生成通道',partial_images:'显影帧',fallback:'允许 CLI 降级'};
  const backendKeys=new Set(['image_model','quality','transport','partial_images','fallback']);
  const labels={auto:'自动',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最大',images:'图片直连',responses:'Responses',cli:'CLI'};
  let press=null,suppress=null,saving=false,frame=0,queue=Promise.resolve(),pending=0,sequence=0;
  const pins=()=>S.settings.quickSettings||[];
  const key=pin=>pin.key+'='+String(pin.value);
  const backend=()=>({...S.settings.imageBackend,...S.composer.imageBackend});
  const canonical=(name,value)=>name==='ratio'?(value==='自动'?'auto':value):name==='size'?({'自动':'auto','1K':'1024','2K':'2048','4K':'4096'}[value]||value):name==='stitch'?(value==='关'?0:parseInt(value)):value;
  const draftValue=pin=>backendKeys.has(pin.key)?backend()[pin.key]:canonical(pin.key,S.composer[pin.key]);
  const active=pin=>pin.value==='toggle'?!!draftValue(pin):draftValue(pin)===pin.value;
  function title(pin){
    if(pin.label)return pin.label;
    const value=pin.value;
    if(value==='toggle')return groups[pin.key];
    if(pin.key==='image_model')return imageModels.find(x=>x[0]===value)?.[1]||value;
    if(pin.key==='model')return StudioService.modelName(value);
    if(pin.key==='count')return value+' 张';
    if(pin.key==='partial_images')return value+' 帧显影';
    if(pin.key==='stitch')return value?'超分 '+value+'×':'关闭超分';
    if(pin.key==='size')return value==='auto'?'自动尺寸':({'1024':'1K','2048':'2K','4096':'4K'}[value]||value);
    return labels[value]||value;
  }
  function available(pin){
    if(pin.key==='model')return StudioService.models().some(model=>model.id===pin.value);
    if(pin.key==='effort')return StudioService.models().find(model=>model.id===S.composer.model)?.efforts.includes(pin.value);
    return true;
  }
  function html(){
    return '<section class="card quick-settings" aria-label="快速设置" hidden><div class="quick-strip" role="group" aria-label="固定的快速设置"></div></section><span class="quick-save-state" role="status"></span>';
  }
  function render(){
    for(const box of document.querySelectorAll('.quick-strip')){
      if(press?.box===box)continue;
      const scroll=box.scrollLeft;
      box.parentElement.hidden=!pins().length;
      syncList(box,pins(),key,pin=>`<button type="button" class="quick-chip${active(pin)?' on':''}" data-quick-id="${esc(key(pin))}" aria-pressed="${active(pin)}" aria-disabled="${!available(pin)}" aria-label="${esc(groups[pin.key]+' · '+title(pin))}；长按排序或编辑"><small>${esc(groups[pin.key])}</small><span>${esc(title(pin))}</span></button>`);
      box.scrollLeft=scroll;
    }
    for(const state of document.querySelectorAll('.quick-save-state'))state.textContent=saving?'正在保存快捷项':'';
    for(const button of document.querySelectorAll('[data-act="backend-opt"]'))button.classList.toggle('on',String(backend()[button.dataset.k])===button.dataset.v);
  }
  function apply(pin){
    if(!available(pin)){toast('当前文本模型不支持此选项，长按可编辑或移除');return;}
    const value=pin.value==='toggle'?!draftValue(pin):pin.value;
    if(backendKeys.has(pin.key))S.composer.imageBackend={...S.composer.imageBackend,[pin.key]:value};
    else{
      S.composer[pin.key]=pin.key==='ratio'?(value==='auto'?'自动':value):pin.key==='size'?({'auto':'自动','1024':'1K','2048':'2K','4096':'4K'}[value]||value):pin.key==='stitch'?(value?value+'×':'关'):value;
      if(pin.key==='model'){
        const model=StudioService.models().find(model=>model.id===value);
        if(!model.efforts.includes(S.composer.effort))S.composer.effort=model.default_effort;
      }
    }
    StudioService.saveDraft();refresh();render();
    if(typeof StudioLandscape!=='undefined')StudioLandscape.parameters();
  }
  function commit(change,button){
    const previous=queue,scope=StudioService.sessionScope();
    pending++;saving=true;render();
    const operation=StudioFeedback.run('quick-settings:save:'+ ++sequence,button,async()=>{
      await previous;
      if(scope!==StudioService.sessionScope())return false;
      const before=pins(),next=typeof change==='function'?change(before):change;
      if(next.length>MAX){toast('最多固定 '+MAX+' 个选项');return false;}
      S.settings.quickSettings=next;render();
      try{await StudioService.saveQuickSettings(next);return scope===StudioService.sessionScope();}
      catch(error){if(scope===StudioService.sessionScope()){S.settings.quickSettings=before;StudioService.report(error);}return false;}
    }).finally(()=>{pending--;saving=pending>0;render();});
    queue=operation.catch(()=>false);
    return queue;
  }
  function closeOwned(layer){return traverseHistory(()=>layers.at(-1)?.type==='sheet'&&topSheet()===layer?1:0);}
  function editor(pin,source=null){
    if(saving){toast('正在保存快速设置，请稍候');return;}
    const existing=pins().find(item=>key(item)===key(pin)),original=existing||pin;
    const layer=openSheet({stack:true,title:existing?'编辑快速设置':'固定到快速设置',cls:'quick-editor',html:`<p class="note">${esc(groups[pin.key])} · ${esc(title({...pin,label:''}))}</p><label class="field-label">显示名称<input class="input" data-quick-name value="${esc(title(original))}" maxlength="40" autocomplete="off"></label><p class="note">点按快捷项应用到本次生成。长按后左右拖动排序，原地松开可编辑。</p><div class="quick-editor-actions"><button class="primary" data-quick-save>${existing?'保存名称':'固定此选项'}</button>${existing?'<button class="secondary danger" data-quick-remove>移除快捷项</button><div class="btn-row"><button class="secondary" data-quick-shift="-1">向前移动</button><button class="secondary" data-quick-shift="1">向后移动</button></div>':''}</div>`});
    const revision=layer.dataset.revision;
    layer.cleanup=()=>{
      const target=source?.isConnected?source:document.querySelector('.gen-bar [data-act="params"]');
      target?.focus({preventScroll:true});
    };
    layer.querySelector('[data-quick-save]').onclick=async event=>{
      const updated={...original,label:layer.querySelector('[data-quick-name]').value.trim()};
      const change=current=>existing?current.map(item=>key(item)===key(pin)?updated:item):current.some(item=>key(item)===key(pin))?current:[...current,updated];
      if(await commit(change,event.currentTarget)){if(layer.dataset.revision===revision)await closeOwned(layer);toast(existing?'名称已保存':'已固定到快速设置');}
    };
    const remove=layer.querySelector('[data-quick-remove]');
    if(remove)remove.onclick=async()=>{
      const index=pins().findIndex(item=>key(item)===key(pin));
      if(await commit(current=>current.filter(item=>key(item)!==key(pin)),remove)){
        await closeOwned(layer);
        toast('已移除快捷项',{action:'撤销',run:()=>commit(current=>{if(current.some(item=>key(item)===key(pin)))return current;const next=[...current];next.splice(Math.min(index,next.length),0,original);return next;},null)});
      }
    };
    layer.querySelectorAll('[data-quick-shift]').forEach(button=>button.onclick=async()=>{
      if(await commit(current=>{const next=[...current],from=next.findIndex(item=>key(item)===key(pin));if(from<0)return next;const to=clamp(from+Number(button.dataset.quickShift),0,next.length-1);[next[from],next[to]]=[next[to],next[from]];return next;},button))toast('顺序已保存');
    });
    layer.querySelector('[data-quick-name]').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();layer.querySelector('[data-quick-save]').click();}});
  }
  function fromButton(button){
    if(!button||button.disabled)return null;
    const action=button.dataset.act;
    let name,value;
    if(action==='opt'){name=button.dataset.k;value=canonical(name,button.dataset.v);}
    if(action==='backend-opt'){name=button.dataset.k;value=button.dataset.v;if(name==='partial_images')value=Number(value);}
    if(action==='sw'){name=button.dataset.k;value='toggle';}
    if(action==='cnt'){name='count';value=S.composer.count;}
    if(action==='model-select'||action==='model-default'){name='model';value=button.dataset.id;}
    if(action==='set-seg'||action==='set-toggle'||action==='set-step'){
      const path=button.dataset.p||'';
      if(path.startsWith('imageBackend.')||path.startsWith('defaults.')){
        name=path.split('.')[1];
        value=action==='set-toggle'?'toggle':action==='set-step'?getP(path):canonical(name,button.dataset.v);
        if(name==='partial_images')value=Number(value);
      }
    }
    return name in groups&&value!==undefined?{key:name,value,label:''}:null;
  }
  function finish(cancel=false){
    const held=press;if(!held)return;
    if(!cancel&&held.ghost){cancelAnimationFrame(frame);frame=0;drag();if(press!==held)return;}
    press=null;clearTimeout(held.timer);cancelAnimationFrame(frame);frame=0;
    held.button.classList.remove('quick-holding','quick-dragging');held.box?.classList.remove('quick-ordering');
    if(held.box?.hasPointerCapture?.(held.pointer))held.box.releasePointerCapture(held.pointer);
    if(held.fired)suppress={button:held.button,until:performance.now()+650};
    if(held.ghost){
      const target=held.button.getBoundingClientRect(),moved=Math.abs(held.x-held.startX)>SLOP;
      if(!cancel&&moved&&!RM)held.ghost.animate([{transform:held.ghost.style.transform},{transform:`translate3d(${target.left-held.left}px,0,0) scale(1)`}],{duration:D(180),easing:E.emph}).finished.catch(()=>{}).finally(()=>held.ghost.remove());
      else held.ghost.remove();
      if(!cancel&&moved){const order=[...held.box.querySelectorAll('[data-quick-id]')].map(button=>button.dataset.quickId);if(order.join('|')!==pins().map(key).join('|'))commit(order.map(id=>pins().find(pin=>key(pin)===id)),held.button);}
      else if(!cancel)editor(held.pin,held.button);
    }
    render();
  }
  function drag(){
    frame=0;const held=press;if(!held?.ghost)return;
    if(!held.button.isConnected)return finish(true);
    const box=held.box.getBoundingClientRect();
    const speed=held.x<box.left+36?-1:held.x>box.right-36?1:0;
    if(speed)held.box.scrollLeft+=speed*7;
    const dx=clamp(held.x-held.startX,box.left-held.left-held.width*.25,box.right-held.left-held.width*.75);
    held.ghost.style.transform=`translate3d(${dx}px,0,0) scale(1.04)`;
    const others=[...held.box.querySelectorAll('[data-quick-id]')].filter(button=>button!==held.button);
    const next=others.find(button=>{const rect=button.getBoundingClientRect();return held.left+held.width/2+dx<rect.left+rect.width/2;});
    const before=new Map(others.map(button=>[button,button.getBoundingClientRect().left]));
    held.box.insertBefore(held.button,next||null);
    for(const button of others){const offset=before.get(button)-button.getBoundingClientRect().left;if(offset)button.animate([{transform:`translateX(${offset}px)`},{transform:'none'}],{duration:D(180),easing:E.emph});}
    if(speed)frame=requestAnimationFrame(drag);
  }
  document.addEventListener('pointerdown',event=>{
    if(event.button>0)return;
    const button=event.target.closest('button'),id=button?.dataset.quickId,pin=id?pins().find(pin=>key(pin)===id):fromButton(button);
    if(!pin)return;
    if(press){finish(true);return;}
    button.classList.add('quick-holding');
    const held={button,pin,box:button.closest('.quick-strip'),pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX};
    press=held;
    held.timer=setTimeout(()=>{
      if(press!==held||!button.isConnected)return finish(true);
      held.fired=true;navigator.vibrate?.(8);
      if(!held.box){editor(pin,button);return;}
      if(saving){finish(true);toast('正在保存快速设置，请稍候');return;}
      const rect=button.getBoundingClientRect();Object.assign(held,{left:rect.left,width:rect.width});
      held.ghost=button.cloneNode(true);held.ghost.removeAttribute('data-quick-id');held.ghost.setAttribute('aria-hidden','true');held.ghost.className='quick-chip quick-drag-ghost';
      Object.assign(held.ghost.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
      document.body.append(held.ghost);button.classList.add('quick-dragging');held.box.classList.add('quick-ordering');held.box.setPointerCapture?.(event.pointerId);drag();
    },HOLD);
  },true);
  document.addEventListener('pointermove',event=>{
    if(!press||press.pointer!==event.pointerId)return;
    if(!press.ghost){if(Math.hypot(event.clientX-press.startX,event.clientY-press.startY)>SLOP)finish(true);return;}
    event.preventDefault();press.x=event.clientX;if(!frame)frame=requestAnimationFrame(drag);
  },{capture:true,passive:false});
  document.addEventListener('touchmove',event=>{if(press?.ghost)event.preventDefault();},{passive:false});
  document.addEventListener('pointerup',event=>{if(press&&press.pointer===event.pointerId){if(Number.isFinite(event.clientX))press.x=event.clientX;finish();}},true);
  document.addEventListener('lostpointercapture',event=>{if(press&&press.pointer===event.pointerId)finish(true);},true);
  document.addEventListener('pointercancel',()=>finish(true),true);
  document.addEventListener('contextmenu',event=>{if(fromButton(event.target.closest('button'))||event.target.closest('[data-quick-id]'))event.preventDefault();});
  document.addEventListener('click',event=>{
    if(suppress&&performance.now()<suppress.until&&suppress.button.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();return;}
    const button=event.target.closest('[data-quick-id]');if(!button)return;
    event.preventDefault();event.stopPropagation();
    const pin=pins().find(pin=>key(pin)===button.dataset.quickId);if(pin)apply(pin);
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&press){event.preventDefault();finish(true);}
    const button=event.target.closest('[data-quick-id]');
    if(button&&event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){
      event.preventDefault();const id=button.dataset.quickId,direction=event.key==='ArrowLeft'?-1:1;
      commit(current=>{const next=[...current],from=next.findIndex(pin=>key(pin)===id);if(from<0)return current;const to=clamp(from+direction,0,next.length-1);[next[from],next[to]]=[next[to],next[from]];return next;},button);
    }
    if(event.shiftKey&&event.key==='F10'){const pin=button?pins().find(pin=>key(pin)===button.dataset.quickId):fromButton(event.target.closest('button'));if(pin){event.preventDefault();editor(pin,event.target.closest('button'));}}
  });
  addEventListener('resize',()=>finish(true));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish(true);});
  return {html,render,backend,apply,fromButton,imageModels,cancel:()=>finish(true)};
})();
