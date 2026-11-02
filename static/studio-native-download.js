"use strict";
/* Original Blob → bounded, acknowledged native chunks. Never send a URL or cookie. */
const StudioNativeDownloads=(()=>{
  let port=null,active=null;const waiters=new Set();
  const isApp=()=>/ImageStudioAndroid\//.test(navigator.userAgent||'');
  const aborted=()=>new DOMException('已取消保存','AbortError');
  const send=value=>port?.postMessage(JSON.stringify(value));
  addEventListener('message',event=>{
    if(!isApp()||!event.isTrusted||(event.source&&event.source!==window)||(event.origin&&event.origin!=='null'&&event.origin!==location.origin)||location.origin!=='https://image.arcol.site'||event.data!=='IMAGE_STUDIO_DOWNLOAD_PORT_V1'||event.ports?.length!==1)return;
    active?.pending?.reject(new Error('保存通道已重置，请重试'));port?.close();port=event.ports[0];
    port.onmessage=event=>{let value;try{value=JSON.parse(event.data);}catch{return;}const task=active,pending=task?.pending;if(!pending||value.id!==task.id)return;
      if(value.type==='error'){pending.reject(new Error(value.detail||'保存失败'));return;}
      if(value.type===pending.type&&(pending.seq===undefined||value.seq===pending.seq))pending.resolve(value);
    };port.start?.();for(const done of [...waiters])done();
  });
  async function ready(signal){
    if(port)return;if(!isApp())throw new Error('此浏览器没有内建保存通道');
    await new Promise((resolve,reject)=>{
      const done=()=>{cleanup();resolve();},cancel=()=>{cleanup();reject(aborted());},timer=setTimeout(()=>{cleanup();reject(new Error('请更新 Android 应用后使用缓存保存'));},2500);
      const cleanup=()=>{clearTimeout(timer);waiters.delete(done);signal?.removeEventListener('abort',cancel);};
      waiters.add(done);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    });
  }
  function request(task,value,type,seq){
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>fail(new Error('保存响应超时，请重试')),30000);
      const finish=fn=>result=>{clearTimeout(timer);if(task.pending?.resolve===ok)task.pending=null;fn(result);};
      const ok=finish(resolve),fail=finish(reject);task.pending={type,seq,resolve:ok,reject:fail};
      try{send({id:task.id,...value});}catch(error){fail(error);}
    });
  }
  async function save(blob,name,{mime=blob.type||'image/png',signal,onProgress}={}){
    await ready(signal);if(signal?.aborted)throw aborted();if(active)throw new Error('另一张图片正在保存');
    const id=[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join(''),task={id,pending:null};active=task;let complete=false;
    const cancel=()=>{send({id,type:'cancel'});task.pending?.reject(aborted());};signal?.addEventListener('abort',cancel,{once:true});
    try{
      await request(task,{type:'begin',name,mime,size:blob.size},'ready');
      for(let offset=0,seq=0;offset<blob.size;offset+=65536,seq++){
        if(signal?.aborted)throw aborted();const bytes=new Uint8Array(await blob.slice(offset,offset+65536).arrayBuffer());
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        if(signal?.aborted)throw aborted();await request(task,{type:'chunk',seq,data:btoa(binary)},'ack',seq);
        onProgress?.({loaded:offset+bytes.length,total:blob.size,done:false});
      }
      const result=await request(task,{type:'end'},'complete');complete=true;onProgress?.({loaded:blob.size,total:blob.size,done:true});return result.detail||name;
    }finally{signal?.removeEventListener('abort',cancel);if(!complete)send({id,type:'cancel'});if(active===task)active=null;}
  }
  return {isApp,save};
})();
