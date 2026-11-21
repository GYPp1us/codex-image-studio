"use strict";
function createConnection({probe,resync,paint,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}){
  let active=false,timer,flight,recovery,controller,generation=0,failures=0,lastGood=0,nextCheck=0;
  let phase='online',pageSlow=false;
  const notify=()=>paint({phase,pageSlow});
  function later(delay){
    clearTimer(timer);
    if(active)timer=setTimer(()=>check(false),Math.max(0,delay));
  }
  function good(){
    if(!active)return;
    lastGood=now();
    if(!flight&&!failures)later(4000);
  }
  function visibleData(ok){
    pageSlow=!ok;
    notify();
    if(!ok&&active&&!flight&&!failures)check(false);
  }
  function check(force){
    if(!active||flight)return flight;
    if(force&&recovery)return recovery;
    clearTimer(timer);
    const token=generation,started=now(),ctl=new AbortController();
    controller=ctl;
    let deadline;
    const stalled=new Promise((_,reject)=>{deadline=setTimer(()=>{reject(new Error('probe deadline'));ctl.abort();},3000);});
    if(force){phase='checking';notify();}
    const task=Promise.race([Promise.resolve().then(()=>probe(ctl.signal)),stalled]).then(value=>{
      if(token!==generation)return;
      if(value?.ok!==true||value.app!=='Image Studio')throw new Error('unexpected health response');
      const reconnect=force||failures>0;
      failures=0;phase='online';nextCheck=4000;notify();
      if(reconnect&&!recovery){
        phase='syncing';notify();
        const work=Promise.resolve().then(()=>resync()).then(()=>{
          if(token===generation){phase='online';notify();}
        },()=>{if(token===generation){phase='online';pageSlow=true;notify();}});
        recovery=work;
        work.finally(()=>{if(recovery===work)recovery=null;});
      }
    }).catch(()=>{
      if(token!==generation)return;
      if(lastGood>started){failures=0;phase='online';nextCheck=Math.max(0,4000-(now()-lastGood));notify();return;}
      phase='retrying';nextCheck=[1000,2000,4000,5000][Math.min(failures,3)];failures++;notify();
    }).finally(()=>{
      clearTimer(deadline);
      if(flight!==task)return;
      flight=null;controller=null;later(nextCheck);
    });
    flight=task;
    return task;
  }
  function stop(){
    active=false;generation++;clearTimer(timer);controller?.abort();controller=null;flight=null;recovery=null;
  }
  function start(immediate=false){
    if(!active){active=true;lastGood=now();later(4000);}
    if(immediate)return check(true);
  }
  return {start,stop,good,check,visibleData,get status(){return {phase,pageSlow,lastGood};}};
}
