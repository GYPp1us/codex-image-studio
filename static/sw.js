"use strict";
const CACHE='studio-offline-v1';
const IMAGE_PREFIX='studio-images-v1-';
const OFFLINE=['/static/offline.html','/static/offline.css','/static/icons/icon-192.png'];
const MAX_BYTES=192*1024*1024,MAX_ITEMS=300,MAX_IMAGE=MAX_BYTES;
let identity=null,checkedAt=0,authPending=null,epoch=0,maintenance=Promise.resolve();
const inflight=new Map();
const liveTransfers=new Set();
const controller=()=>typeof AbortController==='function'?new AbortController():null;
function deadline(work,ms,abort=()=>{}){
  if(typeof setTimeout!=='function')return Promise.resolve().then(work);
  let timer;return Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>{abort();reject(new Error('网络长时间无响应'));},ms);})]).finally(()=>clearTimeout(timer));
}

async function clearImages(){
  epoch++;identity=null;checkedAt=0;authPending=null;
  inflight.clear();
  for(const transfer of liveTransfers)transfer.abort();
  await maintenance.catch(()=>{});
  try{await Promise.all((await caches.keys()).filter(k=>k.startsWith('studio-images-')).map(k=>caches.delete(k)));}catch{/* Storage may be disabled; the authorization gate still resets. */}
}
async function authorize(){
  if(identity&&Date.now()-checkedAt<30000)return identity;
  if(authPending)return authPending;
  const version=epoch;
  const promise=(async()=>{
    const request=controller();
    const {response,state}=await deadline(async()=>{const response=await fetch('/api/auth/state',{credentials:'same-origin',cache:'no-store',...(request?{signal:request.signal}:{})});return {response,state:await response.json()};},8000,()=>request?.abort());
    if(version!==epoch)return null;
    if(!response.ok||!state.authenticated||!state.cache_scope){await clearImages();return null;}
    const next=IMAGE_PREFIX+state.cache_scope;
    if(identity&&identity!==next){const clearing=clearImages(),clearedVersion=epoch;await clearing;if(clearedVersion!==epoch)return null;}
    identity=next;checkedAt=Date.now();return identity;
  })();
  authPending=promise;
  try{return await promise;}finally{if(authPending===promise)authPending=null;}
}
async function entries(cache){
  const result=[];
  for(const request of await cache.keys()){
    const response=await cache.match(request);
    result.push({request,size:Number(response?.headers.get('x-studio-bytes')||0),time:Number(response?.headers.get('x-studio-stored')||0)});
  }
  return result.sort((a,b)=>a.time-b.time);
}
async function store(name,key,response,version){
  const size=Number(response.headers.get('content-length'));
  if(!response.ok||!response.headers.get('content-type')?.startsWith('image/')||!size||size>MAX_IMAGE)return;
  const copy=response.clone();
  const write=async()=>{
    if(version!==epoch||identity!==name)return;
    const cache=await caches.open(name),items=await entries(cache);
    let bytes=items.reduce((n,item)=>n+item.size,0),count=items.length;
    for(const item of items){if(bytes+size<=MAX_BYTES&&count<MAX_ITEMS)break;await cache.delete(item.request);bytes-=item.size;count--;}
    if(version!==epoch||identity!==name)return;
    const headers=new Headers(copy.headers);headers.set('x-studio-bytes',String(size));headers.set('x-studio-stored',String(Date.now()));
    await cache.put(key,new Response(copy.body,{status:copy.status,statusText:copy.statusText,headers}));
  };
  maintenance=maintenance.catch(()=>{}).then(()=>deadline(write,25000,()=>{copy.body?.cancel().catch(()=>{});}));await maintenance;
}
async function fetchImage(request,shared=null){
  const transfer=controller(),cancel=()=>transfer?.abort();let idle;
  const finish=()=>{if(typeof clearTimeout==='function')clearTimeout(idle);if(transfer)liveTransfers.delete(transfer);if(shared){shared.finished=true;for(const consumer of shared.consumers)consumer.signal?.removeEventListener('abort',consumer.cancel);shared.consumers.clear();}else request.signal?.removeEventListener('abort',cancel);};
  if(transfer){liveTransfers.add(transfer);transfer.signal.addEventListener('abort',finish,{once:true});}
  if(shared)shared.cancel=cancel;else if(request.signal?.aborted)cancel();else request.signal?.addEventListener('abort',cancel,{once:true});
  let response;try{response=await deadline(()=>fetch(request,transfer?{signal:transfer.signal}:undefined),15000,cancel);}catch(error){finish();throw error;}const url=request.url;
  if(!response.ok||!response.body||!response.headers.get('content-type')?.startsWith('image/')||typeof TransformStream==='undefined'){finish();return response;}
  const total=Number(response.headers.get('content-length')||0);let loaded=0,last=0;
  const publish=done=>{
    if(new URL(url).searchParams.has('thumbnail'))return;
    if(!done&&loaded!==0&&loaded<total&&Date.now()-last<120)return;last=Date.now();
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>clients.forEach(client=>client.postMessage({type:'IMAGE_PROGRESS',url,loaded,total,done}))).catch(()=>{});
  };
  publish(false);
  const reset=()=>{if(typeof setTimeout!=='function')return;clearTimeout(idle);idle=setTimeout(cancel,20000);};reset();
  const body=response.body.pipeThrough(new TransformStream({transform(chunk,controller){reset();loaded+=chunk.byteLength;publish(false);controller.enqueue(chunk);},flush(){finish();publish(true);}}));
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
async function image(request,event){
  const version=epoch,key=request.url,fallback=()=>version===epoch?fetchImage(request):new Response('',{status:401});let name,cached;
  try{name=await authorize();}catch{return fallback();}
  if(version!==epoch)return new Response('',{status:401});
  if(!name)return fallback();
  try{cached=await (await caches.open(name)).match(key);}catch{return fallback();}
  if(version!==epoch)return new Response('',{status:401});
  if(cached)return cached;
  const id=name+':'+key;
  if(!inflight.has(id)){
    const shared={consumers:new Set(),finished:false,cancel:null};const pending=fetchImage(request,shared);shared.promise=pending;inflight.set(id,shared);
    pending.then(response=>{
      const caching=(response.status===401||response.status===403)&&version===epoch?clearImages():store(name,key,response,version);
      const settled=caching.catch(()=>{});event?.waitUntil?.(settled);
      // Release the unused tee after current consumers clone it, rather than buffering an entire original.
      Promise.resolve().then(()=>{if(inflight.get(id)===shared)inflight.delete(id);response.body?.cancel().catch(()=>{});});
    },()=>{if(inflight.get(id)===shared)inflight.delete(id);});
  }
  const shared=inflight.get(id),consumer={signal:request.signal};
  consumer.cancel=()=>{shared.consumers.delete(consumer);consumer.signal?.removeEventListener('abort',consumer.cancel);if(!shared.finished&&!shared.consumers.size){if(inflight.get(id)===shared)inflight.delete(id);shared.cancel?.();}};
  if(!shared.finished){shared.consumers.add(consumer);if(consumer.signal?.aborted)consumer.cancel();else consumer.signal?.addEventListener('abort',consumer.cancel,{once:true});}
  const response=await shared.promise;
  if(request.signal?.aborted){const error=new Error('图片读取已取消');error.name='AbortError';throw error;}
  return version===epoch?response.clone():new Response('',{status:401});
}
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(OFFLINE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await Promise.all((await caches.keys()).filter(k=>(k.startsWith('studio-offline-')&&k!==CACHE)||(k.startsWith('studio-images-')&&!k.startsWith(IMAGE_PREFIX))).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(!['IMAGE_CACHE_CLEAR','IMAGE_CACHE_STATUS'].includes(event.data?.type))return;
  event.waitUntil((async()=>{
    if(event.data.type==='IMAGE_CACHE_CLEAR'){await clearImages();event.ports[0]?.postMessage({bytes:0,count:0});return;}
    try{const name=await authorize();const items=name?await entries(await caches.open(name)):[];event.ports[0]?.postMessage({bytes:items.reduce((n,item)=>n+item.size,0),count:items.length});}
    catch{event.ports[0]?.postMessage({bytes:0,count:0});}
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname==='/api/auth/logout'){
    event.respondWith((async()=>{await clearImages();return fetch(request);})());return;
  }
  if(request.method!=='GET')return;
  if((/^\/media\/[a-f0-9]{32}$/.test(url.pathname)||/^\/api\/jobs\/[a-f0-9]{32}\/stitch\/base$/.test(url.pathname))&&!url.searchParams.has('download')){event.respondWith(image(request,event));return;}
  if(request.mode==='navigate'||OFFLINE.includes(url.pathname)){
    const network=controller();event.respondWith(deadline(()=>fetch(request,network?{signal:network.signal}:undefined),6000,()=>network?.abort()).catch(async()=>await caches.match(request.mode==='navigate'?'/static/offline.html':url.pathname)||new Response('暂时无法连接，请重试',{status:503})));
  }
});
