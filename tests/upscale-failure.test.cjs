const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {parseHTML}=require('linkedom');
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture({comparisonApi,output=true}={}){
  const {document,HTMLElement}=parseHTML('<html><body></body></html>');
  HTMLElement.prototype.showModal=function(){this.open=true;};HTMLElement.prototype.close=function(){this.open=false;this.dispatchEvent(new document.defaultView.Event('close'));};
  const tiles=[0,1,2,3].map(index=>({index,number:index+1,core:[index%2*360,Math.floor(index/2)*600,(index%2+1)*360,(Math.floor(index/2)+1)*600],state:index===3?'ready':'coverage',reason:index===0?'<script>bad</script>':'Boundary gap',missing_core_pixels:120,actual_size:[971,1619]}));
  const report={input_size:[720,1200],output_size:[1440,2400],preview_size:[720,1200],tiles,images:Object.fromEntries(['source','raw','affine','top','center-raw','center-affine'].map(n=>[n,'/diagnostics/'+n]))};
  let submitted;
  const comparison={input_size:[400,667],expected_size:[800,1334],output_size:output?[971,1619]:null,images:{input:'/comparison/input',output:output?'/comparison/output':null}};
  const context=vm.createContext({document,Set,Number,esc,icon:()=>'',closeModal(){},toast(){},updateHTML:(el,html)=>{if(el)el.innerHTML=html;},api:async path=>path.includes('/comparison?')?(comparisonApi?comparisonApi(path):comparison):path.includes('/diagnostics?')?report:{id:'job',options:{upscale_injection:'Original injection'},upscale_plan:{stages:[{index:1,status:'failed',diagnostic_available:true}]}},post:async(path,body)=>{submitted={path,body};return{};},StudioUpscale:{openJob:async()=>{}}});
  vm.runInContext(fs.readFileSync(require.resolve('../static/upscale-failure.js'),'utf8'),context);
  return {document,ui:context.StudioUpscaleFailure,submitted:()=>submitted};
}
test('diagnostics open in a separate dialog and selecting tiles does not overwrite typed constraints',async()=>{
  const {document,ui}=fixture();await ui.open('job');
  assert.equal(document.querySelector('#upscale-failure').open,true);
  assert.equal(document.querySelectorAll('.failure-panel').length,3);
  assert.ok(!document.querySelector('#page'));assert.equal(document.querySelectorAll('script').length,0);
  const field=document.querySelector('#failure-injection');field.value='My unsaved ink constraint';
  await ui.action('upscale-diagnostic-toggle',{dataset:{tile:'2'}});
  assert.equal(field.value,'My unsaved ink constraint');assert.equal(document.querySelector('#failure-redraw-submit').disabled,false);
  assert.match(document.querySelector('#failure-selected-count').textContent,/已选 1 块/);
});

test('tile compare preloads both layers in the same frame and flipping preserves selection and prompt draft',async()=>{
  const {document,ui}=fixture();await ui.open('job');
  await ui.action('upscale-diagnostic-toggle',{dataset:{tile:'2'}});
  const draft=document.querySelector('#failure-injection');draft.value='Unsaved fine ink';
  const body=document.querySelector('#failure-body');body.scrollTop=400;
  await ui.action('upscale-diagnostic-compare',{dataset:{tile:'2'}});
  const frame=document.querySelector('.failure-compare-frame'),images=[...frame.querySelectorAll('img')];
  assert.equal(images.length,2);assert.equal(images[0].parentNode,images[1].parentNode);
  for(const img of images)img.dispatchEvent(new document.defaultView.Event('load'));
  assert.equal(document.querySelector('#failure-compare-current').textContent,'当前：超分输出');
  await ui.action('upscale-diagnostic-compare-flip',{});
  assert.equal(document.querySelector('#failure-compare-current').textContent,'当前：超分输入');
  assert.equal(document.querySelector('.failure-compare-frame'),frame);assert.equal(images[0].classList.contains('hidden'),false);
  await ui.action('upscale-diagnostic-compare-back',{});
  assert.equal(draft.value,'Unsaved fine ink');assert.equal(body.scrollTop,400);
  assert.match(document.querySelector('#failure-selected-count').textContent,/已选 1 块/);
});

test('missing output shows the input and disables the switch without a broken output image',async()=>{
  const {document,ui}=fixture({output:false});await ui.open('job');await ui.action('upscale-diagnostic-compare',{dataset:{tile:'0'}});
  const images=[...document.querySelectorAll('.failure-compare-layer')];assert.equal(images.length,1);
  images[0].dispatchEvent(new document.defaultView.Event('load'));
  assert.equal(document.querySelector('#failure-compare-switch').disabled,true);
  assert.equal(document.querySelector('#failure-compare-switch').textContent,'尚无输出');
});

test('returning to diagnostics ignores a late comparison response',async()=>{
  let resolve;const {document,ui}=fixture({comparisonApi:()=>new Promise(r=>resolve=r)});await ui.open('job');
  const pending=ui.action('upscale-diagnostic-compare',{dataset:{tile:'0'}});
  await ui.action('upscale-diagnostic-compare-back',{});
  resolve({input_size:[1,1],images:{input:'late'}});await pending;
  assert.equal(document.querySelector('#failure-tile-comparison').classList.contains('hidden'),true);
  assert.equal(document.querySelectorAll('.failure-compare-layer').length,0);
});
test('redraw submits exactly the selected stable tile ids and the edited task injection',async()=>{
  const {document,ui,submitted}=fixture();await ui.open('job');
  await ui.action('upscale-diagnostic-toggle',{dataset:{tile:'1'}});
  document.querySelector('#failure-injection').value='Keep fine lines and {literal braces}';document.querySelector('#failure-current-prompt').checked=true;
  await ui.action('upscale-diagnostic-submit',{});
  assert.deepEqual(JSON.parse(JSON.stringify(submitted())),{path:'/api/upscale/jobs/job/redraw',body:{level:1,tiles:[1],upscale_injection:'Keep fine lines and {literal braces}',use_current_prompt:true}});
  assert.equal(document.querySelector('#upscale-failure').open,false);
});
