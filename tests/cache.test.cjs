const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../static/sw.js'),'utf8');
class CacheStorage {
  constructor(){this.data=new Map();}
  async keys(){return [...this.data.keys()];}
  async delete(key){return this.data.delete(key);}
  async open(name){if(!this.data.has(name))this.data.set(name,new Map());const items=this.data.get(name),key=r=>typeof r==='string'?r:r.url;return {keys:async()=>[...items.keys()].map(url=>new Request(url)),match:async r=>items.get(key(r))?.clone(),put:async(r,response)=>items.set(key(r),response.clone()),delete:async r=>items.delete(key(r))};}
}
function worker(state,cache=new CacheStorage()){
  const listeners={};
  const context=vm.createContext({Response,Request,Headers,URL,Map,Promise,Date:class extends Date{static now(){return state.time||1000;}},caches:cache,self:{location:{origin:'https://image.test'},addEventListener:(type,fn)=>listeners[type]=fn,clients:{claim:async()=>{}},skipWaiting:async()=>{}},fetch:async request=>{
    const url=typeof request==='string'?request:request.url;
    if(url==='/api/auth/state'){state.authCalls=(state.authCalls||0)+1;return Response.json({authenticated:state.auth!==false,cache_scope:state.scope||'account-a'});}
    if(url.includes('/api/auth/logout')){state.auth=false;return Response.json({ok:true});}
    state.loads=(state.loads||0)+1;if(state.block)await state.block;
    return state.auth===false?new Response('',{status:401}):new Response('png',{headers:{'content-type':'image/png','content-length':String(state.bytes||3)}});
  }});
  vm.runInContext(source,context);
  return {cache,fetch:async(path,method='GET')=>{let result;listeners.fetch({request:new Request('https://image.test'+path,{method}),respondWith:p=>result=p});return result?await result:undefined;},message:async type=>{let pending,response;listeners.message({data:{type},ports:[{postMessage:r=>response=r}],waitUntil:p=>pending=p});await pending;return response;}};
}
const path='/media/'+'a'.repeat(32);
test('originals and thumbnails persist across worker restarts without another image download',async()=>{
  const state={},one=worker(state);await one.fetch(path);await one.fetch(path);assert.equal(state.loads,1);
  await one.fetch(path+'?thumbnail=1');assert.equal(state.loads,2);
  const two=worker(state,one.cache);assert.equal(await (await two.fetch(path)).text(),'png');assert.equal(state.loads,2);assert.equal(state.authCalls,2);
  assert.deepEqual({...await two.message('IMAGE_CACHE_STATUS')},{bytes:6,count:2});
});
test('concurrent requests for one immutable image share the same download',async()=>{
  let release;const state={block:new Promise(resolve=>release=resolve)},w=worker(state);
  const pending=[w.fetch(path),w.fetch(path),w.fetch(path)];await new Promise(resolve=>setTimeout(resolve,10));assert.equal(state.loads,1);release();await Promise.all(pending);
  assert.equal(state.loads,1);
});
test('logout clears durable images and downloads/API payloads bypass the image cache',async()=>{
  const state={},w=worker(state);await w.fetch(path);
  assert.equal(await w.fetch('/api/jobs'),undefined);assert.equal(await w.fetch(path+'?download=1'),undefined);
  await w.fetch('/api/auth/logout','POST');assert.equal((await w.cache.keys()).length,0);
  assert.equal((await w.fetch(path)).status,401);assert.equal((await w.cache.keys()).length,0);
});
test('a revoked session is rechecked and cannot read a previously cached image',async()=>{
  const state={},w=worker(state);await w.fetch(path);state.auth=false;state.time=32000;
  assert.equal((await w.fetch(path)).status,401);assert.equal((await w.cache.keys()).length,0);
});
test('clearing the cache while an image is in flight cannot repopulate it',async()=>{
  let release;const state={block:new Promise(resolve=>release=resolve)},w=worker(state),pending=w.fetch(path);
  await new Promise(resolve=>setTimeout(resolve,10));await w.message('IMAGE_CACHE_CLEAR');release();assert.equal((await pending).status,401);
  assert.equal((await w.cache.keys()).length,0);
});
test('the durable cache evicts oldest files within its byte budget',async()=>{
  const state={bytes:48*1024*1024},w=worker(state);
  for(let i=0;i<5;i++)await w.fetch('/media/'+i.toString(16).padStart(32,'0'));
  assert.deepEqual({...await w.message('IMAGE_CACHE_STATUS')},{count:4,bytes:192*1024*1024});
  const name=(await w.cache.keys())[0],cache=await w.cache.open(name);
  assert.equal(await cache.match('https://image.test/media/'+'0'.repeat(32)),undefined);
});
test('large upscale results below the total budget can be cached',async()=>{
  const state={bytes:80*1024*1024},w=worker(state);await w.fetch(path);await w.fetch(path);assert.equal(state.loads,1);
  assert.equal((await w.message('IMAGE_CACHE_STATUS')).bytes,80*1024*1024);
});
test('storage being disabled does not break image loading or logout',async()=>{
  const state={},w=worker(state,{open:async()=>{throw new Error('Storage disabled');},keys:async()=>{throw new Error('Storage disabled');}});
  assert.equal((await w.fetch(path)).status,200);assert.equal((await w.fetch('/api/auth/logout','POST')).status,200);
});
