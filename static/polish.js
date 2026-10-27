"use strict";
(() => {
  function markup(job,compact=false){
    if(!job?.options?.polish&&!job?.polished_prompt)return '';
    const text=job.polished_prompt,pending=['queued','running','retrying'].includes(job.status);
    const source=job.polish_source==='tool_arguments'?'工具调用记录':'执行模型回报';
    return `<section class="polish-result"><div class="section-label"><strong>润色后的提示词</strong>${text?`<span>${source}</span>`:''}</div>${text?`<pre>${esc(text)}</pre><div class="row">${compact?`<button class="link-btn" data-action="polish-details" data-id="${job.id}">查看完整详情</button>`:''}<button class="link-btn" data-action="copy-polished" data-id="${job.id}">复制提示词</button></div>`:`<p class="small muted">${pending?'等待执行模型返回润色后的提示词…':'此任务未记录润色后的提示词。'}</p>`}</section>`;
  }
  async function open(id){
    let job;
    if(id)job=await api(`/api/jobs/${id}`);
    else{const latest=S.jobs.find(j=>j.options.polish);if(latest)job=await api(`/api/jobs/${latest.id}`);}
    S.polishDetail=job||null;
    modal(id?'帮我润色 · 详情':'帮我润色 · 最近一次',`<p class="small muted">执行模型会补充构图、光线、配色与风格，再提交生图。原始需求保留。</p>${job?`<div class="polish-original"><span>原始提示词 · ${fmtTime(job.created)}</span><p>${esc(job.prompt)}</p></div><div id="polish-detail-slot">${markup(job)}</div>`:'<p class="notice">提交开启“帮我润色”的任务后，这里会展示保存的润色结果。</p>'}`);
  }
  async function copy(id){
    const job=S.polishDetail?.id===id?S.polishDetail:S.modalJob?.id===id?S.modalJob:await api(`/api/jobs/${id}`);
    if(!job?.polished_prompt)return toast('此任务没有可复制的润色提示词');
    await navigator.clipboard.writeText(job.polished_prompt);toast('润色后的提示词已复制');
  }
  async function refresh(){
    const slot=$('#polish-detail-slot'),id=S.polishDetail?.id;
    if(!slot||!id)return;
    const job=await api(`/api/jobs/${id}`);if(S.polishDetail?.id!==id)return;
    S.polishDetail=job;updateHTML(slot,markup(job));
  }
  globalThis.StudioPolish={markup,open,copy,refresh};
})();
