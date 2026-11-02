(async()=>{
 const NativeEventSource=window.EventSource,streams=[];class FakeEventSource{constructor(url){this.url=url;this.closed=false;streams.push(this)}close(){this.closed=true}send(data){this.onmessage?.({data:JSON.stringify(data)})}}window.EventSource=FakeEventSource;
 const root=document.createElement('section');root.className='task-section generation-workspace';document.querySelector('#app').append(root);
 const tiny='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aKsAAAAASUVORK5CYII=';
 const first={id:'one',kind:'image',scope:'image-1',status:'running',updated:1,created:1,requested:{quality:'max'},provider_reported:{quality:'low'}};
 const ctx=StudioGeneration.mount(root,{id:'fixture',status:'running',options:{},generation_calls:{items:[first],total:1}},{api:async()=>({items:[first],total:1})});
 try{
  streams[0].send({status:'running',generation:{...first,updated:2,preview:{url:tiny,revision:1}}});
  for(let i=0;i<100&&(!root.querySelector('img').naturalWidth||root.querySelector('.generation-frame').hidden);i++)await new Promise(r=>setTimeout(r,50));
  const image=root.querySelector('img'),decoded=image.naturalWidth===1&&image.naturalHeight===1&&!root.querySelector('.generation-frame').hidden;
  streams[0].send({status:'succeeded',generation:{...first,status:'succeeded',updated:3}});const terminalClosed=streams[0].closed;
  return {ok:decoded&&terminalClosed,decoded,terminalClosed,width:image.naturalWidth,height:image.naturalHeight};
 }finally{StudioGeneration.close(ctx);root.remove();window.EventSource=NativeEventSource;}
})()
