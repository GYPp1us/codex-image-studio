/* Browser acceptance against tests/library_browser_fixture.py. Called by library-browser.cjs. */
const assert=require('node:assert/strict');
const http=require('node:http');
const {performance}=require('node:perf_hooks');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const id=i=>i.toString(16).padStart(32,'0');
async function quality(page,context,base){
  const cdp=await context.newCDPSession(page);
  const tile=n=>page.locator('#grid .tile[data-id="'+id(n)+'"]');
  const chosen=()=>page.evaluate(()=>StudioSelection.chosen());
  const tap=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(({x,y},i)=>({x,y,id:i+1}))});
  const point=async el=>{const b=await el.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
  const readOnly=()=>page.locator('#page .net-status');
  await page.locator('[data-act=tab][data-tab=works]').click();
  await page.locator('.dir-card[data-id=tpl-A]').click();await tile(30).waitFor();
  await tile(20).click({modifiers:['Control']});await page.locator('.dir-scroll').evaluate(el=>el.scrollTop=0);
  console.log('checking touch range');const start=await point(tile(5)),far=await point(tile(12)),near=await point(tile(9));
  await tap('touchStart',[start]);await wait(460);await tap('touchMove',[far]);await wait(50);await tap('touchMove',[near]);await wait(50);await tap('touchEnd',[]);
  assert.deepEqual((await chosen()).sort(),[5,6,7,8,9,20].map(id).sort(),'range shrinks to original union');
  await tap('touchStart',[start]);await wait(460);await tap('touchMove',[near]);await wait(40);await tap('touchCancel',[]);
  assert.deepEqual((await chosen()).sort(),[5,6,7,8,9,20].map(id).sort(),'cancel restores only this stroke');
  await tap('touchStart',[start]);await wait(460);await tap('touchMove',[near]);await wait(30);await tap('touchEnd',[]);
  assert.deepEqual(await chosen(),[id(20)],'already selected start subtracts range');
  await page.locator('[data-selection=exit]').click();
  await tap('touchStart',[await point(tile(1))]);await wait(460);
  const edge=await page.evaluate(()=>{const r=document.querySelector('.dir-scroll').getBoundingClientRect(),b=document.querySelector('#selection-toolbar').getBoundingClientRect();return {x:r.left+r.width/2,y:Math.min(r.bottom,b.top)-6};});
  await tap('touchMove',[edge]);await page.waitForFunction(()=>{const e=document.querySelector('.dir-scroll');return e.scrollTop>=e.clientHeight*3;},null,{timeout:10000});await tap('touchEnd',[]);
  console.log('crossed three viewports');const selectedAfterScroll=await chosen(),stop=await page.locator('.dir-scroll').evaluate(e=>e.scrollTop);
  await wait(160);assert.deepEqual(await chosen(),selectedAfterScroll);assert.equal(await page.locator('.dir-scroll').evaluate(e=>e.scrollTop),stop);
  assert.ok(selectedAfterScroll.length>30,'drag crossed a page boundary');
  await page.locator('[data-selection=exit]').click();
  await page.locator('.dir-scroll').evaluate(e=>e.scrollTop=0);
  await tile(1).click({modifiers:['Control']});await tile(30).click({modifiers:['Shift']});assert.equal((await chosen()).length,30);

  const relay=http.createServer((req,res)=>{
    const upstream=http.request(base+req.url,{method:req.method,headers:{...req.headers,host:new URL(base).host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
  });
  await new Promise(r=>relay.listen(0,'127.0.0.1',r));
  let mode='direct',held=[],forwarded=0,batches=0;
  const relayURL='http://127.0.0.1:'+relay.address().port,networkResults=[];
  const routeHandler=async route=>{
    const u=new URL(route.request().url());
    if(mode==='blackhole'){held.push(route);return;}
    if(mode==='gallery'&&u.pathname==='/api/library'){await route.fulfill({status:503,json:{detail:'gallery temporarily unavailable'}});return;}
    if(mode==='proxy'){
      forwarded++;
      try{const response=await route.fetch({url:relayURL+u.pathname+u.search,timeout:4000});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}
    }else await route.continue().catch(()=>{});
  };
  page.on('response',res=>{if(res.ok()&&new URL(res.url()).pathname==='/api/batches')batches++;});
  await page.route('**/api/**',routeHandler);
  try{
    for(const target of ['proxy','direct']){console.log('testing recovery via '+target);
      await page.waitForResponse(res=>res.ok()&&new URL(res.url()).pathname==='/api/batches');await wait(40);
      mode='blackhole';
      await page.evaluate(()=>{const began=performance.now();window.rcDetection=new Promise(resolve=>{
        const observer=new MutationObserver(()=>{if(S.network?.phase==='retrying'&&document.querySelector('.net-status [data-act=reconnect]')){observer.disconnect();resolve(Math.round(performance.now()-began));}});
        observer.observe(document.querySelector('#page'),{subtree:true,childList:true});
      });});
      await readOnly().getByRole('button',{name:'重新连接工作台'}).waitFor({timeout:7800});
      const detected=await page.evaluate(()=>window.rcDetection),before=batches,recoveredAt=performance.now();
      mode=target;
      await page.waitForFunction(()=>S.network?.phase==='online'&&!S.network.pageSlow,{},{timeout:10000});
      assert.ok(batches>before);assert.equal((await chosen()).length,30);assert.equal(await page.evaluate(()=>navigator.onLine),true);
      networkResults.push({target,detectedMs:detected,recoveredMs:Math.round(performance.now()-recoveredAt)});
      for(const h of held.splice(0))await h.abort().catch(()=>{});
    }
    console.log('testing isolated gallery failure');assert.ok(forwarded>0);mode='gallery';
    await page.evaluate(()=>StudioFolders.resume().catch(()=>{}));
    await page.getByText('作品同步中',{exact:true}).waitFor();
    const before=batches;await page.waitForResponse(res=>res.ok()&&new URL(res.url()).pathname==='/api/batches');
    assert.ok(batches>before);assert.equal(await page.evaluate(()=>S.offline),false);
  }finally{
    mode='direct';for(const h of held)await h.abort().catch(()=>{});
    await page.unroute('**/api/**',routeHandler);relay.closeAllConnections();await new Promise(r=>relay.close(r));
  }
  await page.locator('[data-selection=exit]').click();
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:200,downloadThroughput:200000,uploadThroughput:100000,connectionType:'cellular3g'});
  await page.evaluate(()=>{
    window.rcFrames=[];window.rcInput=[];window.rcWindow=false;
    let last=0;function frame(t){if(last&&window.rcWindow&&t<=window.rcUntil)window.rcFrames.push(t-last);last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);
    document.addEventListener('click',e=>{if(!e.target.closest('[data-dir]'))return;const t=performance.now();window.rcUntil=t+240;requestAnimationFrame(()=>window.rcInput.push(performance.now()-t));},true);
  });
  for(let i=0;i<6;i++){
    await page.evaluate(()=>window.rcWindow=true);
    await page.locator('#dir-path [data-id=""]').click();
    await page.locator('.dir-card[data-id=tpl-A]').click();
    await tile(1).waitFor();await wait(220);
  }
  console.log('collected throttled frames');const samples=await page.evaluate(()=>{window.rcWindow=false;return {frames:window.rcFrames,input:window.rcInput};});
  const metrics={feedbackP95Ms:percentile(samples.input,.95),frameP95Ms:percentile(samples.frames,.95),frames:samples.frames.length,clicks:samples.input.length};
  console.log(JSON.stringify({sweepCount:selectedAfterScroll.length,networkResults,metrics}));
  assert.ok(networkResults.every(r=>r.detectedMs<=7000&&r.recoveredMs<=10000));
  assert.ok(metrics.feedbackP95Ms<=100&&metrics.frameP95Ms<=20,'weak-network frame budget '+JSON.stringify(metrics));
}
module.exports={quality};
