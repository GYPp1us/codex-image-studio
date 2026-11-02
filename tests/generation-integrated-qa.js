(async()=>{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),results={},fakeId='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',assetId='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
 const call={schema:3,id:'callfixture',scope:'image-1',kind:'image',status:'succeeded',created:1,updated:1,requested:{image_model:'gpt-image-test',quality:'max'},provider_reported:{quality:'low'},actual_image:{width:1,height:1}};
 const job={id:fakeId,batch_id:'cccccccccccccccccccccccccccccccc',status:'succeeded',prompt:'合成验收',created:1000,attempt:1,max_attempts:3,model:'gpt-test',effort:'high',options:{stitch:0},outputs:[],generation:call,generation_calls:{items:[call],total:1}};
 const adapter={api:async path=>path.includes('prompt-snapshot')?{available:false,legacy_message:'fixture'}:path.includes('/calls')?{items:[],total:0}:job,modelName:x=>x,task:()=>({up:null}),asset:()=>null,planHTML:()=>'',budget:()=>'',bytes:()=>'',accept(){},report(e){throw e},latest:()=>job};
 const originalFetch=window.fetch;
 try{
  await go('queue');await sleep(200);results.queue=!!document.querySelector('#page .batch');
  await StudioTasks.open(fakeId,adapter);await sleep(150);results.normal=!!document.querySelector('.task-details-workspace .generation-compare')&&document.querySelector('.task-details-workspace').textContent.includes('max');
  await closeOverlays();await sleep(150);
  const upscale={...job,options:{stitch:4},upscale_plan:{stages:[],calls:0}};adapter.api=async path=>path.includes('prompt-snapshot')?{available:false,legacy_message:'fixture'}:path.includes('/calls')?{items:[],total:0}:upscale;
  await StudioTasks.open(fakeId,adapter,{mode:'upscale',inspectOnly:true});await sleep(150);results.upscale=!!document.querySelector('.upscale-workspace .generation-compare');
  await closeOverlays();await sleep(150);openSettings('set-backend');await sleep(150);results.settings=!!document.querySelector('#set-backend')&&document.querySelector('#set-backend').textContent.includes('图片生成通道');
  await closeOverlays();await sleep(150);
  window.fetch=async(input,opts)=>String(input).includes('/api/assets/'+assetId+'/info')?new Response(JSON.stringify({job}),{headers:{'content-type':'application/json'}}):originalFetch(input,opts);
  await StudioService.infoSheet(assetId);await sleep(150);results.info=!!document.querySelector('.sheet .generation-compare');
  await closeOverlays();return {ok:Object.values(results).every(Boolean),results};
 }finally{window.fetch=originalFetch;await closeOverlays();}
})()
