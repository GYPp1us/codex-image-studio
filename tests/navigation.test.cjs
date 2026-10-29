const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {parseHTML}=require('linkedom');
function fixture(){
  const {document,HTMLElement}=parseHTML('<html><body><dialog id="modal"></dialog></body></html>'),listeners={};
  HTMLElement.prototype.showModal=function(){this.open=true;};HTMLElement.prototype.close=function(){this.open=false;};
  const entries=[{studioDepth:0}];let index=0,backs=0;
  const history={get state(){return entries[index];},pushState(value){entries.splice(++index);entries[index]=value;},replaceState(value){entries[index]=value;},back(){backs++;}};
  const context=vm.createContext({document,window:{addEventListener(type,listener){listeners[type]=listener;}},history,location:{href:'https://image.test'},esc:String,icon:()=>'',Map,WeakMap});
  vm.runInContext(fs.readFileSync(require.resolve('../static/navigation.js'),'utf8'),context);
  return {layers:context.StudioLayers,panels:context.StudioPanels,document,history,
    flush(){while(backs){backs--;index=Math.max(0,index-1);listeners.popstate({state:entries[index]});}},
    browserBack(){index=Math.max(0,index-1);listeners.popstate({state:entries[index]});}};
}
test('browser back removes one layer at a time from panel through viewer and collection',()=>{
  const f=fixture(),closed=[];for(const name of ['collection','viewer','panel'])f.layers.push(name,()=>closed.push(name));
  f.browserBack();assert.deepEqual(closed,['panel']);assert.equal(f.layers.top,'viewer');
  f.browserBack();assert.deepEqual(closed,['panel','viewer']);assert.equal(f.layers.top,'collection');
  f.browserBack();assert.equal(f.layers.depth,0);
});
test('rapidly closing two layers then opening another serializes history without losing the collection',()=>{
  const f=fixture(),closed=[];for(const name of ['collection','viewer','panel'])f.layers.push(name,()=>closed.push(name));
  f.layers.close('panel');f.layers.close('viewer');f.layers.push('viewer',()=>closed.push('new viewer'));f.flush();
  assert.deepEqual(closed,['panel','viewer']);assert.equal(f.layers.depth,2);assert.equal(f.history.state.studioDepth,2);
  f.browserBack();assert.equal(f.layers.top,'collection');assert.deepEqual(closed,['panel','viewer','new viewer']);
});
test('switching panel content keeps one panel and one history entry',()=>{
  const f=fixture();f.panels.show('First','<input value="draft">');f.panels.show('Next','<p>next step</p>');
  assert.equal(f.layers.depth,1);assert.equal(f.document.querySelectorAll('dialog').length,1);assert.match(f.document.getElementById('modal').textContent,/Next/);
  f.panels.close();f.flush();assert.equal(f.layers.depth,0);assert.equal(f.document.getElementById('modal').open,false);
});
