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
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'block'});
    await context.addCookies([{name:'studio_session',value:'fixture-local-session',url:base}]);
    const page=await context.newPage(),errors=[],posts=[],reads=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{const p=new URL(req.url()).pathname;if(req.method()==='POST')posts.push(p);else reads.push(p);});
    page.setDefaultTimeout(10000);
    const id=i=>i.toString(16).padStart(32,'0'),tile=i=>page.locator('#grid .tile[data-id="'+id(i)+'"]');
    await page.goto(base);await page.locator('#prompt').waitFor();
    assert.ok(!reads.includes('/api/collections')&&!reads.includes('/api/library'),'composer fetched library at startup');
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
    await page.getByRole('textbox',{name:'文件夹名称'}).press('Enter');
    const group=page.locator('.dir-card').filter({hasText:'抽卡候选'});
    await group.waitFor();assert.equal(posts.filter(s=>s==='/api/library/operations').length,1);
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
