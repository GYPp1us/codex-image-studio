"use strict";

const StudioImageProvider=(()=>{
  const empty={configured:false,base_url:'',model:'gpt-image-2'};
  const current=()=>S.settings.imageAPI||empty;
  const label=()=>current().configured?current().model:'去配置';
  const textCurrent=()=>S.settings.textAPI||{configured:false,enabled:false};
  const textLabel=()=>textCurrent().configured?(textCurrent().enabled?textCurrent().model:'已配置，未启用'):'未配置';
  const protocols=[['chat','Chat Completions'],['responses','Responses'],['messages','Anthropic Messages'],['gemini','Gemini']];
  const auths=[['auto','按协议默认'],['bearer','Authorization: Bearer'],['api-key','api-key'],['x-api-key','x-api-key'],['x-goog-api-key','x-goog-api-key'],['none','无认证']];
  const sources=[['subscription','ChatGPT 订阅'],['api','第三方 API']];
  const sourceHTML=()=>`<div class="provider-choices" role="group" aria-label="图片模型来源">${sources.map(([value,name])=>
    `<button type="button" class="opt" data-act="backend-opt" data-k="source" data-v="${value}" aria-pressed="false">${icon(value==='api'?'layers':'sparkle',17)}<span>${name}</span></button>`).join('')}</div>`;

  function paint(){
    for(const host of document.querySelectorAll('[data-image-api-label]')){
      host.textContent=host.dataset.imageApiLabel==='settings'&&!current().configured?'未配置':label();
    }
    for(const host of document.querySelectorAll('[data-text-api-label]'))host.textContent=textLabel();
  }

  function open({onSaved,kind='image'}={}){
    const text=kind==='text',existing=text?textCurrent():current(),path='/api/settings/'+kind+'-api';
    const hint=text?'测试会发送一条短文本请求，可能计入用量。':'测试连接会查询模型目录，不会生成图片。';
    const options=(items,value)=>items.map(([id,label])=>`<option value="${id}" ${id===value?'selected':''}>${label}</option>`).join('');
    const layer=openSheet({title:text?'自定义语言模型 API':'第三方图片 API',cls:'provider-sheet',stack:true,html:`
      <form class="provider-form" autocomplete="off">
        <div class="provider-fields">
          ${text?`<label class="field-label">接口协议<select class="input" name="protocol">${options(protocols,existing.protocol||'chat')}</select></label>`:''}
          <label class="field-label">API 地址<input class="input" name="base_url" type="url" inputmode="url" autocapitalize="off" spellcheck="false" maxlength="500" required placeholder="https://api.example.com/v1" value="${esc(existing.base_url||'')}"></label>
          <label class="field-label">模型 ID<input class="input" name="model" autocapitalize="off" spellcheck="false" maxlength="128" required placeholder="${text?'供应商提供的模型 ID':'gpt-image-2'}" value="${esc(existing.model||'')}"></label>
          ${text?`<label class="field-label">带图模型 ID <small>留空时沿用上面的模型</small><input class="input" name="vision_model" autocapitalize="off" spellcheck="false" maxlength="128" value="${esc(existing.vision_model||'')}"></label>`:''}
          <label class="field-label">API 密钥<input class="input" name="api_key" type="password" autocomplete="new-password" spellcheck="false" maxlength="2048" placeholder="${existing.configured?'已保存，留空沿用':'输入供应商密钥'}"></label>
          ${text?`<details class="provider-advanced"><summary>鉴权选项</summary><label class="field-label">密钥请求头<select class="input" name="auth">${options(auths,existing.auth||'auto')}</select></label></details>
          <label class="provider-enable"><input type="checkbox" name="enabled" ${existing.enabled||!existing.configured?'checked':''}>用于润色和视觉验收</label>`:''}
        </div>
        <p class="provider-status note" role="status" aria-live="polite">${hint}</p>
        <div class="provider-actions">
          <button type="button" class="secondary" data-provider-test>${icon('refresh',16)}测试连接</button>
          <button type="submit" class="primary">${icon('check',17)}保存</button>
        </div>
        ${existing.configured?'<button type="button" class="provider-disconnect link-btn danger" data-provider-remove>移除 API 配置</button>':''}
      </form>`});
    const form=$('form',layer),fields=$('.provider-fields',form),controls=$$('button,input,select',form);
    const address=form.elements.namedItem('base_url'),model=form.elements.namedItem('model'),key=form.elements.namedItem('api_key');
    const status=$('.provider-status',form),remove=$('[data-provider-remove]',form);
    let action=null,confirmRemove=false;
    function show(message,tone=''){status.textContent=message;status.dataset.tone=tone;}
    function lock(value){for(const control of controls)control.disabled=value;}
    function valid(){return layer.isConnected&&layer.style.pointerEvents!=='none'&&form.isConnected;}
    function close(){return traverseHistory(()=>topSheet()===layer?1:0);}
    function payload(){
      if(!form.reportValidity())return null;
      const base={base_url:address.value.trim(),model:model.value.trim(),api_key:key.value.trim()};
      if(!text)return base;
      const field=name=>form.elements.namedItem(name);
      return {...base,protocol:field('protocol').value,auth:field('auth').value,
        vision_model:field('vision_model').value.trim(),enabled:field('enabled').checked};
    }
    async function run(method,path,body,done){
      if(action)return;
      action=new AbortController();
      const {signal}=action;
      lock(true);
      try{
        const result=await StudioService.api(path,{method,body,signal,timeout:text?24000:17000});
        if(valid())await done(result);
      }catch(error){if(valid()&&error.name!=='AbortError')show(error.message,'failed');}
      finally{action=null;if(valid())lock(false);}
    }
    layer.cleanup=()=>{action?.abort();key.value='';};
    fields.addEventListener('input',()=>{
      show(hint);
      if(confirmRemove){confirmRemove=false;remove.textContent='移除 API 配置';}
    });
    if(text)form.elements.namedItem('protocol').onchange=()=>{form.elements.namedItem('auth').value='auto';};
    $('[data-provider-test]',form).onclick=()=>{
      const body=payload();if(!body)return;
      show('正在从工作台连接供应商…');
      return run('POST',path+'/test',body,result=>{
        show(result.message+(result.status==='ok'?' · '+result.elapsed_ms+' ms':''),result.status);
      });
    };
    form.onsubmit=event=>{
      event.preventDefault();
      const body=payload();if(!body)return;
      show('正在保存…');
      return run('PUT',path,body,async result=>{
        S.settings[text?'textAPI':'imageAPI']=result;key.value='';paint();await close();
        if(onSaved)onSaved();else refresh();
        toast(text?'语言模型 API 已保存':'第三方图片 API 已保存');
      });
    };
    if(remove)remove.onclick=()=>{
      if(!confirmRemove){
        confirmRemove=true;remove.textContent='确认移除配置';
        show('移除后，使用此地址的待执行任务会提示重新配置。','unverified');
        return;
      }
      return run('DELETE',path,undefined,async result=>{
        S.settings[text?'textAPI':'imageAPI']=result;paint();await close();refresh();toast('已移除 API 配置');
      });
    };
  }
  return {current,label,sources,sourceHTML,open,paint,textCurrent,textLabel};
})();
