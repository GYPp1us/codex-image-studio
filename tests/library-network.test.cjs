const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const create=vm.runInNewContext(fs.readFileSync('static/studio-network.js','utf8')+'\ncreateConnection',{AbortController,Promise,Error});
function fixture(){
  let clock=0,serial=0,resyncs=0;
  const timers=new Map(),calls=[],status=[];
  const setTimer=(fn,delay)=>{const id=++serial;timers.set(id,{at:clock+delay,fn});return id;};
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const link=create({now:()=>clock,setTimer,clearTimer:id=>timers.delete(id),
    probe(signal){let resolve,reject;const task=new Promise((yes,no)=>{resolve=yes;reject=no;});calls.push({at:clock,signal,resolve,reject});return task;},
    resync:async()=>{resyncs++;},paint:value=>status.push({...value,at:clock})});
  async function advance(until){
    await flush();
    while(timers.size){const [id,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(t.at>until)break;clock=t.at;timers.delete(id);t.fn();await flush();}
    clock=until;await flush();
  }
  return {link,calls,status,advance,flush,resyncs:()=>resyncs};
}
test('foreground no-event blackhole including stalled body shows retry by 7s, bounded backoff recovers within 10s',async()=>{
  const f=fixture();f.link.start();
  await f.advance(3999);assert.equal(f.calls.length,0);
  await f.advance(4000);assert.equal(f.calls.length,1);
  await f.advance(6999);assert.equal(f.link.status.phase,'online');
  await f.advance(7000);assert.equal(f.link.status.phase,'retrying');assert.ok(f.calls[0].signal.aborted);
  await f.advance(8000);assert.equal(f.calls.length,2);
  f.link.check(true);f.link.check(true);assert.equal(f.calls.length,2);
  await f.advance(11000);await f.advance(13000);await f.advance(16000);await f.advance(20000);
  await f.advance(23000);await f.advance(28000);
  assert.deepEqual(f.calls.map(c=>c.at),[4000,8000,13000,20000,28000]);
  f.calls.at(-1).resolve({app:'Image Studio',ok:true});await f.flush();assert.equal(f.resyncs(),1);
  f.calls[0].resolve({app:'wrong',ok:false});await f.flush();assert.equal(f.link.status.phase,'online');
  f.link.stop();
});
test('good responses postpone normal probes; bad gallery does not make the site offline; manual and wake share probes',async()=>{
  const f=fixture();f.link.start();await f.advance(3000);f.link.good();await f.advance(6500);assert.equal(f.calls.length,0);
  f.link.visibleData(false);await f.flush();f.calls[0].resolve({ok:true,app:'Image Studio'});await f.flush();
  assert.equal(f.link.status.phase,'online');assert.equal(f.link.status.pageSlow,true);
  f.link.check(true);f.link.check(true);await f.flush();assert.equal(f.calls.length,2);
  f.calls[1].resolve({ok:true,app:'Image Studio'});await f.flush();assert.equal(f.resyncs(),1);
  f.link.visibleData(true);assert.equal(f.link.status.pageSlow,false);
  f.link.stop();await f.advance(30000);assert.equal(f.calls.length,2);f.link.start(true);await f.flush();
  f.link.stop();f.calls[2].resolve({ok:true,app:'Image Studio'});await f.flush();assert.equal(f.resyncs(),1);
});
