"use strict";
globalThis.StudioImages={
  async message(type){
    if(!('serviceWorker' in navigator))return {bytes:0,count:0};
    const worker=navigator.serviceWorker.controller;
    if(!worker){
      if(type==='IMAGE_CACHE_CLEAR'&&'caches' in globalThis){try{await Promise.all((await caches.keys()).filter(k=>k.startsWith('studio-images-')).map(k=>caches.delete(k)));}catch{}}
      return {bytes:0,count:0};
    }
    return new Promise(resolve=>{
      const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve({bytes:0,count:0});},5000);
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
      try{worker.postMessage({type},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();resolve({bytes:0,count:0});}
    });
  },
  clear(){return this.message('IMAGE_CACHE_CLEAR');},
  status(){return this.message('IMAGE_CACHE_STATUS');}
};
