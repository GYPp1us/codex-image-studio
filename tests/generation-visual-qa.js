/* Run inside the isolated real-browser/WebView fixture after static modules load.
   Returns measured results; it does not replace actual viewport changes or screenshots. */
(async()=>{
 const still=document.createElement('style');still.textContent='*,*::before,*::after{transition:none!important;animation:none!important}';document.head.append(still);
 const rgb=s=>{const m=s.match(/[\d.]+/g);if(!m||m.length<3)throw Error('unexpected computed color '+s);return m.slice(0,3).map(Number);};
 const lum=c=>{const v=c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
 const contrast=(a,b)=>{let x=lum(rgb(a)),y=lum(rgb(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const host=document.createElement('section');host.className='task-section generation-workspace';host.style.cssText='position:fixed;left:0;top:0;z-index:9999;width:min(100%,760px);max-height:100%;overflow:auto';document.querySelector('#app').append(host);
 const call={id:'visual-call',kind:'image',status:'running',scope:'image-1',created:1,updated:1,requested:{quality:'max'},provider_reported:{quality:'low'},fallback:{from:'responses',to:'cli',reason:'fixture'}};
 const ctx=StudioGeneration.mount(host,{id:'visual-job',status:'succeeded',options:{},generation_calls:{items:[call],total:1}},{api:async()=>({items:[],total:0})});
 const results=[];
 try{for(const mode of ['light','dark'])for(const accent of ['#294b36','#c1e5bc']){
   StudioTheme.apply({mode,accent},false);await new Promise(r=>setTimeout(r,350));
   for(const selector of ['.generation-live-head [data-generation-state]','.generation-compare td','.generation-different','.generation-warning']){
     const el=host.querySelector(selector),style=getComputedStyle(el),box=el.closest('.generation-warning,.generation-compare,.generation-live');
     let bg=getComputedStyle(box).backgroundColor;if(bg==='rgba(0, 0, 0, 0)'||bg==='transparent')bg=getComputedStyle(host).backgroundColor;
     const ratio=contrast(style.color,bg);results.push({mode,accent,selector,foreground:style.color,background:bg,ratio,pass:ratio>=4.5});
   }
   const box=host.getBoundingClientRect(),table=host.querySelector('.generation-compare').getBoundingClientRect();results.push({mode,accent,viewport:[innerWidth,innerHeight],layout:{host:box.width,table:table.width,scrollWidth:host.scrollWidth,clientWidth:host.clientWidth},pass:box.width<=innerWidth+1&&host.scrollWidth<=host.clientWidth+1});
 }}finally{StudioGeneration.close(ctx);host.remove();still.remove();}
 return {ok:results.every(x=>x.pass),results};
})()
