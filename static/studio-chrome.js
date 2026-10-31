"use strict";
/* Keep browser chrome in the viewer's visual lifecycle, including its exit fade. */
const StudioChrome=(()=>{
  const root=document.documentElement;
  let wanted=false,requested=false,pending=null,savedTheme=null,savedStatus=null,createdStatus=false,epoch=0;
  const nativeAndroid=parseFloat(navigator.userAgent?.match(/ImageStudioAndroid\/([\d.]+)/)?.[1]||'0')>=1.1;
  let port=null,lastState='',frame=0,until=0;
  const fullscreen=()=>document.fullscreenElement||document.webkitFullscreenElement;
  const theme=()=>document.querySelector('meta[name="theme-color"]');
  const status=()=>document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  function rgb(value){
    const c=value?.match(/^rgba?\(([^)]+)\)$/)?.[1].split(/[,\s/]+/).map(Number);
    return c?.length>=3?[c[0],c[1],c[2],c[3]??1]:null;
  }
  const blend=(base,color,opacity=1)=>{const alpha=color[3]*opacity;return base.map((c,i)=>c*(1-alpha)+color[i]*alpha);};
  const hex=color=>'#'+color.map(c=>Math.round(Math.max(0,Math.min(255,c))).toString(16).padStart(2,'0')).join('');
  function surfaceColor(bottom){
    let color=[245,244,239];
    const base=rgb(getComputedStyle(app).backgroundColor);if(base)color=blend(color,base);
    const y=bottom?app.getBoundingClientRect().bottom-1:app.getBoundingClientRect().top+1;
    const x=app.getBoundingClientRect().left+app.clientWidth/2;
    // Include fading-out layers even after pointer events have been disabled.
    const surfaces=[document.querySelector('#tabbar'),...document.querySelectorAll('#screens .screen,#layers .scrim,#layers .sheet')].filter(Boolean);
    surfaces.sort((a,b)=>{
      const z=el=>+(getComputedStyle(el.closest('#layers,#screens')||el).zIndex)||0;
      return z(a)-z(b);
    });
    for(const el of surfaces){
      const rect=el.getBoundingClientRect();if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)continue;
      let opacity=1,visible=true;
      for(let p=el;p&&p!==app;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'){visible=false;break;}opacity*=Number(s.opacity||1);}
      const paint=rgb(getComputedStyle(el).backgroundColor);
      if(visible&&paint)color=blend(color,paint,opacity);
    }
    return hex(color);
  }
  function syncNative(){
    if(!port)return;
    const hidden=root.classList.contains('viewer-present');
    const state=JSON.stringify({viewer:hidden,topColor:hidden?'#0c0c0a':surfaceColor(false),bottomColor:hidden?'#0c0c0a':surfaceColor(true)});
    if(state===lastState)return;
    try{port.postMessage(state);lastState=state;}catch{port=null;}
  }
  function followChrome(){
    if(!nativeAndroid||!port)return;
    until=performance.now()+450;
    if(frame)return;
    const step=()=>{frame=0;syncNative();if(performance.now()<until)frame=requestAnimationFrame(step);};
    frame=requestAnimationFrame(step);
  }
  if(nativeAndroid){
    window.addEventListener('message',event=>{
      if(event.data!=='IMAGE_STUDIO_CHROME_PORT_V1'||!event.isTrusted||!event.ports?.[0]||(event.source&&event.source!==window))return;
      port?.close();port=event.ports[0];lastState='';syncNative();followChrome();
    });
    const observer=new MutationObserver(followChrome);
    for(const el of document.querySelectorAll('#layers,#screens'))observer.observe(el,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
    window.addEventListener('resize',followChrome);
    document.addEventListener('studio-theme-change',()=>{syncNative();followChrome();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){syncNative();followChrome();}});
  }
  function restore(ticket){
    if(wanted||ticket!==epoch)return;root.classList.remove('viewer-present');
    if(savedTheme!==null){theme()?.setAttribute('content',savedTheme);savedTheme=null;}
    const meta=status();if(createdStatus)meta?.remove();else if(savedStatus!==null)meta?.setAttribute('content',savedStatus);
    savedStatus=null;createdStatus=false;
    if(typeof StudioTheme!=='undefined')StudioTheme.refreshChrome();
    syncNative();followChrome();
  }
  function exitOwned(){
    if(!requested||fullscreen()!==app)return Promise.resolve();
    const exit=document.exitFullscreen||document.webkitExitFullscreen;
    if(!exit)return Promise.resolve();
    try{return Promise.resolve(exit.call(document)).catch(()=>{});}catch{return Promise.resolve();}
  }
  function enterViewer(){
    wanted=true;epoch++;
    if(savedTheme===null)savedTheme=theme()?.getAttribute('content')||'#f5f4ef';
    root.classList.add('viewer-present');theme()?.setAttribute('content','#0c0c0a');
    let meta=status();if(!meta){meta=document.createElement('meta');meta.name='apple-mobile-web-app-status-bar-style';document.head.append(meta);createdStatus=true;}
    else if(savedStatus===null&&!createdStatus)savedStatus=meta.getAttribute('content')||'default';
    meta.setAttribute('content','black-translucent');
    syncNative();
    if(nativeAndroid)return;
    const touch=(navigator.maxTouchPoints||0)>0||matchMedia('(pointer: coarse)').matches;
    const request=app.requestFullscreen||app.webkitRequestFullscreen;
    if(!touch||!request||fullscreen()||pending)return;
    // This call stays synchronous so a tile click retains user activation.
    requested=true;
    try{
      const result=app.requestFullscreen?request.call(app,{navigationUI:'hide'}):request.call(app);
      pending=Promise.resolve(result).then(()=>{pending=null;if(!wanted)return exitOwned();},()=>{pending=null;if(fullscreen()!==app)requested=false;});
    }catch{requested=false;pending=null;}
  }
  function leaveViewer(){
    wanted=false;const ticket=++epoch;
    return Promise.resolve(pending).then(()=>{if(!wanted&&ticket===epoch)return exitOwned();}).then(()=>{if(fullscreen()!==app)requested=false;restore(ticket);});
  }
  function changed(){
    if(requested&&fullscreen()===app&&!wanted){const ticket=epoch;exitOwned().then(()=>{requested=false;restore(ticket);});}
    else if(!fullscreen())requested=false;
  }
  document.addEventListener('fullscreenchange',changed);document.addEventListener('webkitfullscreenchange',changed);
  return {enterViewer,leaveViewer};
})();
