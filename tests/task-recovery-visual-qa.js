/* Real WebView/browser only: call while an actual task details screen is open.
   Uses the production CSP and loaded stylesheet, not a synthetic DOM renderer. */
(()=>{
 const root=document.querySelector('.task-details-workspace .generation-workspace');
 if(!root)return {ok:false,error:'generation workspace missing'};
 const sheet=[...document.styleSheets].find(s=>s.href?.includes('/static/studio-generation.css'));
 let rules=0;try{rules=sheet?.cssRules.length||0}catch{};
 const trigger=root.querySelector('.generation-trigger'),label=root.querySelector('.generation-select'),comparison=root.querySelector('.generation-compare'),table=comparison?.querySelector('table'),live=root.querySelector('.generation-live');
 if(!sheet||!trigger||!label||!comparison||!table||!live)return {ok:false,error:'stylesheet or expected elements missing',sheet:!!sheet,trigger:!!trigger,comparison:!!comparison};
 const sb=trigger.getBoundingClientRect(),lb=label.getBoundingClientRect(),cb=comparison.getBoundingClientRect(),tb=table.getBoundingClientRect(),cellMetrics=[...table.querySelectorAll('td,th')].map(x=>({text:x.textContent,client:x.clientWidth,scroll:x.scrollWidth,wrap:getComputedStyle(x).overflowWrap}));
 const style={labelDisplay:getComputedStyle(label).display,triggerDisplay:getComputedStyle(trigger).display,borderRadius:getComputedStyle(live).borderRadius,tableLayout:getComputedStyle(table).tableLayout};
 const escapeProbe=document.createElement('div');escapeProbe.innerHTML=StudioGeneration.comparison({kind:'image',requested:{image_model:'<img src=x onerror=alert(1)>'},provider_reported:{}});
 const more=root.querySelector('.generation-more'),probe=document.createElement('div');root.append(probe);
 const legacy=StudioGeneration.mount(probe,{id:'synthetic-old-task',status:'succeeded',options:{},generation_calls:{items:[],total:0}},{api:async()=>({items:[],total:0})});
 const legacySelect=getComputedStyle(probe.querySelector('.generation-select')).display,legacyFrame=getComputedStyle(probe.querySelector('.generation-live')).display;
 StudioGeneration.close(legacy);probe.remove();
 const link=document.querySelector('head link[href*="studio-generation.css"]');
 const checks={hiddenMore:!!more&&more.hidden&&getComputedStyle(more).display==='none',legacySelectHidden:legacySelect==='none',legacyFrameHidden:legacyFrame==='none',headLink:!!link&&!!link.sheet,escapedValues:!escapeProbe.querySelector('img')&&escapeProbe.textContent.includes('<img src=x onerror=alert(1)>'),cssLoaded:rules>0,triggerStyled:style.labelDisplay==='grid'&&style.triggerDisplay==='flex'&&trigger.getAttribute('aria-haspopup')==='dialog',cardStyled:parseFloat(style.borderRadius)>0,tableStyled:style.tableLayout==='fixed',triggerFits:sb.left>=lb.left-1&&sb.right<=lb.right+1,tableFits:tb.width<=cb.width+1,cellsFit:cellMetrics.every(c=>c.scroll<=c.client+1),notEscaped:!root.textContent.includes('<div class=')};
 return {ok:Object.values(checks).every(Boolean),checks,style,rules,viewport:[innerWidth,innerHeight],bounds:{trigger:sb.width,label:lb.width,comparison:cb.width,table:tb.width},cellMetrics};
})()
