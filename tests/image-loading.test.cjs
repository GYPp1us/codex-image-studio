const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');const {parseHTML}=require('linkedom');
function fixture(){
  const {document,Event}=parseHTML('<html><body><span data-image-view class="detail-image-frame"><img data-full-image width="720" height="1080" src="/media/example"></span></body></html>');
  const listeners={};const context=vm.createContext({document,navigator:{serviceWorker:{addEventListener:(name,fn)=>listeners[name]=fn}},location:{href:'https://image.test/'},URL,setTimeout,clearTimeout,MessageChannel});
  vm.runInContext(fs.readFileSync(require.resolve('../static/image-cache.js'),'utf8'),context);
  const frame=document.querySelector('[data-image-view]'),image=frame.querySelector('img');frame.insertAdjacentHTML('beforeend',context.StudioImages.markup());
  Object.defineProperties(image,{complete:{value:false,writable:true},naturalWidth:{value:0,writable:true}});
  context.StudioImages.hydrate(document);return {document,image,frame,Event,manager:context.StudioImages,progress:data=>listeners.message({data:{type:'IMAGE_PROGRESS',url:'https://image.test/media/example',...data}})};
}
test('the full image frame reserves its real aspect ratio before data arrives and keeps it through progress',()=>{
  const f=fixture();assert.equal(f.frame.style.aspectRatio,'720 / 1080');assert.equal(f.frame.querySelector('.image-download-status').hidden,false);
  f.progress({loaded:1048576,total:4194304,done:false});assert.match(f.frame.textContent,/25%/);assert.equal(f.frame.querySelector('[role=progressbar]').getAttribute('aria-valuenow'),'25');
  f.manager.hydrate(f.document);assert.equal(f.frame.style.aspectRatio,'720 / 1080');assert.match(f.frame.textContent,/25%/);
  f.image.complete=true;f.image.naturalWidth=720;f.image.dispatchEvent(new f.Event('load'));
  assert.equal(f.frame.querySelector('.image-download-status').hidden,true);assert.equal(f.frame.style.aspectRatio,'720 / 1080');
});
test('unknown lengths and load errors keep the same frame and show useful status',()=>{
  const f=fixture();f.progress({loaded:1024,total:0,done:false});assert.equal(f.frame.querySelector('[role=progressbar]').getAttribute('aria-valuenow'),null);
  f.image.dispatchEvent(new f.Event('error'));assert.match(f.frame.textContent,/加载失败/);assert.equal(f.frame.style.aspectRatio,'720 / 1080');
});
