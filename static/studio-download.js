"use strict";
/* Use the same authenticated original URL as viewing. The service worker owns
   persistent caching; object URLs are only a temporary hand-off to the system. */
const StudioDownloads=(()=>{
  let current=null;
  const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';
  function cancel(){current?.dispose();current=null;}
  function open(image){
    if(/ImageStudioAndroid\//.test(navigator.userAgent||'')){const link=document.createElement('a');link.href=image.url+'?download=1';link.download=image.name||'image.png';document.body.append(link);link.click();link.remove();toast('已交给系统下载管理器');return;}
    if(current?.id===image.id&&current.layer.isConnected)return;
    cancel();const controller=new AbortController();let objectURL=null,disposed=false,handedOff=false;
    const layer=openSheet({title:'下载原图',html:`<div class="download-status" role="status"><b class="download-label">正在准备原图…</b><progress class="download-progress" max="100" aria-label="原图下载进度"></progress><p class="note download-detail"></p></div><div class="download-actions"></div><p class="note download-error" role="alert" hidden></p>`});
    const revision=layer.dataset.revision,valid=()=>!disposed&&layer.isConnected&&layer.dataset.revision===revision;
    const dispose=()=>{if(disposed)return;disposed=true;controller.abort();if(objectURL){const url=objectURL;if(handedOff)setTimeout(()=>URL.revokeObjectURL(url),60000);else URL.revokeObjectURL(url);}if(current?.layer===layer)current=null;};
    layer.cleanup=dispose;current={id:image.id,layer,dispose};
    const label=$('.download-label',layer),bar=$('.download-progress',layer),detail=$('.download-detail',layer),actions=$('.download-actions',layer),error=$('.download-error',layer);
    const fail=e=>{if(!valid()||e.name==='AbortError')return;label.textContent='原图下载失败';error.hidden=false;error.textContent=e.message||'请检查网络后重试';actions.innerHTML='<button class="primary download-retry">重新下载</button>';$('.download-retry',layer).onclick=()=>{cancel();open(image);};};
    StudioImages.original(image.url,{signal:controller.signal,onProgress:state=>{
      if(!valid())return;const percent=state.total?Math.min(100,Math.floor(state.loaded/state.total*100)):null;
      label.textContent=state.done?'原图已准备好':percent===null?'正在下载原图…':`正在下载原图 · ${percent}%`;
      if(percent===null)bar.removeAttribute('value');else bar.value=percent;
      detail.textContent=state.total?`${size(state.loaded)} / ${size(state.total)}`:state.loaded?`已下载 ${size(state.loaded)}`:'正在读取…';
    }}).then(blob=>{
      if(!valid())return;objectURL=URL.createObjectURL(blob);bar.value=100;label.textContent='原图已准备好';detail.textContent=`${size(blob.size)} · ${image.width||image.w} × ${image.height||image.h}`;
      const filename=(image.name||'image').replace(/\.[^.]+$/,'')+'.png';
      const link=document.createElement('a');link.className='primary';link.href=objectURL;link.setAttribute('download',filename);link.textContent='下载原图';link.onclick=()=>{handedOff=true;};actions.append(link);
      let file=null;try{file=new File([blob],filename,{type:blob.type});}catch{}
      let canShare=false;try{canShare=!!file&&typeof navigator.share==='function'&&!!navigator.canShare?.({files:[file]});}catch{}
      if(canShare){
        const save=document.createElement('button');save.className='primary';save.textContent='保存到相册 / 分享';link.className='secondary';actions.prepend(save);
        save.onclick=()=>{error.hidden=true;save.disabled=true;handedOff=true;let pending;try{pending=navigator.share({files:[file]});}catch(e){pending=Promise.reject(e);}
          Promise.resolve(pending).catch(e=>{if(valid()&&e.name!=='AbortError'){error.hidden=false;error.textContent='系统未能分享图片，请使用下方“下载原图”。';}}).finally(()=>{if(valid())save.disabled=false;});};
      }else{handedOff=true;link.click();label.textContent='原图已交给浏览器保存';}
    }).catch(fail);
    return layer;
  }
  return {open,cancel};
})();
