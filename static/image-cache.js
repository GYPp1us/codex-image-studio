"use strict";
(() => {
const transfers=new Map(),bound=new WeakMap(),listeners=new Map();
const canonical=url=>new URL(url,location.href).href;
const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';
function paint(image){
  const frame=image.closest('[data-image-view]'),panel=frame?.querySelector('.image-download-status');if(!panel)return;
  if(image.complete&&image.naturalWidth>0){panel.hidden=true;return;}
  panel.hidden=false;const state=transfers.get(canonical(image.src))||{},total=state.total||0,loaded=state.loaded||0;
  const label=panel.querySelector('.image-download-label'),track=panel.querySelector('[role=progressbar]'),fill=panel.querySelector('.motion-fill');
  const percent=total?Math.min(100,Math.floor(loaded/total*100)):state.done?100:0;
  panel.classList.toggle('indeterminate',!total&&!state.done&&!state.error);panel.classList.toggle('has-error',Boolean(state.error));
  if(label)label.textContent=state.error?'原图加载失败，点击图片重试':state.done?'原图已下载，正在显示…':total?`下载原图 ${size(loaded)} / ${size(total)} · ${percent}%`:'正在下载原图…';
  if(fill)fill.className='motion-fill p'+percent;
  if(track){if(total||state.done)track.setAttribute('aria-valuenow',percent);else track.removeAttribute('aria-valuenow');track.setAttribute('aria-valuetext',label?.textContent||'');}
}
globalThis.StudioImages={
  async original(url,{signal,onProgress=()=>{}}={}){
    const key=canonical(url);if(new URL(key).origin!==new URL(location.href).origin)throw new Error('原图地址无效');
    let reported=0;const progress=state=>{reported=Math.max(reported,state.loaded||0);onProgress({...state,loaded:reported});};
    if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(progress);progress({loaded:0,total:0,done:false});
    try{
      const response=await fetch(key,{credentials:'same-origin',signal});
      if(!response.ok)throw new Error(response.status===401?'登录已失效，请重新登录':`原图下载失败（${response.status}）`);
      const type=response.headers.get('content-type')||'';if(!type.startsWith('image/'))throw new Error('服务器未返回有效图片');
      const total=Number(response.headers.get('content-length'))||0;
      if(!response.body?.getReader){const blob=await response.blob();progress({loaded:blob.size,total:total||blob.size,done:true});return blob;}
      const reader=response.body.getReader(),parts=[];let loaded=0,last=0;
      try{while(true){const chunk=await reader.read();if(chunk.done)break;if(signal?.aborted)throw new DOMException('已取消','AbortError');parts.push(chunk.value);loaded+=chunk.value.byteLength;
        if(Date.now()-last>=80||total&&loaded>=total){last=Date.now();progress({loaded,total,done:false});}}
      }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
      if(signal?.aborted)throw new DOMException('已取消','AbortError');
      const blob=new Blob(parts,{type});progress({loaded,total:total||loaded,done:true});return blob;
    }finally{listeners.get(key)?.delete(progress);if(!listeners.get(key)?.size)listeners.delete(key);}
  },
  markup(extra=''){return `<span class="image-download-status ${extra}" role="status"><span class="image-download-label">正在下载原图…</span><span class="motion-track" role="progressbar" aria-label="原图下载进度" aria-valuemin="0" aria-valuemax="100"><span class="motion-fill p0"></span></span></span>`;},
  hydrate(root=document){
    for(const image of root.querySelectorAll('img[data-full-image]')){
      const frame=image.closest('[data-image-view]');if(!frame)continue;
      if(frame.classList.contains('detail-image-frame')){const w=Number(image.getAttribute('width')),h=Number(image.getAttribute('height'));if(w>0&&h>0)frame.style.aspectRatio=`${w} / ${h}`;}
      const url=canonical(image.src);frame.dataset.imageUrl=url;
      if(bound.get(image)!==url){
        bound.set(image,url);
        image.addEventListener('load',()=>{if(bound.get(image)===url)paint(image);});
        image.addEventListener('error',()=>{if(bound.get(image)===url){transfers.set(url,{error:true});paint(image);}});
      }
      paint(image);
    }
  },
  async message(type){
    if(!('serviceWorker' in navigator))return {bytes:0,count:0};
    const worker=navigator.serviceWorker.controller;
    if(!worker){
      if(type==='IMAGE_CACHE_CLEAR'&&'caches' in globalThis){try{await Promise.all((await caches.keys()).filter(k=>k.startsWith('studio-images-')).map(k=>caches.delete(k)));}catch{}}
      return {bytes:0,count:0};
    }
    return new Promise(resolve=>{
      const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve({bytes:0,count:0});},5000);
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
      try{worker.postMessage({type},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();resolve({bytes:0,count:0});}
    });
  },
  clear(){transfers.clear();return this.message('IMAGE_CACHE_CLEAR');},
  status(){return this.message('IMAGE_CACHE_STATUS');}
};
navigator.serviceWorker?.addEventListener('message',event=>{
  if(event.data?.type!=='IMAGE_PROGRESS')return;
  const {url,loaded,total,done}=event.data;transfers.set(url,{loaded,total,done});
  for(const listener of listeners.get(url)||[])listener({loaded,total,done});
  if(transfers.size>500)transfers.delete(transfers.keys().next().value);
  for(const frame of document.querySelectorAll('[data-image-view]'))if(frame.dataset.imageUrl===url){const image=frame.querySelector('img[data-full-image]');if(image)paint(image);}
});
})();
