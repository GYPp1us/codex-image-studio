"use strict";
/* The same scoped choices accompany every entry point; the server compiles previews. */
const StudioUpscalePrompts=(()=>{
  let settings={upscale_system_prompts:{},default_upscale_system_prompts:{},upscale_prompt_labels:{},upscale_prompt_variables:{}};
  const previews=new Map(),drafts=new Map();
  const defaults=()=>({append_system:S.settings.upscale.appendSystem??true,include_source_context:S.settings.upscale.includeSourceContext??false});
  function policy(scope){if(scope==='composer')return S.composer.upscalePolicy||defaults();if(scope==='upscale')return S.upc.policy||defaults();return drafts.get(scope)?.policy||defaults();}
  function setPolicy(scope,value){if(scope==='composer')S.composer.upscalePolicy=value;else if(scope==='upscale')S.upc.policy=value;else drafts.set(scope,{...drafts.get(scope),policy:value});previews.delete(scope);}
  function requirements(scope){return scope==='composer'?S.composer.upscaleRequirements??'':scope==='upscale'?S.upc.inj??'':drafts.get(scope)?.requirements??'';}
  function setRequirements(scope,value){
    if(scope==='composer')S.composer.upscaleRequirements=value;else if(scope==='upscale')S.upc.inj=value;else drafts.set(scope,{...drafts.get(scope),requirements:value});previews.delete(scope);
    for(const holder of document.querySelectorAll('.prompt-composition[data-prompt-scope]'))if(holder.dataset.promptScope===scope)for(const input of holder.querySelectorAll('[data-upp-requirements]'))if(input.value!==value)input.value=value;
  }
  function refreshEntries(scope){
    for(const holder of document.querySelectorAll('.prompt-composition[data-prompt-scope]'))if(holder.dataset.promptScope===scope)holder.outerHTML=entry(scope,{source:holder.dataset.promptSource});
  }
  function state(scope,holder){
    holder=holder||[...document.querySelectorAll('.prompt-composition[data-prompt-scope]')].find(el=>el.dataset.promptScope===scope);
    const layer=holder?.closest('.sheet-layer'),source=holder?.dataset.promptSource||(scope==='upscale'?S.upc.src:null);
    const factor=Number(String(scope==='upscale'?S.upc.factor:scope==='composer'?S.composer.stitch:layer?.dataset.f||'4').replace('×',''));
    return {source:source||null,factor,upscale_requirements:requirements(scope),upscale_policy:{...policy(scope)}};
  }
  function entry(scope,{source=null}={}){
    const value=policy(scope);
    return `<div class="prompt-composition" data-prompt-scope="${scope}"${source?` data-prompt-source="${source}"`:''}><div class="composition-source"><span>本次草稿选项 · 提交后固定</span><button class="link-btn" type="button" data-upp-defaults>恢复超分默认</button></div>${scope==='composer'?`<label class="composition-requirements">超分任务统一要求<textarea class="input" rows="2" maxlength="12000" data-upp-requirements placeholder="只约束后续超分，不改变本次原图生成要求">${esc(requirements(scope))}</textarea></label>`:''}<div class="composition-options">${[['append_system','拼接超分系统提示','图块保真、细节与接缝约束'],['include_source_context','附带原图历史描述','仅作背景，不重做历史编辑']].map(([key,label,note])=>`<button type="button" class="composition-choice ${value[key]?'on':''}" data-upp-policy="${key}" aria-pressed="${value[key]}"><span class="choice-check">${icon('check',13)}</span><span><b>${label}</b><small>${note}</small></span></button>`).join('')}</div><div class="composition-order"><span>调用协议</span>${value.append_system?'<i>＋</i><span>超分系统提示</span>':''}${value.include_source_context?'<i>＋</i><span>历史背景</span>':''}<i>＋</i><span>统一要求（有填写时）</span></div><div class="composition-foot"><p>关闭系统提示仍保留尺寸、原图附件与产物协议；验收提示独立配置。</p><button class="link-btn" type="button" data-upp-preview>查看拼接</button></div></div>`;
  }
  function entryValue(scope){const saved=previews.get(scope);return {upscale_policy:{...policy(scope)},expected_prompt_revision:saved?.signature===JSON.stringify(state(scope))?saved.revision:undefined};}
  function settingsHTML(){return `<div class="up-prompt-settings">${Object.entries(settings.upscale_prompt_labels).map(([key,label])=>`<button class="s-row" data-upp-edit="${key}"><span class="s-l">${esc(label)}<small>${esc((settings.upscale_prompt_variables[key]||[]).map(v=>'{'+v+'}').join(' · '))}</small></span><span class="s-r">${settings.upscale_system_prompts[key]===settings.default_upscale_system_prompts[key]?'默认':'自定义'}${icon('chevr',15)}</span></button>`).join('')}</div>`;}
  function edit(key){
    const label=settings.upscale_prompt_labels[key],initial=settings.upscale_system_prompts[key]||'';
    const el=openScreen(`<header class="top scr-top"><button class="icon-btn" data-act="scr-back" aria-label="返回">${icon('back')}</button><h1>${esc(label)}</h1><span class="grow"></span><button class="pill-btn strong" data-upp-save>保存</button></header><div class="scroll prompt-editor-workspace"><main><textarea class="input mono system-prompt-editor" maxlength="24000" spellcheck="false">${esc(initial)}</textarea><p class="form-err" role="alert"></p></main><aside><h2>可插入变量</h2><div class="var-chips">${(settings.upscale_prompt_variables[key]||[]).map(name=>`<button type="button" data-upp-var="${name}">{${name}}</button>`).join('')}</div><p class="note">变量只替换一次，用户输入中的大括号保持原样。保存后只影响新任务；旧任务继续使用自己的快照。</p><button class="secondary" data-upp-reset>恢复默认文本</button></aside></div>`,{cls:'system-prompt-screen'});
    const ta=el.querySelector('textarea'),error=el.querySelector('.form-err'),button=el.querySelector('[data-upp-save]');
    el.addEventListener('click',event=>{const variable=event.target.closest('[data-upp-var]');if(variable){ta.setRangeText('{'+variable.dataset.uppVar+'}',ta.selectionStart,ta.selectionEnd,'end');ta.focus();}if(event.target.closest('[data-upp-reset]')){ta.value=settings.default_upscale_system_prompts[key];error.textContent='已恢复默认文本，保存后生效';}});
    button.onclick=()=>{if(StudioFeedback.busy('up-template-save'))return;StudioFeedback.run('up-template-save',button,async()=>{
      try{const result=await StudioService.api('/api/settings',{method:'PATCH',body:{upscale_system_prompts:{[key]:ta.value}}});settings={...settings,...result};if(!result.upscale_system_prompts)settings.upscale_system_prompts[key]=ta.value;previews.clear();await back();toast('已保存，之后的新超分任务使用新版本');const holder=document.querySelector('#set-upscale-prompts .up-prompt-settings');if(holder)holder.outerHTML=settingsHTML();}
      catch(e){error.textContent=e.message;}
    });};
  }
  function previewHTML(value){
    return `<div class="prompt-preview-meta"><span>任务快照 ${esc(value.snapshot_revision?.slice(0,10)||'')}</span><span>第 ${value.scope?.level||1} 级 · 第 ${(value.scope?.tile||0)+1} 块</span></div><div class="prompt-preview-work"><aside class="prompt-components">${(value.components||[]).map(part=>`<details ${part.enabled?'open':''} class="${part.enabled?'':'disabled'}"><summary>${part.enabled?'已拼接':'未拼接'} · ${esc(part.label)}</summary><pre>${esc(part.text)}</pre></details>`).join('')}</aside><main><h2>完整发送给模型的指令</h2><p class="note">这是工作台实际发送的完整文本，不代表生图工具内部不可见的提示词。</p><pre class="prompt-box">${esc(value.worker_instruction)}</pre>${value.review?`<details class="task-disclosure"><summary>独立视觉验收指令</summary><pre class="prompt-box">${esc(value.review.worker_instruction)}</pre></details>`:''}</main></div>`;
  }
  async function preview(holder,button){
    const scope=holder.dataset.promptScope,captured=state(scope,holder),{source,...body}=captured,signature=JSON.stringify(captured);
    if(!source){openSheet({title:'超分提示拼接顺序',html:`<p class="note">${scope==='composer'?'原图生成后才确定每级图块与尺寸；当前选项会随任务冻结。':'选择原图后可查看填入真实图块尺寸的完整指令。'}</p>${entry(scope)}<div class="prompt-box">${esc(settings.upscale_system_prompts.tile||'')}</div>${scope==='composer'?'':`<div class="field-label">任务统一要求</div><div class="prompt-box">${esc(body.upscale_requirements||'无额外要求')}</div>`}`});return;}
    await StudioFeedback.run('up-preview:'+scope,button,async()=>{
      const value=await StudioService.api(`/api/assets/${source}/upscale-prompt-preview`,{method:'POST',body});
      if(!holder.isConnected||signature!==JSON.stringify(state(scope,holder))){toast('草稿已改变，请重新查看拼接');return;}
      previews.set(scope,{revision:value.snapshot_revision,signature});
      openScreen(`<header class="top scr-top"><button class="icon-btn" data-act="scr-back" aria-label="返回">${icon('back')}</button><h1>超分提示拼接预览</h1></header><div class="scroll prompt-preview-scroll">${previewHTML(value)}</div>`,{cls:'prompt-preview-screen'});
    });
  }
  async function mountTask(holder,job,api){
    if(!holder)return;holder.innerHTML='<h2>超分提示词</h2><p class="note">正在读取任务快照…</p>';
    try{const [snapshot,calls]=await Promise.all([api(`/api/upscale/jobs/${job.id}/prompt-snapshot`),api(`/api/upscale/jobs/${job.id}/calls`)]);if(!holder.isConnected)return;
      holder.innerHTML=`<h2>超分提示词</h2><p class="note">${snapshot.available?'系统模板与开关已在任务创建时冻结。':esc(snapshot.legacy_message)}</p>${snapshot.available?`<details class="task-disclosure"><summary>任务系统提示快照 · ${esc(snapshot.snapshot.revision.slice(0,10))}</summary>${Object.entries(snapshot.snapshot.templates).map(([key,text])=>`<details><summary>${esc(settings.upscale_prompt_labels[key]||key)}</summary><pre class="prompt-box">${esc(text)}</pre></details>`).join('')}</details>`:''}<details class="task-disclosure"><summary>实际调用记录 · ${calls.total} 次</summary><div class="prompt-call-list">${calls.items.map(call=>`<button class="s-row" data-prompt-call="${call.id}"><span class="s-l">${call.kind==='inspection'?'视觉验收':call.scope?.tile!==undefined?`第 ${call.scope.level} 级 · 第 ${call.scope.tile+1} 块`:'原图生成'}<small>${call.created?fmtTime(call.created*1000):'旧记录，未保存时间'}</small></span>${icon('chevr',14)}</button>`).join('')||'<p class="note">尚无留存的调用记录，或缓存已清理。</p>'}${calls.total>calls.items.length?'<p class="note">此处显示最近 30 次调用。</p>':''}</div></details>`;
      holder.addEventListener('click',event=>{const button=event.target.closest('[data-prompt-call]');if(!button)return;StudioFeedback.run('prompt-call:'+button.dataset.promptCall,button,async()=>{const value=await api(`/api/upscale/jobs/${job.id}/calls/${button.dataset.promptCall}`);openScreen(`<header class="top scr-top"><button class="icon-btn" data-act="scr-back" aria-label="返回">${icon('back')}</button><h1>实际发送的提示词</h1></header><div class="scroll prompt-preview-scroll">${previewHTML({...value.prompt_metadata,worker_instruction:value.worker_instruction})}</div>`,{cls:'prompt-preview-screen'});}).catch(StudioService.report);});
      const clone=document.createElement('button');clone.className='secondary';clone.textContent='复制为新超分任务';clone.disabled=!job.options?.source_asset_id&&!job.source_image?.id;clone.onclick=()=>StudioFeedback.run('up-clone:'+job.id,clone,()=>StudioService.cloneUpscale(job.id)).catch(StudioService.report);holder.append(clone);
    }catch(error){if(holder.isConnected)holder.innerHTML=`<p class="form-err">${esc(error.message)}</p>`;}
  }
  app.addEventListener('click',event=>{const toggle=event.target.closest('[data-upp-policy]'),restore=event.target.closest('[data-upp-defaults]'),editButton=event.target.closest('[data-upp-edit]'),previewButton=event.target.closest('[data-upp-preview]');
    if(toggle){const holder=toggle.closest('[data-prompt-scope]'),scope=holder.dataset.promptScope,next={...policy(scope),[toggle.dataset.uppPolicy]:!policy(scope)[toggle.dataset.uppPolicy]};setPolicy(scope,next);refreshEntries(scope);StudioService.saveDraft?.();}
    if(restore){const holder=restore.closest('[data-prompt-scope]'),scope=holder.dataset.promptScope;setPolicy(scope,defaults());setRequirements(scope,S.settings.upscale.injection||'');const input=scope==='upscale'?$('#cu-inj'):holder.closest('.sheet-layer')?.querySelector('#up-inj');if(input)input.value=requirements(scope);refreshEntries(scope);StudioService.saveDraft?.();toast('已恢复当前超分默认，其他草稿内容保留');}
    if(editButton)edit(editButton.dataset.uppEdit);
    if(previewButton)preview(previewButton.closest('[data-prompt-scope]'),previewButton).catch(StudioService.report);
  });
  app.addEventListener('input',event=>{if(event.target.hasAttribute('data-upp-requirements'))setRequirements(event.target.closest('[data-prompt-scope]').dataset.promptScope,event.target.value);if(event.target.id==='cu-inj')setRequirements('upscale',event.target.value);if(event.target.id==='up-inj'){const scope=event.target.closest('.sheet-layer')?.dataset.promptScope;if(scope)setRequirements(scope,event.target.value);}});
  return {configure:value=>{settings={...settings,...value};},entry,entryValue,settingsHTML,mountTask,newScope:()=>{const key='sheet-'+uid('prompt');drafts.set(key,{policy:defaults(),requirements:S.settings.upscale.injection||''});return key;},release:scope=>{drafts.delete(scope);previews.delete(scope);}};
})();
