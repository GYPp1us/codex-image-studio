"use strict";
/* One renderer for queue, task inspector and failure checkpoints. Long rows are windowed. */
const StudioProgress=(()=>{
  const models=new Map(),bindings=new WeakMap(),positions=new Map(),WIDTH=36;
  const calls=['sending','thinking','generating','receiving'],callNames=['发送','思考','生图','回传'];
  const before=[['base','原图'],['cutting','切图']],after=[['registration','配准'],['color','色调'],['seams','接缝'],['blend','融合'],['inspection','验收'],['receiving','结果']];
  const success=value=>['done','succeeded'].includes(value);
  function model(task,index){
    const level=task.up.levels[index],raw=level.raw||{};
    const history=task.raw?.progress?.timeline?.find(p=>p.index===(raw.index||index+1))||raw.progress||{};
    const children=history.tiles?.length?history.tiles:task.raw?.progress?.level===index+1?task.raw.progress.children||[]:[];
    return {task,level,index,history,children,count:children.length||raw.tile_count||level.tiles.length,complete:success(raw.status),key:`${task.id}:${index}`};
  }
  function short(task,width){
    if(task.status==='done')return '';
    return `<span class="bbar up-short"${width?` data-layout="width:${width}px"`:''} aria-label="超分各级进度">${task.up.levels.map((level,index)=>{const m=model(task,index),fraction=m.history.fraction||0,status=m.complete?'done':m.history.status==='failed'?'failed':index===task.up.cur&&task.status==='running'?'running':'queued';return `<i data-st="${status}" data-layout="--p:${Math.round(fraction*100)}%"></i>`;}).join('')}</span>`;
  }
  function html(task,{all=false,key='queue'}={}){
    if(task.status==='done')return `<p class="progress-result">${icon('check',14)}已完成 ${task.up.levels.length} 级超分</p>`;
    const levels=all?task.up.levels.map((_,i)=>i):[task.up.cur];
    return levels.map(index=>{
      const m=model(task,index),id=key+':'+m.key;models.set(id,m);
      return `<section class="composite-progress" data-progress-board="${id}" aria-label="第 ${index+1} 级各图块与合成阶段"><header><span>第 ${index+1} 级</span><span class="progress-caption">${m.count} 块 · 发送 / 思考 / 生图 / 回传</span><button class="progress-follow" type="button">跟随当前</button></header><div class="progress-edge"><div class="progress-board-scroll" tabindex="0" aria-label="横向滚动查看所有图块"><div class="progress-board-spacer" data-layout="width:${(m.count+8)*WIDTH}px"><div class="progress-board-cells"></div></div></div></div><div class="progress-legend"><span><i data-state="done"></i>检查点</span><span><i data-state="running"></i>进行中</span><span><i data-state="failed"></i>失败</span><span>整列表示全图处理步骤</span></div></section>`;
    }).join('');
  }
  function tileState(tile,row,m){
    if(m.complete||success(tile.state||tile.status))return 'done';
    const stage=calls.indexOf(tile.stage),state=tile.state||tile.status;
    if(stage<0)return state==='failed'&&row===0?'failed':'queued';
    if(row<stage)return 'done';
    if(row>stage)return 'queued';
    return state==='failed'?'failed':state==='cancelled'?'cancelled':state==='running'?'running':'queued';
  }
  function column(m,index){
    const phase=index<2?before[index]:index>=m.count+2?after[index-m.count-2]:null;
    if(phase){const [key,label]=phase,state=m.complete?'done':m.history.phases?.[key]?.status||'queued',normalized=success(state)?'done':state==='cancelled'?'cancelled':state==='failed'?'failed':state==='running'?'running':'queued';
      return `<div class="progress-column whole" data-phase="${key}" title="${label} · ${normalized==='done'?'已完成':normalized==='failed'?'失败':normalized==='running'?'进行中':'等待'}"><i class="work-cell merged" data-state="${normalized}"></i><span>${label}</span></div>`;}
    const i=index-2,tile=m.children[i]||{index:i+1},number=tile.index||i+1;
    return `<div class="progress-column" data-tile="${number-1}">${calls.map((stage,row)=>{const state=tileState(tile,row,m);return `<i class="work-cell" data-stage="${stage}" data-state="${state}" title="第 ${number} 块 · ${callNames[row]} · ${state==='done'?'已完成':state==='failed'?'失败':state==='running'?'进行中':'等待'}"></i>`;}).join('')}<span title="第 ${number} 块">${number}</span></div>`;
  }
  function activeColumn(m){
    const phase=m.history.phase||taskPhase(m.task);
    if(phase==='redraw'){const i=m.children.findIndex(t=>t.state==='running'||t.state==='failed');return 2+Math.max(0,i);}
    const first=before.findIndex(p=>p[0]===phase);if(first>=0)return first;
    const last=after.findIndex(p=>p[0]===phase);return last<0?0:m.count+2+last;
  }
  const taskPhase=task=>task.raw?.progress?.stage;
  function patchColumns(m,start,end,box){
    const old=new Map([...box.children].map(el=>[Number(el.dataset.column),el]));
    for(let index=start;index<end;index++){
      const html=column(m,index);let el=old.get(index);old.delete(index);
      if(!el||el.dataset.signature!==html){
        const template=document.createElement('template');template.innerHTML=html;const next=template.content.firstElementChild;
        if(!el||el.className!==next.className){el?.remove();el=next;}
        else{
          for(const attribute of [...el.attributes])if(!attribute.name.startsWith('data-column')&&attribute.name!=='data-signature'&&!next.hasAttribute(attribute.name))el.removeAttribute(attribute.name);
          for(const attribute of next.attributes)el.setAttribute(attribute.name,attribute.value);
          const cells=el.querySelectorAll('.work-cell'),updated=next.querySelectorAll('.work-cell');
          updated.forEach((cell,i)=>{cells[i].dataset.state=cell.dataset.state;cells[i].title=cell.title;});
          const label=el.querySelector('span'),newLabel=next.querySelector('span');if(label&&newLabel){label.textContent=newLabel.textContent;label.title=newLabel.title;}
        }
        el.dataset.column=index;el.dataset.signature=html;
      }
      const at=box.children[index-start];if(at!==el)box.insertBefore(el,at||null);
    }
    for(const el of old.values())el.remove();
  }
  function paint(root,force=false){
    const m=models.get(root.dataset.progressBoard),b=bindings.get(root);if(!m||!b)return;
    const count=m.count+8,total=count*WIDTH;
    b.spacer.style.width=total+'px';
    if(b.restoreLeft!==undefined){b.scroll.scrollLeft=b.restoreLeft;delete b.restoreLeft;}
    const current=activeColumn(m),old=b.current;b.current=current;
    if(b.follow&&(force||old!==current)){b.scroll.scrollLeft=Math.max(0,current*WIDTH-b.scroll.clientWidth*.55);}
    const start=Math.max(0,Math.floor(b.scroll.scrollLeft/WIDTH)-2),end=Math.min(count,Math.ceil((b.scroll.scrollLeft+b.scroll.clientWidth)/WIDTH)+3);
    b.cells.style.transform=`translateX(${start*WIDTH}px)`;
    patchColumns(m,start,end,b.cells);
    root.classList.toggle('edge-left',b.scroll.scrollLeft>2);root.classList.toggle('edge-right',b.scroll.scrollLeft+b.scroll.clientWidth<total-2);
    b.button.hidden=b.follow;positions.set(root.dataset.progressBoard,{left:b.scroll.scrollLeft,follow:b.follow});
  }
  function hydrate(root=document){
    for(const board of [...(root.matches?.('[data-progress-board]')?[root]:[]),...root.querySelectorAll?.('[data-progress-board]')||[]]){
      if(!bindings.has(board)){
        const prior=positions.get(board.dataset.progressBoard),scroll=board.querySelector('.progress-board-scroll'),b={scroll,spacer:scroll.firstElementChild,cells:scroll.querySelector('.progress-board-cells'),button:board.querySelector('.progress-follow'),follow:prior?.follow??true,current:null};bindings.set(board,b);
        if(prior)b.restoreLeft=prior.left;
        const manual=()=>{b.follow=false;b.button.hidden=false;};scroll.addEventListener('pointerdown',manual,{passive:true});scroll.addEventListener('wheel',manual,{passive:true});scroll.addEventListener('keydown',manual);
        scroll.addEventListener('scroll',()=>paint(board),{passive:true});b.button.onclick=()=>{b.follow=true;paint(board,true);};
        if(typeof ResizeObserver==='function'){b.observer=new ResizeObserver(()=>paint(board));b.observer.observe(scroll);}
      }
      paint(board);
    }
  }
  function preserve(root,replace){
    const retained=new Map([...root.querySelectorAll('[data-progress-board]')].map(board=>[board.dataset.progressBoard,board]));
    replace();
    for(const board of root.querySelectorAll('[data-progress-board]')){
      const old=retained.get(board.dataset.progressBoard);if(!old)continue;
      const caption=old.querySelector('.progress-caption'),updated=board.querySelector('.progress-caption');if(caption&&updated)caption.textContent=updated.textContent;
      board.replaceWith(old);
    }
  }
  new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node.nodeType===1)for(const board of [...(node.matches?.('[data-progress-board]')?[node]:[]),...node.querySelectorAll('[data-progress-board]')])if(!board.isConnected)bindings.get(board)?.observer?.disconnect();}).observe(document.documentElement,{childList:true,subtree:true});
  return {html,short,hydrate,preserve};
})();
