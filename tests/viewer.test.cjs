const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {parseHTML}=require('linkedom');
function fixture(){
  const {document,HTMLElement}=parseHTML('<html><body></body></html>');
  HTMLElement.prototype.showModal=function(){this.open=true;};HTMLElement.prototype.close=function(){this.open=false;};
  const context=vm.createContext({document,Map,Math,setTimeout,clearTimeout,window:{addEventListener(){}},history:{state:{},pushState(){},back(){}},location:{href:'https://image.test/'},ResizeObserver:class{observe(){}disconnect(){}}});
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

test('huge images use a bounded preview and visible native tiles, including the partial right edge',()=>{
  const {viewer}=fixture();
  viewer.open({id:'large',url:'/media/large',preview:'/media/large?preview=1',width:40001,height:1801,tile_template:'/api/assets/large/tiles/{level}/{x}/{y}'});
  Object.defineProperties(viewer.stage,{clientWidth:{value:400},clientHeight:{value:600}});viewer.layout();viewer.action('native');
  assert.equal(viewer.image.getAttribute('src'),'/media/large?preview=1');
  assert.ok(Math.abs(viewer.base*viewer.zoom-1)<1e-8);
  viewer.x=-(40001-400)/2;viewer.paint();viewer.paintTiles();
  assert.ok(viewer.tileImages.size>0&&viewer.tileImages.size<=12);
  const right=[...viewer.tileImages.entries()].find(([key])=>key.includes('/78/'))?.[1];
  assert.ok(right);assert.ok(parseFloat(right.style.width)<100*512/40001);
  viewer.close(false);
});

test('multiple rectangles keep individual prompts and reject overlapping selections before submission',async()=>{
  const {viewer}=fixture();let received;viewer.options.onSubmit=async body=>received=body;viewer.action('edit');
  viewer.dialog.querySelector('.viewer-shared').checked=false;
  viewer.dialog.querySelector('.viewer-prompt').value='blue flowers';viewer.region={x:10,y:20,width:80,height:60};viewer.updateSelection();viewer.action('add-region');
  viewer.region={x:40,y:30,width:80,height:60};viewer.updateSelection();assert.equal(viewer.dialog.querySelector('.viewer-submit').disabled,true);
  viewer.region={x:240,y:200,width:90,height:80};viewer.dialog.querySelector('.viewer-prompt').value='green leaves';viewer.updateSelection();await viewer.submit();
  assert.equal(received.regions.length,2);assert.equal(received.regions[0].prompt,'blue flowers');assert.equal(received.regions[1].prompt,'green leaves');assert.equal(received.region,undefined);
});

test('viewer next and previous switch image identity and quick-edit uses the current source',async()=>{
  const {viewer}=fixture();let requested;const source=viewer.asset,other={id:'next-image',url:'/media/next-image',width:503,height:751};
  viewer.options.sequence=[source,other];viewer.options.onAction=async(...args)=>requested=args;
  viewer.change(1);assert.equal(viewer.asset.id,'next-image');assert.match(viewer.dialog.querySelector('.viewer-quick-spec').textContent,/503 × 751/);
  viewer.dialog.querySelector('.viewer-quick-prompt').value='  make it evening  ';await viewer.dialog.querySelector('.viewer-quick').onsubmit({preventDefault(){}});
  assert.equal(requested[0],'quick-edit');assert.equal(requested[1].id,'next-image');assert.equal(requested[2],'make it evening');
  viewer.change(-1);assert.equal(viewer.asset.id,'source');
});
