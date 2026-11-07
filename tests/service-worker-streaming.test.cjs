const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function fixture(){
  const handlers={},pending=[];
  const cache={keys:async()=>[],match:async()=>undefined,delete:async()=>true,put:async(key,response)=>{await response.arrayBuffer();}};
  let close;
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]));close=()=>controller.close();}});
  const worker={location:{origin:'https://image.test'},clients:{matchAll:async()=>[]},addEventListener:(name,fn)=>handlers[name]=fn};
  const context=vm.createContext({self:worker,caches:{open:async()=>cache,keys:async()=>[]},fetch:async request=>{
    if(typeof request==='string')return new Response(JSON.stringify({authenticated:true,cache_scope:'fixture'}),{headers:{'content-type':'application/json'}});
    return new Response(body,{headers:{'content-type':'image/png','content-length':'6'}});
  },Response,Request,Headers,URL,TransformStream,Date,Promise});
  vm.runInContext(fs.readFileSync('static/sw.js','utf8'),context);
  let response;
  handlers.fetch({request:new Request('https://image.test/media/'+ 'a'.repeat(32)+'?thumbnail=1'),respondWith:p=>response=p,waitUntil:p=>pending.push(p)});
  return {response,finish:()=>close(),pending};
}

test('first image bytes are available before a slow cache write has completed',async()=>{
  const f=fixture();
  try{
    const result=await Promise.race([f.response,new Promise(resolve=>setTimeout(()=>resolve(null),150))]);
    assert.ok(result,'a response must not wait for the complete body or cache write');
    const {value,done}=await result.body.getReader().read();
    assert.equal(done,false);assert.equal(value.length,3);
  }finally{f.finish();}
});

test('stalled authorization falls back to the network without reading private cache',async()=>{
 const handlers={},timers=new Map(),opened=[];let next=0,downloads=0;
 const worker={location:{origin:'https://image.test'},clients:{matchAll:async()=>[]},addEventListener:(name,fn)=>handlers[name]=fn};
 const context=vm.createContext({self:worker,caches:{open:async name=>{opened.push(name);throw new Error('must not read cache');},keys:async()=>[]},
  fetch:async request=>{if(typeof request==='string')return new Promise(()=>{});downloads++;return new Response('png',{headers:{'content-type':'image/png'}});},
  Response,Request,Headers,URL,TransformStream,Date,Promise,AbortController,DOMException,
  setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(fs.readFileSync('static/sw.js','utf8'),context);
 let response;handlers.fetch({request:new Request('https://image.test/media/'+ 'b'.repeat(32)+'?thumbnail=1'),respondWith:p=>response=p,waitUntil:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));
 const timeout=[...timers.values()].find(timer=>timer.ms===8000);assert.ok(timeout,'authorization must have a deadline');timeout.fn();
 const result=await response;assert.equal(result.status,200);assert.equal(downloads,1);assert.deepEqual(opened,[]);
});


test('slow navigation remains live past six seconds and failures use the offline page',async()=>{
  const handlers={},timers=new Map();let next=0,resolveNetwork,rejectNetwork;
  const worker={location:{origin:'https://image.test'},addEventListener:(name,fn)=>handlers[name]=fn};
  const context=vm.createContext({self:worker,caches:{match:async()=>new Response('offline')},
    fetch:()=>new Promise((resolve,reject)=>{resolveNetwork=resolve;rejectNetwork=reject;}),
    Response,Request,Headers,URL,TransformStream,Date,Promise,AbortController,
    setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(fs.readFileSync('static/sw.js','utf8'),context);
  const navigate=()=>{let result;handlers.fetch({request:{url:'https://image.test/',method:'GET',mode:'navigate'},respondWith:p=>result=p});return result;};
  let settled=false;const first=navigate().then(r=>{settled=true;return r;});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual([...timers.values()].map(t=>t.ms),[45000]);
  for(const timer of [...timers.values()])if(timer.ms<=6000)timer.fn();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  resolveNetwork(new Response('online'));assert.equal(await (await first).text(),'online');
  const second=navigate();await new Promise(resolve=>setImmediate(resolve));rejectNetwork(new Error('network lost'));
  assert.equal(await (await second).text(),'offline');
  const third=navigate();await new Promise(resolve=>setImmediate(resolve));[...timers.values()].find(t=>t.ms===45000).fn();
  assert.equal(await (await third).text(),'offline');
});
