const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

async function seed(context,base){
  const pins=[
    ['count',3,'3 张'],['ratio','1:1',''],['size','2048',''],['ratio','3:2',''],
    ['count',6,'6 张'],['image_model','gpt-image-2.6-sunburst',''],
    ['ratio','9:16',''],['image_model','gpt-image-2.6-flare',''],['partial_images',1,''],
  ].map(([key,value,label])=>({key,value,label}));
  const settings=await context.request.patch(base+'/api/settings',{headers:{'X-CSRF-Token':'fixture-csrf'},data:{quick_settings:pins}});
  assert.equal(settings.status(),200);
}

async function check(page,context,base){
  const engine=context.browser().browserType().name();
  const activate=button=>engine==='webkit'?button.click():button.tap();
  const theme=process.env.STUDIO_QA_SCHEME||'dark';
  await page.emulateMedia({colorScheme:theme});
  const viewport=Number(process.env.STUDIO_QA_WIDTH||390);
  if(viewport!==390)await page.setViewportSize({width:viewport,height:844});
  const dir=process.env.STUDIO_QA_SCREENSHOTS;
  async function capture(name){
    if(!dir)return;
    await page.locator('#toast .toast').waitFor({state:'hidden'});
    await fs.mkdir(dir,{recursive:true});
    await page.screenshot({path:path.join(dir,name+'.png'),animations:'disabled'});
  }
  const strip=page.locator('.quick-strip'),count=strip.locator('[data-quick-unit=count]'),ratio=strip.locator('[data-quick-unit=ratio]');
  assert.equal(await count.count(),1);
  assert.equal(await count.locator('output').textContent(),'1 张');
  assert.equal(await count.getByRole('button',{name:'减少数量'}).isDisabled(),true);
  await activate(count.getByRole('button',{name:'增加数量'}));
  assert.equal(await count.locator('output').textContent(),'2 张');
  await activate(ratio.getByRole('button',{name:'3:2'}));
  await ratio.locator('[data-quick-id="ratio=3:2"][aria-pressed=true]').waitFor();
  assert.equal(await ratio.getByRole('button',{name:'1:1'}).getAttribute('aria-pressed'),'false');
  await strip.scrollIntoViewIfNeeded();
  await capture('01-quick-settings');

  const choice=ratio.getByRole('button',{name:'3:2'});
  if(engine==='chromium'&&viewport===390){
    const cdp=await context.newCDPSession(page);
    const rect=await choice.boundingBox(),start={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    const left=(await strip.boundingBox()).x;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
    const ghost=page.locator('.quick-drag-ghost[data-quick-kind=group]');
    await ghost.waitFor();
    assert.deepEqual(await ghost.locator('.quick-choices button').allTextContents(),['1:1','3:2','9:16']);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:left+21,y:start.y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>document.querySelector('.quick-strip').firstElementChild.dataset.quickUnit==='ratio');
    await page.waitForFunction(()=>!document.querySelector('.quick-save-state').textContent);
    await choice.press('Alt+ArrowRight');
    await page.waitForFunction(()=>document.querySelector('.quick-strip').firstElementChild.dataset.quickUnit==='count'&&!document.querySelector('.quick-save-state').textContent);
    await cdp.detach();
  }
  await choice.press('Shift+F10');
  const editor=page.locator('.quick-editor');
  await editor.getByRole('button',{name:'整组后移'}).waitFor();
  await capture('02-group-edit');
  await activate(editor.getByRole('button',{name:'整组后移'}));
  await page.waitForFunction(()=>[...document.querySelector('.quick-strip').children].map(unit=>unit.dataset.quickUnit).slice(0,3).join()=== 'count,size,ratio');
  await activate(editor.getByRole('button',{name:'关闭',exact:true}));
  await editor.waitFor({state:'hidden'});
  await page.waitForLoadState('networkidle');
  await page.reload();
  await strip.waitFor();
  assert.equal(await count.locator('output').textContent(),'2 张');
  assert.deepEqual(await strip.locator('[data-quick-unit]').evaluateAll(units=>units.slice(0,3).map(unit=>unit.dataset.quickUnit)),['count','size','ratio']);
  assert.deepEqual(await ratio.locator('[data-quick-id]').allTextContents(),['1:1','3:2','9:16']);

  await activate(page.locator('#page [data-act=me]'));
  await activate(page.locator('.sheet [data-act=settings]'));
  const settingsGroup=page.locator('#set-image-source');
  await settingsGroup.scrollIntoViewIfNeeded();
  await capture('03-settings-entry');
  await activate(settingsGroup.locator('[data-act=image-api]'));
  const form=page.locator('.provider-form'),address=form.getByLabel('API 地址'),model=form.getByLabel('模型 ID'),key=form.getByLabel('API 密钥');
  await address.fill('https://api.example.com/v1/');
  await model.fill('gpt-image-2');
  await key.fill('fixture-invalid-key');
  let probes=0,generated=0;
  page.on('request',request=>{
    const pathname=new URL(request.url()).pathname;
    if(request.method()!=='POST')return;
    if(pathname==='/api/jobs')generated++;
    if(pathname==='/api/settings/image-api/test')probes++;
  });
  const test=form.getByRole('button',{name:'测试连接'});
  await activate(test);await form.locator('[data-tone=failed]').waitFor();
  assert.equal(await key.inputValue(),'fixture-invalid-key');
  await capture('04-connection-error');
  await key.fill('fixture-provider-key');
  await activate(test);await form.locator('[data-tone=ok]').waitFor();
  assert.equal(generated,0);
  await capture('05-connection-ok');
  await activate(form.getByRole('button',{name:'保存',exact:true}));
  await form.waitFor({state:'hidden'});
  assert.equal(await settingsGroup.locator('[data-image-api-label]').textContent(),'gpt-image-2');
  const stored=await (await context.request.get(base+'/api/settings')).json();
  assert.equal(stored.image_api.base_url,'https://api.example.com/v1');
  assert.equal(JSON.stringify(stored).includes('fixture-provider-key'),false);
  await activate(settingsGroup.locator('[data-act=image-api]'));
  await form.waitFor();
  assert.equal(await key.inputValue(),'');
  await activate(page.locator('.provider-sheet button[aria-label=关闭]'));
  await form.waitFor({state:'hidden'});
  await activate(page.locator('.settings [data-act=scr-back]'));
  await page.locator('.settings').waitFor({state:'hidden'});

  await activate(page.locator('.gen-bar [data-act=params]'));
  const parameters=page.getByRole('dialog',{name:'生成参数',exact:true});
  const source=parameters.locator('[data-k=source][data-v=api]');
  await activate(source);
  await parameters.locator('[data-k=source][data-v=api][aria-pressed=true]').waitFor();
  assert.equal(await parameters.locator('[data-act=image-api]').textContent(),'图片模型gpt-image-2');
  assert.equal(await parameters.locator('[data-k=image_model]:visible').count(),0);
  assert.equal(await parameters.locator('[data-k=quality]:visible').count(),4);
  assert.equal(await parameters.locator('[data-k=quality][data-v=auto]').getAttribute('aria-pressed'),'true');
  await capture('06-composer-api');
  await activate(parameters.getByRole('button',{name:'关闭',exact:true}));
  await parameters.waitFor({state:'hidden'});
  assert.match(await page.locator('#sum2').textContent(),/^第三方 API/);
  await page.locator('#prompt').fill('验收用图片描述');
  const queued=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/jobs');
  await activate(page.locator('#gen'));
  const response=await queued;
  assert.equal(response.status(),200,await response.text());
  assert.equal(response.request().postDataJSON().image_backend.source,'api');
  assert.equal((await response.json()).ids.length,2);
  assert.equal(probes,2);

  await page.setViewportSize({width:844,height:390});
  const landscape=page.locator('#landscape-parameters');
  await landscape.locator('[data-k=source][data-v=api][aria-pressed=true]').waitFor();
  assert.equal(await landscape.locator('[data-act=image-api]').isVisible(),true);
  await capture('07-landscape');
  console.log('Passed legacy shortcuts, numeric controls, grouped order, API settings, drafting, and job submission.');
}

module.exports={seed,check};
