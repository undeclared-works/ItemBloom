/* Draft limits apply to new edits; old oversized records remain recovery/exportable. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.ItemBloomDrafts=api;})(globalThis,()=>{
 'use strict';
 const MAX_ROWS=100,MAX_TEXT=4000,MAX_BYTES=2500000;
 const recognizable=d=>!!d&&Array.isArray(d.rows)&&d.rows.length>0&&Array.isArray(d.dist)&&d.dist.length===6&&d.dist.every(v=>Number.isFinite(Number(v))&&Number(v)>=0);
 function reason(d){if(!recognizable(d))return 'Unrecognized assessment draft.';if(d.rows.length>MAX_ROWS)return 'Maximum 100 competencies. This older draft is available for recovery/export.';if(d.rows.some(r=>!r||typeof r!=='object'||String(r.text??'').length>MAX_TEXT))return 'Maximum 4,000 characters per competency. This draft is available for recovery/export.';if(new TextEncoder().encode(JSON.stringify(d)).length>MAX_BYTES)return 'Maximum draft size is 2.5 MB. Export a recovery copy before reducing its contents.';return '';}
 function store(storage,changed){
  const failures=new Map(),raw=new Map(),blocked=new Set(),pending=new Map();
  function failed(key,error){failures.set(key,error?.message||String(error));changed();return false;}
  function success(key){if(!pending.has(key))failures.delete(key);changed();}
  return {failures,raw,blocked,
   readText(key,fallback=null){try{const value=storage.getItem(key);if(value!==null)raw.set(key,value);blocked.delete(key);success(key);return value??fallback;}catch(e){blocked.add(key);failed(key,e);return fallback;}},
   retryWrites(){for(const [key,value] of [...pending])this.writeText(key,value);return failures.size===0;},
   readJSON(key,fallback,validate=()=>true){try{const text=storage.getItem(key);if(text!==null)raw.set(key,text);const value=text===null?fallback:JSON.parse(text);if(!validate(value))throw Error('Unrecognized stored data; original text retained for export.');blocked.delete(key);success(key);return value;}catch(e){blocked.add(key);failed(key,e);return fallback;}},
   writeText(key,value){pending.set(key,value);if(blocked.has(key))return failed(key,Error('Existing storage could not be read safely. Export recovery data before repairing storage.'));try{storage.setItem(key,value);if(storage.getItem(key)!==value)throw Error('Browser did not verify the saved data.');raw.set(key,value);pending.delete(key);success(key);return true;}catch(e){return failed(key,e);}},
   writeJSON(key,value){try{return this.writeText(key,JSON.stringify(value));}catch(e){return failed(key,e);}},
   remove(key){if(blocked.has(key))return failed(key,Error('Existing storage could not be read safely.'));try{storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('Browser did not verify removal.');raw.delete(key);pending.delete(key);success(key);return true;}catch(e){return failed(key,e);}}
  };
 }
 return {MAX_ROWS,MAX_TEXT,MAX_BYTES,recognizable,reason,store};
});
