"use strict";
const StudioAvatar=(()=>{
  function open(store){
    let image=null,url=null,active=true,drag=null,zoom=1,x=0,y=0,busy=false,loadVersion=0;
    const L=openSheet({stack:true,title:'自定义头像',cls:'avatar-editor',html:`<div class="avatar-current">${store.current()?`<img src="${esc(store.current())}" alt="当前头像">`:icon('imgplus',40)}</div><div class="avatar-crop" hidden><img draggable="false" alt="头像裁剪预览"></div><label class="avatar-zoom" hidden>缩放<input type="range" min="1" max="3" step="0.01" value="1" aria-label="头像缩放"></label><p class="note">选择图片后，拖动定位并调整缩放。圆框内的内容将作为头像。</p><input type="file" id="avatar-file" hidden accept="image/png,image/jpeg,image/webp"><button class="secondary avatar-choose">${icon('upload',16)}选择图片</button><p class="form-err" role="alert"></p><button class="primary avatar-save" disabled>保存头像</button>${store.current()?'<button class="secondary danger avatar-remove">恢复默认头像</button>':''}`});
    const file=$('#avatar-file',L),crop=$('.avatar-crop',L),preview=$('img',crop),range=$('.avatar-zoom input',L),save=$('.avatar-save',L),error=$('.form-err',L);
    const width=()=>crop.getBoundingClientRect().width;
    function paint(){if(!image)return;const w=width(),scale=w/Math.min(image.naturalWidth,image.naturalHeight)*zoom;
      x=clamp(x,-(image.naturalWidth*scale-w)/2,(image.naturalWidth*scale-w)/2);y=clamp(y,-(image.naturalHeight*scale-w)/2,(image.naturalHeight*scale-w)/2);
      Object.assign(preview.style,{width:image.naturalWidth*scale+'px',height:image.naturalHeight*scale+'px',transform:`translate(-50%,-50%) translate3d(${x}px,${y}px,0)`});
    }
    function pending(value){busy=value;save.disabled=value||!image;$('.avatar-choose',L).disabled=value;const remove=$('.avatar-remove',L);if(remove)remove.disabled=value;save.textContent=value?'正在保存…':'保存头像';}
    $('.avatar-choose',L).onclick=()=>file.click();
    file.onchange=()=>{
      const chosen=file.files?.[0];if(!chosen)return;file.value='';error.textContent='';
      if(chosen.size>12*1024*1024){error.textContent='头像文件不能超过 12 MB';return;}
      const ticket=++loadVersion,nextURL=URL.createObjectURL(chosen),next=new Image();next.onload=()=>{
        if(!active||ticket!==loadVersion){URL.revokeObjectURL(nextURL);return;}
        if(next.naturalWidth*next.naturalHeight>40_000_000){URL.revokeObjectURL(nextURL);error.textContent='头像请使用 4000 万像素以内的图片';return;}
        if(url)URL.revokeObjectURL(url);url=nextURL;image=next;zoom=1;x=y=0;range.value='1';preview.src=url;
        $('.avatar-current',L).hidden=true;crop.hidden=false;$('.avatar-zoom',L).hidden=false;save.disabled=false;paint();
      };next.onerror=()=>{URL.revokeObjectURL(nextURL);if(active&&ticket===loadVersion)error.textContent='无法读取图片，请选择 PNG、JPEG 或 WebP';};next.src=nextURL;
    };
    range.oninput=()=>{zoom=Number(range.value);paint();};
    crop.addEventListener('pointerdown',e=>{if(busy||!image||e.button>0||drag)return;e.preventDefault();drag={pointer:e.pointerId,x:e.clientX,y:e.clientY};crop.setPointerCapture(e.pointerId);});
    crop.addEventListener('pointermove',e=>{if(!drag||drag.pointer!==e.pointerId)return;x+=e.clientX-drag.x;y+=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;paint();});
    crop.addEventListener('pointerup',()=>drag=null);crop.addEventListener('pointercancel',()=>drag=null);
    save.onclick=async()=>{if(busy||!image)return;pending(true);error.textContent='';
      try{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const w=width(),scale=w/Math.min(image.naturalWidth,image.naturalHeight)*zoom,side=w/scale;
        canvas.getContext('2d').drawImage(image,(image.naturalWidth-side)/2-x/scale,(image.naturalHeight-side)/2-y/scale,side,side,0,0,512,512);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('头像处理失败，请重新选择图片');
        const body=new FormData();body.append('file',blob,'avatar.png');const result=await store.api('/api/account/avatar',{method:'POST',body});store.updated(result.avatar_url);
        if(active&&topSheet()===L)await back();toast('头像已更新');
      }catch(e){if(active)error.textContent=e.message;else store.report(e);}finally{if(active)pending(false);}
    };
    const remove=$('.avatar-remove',L);if(remove)remove.onclick=async()=>{if(busy)return;pending(true);try{const result=await store.api('/api/account/avatar',{method:'DELETE'});store.updated(result.avatar_url);if(active&&topSheet()===L)await back();toast('已恢复默认头像');}catch(e){if(active)error.textContent=e.message;}finally{if(active)pending(false);}};
    L.cleanup=()=>{active=false;loadVersion++;if(url)URL.revokeObjectURL(url);};return L;
  }
  return {open};
})();
