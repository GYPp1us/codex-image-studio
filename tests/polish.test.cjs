const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function load(){const context=vm.createContext({esc:escape});vm.runInContext(fs.readFileSync(require.resolve('../static/polish.js'),'utf8'),context);return context.StudioPolish;}
test('saved polished prompt is escaped and provenance is visible',()=>{
  const html=load().markup({id:'job',options:{polish:true},polished_prompt:'Line1\n<script>alert(1)</script>',polish_source:'tool_arguments'});
  assert.match(html,/Line1\n&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/工具调用记录/);
});
test('old polished jobs degrade without displaying the raw prompt as a polished result',()=>{
  const html=load().markup({options:{polish:true},prompt:'Original text',status:'succeeded',polished_prompt:null});
  assert.match(html,/未记录润色后的提示词/);assert.doesNotMatch(html,/Original text/);assert.doesNotMatch(html,/copy-polished/);
});
test('ordinary jobs have no misleading polish panel',()=>assert.equal(load().markup({options:{polish:false}}),''));
