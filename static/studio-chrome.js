"use strict";
/* Keep browser chrome in the viewer's visual lifecycle, including its exit fade. */
const StudioChrome=(()=>{
  const root=document.documentElement;
  let wanted=false,requested=false,pending=null,savedTheme=null,savedStatus=null,createdStatus=false,epoch=0;
  const fullscreen=()=>document.fullscreenElement||document.webkitFullscreenElement;
  const theme=()=>document.querySelector('meta[name="theme-color"]');
  const status=()=>document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  function restore(ticket){
    if(wanted||ticket!==epoch)return;root.classList.remove('viewer-present');
    if(savedTheme!==null){theme()?.setAttribute('content',savedTheme);savedTheme=null;}
    const meta=status();if(createdStatus)meta?.remove();else if(savedStatus!==null)meta?.setAttribute('content',savedStatus);
    savedStatus=null;createdStatus=false;
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
