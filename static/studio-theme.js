"use strict";
/* Resolve before first paint; the server remains the saved preference source. */
const StudioTheme=(()=>{
  const root=document.documentElement,system=matchMedia('(prefers-color-scheme: dark)'),key='studio-appearance-v1';
  let preference={mode:'system',accent:'#5d7350'};
  const normalize=value=>({mode:['system','light','dark'].includes(value?.mode)?value.mode:'system',accent:/^#[0-9a-f]{6}$/i.test(value?.accent||'')?value.accent.toLowerCase():'#5d7350'});
  const mix=(a,b,t)=>a.map((x,i)=>Math.round(x*(1-t)+b[i]*t));
  const hex=rgb=>'#'+rgb.map(x=>x.toString(16).padStart(2,'0')).join('');
  function refreshChrome(){if(root.classList.contains('viewer-present'))return;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',root.dataset.theme==='dark'?'#171916':'#f5f4ef');}
  function apply(value=preference,save=true){
    preference=normalize(value);const dark=preference.mode==='dark'||preference.mode==='system'&&system.matches;
    root.dataset.theme=dark?'dark':'light';root.style.colorScheme=dark?'dark':'light';
    const rgb=preference.accent.slice(1).match(/../g).map(v=>parseInt(v,16));
    // Derive readable accent ink and tinted surfaces even for very pale or dark custom colors.
    let ink=mix(rgb,dark?[255,255,255]:[0,0,0],dark?.58:.28);
    const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    for(let i=0;i<15&&(dark?luminance(ink)<.55:luminance(ink)>.16);i++)ink=mix(ink,dark?[255,255,255]:[0,0,0],.12);
    const surface=mix(dark?[23,25,22]:[255,254,250],rgb,dark?.24:.14);
    const strong=mix(dark?[23,25,22]:[255,254,250],rgb,dark?.42:.26);
    for(const [name,color] of Object.entries({'--sage':surface,'--sage-2':strong,'--sage-ink':ink,'--accent':rgb}))root.style.setProperty(name,hex(color));
    root.style.setProperty('--on-accent',dark?'#141612':'#fffefa');
    if(save)try{localStorage.setItem(key,JSON.stringify(preference));}catch{}
    refreshChrome();document.dispatchEvent(new window.Event('studio-theme-change'));
    return {...preference};
  }
  try{preference=normalize(JSON.parse(localStorage.getItem(key)||'null'));}catch{}
  system.addEventListener?.('change',()=>{if(preference.mode==='system')apply(preference,false);});
  apply(preference,false);return {apply,refreshChrome,current:()=>({...preference})};
})();
