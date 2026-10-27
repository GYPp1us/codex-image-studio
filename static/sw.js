"use strict";
const CACHE='studio-offline-v1';
const IMAGE_PREFIX='studio-images-v1-';
const OFFLINE=['/static/offline.html','/static/offline.css','/static/icons/icon-192.png'];
const MAX_BYTES=192*1024*1024,MAX_ITEMS=300,MAX_IMAGE=MAX_BYTES;
let identity=null,checkedAt=0,authPending=null,epoch=0,maintenance=Promise.resolve();
const inflight=new Map();

async function clearImages(){
  epoch++;identity=null;checkedAt=0;authPending=null;
  await maintenance.catch(()=>{});
  try{await Promise.all((await caches.keys()).filter(k=>k.startsWith('studio-images-')).map(k=>caches.delete(k)));}catch{/* Storage may be disabled; the authorization gate still resets. */}
}
async function authorize(){
  if(identity&&Date.now()-checkedAt<30000)return identity;
  if(authPending)return authPending;
  const version=epoch;
  const promise=(async()=>{
    const response=await fetch('/api/auth/state',{credentials:'same-origin',cache:'no-store'});
    const state=await response.json();
    if(version!==epoch)return null;
    if(!response.ok||!state.authenticated||!state.cache_scope){await clearImages();return null;}
    const next=IMAGE_PREFIX+state.cache_scope;
    if(identity&&identity!==next)await clearImages();
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
  maintenance=maintenance.catch(()=>{}).then(write);await maintenance;
}
async function fetchImage(request){
  const response=await fetch(request),url=request.url;
  if(!response.ok||!response.body||!response.headers.get('content-type')?.startsWith('image/')||new URL(url).searchParams.has('thumbnail')||typeof TransformStream==='undefined')return response;
  const total=Number(response.headers.get('content-length')||0);let loaded=0,last=0;
  const publish=done=>{
    if(!done&&loaded!==0&&loaded<total&&Date.now()-last<120)return;last=Date.now();
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>clients.forEach(client=>client.postMessage({type:'IMAGE_PROGRESS',url,loaded,total,done}))).catch(()=>{});
  };
  publish(false);
  const body=response.body.pipeThrough(new TransformStream({transform(chunk,controller){loaded+=chunk.byteLength;publish(false);controller.enqueue(chunk);},flush(){publish(true);}}));
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
async function image(request){
  let name;
  try{name=await authorize();}catch{return fetchImage(request);}
  if(!name)return fetchImage(request);
  const version=epoch,key=request.url;let cached;
  try{cached=await (await caches.open(name)).match(key);}catch{return fetchImage(request);}
  if(version!==epoch)return new Response('',{status:401});
  if(cached)return cached;
  const id=name+':'+key;
  if(!inflight.has(id)){
    const pending=(async()=>{
      const response=await fetchImage(request);
      if((response.status===401||response.status===403)&&version===epoch)await clearImages();
      else {try{await store(name,key,response,version);}catch{/* Storage pressure must not break image loading. */}}
      return response;
    })();
    inflight.set(id,pending);pending.finally(()=>{if(inflight.get(id)===pending)inflight.delete(id);}).catch(()=>{});
  }
  const response=await inflight.get(id);
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
  if((/^\/media\/[a-f0-9]{32}$/.test(url.pathname)||/^\/api\/jobs\/[a-f0-9]{32}\/stitch\/base$/.test(url.pathname))&&!url.searchParams.has('download')){event.respondWith(image(request));return;}
  if(request.mode==='navigate')event.respondWith(fetch(request).catch(()=>caches.match('/static/offline.html')));
  else if(OFFLINE.includes(url.pathname))event.respondWith(fetch(request).catch(()=>caches.match(url.pathname)));
});
