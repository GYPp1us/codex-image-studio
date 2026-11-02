"use strict";
/* Use the same authenticated original URL as viewing. The service worker owns
   persistent caching; object URLs are only a temporary hand-off to the system. */
const StudioDownloads=(()=>{
  let current=null;
  const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';
  async function fileInfo(blob,name){
    const h=new Uint8Array(await blob.slice(0,12).arrayBuffer());
    const png=h.length>=8&&h[0]===137&&h[1]===80&&h[2]===78&&h[3]===71&&h[4]===13&&h[5]===10&&h[6]===26&&h[7]===10;
    const jpeg=h.length>=3&&h[0]===255&&h[1]===216&&h[2]===255;
    const webp=h.length>=12&&String.fromCharCode(...h.slice(0,4))==='RIFF'&&String.fromCharCode(...h.slice(8,12))==='WEBP';
    const extension=png?'png':jpeg?'jpg':webp?'webp':null;if(!extension)throw new Error('原图格式无法识别，请重新读取');
    return {name:(name||'image').replace(/\.[^.]+$/,'')+'.'+extension,mime:png?'image/png':jpeg?'image/jpeg':'image/webp'};
  }
  function cancel(){current?.dispose();current=null;}
  function open(image){
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
    }}).then(async blob=>{
      if(!valid())return;
      const info=await fileInfo(blob,image.name),filename=info.name;if(!valid())return;
      if(StudioNativeDownloads.isApp()){
        label.textContent='正在保存到下载文件夹…';bar.value=0;
        const saved=await StudioNativeDownloads.save(blob,filename,{mime:info.mime,signal:controller.signal,onProgress:state=>{if(!valid())return;bar.value=state.loaded/Math.max(1,state.total)*100;detail.textContent=`${size(state.loaded)} / ${size(state.total)} · 已缓存原图`;} });
        if(!valid())return;bar.value=100;label.textContent='已保存到下载文件夹';detail.textContent=`Downloads / ImageStudio / ${saved}`;
        const done=document.createElement('button');done.className='primary';done.textContent='完成';done.onclick=()=>back();actions.append(done);return;
      }
      objectURL=URL.createObjectURL(blob);bar.value=100;label.textContent='原图已准备好';detail.textContent=`${size(blob.size)} · ${image.width||image.w} × ${image.height||image.h}`;
      const link=document.createElement('a');link.className='primary';link.href=objectURL;link.setAttribute('download',filename);link.textContent='下载原图';link.onclick=()=>{handedOff=true;};actions.append(link);
      let file=null;try{file=new File([blob],filename,{type:info.mime});}catch{}
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
