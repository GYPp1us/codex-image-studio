"use strict";
/* Diagnostics may fail to render; recovery controls must remain reachable. */
const StudioRecovery=(()=>{
  let context=null;
  function render(job,diagnostic,a){
    const t=FX.task,u=t?.up,lv=u?.levels?.[u.cur],r=job.recovery||{},hasMap=!!(diagnostic&&lv);
    Object.assign(FX,{bid:a.bid,pane:'affine',cmp:null,side:'output',showOk:false,latest:false,appendSystem:true,page:0,
      sel:new Set(hasMap&&S.settings.upscale.autoSelect?lv.tiles.filter(x=>x.state!=='done').map(x=>x.i):[])});
    const retry=r.retry_label||(hasMap?'从当前检查点重试':'重新执行任务');
    const controls=`<section class="failure-recovery task-section"><h2>继续这个任务</h2><button class="secondary" data-act="fx-recover" data-id="${job.id}" data-v="retry" ${r.can_retry?'':'disabled'}>${icon('refresh',16)}${esc(retry)}</button><p class="note">${esc(r.retry_reason||(r.can_retry?(r.cache_available?'复用已完成的检查点，继续未完成步骤，并重新审核。':'没有可复用的图块，将重新执行任务并审核。'):r.reason||'当前无法恢复，请刷新任务状态。'))}</p><button class="secondary" data-act="fx-recover" data-id="${job.id}" data-v="accept_review" ${r.can_accept_review?'':'disabled'}>${icon('arrow',16)}忽略本级审核并继续</button><p class="note">${esc(r.accept_review_reason||(r.can_accept_review?'仅放行本级这次视觉审核；缺图、尺寸与配准校验仍执行，后续级照常审核。':'仅当本级视觉审核未通过、且检查点完整时可用。'))}</p></section>`;
    const repair=hasMap?`<section class="task-section failure-repair"><h2>选块重绘</h2><div class="fx-quick"><button data-act="fx-sel" data-v="problems">问题块</button><button data-act="fx-sel" data-v="all">全选</button><button data-act="fx-sel" data-v="none">清除</button></div><div id="fx-list"></div><div id="fx-warn"></div><label class="field-label" for="fx-inj">本次所选图块的修复要求</label><textarea class="input" id="fx-inj" rows="2" maxlength="12000" placeholder="例如：修复窗框断线，保留其余内容"></textarea><p class="note">仅作用于本级所选图块，后续级接收修复后的图像。</p><details class="task-disclosure"><summary>任务统一要求</summary><div class="prompt-box">${esc(u.injection||'无额外统一要求')}</div></details><div class="g-card repair-composition"><button class="s-row" data-act="fx-repair-system">${lbl('拼接局部修复系统模板','关闭时仅附加填写的修复要求')}<span class="switch on" id="fx-repair-system-sw"></span></button><button class="s-row" data-act="fx-latest">${lbl('采用最新修复模板','只影响所选图块的局部修复')}<span class="switch" id="fx-latest-sw"></span></button></div></section>`:'';
    const source=a.assets.get(job.options.source_asset_id);
    const visual=hasMap?`<div class="seg" id="fx-seg"><span class="ind"></span><button data-act="fx-pane" data-v="source">原图对照</button><button data-act="fx-pane" data-v="raw">直接拼接</button><button data-act="fx-pane" data-v="affine">仿射诊断</button></div><div id="fx-view"></div>`:`<section class="task-section failure-empty"><h2>检查点预览</h2>${source?`<img class="up-check-image" src="${esc(source.preview||source.thumbnail||source.url)}" alt="超分原图">`:''}<p class="note">${esc(FX.diagnosticError||'本级尚无可用的诊断图。恢复操作仍可在此选择。')}</p></section>`;
    const el=openScreen(`<header class="top scr-top"><button class="icon-btn" data-act="scr-back" aria-label="返回">${icon('back')}</button><div class="ct"><h1>失败处理</h1><span>${job.options.stitch}× 面积${lv?' · 第 '+(u.cur+1)+' / '+u.levels.length+' 级':''}</span></div></header><div class="scroll fx-scroll"><div class="failure-checkpoints">${u?StudioProgress.html(t,{all:true,key:'failure'}):'<p class="note">尚未建立分块检查点</p>'}</div><div class="fx-err">${icon('alert',20)}<div><b>${r.can_accept_review?'本级视觉审核未通过':'任务未完成'}</b><p class="failure-error-summary">${esc(job.error||'任务已取消，可选择恢复方式。')}</p>${job.error?.length>100?`<details><summary>查看完整错误</summary><code>${esc(job.error)}</code></details>`:''}</div></div><div class="fx-workspace"><main class="fx-visuals">${visual}</main><aside class="fx-controls">${controls}<details class="inspection-budget task-section" open><summary>尺寸、切法与预算</summary>${a.planHTML(source,job.options.stitch+'×',job.upscale_plan)}<p class="note">已调用 ${a.budget(job.upscale_plan?.calls)} · 缓存 ${a.bytes(job.cache_bytes||0)}</p></details>${repair}</aside></div></div>${hasMap?'<footer class="fx-bar"><div class="fx-sum" id="fx-sum"></div><button class="primary" id="fx-go" data-act="fx-go">重绘所选</button></footer>':''}`,{cls:'fail-screen',onClose:()=>{if(context?.el===el)context=null;if(FX.screen===el)FX.screen=null;}});
    FX.screen=el;context={el,job,a,busy:false};hydrateIcons(el);StudioProgress.hydrate(el);if(hasMap)fxRender(el);return el;
  }
  async function recover(action,button){
    const c=context;if(!c||c.busy||!c.el.isConnected||c.el.style.pointerEvents==='none')return;
    if(!['retry','accept_review'].includes(action))return;
    const enabled=action==='retry'?c.job.recovery?.can_retry:c.job.recovery?.can_accept_review;if(!enabled)return;
    c.busy=true;let accepted=false;const buttons=[...c.el.querySelectorAll('[data-act="fx-recover"],#fx-go')].map(b=>[b,b.disabled]);
    try{
      await StudioFeedback.run('recover:'+c.job.id,button,async()=>{
        buttons.forEach(([b])=>b.disabled=true);
        await c.a.post(`/api/upscale/jobs/${c.job.id}/recover`,{action});accepted=true;
        c.a.invalidate(c.job.id);if(c.el.isConnected&&c.el.style.pointerEvents!=='none'&&topScreen()===c.el)await back();
        await c.a.refreshData();toast(action==='retry'?(c.job.recovery?.cache_available?'已从检查点重新排队':'任务已重新排队'):'已记录本级审核放行，继续执行');
      });
    }catch(error){
      if(accepted){toast('恢复已提交，状态刷新失败，请稍后刷新任务。');return;}
      // A stale checkpoint or another recovery cannot leave actionable stale controls.
      c.a.invalidate(c.job.id);c.a.report(error);
      if(c.el.isConnected&&c.el.style.pointerEvents!=='none')try{
        const job=await c.a.api('/api/upscale/jobs/'+c.job.id);c.job=job;
        buttons.forEach(([b])=>{if(b.dataset.act==='fx-recover')b.disabled=!(b.dataset.v==='retry'?job.recovery?.can_retry:job.recovery?.can_accept_review);});
      }catch{}
    }finally{c.busy=false;buttons.forEach(([b,disabled])=>{if(!b.isConnected)return;if(b.dataset.act==='fx-recover')b.disabled=!(b.dataset.v==='retry'?c.job.recovery?.can_retry:c.job.recovery?.can_accept_review);else b.disabled=disabled;});}
  }
  return {render,recover};
})();
