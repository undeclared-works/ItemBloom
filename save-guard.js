/* Content baselines work with old records too; no on-disk revision migration. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.ItemBloomSaveGuard=api;})(globalThis,()=>{
 'use strict';
 function fingerprint(value){return JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort().reduce((out,k)=>{Object.defineProperty(out,k,{value:v[k],enumerable:true});return out},{}):v);}
 function conflict(message){const error=Error(message);error.code='SAVE_CONFLICT';return error;}
 function withFileLock(task){if(!globalThis.navigator?.locks)throw conflict('This browser cannot coordinate assessment writes. Save a recovery copy instead.');return navigator.locks.request('itembloom-assessment-writes',()=>task());}
 async function fileSave({expected,read,write}){return withFileLock(async()=>{
  let latest;try{latest=await read()}catch{throw conflict('The assessment changed or cannot be verified.');}if(expected===null||fingerprint(latest)!==expected)throw conflict('The assessment changed since it was opened.');
  await write();
 });}
 function choose(message){return new Promise(resolve=>{
  const dialog=document.createElement('dialog'),text=document.createElement('p');text.textContent=message;dialog.append(text);
  for(const [value,label] of [['reload','Reload latest'],['copy','Save as Copy'],['cancel','Cancel']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>dialog.close(value));dialog.append(button);}
  dialog.addEventListener('close',()=>{const choice=dialog.returnValue;dialog.remove();resolve(['reload','copy'].includes(choice)?choice:'cancel');},{once:true});
  document.body.append(dialog);dialog.showModal();dialog.lastElementChild.focus();
 });}
 return {fingerprint,conflict,withFileLock,fileSave,choose};
});
