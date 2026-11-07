const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const {parseHTML}=require('linkedom');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({job={},pages=[]}={}){
 const {window}=parseHTML('<!doctype html><html><body><section id="root"></section></body></html>'),{document}=window;
 const sources=[],images=[],requests=[],timers=new Map();let hidden=false,nextTimer=0;
 Object.defineProperty(document,'hidden',{get:()=>hidden});
 class EventSource{constructor(url){this.url=url;this.closed=false;sources.push(this);}close(){this.closed=true;}send(value){this.onmessage?.({data:JSON.stringify(value)});}error(){this.onerror?.(new Error('offline'));}}
 class Image{constructor(){images.push(this);}set src(value){this.url=value;}get src(){return this.url;}decode(){return Promise.resolve();}success(){this.onload?.();}fail(){this.onerror?.();}}
 const layers=[];
 function openSheet({html}){const sheet=document.createElement('section');sheet.innerHTML=html;document.body.append(sheet);layers.push({type:'sheet',sheet});return sheet;}
 function traverseHistory(count){if(count()){const {sheet}=layers.pop();sheet.cleanup?.();sheet.remove();}}
 const context=vm.createContext({document,window,EventSource,Image,AbortController,DOMException,setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout:id=>timers.delete(id),MutationObserver:window.MutationObserver,console,openSheet,layers,traverseHistory,topSheet:()=>layers.at(-1)?.sheet,icon:()=>'<svg></svg>',esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 vm.runInContext(fs.readFileSync('static/studio-generation.js','utf8'),context,{filename:'studio-generation.js'});
 const generation=vm.runInContext('StudioGeneration',context),root=document.querySelector('#root');
 const adapter={async api(path){requests.push(path);const offset=Number(new URL(path,'https://fixture').searchParams.get('offset'));return structuredClone(pages.find(p=>p.offset===offset)?.data||{items:[],total:0});}};
 const j={id:'job',status:'running',options:{},outputs:[],generation_calls:{items:[],total:0},...job};
 const session=generation.mount(root,j,adapter);
 function openPicker(){root.querySelector('.generation-trigger').click();return layers.at(-1)?.sheet;}
 return {document,window,root,generation,session,sources,images,requests,openPicker,choose(id){openPicker().querySelector(`[data-call-id="${id}"]`).click();},advance(ms){let count=0;for(const [id,t] of [...timers])if(t.ms<=ms){count++;timers.delete(id);t.fn();}return count;},visibility(value){hidden=value;document.dispatchEvent(new window.Event('visibilitychange'));},send(value){sources.at(-1).send(value);},async settle(){await tick();await tick();}};
}
function call(extra={}){return {id:'one',kind:'image',scope:'image-0',created:1,updated:1,status:'running',requested:{quality:'auto',size:'auto'},provider_reported:{},...extra};}

test('SSE image decode retains newest frame even when previous download completes later',async()=>{
 const f=fixture();f.send({status:'running',generation:call({preview:{url:'/frame/1'},updated:1})});f.send({status:'running',generation:call({preview:{url:'/frame/2'},updated:2})});
 assert.deepEqual(f.images.map(i=>i.url),['/frame/1','/frame/2']);f.images[1].success();await f.settle();f.images[0].success();await f.settle();
 assert.equal(f.root.querySelector('.generation-image').getAttribute('src'),'/frame/2');assert.equal(f.root.querySelector('.generation-frame').hidden,false);
});
test('late older SSE observation cannot roll back newest displayed partial',async()=>{
 const f=fixture();f.send({status:'running',generation:call({preview:{url:'/frame/2'},updated:2})});f.images.at(-1).success();await f.settle();f.send({status:'running',generation:call({preview:{url:'/frame/1'},updated:1})});await f.settle();assert.equal(f.root.querySelector('.generation-image').getAttribute('src'),'/frame/2');assert.equal(f.images.length,1);
});
test('legacy task says no structured records and never invents response values',()=>{
 const f=fixture({job:{status:'succeeded'}});assert.match(f.root.textContent,/旧任务没有结构化请求记录/);assert.doesNotMatch(f.root.textContent,/gpt-image|实际图片|图片质量/);assert.equal(f.sources.length,0);
});
test('auto is valid; explicit max requested versus low reported is visibly distinct',()=>{
 const f=fixture();const auto=f.generation.comparison(call({requested:{quality:'auto'},provider_reported:{quality:'low'}}));assert.match(auto,/auto/);assert.doesNotMatch(auto,/class="generation-different"/);
 const mismatch=f.generation.comparison(call({requested:{quality:'max'},provider_reported:{quality:'low'}}));assert.match(mismatch,/max/);assert.match(mismatch,/class="generation-different">low/);
});
test('separate polish and image records retain their respective scope and ordering',()=>{
 const f=fixture({job:{generation_calls:{total:2,items:[call({id:'image',created:2}),call({id:'polish',kind:'polish',scope:'polish',created:1,requested:{response_model:'text-model'}})]}}});
 const trigger=f.root.querySelector('.generation-trigger'),picker=f.openPicker();
 assert.equal(f.root.querySelector('select'),null);
 assert.equal(trigger.getAttribute('aria-expanded'),'true');
 assert.equal(picker.querySelector('[aria-pressed="true"]').dataset.callId,'image');
 const polish=picker.querySelector('[data-call-id="polish"]');assert.match(polish.textContent,/独立润色/);polish.click();
 assert.equal(picker.isConnected,false);assert.equal(trigger.getAttribute('aria-expanded'),'false');
 assert.match(trigger.textContent,/独立润色/);assert.match(f.root.textContent,/润色文本模型/);assert.match(f.root.textContent,/text-model/);
 assert.equal(f.root.querySelector('.generation-live').hidden,true);
});
test('terminal event closes stream and detached detail releases stream',async()=>{
 const f=fixture();f.send({status:'succeeded',generation:call({status:'succeeded',updated:3})});assert.equal(f.sources[0].closed,true);
 const g=fixture();g.root.remove();await g.settle();assert.equal(g.sources[0].closed,true);
});
test('hidden tab disconnects and visible tab reconnects; network errors retain native retry',async()=>{
 const f=fixture();f.visibility(true);assert.equal(f.sources[0].closed,true);f.visibility(false);assert.equal(f.sources.length,2);f.sources[1].error();assert.match(f.root.textContent,/连接恢复中/);assert.equal(f.sources[1].closed,false);
});
test('paging old scope preserves manual selection across newer stream events',async()=>{
 const older=call({id:'old',scope:'level-1-tile-1',created:1});const newer=call({id:'new',scope:'level-1-tile-2',created:2});
 const f=fixture({job:{generation_calls:{items:[newer],total:2}},pages:[{offset:1,data:{items:[older],total:2}}]});f.root.querySelector('.generation-more').click();await f.settle();assert.equal(f.requests.at(-1),'/api/jobs/job/generation-calls?limit=30&offset=1');
 f.choose('old');assert.match(f.root.querySelector('[data-generation-label]').textContent,/level-1-tile-1/);f.send({status:'running',generation:call({id:'newest',created:3,scope:'level-2-tile-1'})});assert.match(f.root.querySelector('[data-generation-label]').textContent,/level-1-tile-1/);
});
test('failed preview offers an explicit retry without requiring another server event',async()=>{
 const f=fixture();f.send({status:'running',generation:call({preview:{url:'/frame/1'}})});f.images[0].fail();const retry=f.root.querySelector('.generation-preview-retry');assert.ok(retry,'failed image exposes a retry control');retry.click();assert.equal(f.images.length,2);f.images[1].success();await f.settle();assert.equal(f.root.querySelector('.generation-frame').hidden,false);
});
// Actual computed styles and landscape measurements run in generation-visual-qa.js on a real WebView.


test('same-timestamp older partial revision cannot supersede the newest frame',async()=>{
 const f=fixture();f.send({status:'running',generation:call({preview:{url:'/frame/3',revision:3},updated:100})});f.images.at(-1).success();await f.settle();
 f.send({status:'running',generation:call({preview:{url:'/frame/2',revision:2},updated:100})});await f.settle();assert.equal(f.images.length,1);assert.equal(f.root.querySelector('.generation-image').getAttribute('src'),'/frame/3');
});
test('terminal status received through ordinary detail refresh also closes the live stream',()=>{
 const f=fixture();f.generation.update(f.root,{status:'succeeded'});assert.equal(f.sources[0].closed,true);
});


test('a failed earlier image attempt must not display a later attempt final image',async()=>{
 const previous=call({id:'attempt-1',scope:'image-1',status:'failed',created:1,preview:{url:'/attempt-1/frame',revision:1}}),latest=call({id:'attempt-2',scope:'image-2',status:'succeeded',created:2});
 const f=fixture({job:{status:'succeeded',attempt:2,outputs:[{preview:'/attempt-2/final'}],generation_calls:{items:[previous,latest],total:2}}});
 f.choose('attempt-1');assert.equal(f.images.at(-1).url,'/attempt-1/frame');f.images.at(-1).success();await f.settle();assert.equal(f.root.querySelector('.generation-image').getAttribute('src'),'/attempt-1/frame');assert.match(f.root.querySelector('.generation-frame-badge').textContent,/非最终作品/);
});



test('the successful call may display its own final asset only after that call is identified',async()=>{
 const success=call({id:'attempt-2',scope:'image-2',status:'succeeded',created:2});
 const f=fixture({job:{status:'succeeded',generation:success,attempt:2,outputs:[{preview:'/attempt-2/final'}],generation_calls:{items:[success],total:1}}});assert.equal(f.images[0].url,'/attempt-2/final');f.images[0].success();await f.settle();assert.equal(f.root.querySelector('.generation-image').getAttribute('src'),'/attempt-2/final');assert.equal(f.root.querySelector('.generation-frame-badge').textContent,'最终作品');
});


test('switching call scopes never shows the previous call image under the newly selected call',async()=>{
 const older=call({id:'old',scope:'image-1',created:1,preview:{url:'/old/frame',revision:1}}),newer=call({id:'new',scope:'image-2',created:2,preview:{url:'/new/frame',revision:1}});
 const f=fixture({job:{generation_calls:{items:[newer,older],total:2}}});f.images[0].success();await f.settle();assert.equal(f.root.querySelector('.generation-image').getAttribute('src'),'/new/frame');
 f.choose('old');assert.match(f.root.querySelector('[data-generation-label]').textContent,/image-1/);
 assert.equal(f.root.querySelector('.generation-frame').hidden,true,'previous call image must not remain visible while the other scope loads');f.images.at(-1).success();await f.settle();assert.equal(f.root.querySelector('.generation-image').getAttribute('src'),'/old/frame');
});


test('a stalled generation preview decode exposes retry after its deadline',async()=>{
 const f=fixture();f.send({status:'running',generation:call({preview:{url:'/frame/1'}})});
 let finish;f.images[0].decode=()=>new Promise(resolve=>finish=resolve);f.images[0].success();await f.settle();
 assert.ok(f.advance(20000),'the preview must have a deadline');await f.settle();
 const retry=f.root.querySelector('.generation-preview-retry');assert.equal(retry.hidden,false);assert.equal(retry.disabled,false);
 finish();await f.settle();assert.equal(f.root.querySelector('.generation-frame').hidden,true,'late decode must not paint');
 retry.click();assert.equal(f.images.length,2);f.images[1].success();await f.settle();
 assert.equal(f.root.querySelector('.generation-image').getAttribute('src'),'/frame/1');
});

test('backgrounding cancels a pending frame and preserves the last decoded frame',async()=>{
 const f=fixture();f.send({status:'running',generation:call({preview:{url:'/frame/1'},updated:1})});f.images[0].success();await f.settle();
 f.send({status:'running',generation:call({preview:{url:'/frame/2'},updated:2})});
 let finish;f.images[1].decode=()=>new Promise(resolve=>finish=resolve);f.images[1].success();await f.settle();
 f.visibility(true);assert.equal(f.sources[0].closed,true);finish();await f.settle();
 assert.equal(f.root.querySelector('.generation-image').getAttribute('src'),'/frame/1');
 assert.equal(f.root.querySelector('.generation-frame').hidden,false);
});

test('closing generation details aborts an in-flight records read',async()=>{
 const f=fixture();await f.settle();let signal;
 f.session.adapter.api=(path,options={})=>{signal=options.signal;return new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true}));};
 f.visibility(true);f.visibility(false);await f.settle();assert.ok(signal,'records GET must accept an abort signal');
 f.generation.close(f.session);assert.equal(signal.aborted,true);
});
