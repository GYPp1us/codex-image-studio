"use strict";

const StudioImageProvider=(()=>{
  const empty={configured:false,base_url:'',model:'gpt-image-2'};
  const current=()=>S.settings.imageAPI||empty;
  const label=()=>current().configured?current().model:'去配置';
  const sources=[['subscription','ChatGPT 订阅'],['api','第三方 API']];
  const sourceHTML=()=>`<div class="provider-choices" role="group" aria-label="图片模型来源">${sources.map(([value,name])=>
    `<button type="button" class="opt" data-act="backend-opt" data-k="source" data-v="${value}" aria-pressed="false">${icon(value==='api'?'layers':'sparkle',17)}<span>${name}</span></button>`).join('')}</div>`;

  function paint(){
    for(const host of document.querySelectorAll('[data-image-api-label]')){
      host.textContent=host.dataset.imageApiLabel==='settings'&&!current().configured?'未配置':label();
    }
  }

  function open({onSaved}={}){
    const existing=current();
    const layer=openSheet({title:'第三方图片 API',cls:'provider-sheet',stack:true,html:`
      <form class="provider-form" autocomplete="off">
        <div class="provider-fields">
          <label class="field-label">API 地址<input class="input" name="base_url" type="url" inputmode="url" autocapitalize="off" spellcheck="false" maxlength="500" required placeholder="https://api.example.com/v1" value="${esc(existing.base_url)}"></label>
          <label class="field-label">模型 ID<input class="input" name="model" autocapitalize="off" spellcheck="false" maxlength="128" required placeholder="gpt-image-2" value="${esc(existing.model)}"></label>
          <label class="field-label">API 密钥<input class="input" name="api_key" type="password" autocomplete="new-password" spellcheck="false" maxlength="2048" placeholder="${existing.configured?'已保存，留空沿用':'输入供应商密钥'}"></label>
        </div>
        <p class="provider-status note" role="status" aria-live="polite">测试连接会查询模型目录，不会生成图片。</p>
        <div class="provider-actions">
          <button type="button" class="secondary" data-provider-test>${icon('refresh',16)}测试连接</button>
          <button type="submit" class="primary">${icon('check',17)}保存</button>
        </div>
        ${existing.configured?'<button type="button" class="provider-disconnect link-btn danger" data-provider-remove>移除 API 配置</button>':''}
      </form>`});
    const form=$('form',layer),fields=$('.provider-fields',form),controls=$$('button,input',form);
    const address=form.elements.namedItem('base_url'),model=form.elements.namedItem('model'),key=form.elements.namedItem('api_key');
    const status=$('.provider-status',form),remove=$('[data-provider-remove]',form);
    let action=null,confirmRemove=false;
    function show(message,tone=''){status.textContent=message;status.dataset.tone=tone;}
    function lock(value){for(const control of controls)control.disabled=value;}
    function valid(){return layer.isConnected&&layer.style.pointerEvents!=='none'&&form.isConnected;}
    function close(){return traverseHistory(()=>topSheet()===layer?1:0);}
    function payload(){
      if(!form.reportValidity())return null;
      return {base_url:address.value.trim(),model:model.value.trim(),api_key:key.value.trim()};
    }
    async function run(method,path,body,done){
      if(action)return;
      action=new AbortController();
      const {signal}=action;
      lock(true);
      try{
        const result=await StudioService.api(path,{method,body,signal,timeout:17000});
        if(valid())await done(result);
      }catch(error){if(valid()&&error.name!=='AbortError')show(error.message,'failed');}
      finally{action=null;if(valid())lock(false);}
    }
    layer.cleanup=()=>{action?.abort();key.value='';};
    fields.addEventListener('input',()=>{
      show('测试连接会查询模型目录，不会生成图片。');
      if(confirmRemove){confirmRemove=false;remove.textContent='移除 API 配置';}
    });
    $('[data-provider-test]',form).onclick=()=>{
      const body=payload();if(!body)return;
      show('正在从工作台连接供应商…');
      return run('POST','/api/settings/image-api/test',body,result=>{
        show(result.message+(result.status==='ok'?' · '+result.elapsed_ms+' ms':''),result.status);
      });
    };
    form.onsubmit=event=>{
      event.preventDefault();
      const body=payload();if(!body)return;
      show('正在保存…');
      return run('PUT','/api/settings/image-api',body,async result=>{
        S.settings.imageAPI=result;key.value='';paint();await close();
        if(onSaved)onSaved();else refresh();
        toast('第三方图片 API 已保存');
      });
    };
    if(remove)remove.onclick=()=>{
      if(!confirmRemove){
        confirmRemove=true;remove.textContent='确认移除配置';
        show('移除后，使用此地址的待执行任务会提示重新配置。','unverified');
        return;
      }
      return run('DELETE','/api/settings/image-api',undefined,async result=>{
        S.settings.imageAPI=result;paint();await close();refresh();toast('已移除第三方图片 API');
      });
    };
  }
  return {current,label,sources,sourceHTML,open,paint};
})();
