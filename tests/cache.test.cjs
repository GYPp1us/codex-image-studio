const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../static/sw.js'),'utf8');
class CacheStorage {
  constructor(){this.data=new Map();}
  async keys(){return [...this.data.keys()];}
  async delete(key){return this.data.delete(key);}
  async open(name){if(!this.data.has(name))this.data.set(name,new Map());const items=this.data.get(name),key=r=>typeof r==='string'?r:r.url;return {keys:async()=>[...items.keys()].map(url=>new Request(url)),match:async r=>items.get(key(r))?.clone(),put:async(r,response)=>items.set(key(r),new Response(await response.arrayBuffer(),{status:response.status,headers:response.headers})),delete:async r=>items.delete(key(r))};}
}
function worker(state,cache=new CacheStorage()){
  const listeners={},pending=new Set();
  const waitUntil=work=>{const task=Promise.resolve(work);pending.add(task);task.finally(()=>pending.delete(task)).catch(()=>{});};
  const context=vm.createContext({Response,Request,Headers,URL,Map,Promise,TransformStream,AbortController,DOMException,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout,Date:class extends Date{static now(){return state.time||1000;}},caches:cache,self:{location:{origin:'https://image.test'},addEventListener:(type,fn)=>listeners[type]=fn,clients:{claim:async()=>{},matchAll:async()=>[{postMessage:message=>(state.progress||=[]).push(message)}]},skipWaiting:async()=>{}},fetch:async (request,options={})=>{
    const url=typeof request==='string'?request:request.url;
    if(url==='/api/auth/state'){state.authCalls=(state.authCalls||0)+1;const authenticated=state.auth!==false;if(state.authGate)await state.authGate;if(state.authFailure)throw new Error('auth connection lost');return Response.json({authenticated,cache_scope:state.scope||'account-a'});}
    if(url.includes('/api/auth/logout')){state.auth=false;return Response.json({ok:true});}
    state.loads=(state.loads||0)+1;if(state.block){if(state.abortable)await Promise.race([state.block,new Promise((resolve,reject)=>options.signal?.addEventListener('abort',()=>{state.upstreamAborts=(state.upstreamAborts||0)+1;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true}))]);else await state.block;}
    return state.auth===false?new Response('',{status:401}):new Response('png',{headers:{'content-type':'image/png','content-length':String(state.bytes||3)}});
  }});
  vm.runInContext(source,context);
  return {cache,fetch:async(path,method='GET',signal)=>{let result;listeners.fetch({request:new Request('https://image.test'+path,{method,...(signal?{signal}:{})}),respondWith:p=>result=p,waitUntil});return result?await result:undefined;},settle:async()=>{while(pending.size)await Promise.allSettled([...pending]);},message:async type=>{let pending,response;listeners.message({data:{type},ports:[{postMessage:r=>response=r}],waitUntil:p=>pending=p});await pending;return response;}};
}
const path='/media/'+'a'.repeat(32);
test('originals and thumbnails persist across worker restarts without another image download',async()=>{
  const state={},one=worker(state);await one.fetch(path);await one.settle();await one.fetch(path);assert.equal(state.loads,1);
  await one.fetch(path+'?thumbnail=1');await one.settle();assert.equal(state.loads,2);
  const two=worker(state,one.cache);assert.equal(await (await two.fetch(path)).text(),'png');assert.equal(state.loads,2);assert.equal(state.authCalls,2);
  assert.deepEqual({...await two.message('IMAGE_CACHE_STATUS')},{bytes:6,count:2});
});
test('concurrent requests for one immutable image share the same download',async()=>{
  let release;const state={block:new Promise(resolve=>release=resolve)},w=worker(state);
  const pending=[w.fetch(path),w.fetch(path),w.fetch(path)];await new Promise(resolve=>setTimeout(resolve,10));assert.equal(state.loads,1);release();await Promise.all(pending);await w.settle();
  assert.equal(state.loads,1);
});
test('logout clears durable images and downloads/API payloads bypass the image cache',async()=>{
  const state={},w=worker(state);await w.fetch(path);await w.settle();
  assert.equal(await w.fetch('/api/jobs'),undefined);assert.equal(await w.fetch(path+'?download=1'),undefined);
  await w.fetch('/api/auth/logout','POST');assert.equal((await w.cache.keys()).length,0);
  assert.equal((await w.fetch(path)).status,401);assert.equal((await w.cache.keys()).length,0);
});
test('a revoked session is rechecked and cannot read a previously cached image',async()=>{
  const state={},w=worker(state);await w.fetch(path);await w.settle();state.auth=false;state.time=32000;
  assert.equal((await w.fetch(path)).status,401);assert.equal((await w.cache.keys()).length,0);
});
test('clearing the cache while an image is in flight cannot repopulate it',async()=>{
  let release;const state={block:new Promise(resolve=>release=resolve)},w=worker(state),pending=w.fetch(path);
  await new Promise(resolve=>setTimeout(resolve,10));await w.message('IMAGE_CACHE_CLEAR');release();assert.equal((await pending).status,401);await w.settle();
  assert.equal((await w.cache.keys()).length,0);
});
test('the durable cache evicts oldest files within its byte budget',async()=>{
  const state={bytes:48*1024*1024},w=worker(state);
  for(let i=0;i<5;i++){await w.fetch('/media/'+i.toString(16).padStart(32,'0'));await w.settle();}
  assert.deepEqual({...await w.message('IMAGE_CACHE_STATUS')},{count:4,bytes:192*1024*1024});
  const name=(await w.cache.keys())[0],cache=await w.cache.open(name);
  assert.equal(await cache.match('https://image.test/media/'+'0'.repeat(32)),undefined);
});
test('large upscale results below the total budget can be cached',async()=>{
  const state={bytes:80*1024*1024},w=worker(state);await w.fetch(path);await w.settle();await w.fetch(path);assert.equal(state.loads,1);
  assert.equal((await w.message('IMAGE_CACHE_STATUS')).bytes,80*1024*1024);
});
test('storage being disabled does not break image loading or logout',async()=>{
  const state={},w=worker(state,{open:async()=>{throw new Error('Storage disabled');},keys:async()=>{throw new Error('Storage disabled');}});
  assert.equal((await w.fetch(path)).status,200);assert.equal((await w.fetch('/api/auth/logout','POST')).status,200);
});
test('original image downloads report real byte progress while entering the durable cache',async()=>{
  const state={},w=worker(state);await w.fetch(path);await w.settle();
  assert.equal(state.progress[0].loaded,0);
  const last=state.progress.at(-1);assert.equal(last.loaded,3);assert.equal(last.total,3);assert.equal(last.done,true);
  assert.equal(last.url,'https://image.test'+path);const count=state.progress.length;
  await w.fetch(path);assert.equal(state.progress.length,count,'A cached image must not pretend to download again');
});


test('cancelling one concurrent image consumer does not cancel another consumer',async()=>{
  let release;const state={abortable:true,block:new Promise(resolve=>release=resolve)},w=worker(state),firstController=new AbortController();
  const first=w.fetch(path,'GET',firstController.signal).catch(error=>error),second=w.fetch(path).catch(error=>error);
  await new Promise(resolve=>setTimeout(resolve,10));firstController.abort();await new Promise(resolve=>setImmediate(resolve));release();
  const result=await second;assert.equal(result.status,200);await first;await w.settle();
});


test('cancelling every concurrent image consumer aborts the shared upstream',async()=>{
  const state={abortable:true,block:new Promise(()=>{})},w=worker(state),a=new AbortController(),b=new AbortController();
  const first=w.fetch(path,'GET',a.signal).catch(error=>error),second=w.fetch(path,'GET',b.signal).catch(error=>error);
  await new Promise(resolve=>setTimeout(resolve,10));a.abort();assert.equal(state.upstreamAborts||0,0);b.abort();
  const results=await Promise.all([first,second]);assert.ok(results.every(error=>error.name==='AbortError'));assert.equal(state.upstreamAborts,1);
});


test('logout during pending authorization prevents any subsequent media fetch',async()=>{
  for(const rejectAuth of [false,true]){
    let release;const state={authFailure:rejectAuth,authGate:new Promise(resolve=>release=resolve)},w=worker(state);
    const image=w.fetch(path);await new Promise(resolve=>setImmediate(resolve));assert.equal(state.authCalls,1);
    assert.equal((await w.fetch('/api/auth/logout','POST')).status,200);release();
    assert.equal((await image).status,401);assert.equal(state.loads||0,0);await w.settle();
  }
});

test('logout while cache open or match fails cannot fall back to media fetch',async()=>{
  for(const failAt of ['open','match']){
    let release;const gate=new Promise(resolve=>release=resolve),state={};
    let started;const entered=new Promise(resolve=>started=resolve);
    const gated={keys:async()=>[],delete:async()=>true,open:async()=>{
      if(failAt==='open'){started();await gate;throw new Error('open failed');}
      return {match:async()=>{started();await gate;throw new Error('match failed');}};
    }};
    const w=worker(state,gated),image=w.fetch(path);await entered;
    assert.equal((await w.fetch('/api/auth/logout','POST')).status,200);release();
    assert.equal((await image).status,401);assert.equal(state.loads||0,0);await w.settle();
  }
});
