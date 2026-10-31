const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {parseHTML}=require('linkedom');
async function fixture(){
  const {document,HTMLElement}=parseHTML('<html><body><div id="app"></div><div id="toast"></div><dialog id="modal"><div id="modal-content"></div></dialog></body></html>');
  HTMLElement.prototype.showModal=function(){this.open=true;};HTMLElement.prototype.close=function(){this.open=false;};HTMLElement.prototype.scrollIntoView=function(){};
  const preferences={defaults:{ratio:'1:1',size:'auto',count:1,polish:false,transparent:false,stitch:0},quick:{model:null,effort:null,use_source_template:true,polish:false},upscale:{factor:4,auto_select:true,default_injection:''},motion:false,notify:false};
  const config={preferences,model:'gpt-6.1-sol',effort:'xhigh',concurrency:2,max_attempts:3,paused:false,counts:[]},calls=[];let infoResolve;
  const response=data=>({ok:true,json:async()=>data});
  const fetch=async(path,options={})=>{calls.push({path,options});if(path==='/api/auth/state')return response({authenticated:false,initialized:true});
    if(path==='/api/settings'&&options.method==='PATCH'){await new Promise(setImmediate);Object.assign(preferences,JSON.parse(options.body));return response({ok:true});}
    if(path==='/api/settings')return response({...preferences,call_prompt:'instruction {prompt}',polish_prompt:'polish instruction {prompt}',stitch_prompt:'redraw instruction {prompt}',variables:['{prompt}']});
    if(path==='/api/account')return response({username:'test',session_count:1});
    if(path==='/api/setup/status')return response({authenticated:true,version:'fixture'});
    if(path==='/api/jobs'&&options.method==='POST')return response({ids:['one','two','three'],batch_id:'batch',collection_id:'untemplated'});
    if(path.startsWith('/api/jobs?'))return response({items:[],total:0});
    if(path.startsWith('/api/collections'))return response({items:[],total:0});
    if(path==='/api/state')return response(config);
    if(path==='/api/assets/a/info')return new Promise(resolve=>{infoResolve=data=>resolve(response(data));});
    throw new Error('unexpected request: '+path);
  };
  const context=vm.createContext({document,window:{addEventListener(){},scrollTo(){},scrollY:0},navigator:{onLine:true},history:{state:{},pushState(){},replaceState(){},back(){}},location:{href:'https://image.test'},localStorage:{getItem(){return null;},setItem(){}},matchMedia:()=>({matches:false}),requestAnimationFrame:fn=>fn(),fetch,FormData:class{},setTimeout,clearTimeout,setInterval(){},console,Map,WeakMap,Set,Event:document.defaultView.Event,
    StudioImages:{async clear(){},hydrate(){},markup(){return '';},async status(){return {bytes:0};}},StudioUpscale:{async renderStorage(){}},StudioViewer:{isOpen:false},StudioPolish:{markup(){return '';}}});
  for(const file of ['dom','navigation','tasks','settings','workspace','app'])vm.runInContext(fs.readFileSync(require.resolve(`../static/${file}.js`),'utf8'),context);
  await new Promise(setImmediate);
  vm.runInContext(`S.auth={authenticated:true,username:'test'};S.config=${JSON.stringify(config)};S.setup={authenticated:true};S.page='create';renderShell();renderCreate();`,context);
  return {context,document,preferences,calls,resolveInfo:data=>infoResolve(data)};
}
test('generate preserves the draft and page, and exposes the returned batch as inline feedback',async()=>{
  const f=await fixture();await vm.runInContext("S.prompt='mountain light';S.count=3;generate()",f.context);
  assert.equal(vm.runInContext('S.page',f.context),'create');assert.equal(vm.runInContext('S.prompt',f.context),'mountain light');
  assert.equal(vm.runInContext('S.lastSubmission.batch_id',f.context),'batch');assert.match(f.document.getElementById('submission-status').textContent,/已加入 3 张/);
  assert.equal(f.calls.filter(c=>c.path==='/api/jobs'&&c.options.method==='POST').length,1);
});
test('a late image-info response cannot replace another panel the user has opened',async()=>{
  const f=await fixture(),pending=f.context.StudioWorkspace.info('a');
  f.context.StudioPanels.show('another panel','<input value="unfinished draft">');
  f.resolveInfo({asset:{id:'a'},job:null});await pending;
  assert.match(f.document.querySelector('.modal-head').textContent,/another panel/);assert.equal(f.document.querySelector('#modal input').value,'unfinished draft');
});
test('rapid preference changes merge in request order rather than overwriting another field',async()=>{
  const f=await fixture();vm.runInContext("S.page='settings'",f.context);await f.context.StudioSettings.render();
  await Promise.all([f.context.StudioSettings.save('defaults.ratio','3:2'),f.context.StudioSettings.save('defaults.count',5)]);
  assert.equal(f.preferences.defaults.ratio,'3:2');assert.equal(f.preferences.defaults.count,5);
});
