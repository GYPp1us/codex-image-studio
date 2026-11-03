const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
function fixture(recovery){
 const {document}=parseHTML('<!doctype html><html><body></body></html>');
 const FX={task:{up:null},diagnosticError:''},job={id:'synthetic',status:'failed',error:'合成失败',options:{stitch:4},recovery};
 const context=vm.createContext({document,FX,S:{settings:{upscale:{autoSelect:false}}},icon:()=>'',esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),lbl:()=>'',StudioProgress:{hydrate(){}},hydrateIcons(){},openScreen(html){const e=document.createElement('section');e.innerHTML=html;document.body.append(e);return e;}});
 vm.runInContext(fs.readFileSync('static/studio-recovery.js','utf8'),context);const module=vm.runInContext('StudioRecovery',context);
 const el=module.render(job,null,{bid:'batch',assets:new Map(),planHTML:()=>'',budget:()=>'',bytes:()=>''});return el;
}
test('without checkpoint retry offers restart without promising checkpoint reuse',()=>{
 const root=fixture({can_retry:true,can_accept_review:false,cache_available:false,retry_label:'重新执行',retry_reason:null});
 const button=root.querySelector('[data-v="retry"]');assert.ok(button&&!button.disabled);assert.match(button.textContent,/重新执行/);assert.doesNotMatch(button.nextElementSibling.textContent,/复用已完成的检查点/);
 assert.equal(root.querySelector('[data-v="accept_review"]').disabled,true);
});
test('available checkpoint offers checkpoint retry and explicitly permitted review override',()=>{
 const root=fixture({can_retry:true,can_accept_review:true,cache_available:true,retry_label:'从当前检查点重试',retry_reason:null});
 assert.match(root.querySelector('[data-v="retry"]').textContent,/检查点/);assert.match(root.querySelector('[data-v="retry"]').nextElementSibling.textContent,/复用/);assert.equal(root.querySelector('[data-v="accept_review"]').disabled,false);
});
