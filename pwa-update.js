/* Update readiness protocol shared by top-level pages and analysis frames. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.ItemBloomPWAUpdate=api;})(globalThis,()=>{
 'use strict';
 function install({serviceWorker,scriptURL,ready,freeze,reload,setTimer=setTimeout,clearTimer=clearTimeout}){
  let token=null,timer=null,requesting=false,reloadPending=false,hadController=!!serviceWorker.controller;
  const safe=()=>{try{return ready()===true}catch{return false}};
  function release(){clearTimer(timer);timer=null;if(token){token=null;freeze(false);}}
  function tick(){if(reloadPending&&safe()){reloadPending=false;release();reload();}}
  serviceWorker.addEventListener('message',event=>{
   if(event.source?.scriptURL!==scriptURL)return;
   const data=event.data||{};if(typeof data.token!=='string'||!data.token)return;const reply=value=>event.ports?.[0]?.postMessage({safe:value,token:data.token});
   // A first-install worker may activate between being observed as waiting and this message.
   // Only a still-installed candidate can begin locking; ABORT must always release an old lock.
   const waiting=event.source.state==='installed';
   if(data.type==='IB_UPDATE_QUERY'){reply(waiting&&!token&&safe());}
   else if(data.type==='IB_UPDATE_PREPARE'){
    if(!waiting||token||!safe()){reply(false);return;}
    token=data.token;freeze(true);timer=setTimer(release,8000);reply(true);
   }else if(data.type==='IB_UPDATE_CHECK')reply(token===data.token&&safe());
   else if(data.type==='IB_UPDATE_ABORT'&&token===data.token)release();
   else if(data.type==='IB_UPDATE_COMMIT'&&token===data.token){
    // Release a stalled transition without ever forcing a busy page to reload.
    clearTimer(timer);timer=setTimer(()=>{release();tick();},15000);
   }
  });
  serviceWorker.addEventListener('controllerchange',()=>{
   if(hadController)reloadPending=true;hadController=true;release();tick();
  });
  return {tick,request(worker){tick();if(!worker||worker.state!=='installed'||worker===serviceWorker.controller||requesting||!safe())return;
   requesting=true;try{worker.postMessage({type:'IB_REQUEST_SAFE_UPDATE'});}finally{setTimer(()=>{requesting=false},5000);}
  }};
 }
 return {install};
});
