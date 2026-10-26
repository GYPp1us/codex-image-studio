const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {parseHTML}=require('linkedom');
function fixture(){
  const {document,HTMLElement}=parseHTML('<html><body></body></html>');
  HTMLElement.prototype.showModal=function(){this.open=true;};HTMLElement.prototype.close=function(){this.open=false;};
  const context=vm.createContext({document,Map,Math,window:{addEventListener(){}},history:{state:{},pushState(){},back(){}},location:{href:'https://image.test/'},ResizeObserver:class{observe(){}disconnect(){}}});
  vm.runInContext(fs.readFileSync(require.resolve('../static/viewer.js'),'utf8'),context);
  const viewer=context.StudioViewer;viewer.open({id:'source',url:'/media/source',width:1000,height:800});
  Object.defineProperties(viewer.stage,{clientWidth:{value:400},clientHeight:{value:600}});
  viewer.stage.getBoundingClientRect=()=>({left:0,top:0,width:400,height:600});viewer.stage.setPointerCapture=()=>{};viewer.layout();
  return {viewer,geometry:context.StudioViewGeometry,document};
}
const pointer=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,pointerType:'touch',preventDefault(){}});
test('rectangle coordinates remain native pixels after zoom and pan, including reverse drags',()=>{
  const {viewer,geometry}=fixture();viewer.setZoom(3);viewer.x=130;viewer.y=-90;viewer.paint();viewer.action('edit');
  const scale=viewer.base*viewer.zoom,screen=(x,y)=>({x:200+viewer.x+(x-500)*scale,y:300+viewer.y+(y-400)*scale});
  const a=screen(600,500),b=screen(300,250);viewer.down(pointer(1,a.x,a.y));viewer.move(pointer(1,b.x,b.y));viewer.up(pointer(1,b.x,b.y));
  assert.deepEqual(JSON.parse(JSON.stringify(viewer.region)),{x:300,y:250,width:300,height:250});
  const clipped=geometry.project({x:1e8,y:-1e8},{x:0,y:0,scale:1},{width:1000,height:800});assert.equal(clipped.x,1000);assert.equal(clipped.y,0);
});
test('two-finger pinch changes zoom without accidentally replacing the selected rectangle',()=>{
  const {viewer}=fixture();viewer.action('edit');viewer.region={x:100,y:100,width:200,height:200};
  viewer.down(pointer(1,150,300));viewer.down(pointer(2,250,300));viewer.move(pointer(2,350,300));
  assert.equal(viewer.zoom,2);assert.equal(viewer.region.width,200);
  viewer.up(pointer(2,350,300));const x=viewer.x;viewer.move(pointer(1,160,300));assert.equal(viewer.x,x+10);
});
test('submission requires a meaningful rectangle and forwards the native bounds and trimmed brief',async()=>{
  const {viewer}=fixture();let received;viewer.options.onSubmit=async body=>received=body;viewer.action('edit');
  viewer.region={x:20,y:30,width:10,height:20};viewer.dialog.querySelector('textarea').value='  修改花朵  ';viewer.updateSelection();assert.equal(viewer.dialog.querySelector('.viewer-submit').disabled,true);
  viewer.region.width=80;viewer.updateSelection();await viewer.submit();
  assert.equal(received.prompt,'修改花朵');assert.equal(received.region.width,80);assert.equal(received.region.x,20);assert.equal(received.asset.id,'source');
});
