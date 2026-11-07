const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('a stalled original download times out without emitting a false completion',async()=>{
 const timers=new Map(),states=[];let next=0;
 const body=new ReadableStream({start(){}});
 const context=vm.createContext({console,document:{querySelectorAll:()=>[]},navigator:{},location:{href:'https://image.test/'},URL,Date,Blob,DOMException,AbortController,
  fetch:async()=>new Response(body,{headers:{'content-type':'image/png','content-length':'200'}}),
  setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(fs.readFileSync('static/image-cache.js','utf8'),context);
 const result=context.StudioImages.original('/media/example',{onProgress:s=>states.push(s)});
 await new Promise(resolve=>setImmediate(resolve));
 const timer=[...timers.values()].find(t=>t.ms===20000);assert.ok(timer,'download must have a stalled-transfer deadline');timer.fn();
 await assert.rejects(result);assert.ok(!states.some(s=>s.done));
});

test('ongoing original download resets the idle timeout after each chunk',async()=>{
 const timers=new Map(),states=[];let next=0,stream;
 const body=new ReadableStream({start(controller){stream=controller;}});
 const context=vm.createContext({console,document:{querySelectorAll:()=>[]},navigator:{},location:{href:'https://image.test/'},URL,Date,Blob,DOMException,AbortController,
  fetch:async()=>new Response(body,{headers:{'content-type':'image/png','content-length':'4'}}),
  setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(fs.readFileSync('static/image-cache.js','utf8'),context);
 const result=context.StudioImages.original('/media/example',{onProgress:s=>states.push(s)});
 await new Promise(resolve=>setImmediate(resolve));const first=[...timers.entries()].find(([,t])=>t.ms===20000);assert.ok(first);
 stream.enqueue(new Uint8Array([1,2]));await new Promise(resolve=>setImmediate(resolve));
 const second=[...timers.entries()].find(([,t])=>t.ms===20000);assert.ok(second);assert.notEqual(second[0],first[0]);
 stream.enqueue(new Uint8Array([3,4]));stream.close();assert.equal((await result).size,4);assert.equal(states.at(-1).done,true);
});
