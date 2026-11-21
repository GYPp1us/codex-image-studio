/* Usage: install Playwright separately, set STUDIO_QA_PYTHON and run node tests/library-browser.cjs. */
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..');
const port=Number(process.env.STUDIO_QA_PORT||18788),base='http://127.0.0.1:'+port;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
  const server=cp.spawn(process.env.STUDIO_QA_PYTHON||'python',['tests/library_browser_fixture.py','--port',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','ignore','inherit']});
  let browser;
  try{
    for(let i=0;i<120;i++){if(server.exitCode!==null)throw Error('fixture exited '+server.exitCode);try{if((await fetch(base+'/api/health')).ok)break;}catch{}await pause(100);}
    const safari=process.argv.includes('--webkit');
    browser=await(safari?webkit:chromium).launch(safari?{}:{channel:'chrome',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
    const startup=process.argv.includes('--startup');
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:startup?'allow':'block'});
    await context.addCookies([{name:'studio_session',value:'fixture-local-session',url:base}]);
    const page=await context.newPage(),errors=[],posts=[],reads=[];
    page.on('pageerror',e=>{errors.push(e.message);console.error('page error',e.message);});page.on('request',req=>{const p=new URL(req.url()).pathname;if(req.method()==='POST')posts.push(p);else reads.push(p);});
    page.setDefaultTimeout(10000);
    const id=i=>i.toString(16).padStart(32,'0'),tile=i=>page.locator('#grid .tile[data-id="'+id(i)+'"]');
    if(startup){
      const cdp=await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:200,downloadThroughput:200000,uploadThroughput:100000,connectionType:'cellular3g'});
      await page.addInitScript(()=>{
        window.composerPainted=new Promise(resolve=>{
          const observer=new MutationObserver(()=>{
            if(!document.querySelector('#prompt')||document.querySelector('#tabbar')?.hidden)return;
            observer.disconnect();requestAnimationFrame(()=>resolve(Math.round(performance.now())));
          });
          observer.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
        });
      });
      await page.goto(base);
      const coldMs=await page.evaluate(()=>window.composerPainted);
      await page.waitForFunction(async()=>{
        if(!navigator.serviceWorker.controller)return false;
        const cache=await caches.open('studio-shell-v1');
        return (await cache.keys()).length>=3&&!!(await cache.match('/'));
      });
      await page.reload();
      const warmMs=await page.evaluate(()=>window.composerPainted);
      console.log(JSON.stringify({coldMs,warmMs,directoriesFetched:reads.includes('/api/library')}));
      assert.equal(reads.includes('/api/library'),false);assert.ok(warmMs<=700,'cached composer startup '+warmMs+' ms');assert.deepEqual(errors,[]);return;
    }
    await page.goto(base);await page.locator('#prompt').waitFor();
    assert.ok(!reads.includes('/api/collections')&&!reads.includes('/api/library'),'composer fetched library at startup');
    if(process.argv.includes('--quality')){await require('./library-quality.cjs').quality(page,context,base);assert.deepEqual(errors,[]);return;}
    await page.locator('[data-act=tab][data-tab=works]').click();
    await page.locator('[data-dir=open][data-id="tpl-A"]').first().click();
    await tile(30).waitFor();
    if(safari)await tile(1).click({modifiers:['Control']});
    else{
      const cd=await context.newCDPSession(page);
      const box=await tile(1).boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2};
      await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await pause(470);
      await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    assert.equal(await page.locator('.selection-count').textContent(),'已选 1 张');
    await tile(30).click({modifiers:['Shift']});
    assert.equal(await page.locator('.selection-count').textContent(),'已选 30 张');
    await page.locator('#selection-toolbar [data-dir=create]').click();
    await page.getByRole('textbox',{name:'文件夹名称'}).fill('抽卡候选');
    await page.route('**/api/library/operations',async route=>{
      const saved=await route.fetch();
      assert.equal(saved.status(),200);
      await route.abort('connectionreset');
    },{times:1});
    await page.getByRole('textbox',{name:'文件夹名称'}).press('Enter');
    await page.waitForFunction(()=>document.querySelector('.dir-feedback')?.textContent.trim());
    assert.equal(await page.locator('.selection-count').textContent(),'已选 30 张');
    await page.locator('.dir-form [type=submit]').click();
    const group=page.locator('.dir-card').filter({hasText:'抽卡候选'});
    try{await group.waitFor();}catch(error){
      console.error({posts,reads:reads.filter(s=>s.startsWith('/api/library')),state:await page.evaluate(()=>({
        location:S.coll,tab:S.tab,hidden:document.hidden,history:history.state?.depth,notice:document.querySelector('.dir-feedback')?.textContent,
        toast:document.querySelector('#toast')?.textContent,page:document.querySelector('#page')?.textContent.slice(0,280),
        selection:StudioSelection.chosen().length,folders:StudioFolders.page('tpl-A').folders,errors:StudioFolders.page('tpl-A').errors,
        layers:layers.map(l=>l.type),groups:[...document.querySelectorAll('.dir-card')].map(e=>e.textContent).slice(0,4)
      }))});throw error;
    }
    assert.equal(posts.filter(s=>s==='/api/library/operations').length,1);
    assert.ok(reads.some(s=>s.startsWith('/api/library/operations/')),'retried by reading the operation receipt');
    await group.click();await tile(1).waitFor();
    assert.equal(await page.locator('#grid .tile').count(),30);
    await page.locator('#dir-path [data-dir=ancestor][data-id="tpl-A"]').click();
    await group.waitFor();assert.equal(await page.locator('#grid .tile[data-id="'+id(1)+'"]').count(),0);
    await group.click();await page.locator('[data-dir=menu]').click();await page.locator('[data-dir=recipe]').click();
    await page.locator('.dir-form textarea').fill('新的子模板');await page.locator('.dir-form [type=submit]').click();
    await page.locator('.dir-form').waitFor({state:'detached'});
    await page.locator('[data-dir=menu]').click();await page.locator('[data-dir=detach-folder]').click();
    await page.locator('.dir-form [type=submit]').click();
    await page.waitForFunction(()=>!document.querySelector('#dir-path [data-id="tpl-A"]'));
    await page.locator('#dir-path [data-id=""]').click();await group.waitFor();
    await page.locator('[data-dir=all]').click();await page.locator('[data-dir=filter]').click();
    await page.locator('[data-dir=origin][data-id=A]').click();await tile(1).waitFor();
    await tile(1).click();await page.locator('#viewer.open').waitFor();
    await page.locator('#viewer [data-act=v-back]').click();
    await page.locator('#viewer.open').waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({engine:safari?'WebKit':'Chrome',passed:'group 30; recipe; detach; origin; viewer; history',writes:posts.length}));
  }finally{if(browser)await browser.close();server.kill();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
