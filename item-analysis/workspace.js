/* ItemBloom local Item Analysis workspaces — same-origin IndexedDB, no network. */
'use strict';
(()=>{
 const NAME='itembloom-item-analysis-workspaces-v1';
 let connectionPromise=null;
 function open(){
  if(!connectionPromise)connectionPromise=new Promise((resolve,reject)=>{
   const request=indexedDB.open(NAME,1);
   request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('metadata'))db.createObjectStore('metadata',{keyPath:'id'});if(!db.objectStoreNames.contains('data'))db.createObjectStore('data',{keyPath:'id'});};
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connectionPromise=null;};resolve(db);};
   request.onerror=()=>{connectionPromise=null;reject(request.error||Error('Unable to access browser storage.'));};
   request.onblocked=()=>console.warn('ItemBloom workspace storage is blocked by another tab.');
  });
  return connectionPromise;
 }
 async function tx(stores,mode,make){const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction(stores,mode);let v;t.oncomplete=()=>resolve(v);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);v=make(t);});}
 function reqResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});}
 const api={
  list:()=>tx(['metadata'],'readonly',t=>reqResult(t.objectStore('metadata').getAll())).then(x=>x),
  async load(id){const db=await open();return await new Promise((resolve,reject)=>{const t=db.transaction(['metadata','data'],'readonly');let a,b;t.objectStore('metadata').get(id).onsuccess=e=>a=e.target.result;t.objectStore('data').get(id).onsuccess=e=>b=e.target.result;t.oncomplete=()=>resolve(a&&b?{metadata:a,snapshot:b.snapshot,baseline:globalThis.ItemBloomSaveGuard.fingerprint({metadata:a,snapshot:b.snapshot})}:null);t.onabort=()=>reject(t.error||Error('Workspace load aborted.'));t.onerror=()=>reject(t.error);});},
  async save(metadata,snapshot,expected=null){
   metadata=structuredClone(metadata);snapshot=structuredClone(snapshot);
   const guard=globalThis.ItemBloomSaveGuard,db=await open();
   return new Promise((resolve,reject)=>{
    const t=db.transaction(['metadata','data'],'readwrite');let a,b,done=0,result,error;
    const apply=()=>{if(++done!==2)return;
     try{
      const exists=!!(a||b),current=a&&b?guard.fingerprint({metadata:a,snapshot:b.snapshot}):null;
      if((expected===null&&exists)||(expected!==null&&(!a||!b||current!==expected))){
       const id='ib-recovery-'+crypto.randomUUID(),recoveryMeta={...metadata,id,filename:(metadata.filename||'Analysis')+' (Recovery)'};
       t.objectStore('metadata').add(recoveryMeta);t.objectStore('data').add({id,snapshot});
       error=guard.conflict('A newer workspace exists. Your edits were saved in a recovery copy.');error.recoveryId=id;
      }else{
       t.objectStore('metadata').put(metadata);t.objectStore('data').put({id:metadata.id,snapshot});
       result=guard.fingerprint({metadata,snapshot});
      }
     }catch(e){error=e;t.abort();}
    };
    t.objectStore('metadata').get(metadata.id).onsuccess=e=>{a=e.target.result;apply()};
    t.objectStore('data').get(metadata.id).onsuccess=e=>{b=e.target.result;apply()};
    t.oncomplete=()=>error?reject(error):resolve(result);
    t.onerror=()=>reject(t.error||Error('Workspace save failed.'));
    t.onabort=()=>reject(t.error||error||Error('Workspace save aborted.'));
   });
  },
  remove:id=>tx(['metadata','data'],'readwrite',t=>{t.objectStore('metadata').delete(id);t.objectStore('data').delete(id);})
 };
 globalThis.ItemBloomWorkspace=api;
})();
