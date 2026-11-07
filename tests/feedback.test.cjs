const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
function fixture(markup){
 const {window}=parseHTML(`<html><body><main>${markup}</main></body></html>`),{document}=window;
 let observer;class Observer{constructor(callback){this.callback=callback;observer=this;}observe(){}}
 const context=vm.createContext({document,MutationObserver:Observer,Promise});
 vm.runInContext(fs.readFileSync('static/studio-feedback.js','utf8'),context);
 return {document,feedback:vm.runInContext('StudioFeedback',context),notify(target,addedNodes){observer.callback([{target,addedNodes}]);}};
}
function gate(){let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return {promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('pending operation is single-flight and restores existing disabled and aria-busy state even on failure',async()=>{
 const f=fixture('<button data-act="save" disabled aria-busy="false">保存</button>'),button=f.document.querySelector('button'),g=gate();let called=0;
 const one=f.feedback.run('save',button,()=>{called++;return g.promise;});
 const two=f.feedback.run('save',button,()=>{called++;});await tick();
 assert.strictEqual(one,two);assert.equal(called,1);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');
 const failed=assert.rejects(one,/failure/);g.reject(new Error('failure'));await failed;
 assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(button.querySelector('.action-spinner'),null);assert.equal(f.feedback.busy('save'),false);
});
test('keyed replacement is pending until completion and recovers its own original state',async()=>{
 const f=fixture('<button data-act="save" data-id="one">保存</button>'),old=f.document.querySelector('button'),g=gate();
 const task=f.feedback.run('action:save:one',old,()=>g.promise);await tick();
 old.outerHTML='<button data-act="save" data-id="one" disabled aria-busy="false">再次保存</button>';
 const replacement=f.document.querySelector('button');f.feedback.hydrate(replacement);
 assert.equal(replacement.getAttribute('aria-busy'),'true');assert.ok(replacement.querySelector('.action-spinner'));
 g.resolve();await task;assert.equal(replacement.disabled,true);assert.equal(replacement.getAttribute('aria-busy'),'false');assert.equal(replacement.querySelector('.action-spinner'),null);
});
test('independent buttons retain their own busy lifecycle and accessible labels',async()=>{
 const f=fixture('<button data-act="a" aria-label="保存文件"><svg aria-hidden="true"><path></path></svg><span>保存</span></button><button data-act="b">取消</button>');
 const [a,b]=f.document.querySelectorAll('button'),ga=gate(),gb=gate(),ta=f.feedback.run('a',a,()=>ga.promise),tb=f.feedback.run('b',b,()=>gb.promise);await tick();
 assert.equal(a.getAttribute('aria-label'),'保存文件');assert.equal(a.getAttribute('aria-busy'),'true');assert.equal(b.getAttribute('aria-busy'),'true');
 ga.resolve();await ta;assert.equal(a.disabled,false);assert.equal(b.disabled,true);assert.equal(a.getAttribute('aria-label'),'保存文件');
 gb.resolve();await tb;assert.equal(b.disabled,false);assert.equal(a.querySelector('svg path')!==null,true);
});
test('text-only pending centers its spinner while preserving accessible multiline text and live updates',async()=>{
 const f=fixture('<button data-act="save">保存<span>当前设置<br>和草稿</span></button>'),button=f.document.querySelector('button'),child=button.querySelector('span'),g=gate();let clicks=0;child.addEventListener('click',()=>clicks++);
 const task=f.feedback.run('save',button,()=>g.promise);await tick();
 assert.equal(button.dataset.pendingMode,'text');assert.equal(button.querySelectorAll(':scope > .action-spinner').length,1);assert.equal(button.querySelector('.action-spinner').getAttribute('aria-hidden'),'true');
 assert.ok(button.getAttribute('aria-label')?.includes('保存'));assert.ok(child.hasAttribute('data-pending-content'));assert.ok([...button.children].some(el=>el.getAttribute('data-pending-content')==='1'&&el.textContent.includes('保存')));
 child.textContent='更新后名称';g.resolve();await task;
 assert.equal(button.dataset.pendingMode,undefined);assert.equal(button.getAttribute('aria-label'),null);assert.equal(button.querySelector('span'),child);assert.equal(child.textContent,'更新后名称');assert.equal(child.hasAttribute('data-pending-content'),false);child.click();assert.equal(clicks,1);
});
test('icon with text replaces only its icon, including wrapped SVG, without destroying listeners or labels',async()=>{
 for(const markup of ['<svg aria-hidden="true"><path></path></svg><span>下载原图</span>','<span class="icon"><svg aria-hidden="true"><path></path></svg></span><span>下载原图</span>']){
  const f=fixture(`<button data-act="download">${markup}</button>`),button=f.document.querySelector('button'),svg=button.querySelector('svg'),label=button.lastElementChild,g=gate();let clicks=0;label.addEventListener('click',()=>clicks++);
  const task=f.feedback.run('download',button,()=>g.promise);await tick();
  assert.equal(button.dataset.pendingMode,'icon');assert.ok(button.querySelector('[data-pending-icon="1"]'));assert.equal(label.hasAttribute('data-pending-content'),false);assert.equal(label.textContent,'下载原图');assert.ok(button.getAttribute('aria-label')?.includes('下载原图'));
  g.resolve();await task;assert.equal(button.querySelector('svg'),svg);assert.equal(button.querySelector('[data-pending-icon]'),null);assert.equal(button.getAttribute('aria-label'),null);label.click();assert.equal(clicks,1);
 }
});

test('live content replacement during a text-only operation stays hidden until completion',async()=>{
 const f=fixture('<button data-act="save"><span>保存</span></button>'),button=f.document.querySelector('button'),g=gate();
 const task=f.feedback.run('save',button,()=>g.promise);await tick();
 button.querySelector('span').replaceWith(Object.assign(f.document.createElement('b'),{textContent:'新的状态'}));
 const updated=button.querySelector('b');f.notify(button,[updated]);assert.equal(updated.getAttribute('data-pending-content'),'1');assert.equal(button.querySelectorAll('.action-spinner').length,1);
 g.resolve();await task;assert.equal(updated.getAttribute('data-pending-content'),null);assert.equal(updated.textContent,'新的状态');
});
test('icon-only action keeps its explicit accessible name throughout pending and recovery',async()=>{
 const f=fixture('<button data-act="close" aria-label="关闭"><svg><path></path></svg></button>'),button=f.document.querySelector('button'),g=gate();
 const task=f.feedback.run('close',button,()=>g.promise);await tick();assert.equal(button.dataset.pendingMode,'icon');assert.equal(button.getAttribute('aria-label'),'关闭');assert.equal(button.getAttribute('aria-busy'),'true');
 g.resolve();await task;assert.equal(button.getAttribute('aria-label'),'关闭');assert.equal(button.hasAttribute('aria-busy'),false);
});
test('immediate mode starts synchronously, holds the single-flight lock, and restores on thrown error',async()=>{
 const f=fixture('<button data-act="share">分享</button>'),button=f.document.querySelector('button');let calls=0,reentrant;
 const task=f.feedback.run('share',button,()=>{calls++;reentrant=f.feedback.run('share',button,()=>calls++,{immediate:true});throw new Error('share failed');},{immediate:true});
 assert.equal(calls,1);assert.strictEqual(reentrant,task);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');
 await assert.rejects(task,/share failed/);assert.equal(button.disabled,false);assert.equal(button.hasAttribute('aria-busy'),false);assert.equal(button.querySelector('.action-spinner'),null);assert.equal(f.feedback.busy('share'),false);
});
test('an earlier operation finishing cannot clear another active operation on the same button',async()=>{
 const f=fixture('<button data-act="more">加载更多</button>'),button=f.document.querySelector('button'),a=gate(),b=gate();
 const pa=f.feedback.run('page:a',button,()=>a.promise),pb=f.feedback.run('page:b',button,()=>b.promise);await tick();a.resolve();await pa;
 assert.equal(button.dataset.pendingKey,'page:b');assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');assert.ok(button.querySelector('.action-spinner'));
 b.resolve();await pb;assert.equal(button.disabled,false);assert.equal(button.hasAttribute('aria-busy'),false);assert.equal(button.querySelector('.action-spinner'),null);
});
test('background completion does not disable a button rebound to another idle page',async()=>{
 const f=fixture('<button data-act="more">加载更多</button>'),button=f.document.querySelector('button'),a=gate();
 const pa=f.feedback.run('page:a',button,()=>a.promise);await tick();button.dataset.pendingKey='page:b';f.feedback.hydrate(button);button.disabled=false;
 a.resolve();await pa;assert.equal(button.dataset.pendingKey,'page:b');assert.equal(button.disabled,false);assert.equal(button.hasAttribute('aria-busy'),false);assert.equal(button.querySelector('.action-spinner'),null);
});
