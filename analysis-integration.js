/* ItemBloom v1.0.0-beta.11: embeds the offline Item Analysis module in the existing TOS app.
   Existing extraction records and their IndexedDB schema remain untouched. */
'use strict';
(()=>{
 const upload=document.getElementById('uploadAnalysisCSV');
 const list=document.getElementById('analysisWorkspaceList');
 if(!upload||!list)return;
 const legacyPill=document.getElementById('analysisCount');
 const workspacePill=document.createElement('span');workspacePill.className='pill';workspacePill.id='analysisWorkspaceCount';workspacePill.hidden=true;
 if(legacyPill){legacyPill.before(workspacePill);const checkLegacy=()=>{legacyPill.hidden=/^0\s+(?:local\s+)?records/i.test(legacyPill.textContent.trim());};new MutationObserver(checkLegacy).observe(legacyPill,{childList:true,characterData:true,subtree:true});checkLegacy();}
 let overlay=null,frame=null,closeButton=null,closing=false,frameReady=false,previousFocus=null;
 window.ItemBloomAnalysisUpdateState=()=>({open:!!overlay,loading:!!overlay&&!frameReady,closing,busy:!!overlay||!!document.getElementById('restoreAnalysisBackup')?.disabled});
 const STORE='itembloom-item-analysis-workspaces-v1';
 function db(name=STORE){return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('metadata'))db.createObjectStore('metadata',{keyPath:'id'});if(!db.objectStoreNames.contains('data'))db.createObjectStore('data',{keyPath:'id'});};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('Cannot open saved Item Analysis workspaces.'));
 });}
 async function transaction(stores,mode,make,name=STORE){const conn=await db(name);return new Promise((resolve,reject)=>{
  const tx=conn.transaction(stores,mode);let result;
  tx.oncomplete=()=>{conn.close();resolve(result)};tx.onerror=()=>{conn.close();reject(tx.error)};tx.onabort=()=>{conn.close();reject(tx.error)};
  try{result=make(tx)}catch(ex){conn.close();reject(ex)};
 });}
 function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});}
 async function listWorkspaces(){return await transaction(['metadata'],'readonly',tx=>requestResult(tx.objectStore('metadata').getAll()));}
 async function readWorkspace(id){const conn=await db();try{return await new Promise((resolve,reject)=>{
  const tx=conn.transaction(['metadata','data'],'readonly');let meta,snapshot;
  tx.objectStore('metadata').get(id).onsuccess=e=>meta=e.target.result;
  tx.objectStore('data').get(id).onsuccess=e=>snapshot=e.target.result?.snapshot;
  tx.oncomplete=()=>resolve(meta&&snapshot?{metadata:meta,snapshot}:null);
  tx.onerror=()=>reject(tx.error);
 });}finally{conn.close();}}
 async function deleteWorkspace(id){await transaction(['metadata','data'],'readwrite',tx=>{tx.objectStore('metadata').delete(id);tx.objectStore('data').delete(id);});}
 function notify(text){const e=document.getElementById('message');if(!e)return;e.textContent=text;e.classList.remove('hidden');}
 function btn(name,fn,cls='btn secondary compact'){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=name;b.addEventListener('click',fn);return b;}
 function analysisHeading(m){
  const grade=String(m.grade||'').replace(/^GRADE\s+/i,'Grade ').trim();
  const parts=[grade,String(m.section||'').trim(),String(m.subject||'').trim()].filter(Boolean);
  return parts.join(' · ')||String(m.filename||'Imported results').replace(/\.(?:csv|xlsx|xls)$/i,'')||'Imported results';
 }
 function analysisSubtitle(m){
  const type=m.testType==='summative1'?'Summative test 1':m.testType==='summative2'?'Summative test 2':m.testType==='termexam'?'Term exam':m.otherTestType||'Item Analysis';
  const date=m.updatedAt&&Number.isFinite(new Date(m.updatedAt).getTime())?new Date(m.updatedAt).toLocaleString('en-US',{month:'numeric',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}):'';
  return [type,`${m.itemCount||0} items`,m.term,m.schoolYear,date].filter(Boolean).join(' · ');
 }
 async function refreshWorkspaces(){
  try{
   const query=(document.getElementById('homeAnalysisSearch')?.value||'').trim().toLocaleLowerCase();
   const all=(await listWorkspaces()).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).filter(m=>!query||[m.filename,m.source,m.learnerCount,m.itemCount,m.linkedAssessmentTitle,m.section,m.grade,m.subject,m.term,m.schoolYear].some(v=>String(v||'').toLocaleLowerCase().includes(query)));
   workspacePill.textContent=`${all.length} ${all.length===1?'analysis':'analyses'}`;workspacePill.hidden=!all.length;
   list.replaceChildren();
   for(const entry of all){
    const card=document.createElement('div');card.className='recent-item';
    const body=document.createElement('div');body.style.minWidth='0';
    const title=document.createElement('div');title.className='recent-title';title.textContent=analysisHeading(entry);
    const subtitle=document.createElement('div');subtitle.className='recent-meta';subtitle.textContent=analysisSubtitle(entry);
    const tag=document.createElement('span');tag.className='kind-pill';tag.textContent='ANALYSIS';
    const fileline=document.createElement('div');fileline.className='recent-path';fileline.textContent=(entry.filename||'Local Item Analysis')+` · ${entry.source} · ${entry.learnerCount} examinees`;body.append(title,tag,subtitle,fileline);
    const actions=document.createElement('div');actions.className='record-actions';
    function iconAction(action,label,svg,handler){const b=document.createElement('button');b.type='button';b.className='icon-btn';b.dataset.action=action;b.title=label;b.setAttribute('aria-label',label);b.innerHTML=svg;b.addEventListener('click',e=>{e.stopPropagation();handler();});actions.append(b);return b;}
    iconAction('open','Open item analysis','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12s3.3-6 8-6 8 6 8 6-3.3 6-8 6-8-6-8-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>',()=>openWorkspace(entry.id));
    iconAction('backup','Download item analysis backup','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/></svg>',async()=>{
     try{const item=await readWorkspace(entry.id);if(!item)throw Error('Record is missing.');
      const blob=new Blob([globalThis.ItemBloomBackup.exportWorkspace(item)],{type:'application/json'});
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='ItemBloom-ItemAnalysis-'+String(entry.filename||entry.id).replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,90)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
     }catch(ex){notify('Cannot download Item Analysis backup: '+ex.message);}
    });
    iconAction('delete','Delete item analysis','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16m-14 0 1 13h10l1-13M9 7V4h6v3m-5 4v6m4-6v6"/></svg>',async()=>{
     if(!confirm(`Delete the locally saved Item Analysis for “${entry.filename}”? This cannot be undone.`))return;
     try{await deleteWorkspace(entry.id);refreshWorkspaces();}catch(ex){notify('Unable to delete Item Analysis: '+ex.message);}
    });
    const selected=window.itemBloomHomeSelectedAnalysis==='workspace:'+entry.id;
    card.classList.add('ib-selectable');card.classList.toggle('ib-selected',selected);actions.hidden=!selected;
    card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-expanded',String(selected));
    card.setAttribute('aria-label','Select '+(entry.filename||'item analysis')+' actions; double click to open');
    card.dataset.analysisId='workspace:'+entry.id;
    const toggle=()=>{window.itemBloomHomeSelectedAnalysis=window.itemBloomHomeSelectedAnalysis===card.dataset.analysisId?'':card.dataset.analysisId;document.dispatchEvent(new Event('ib-analysis-selection'));};
    card.addEventListener('click',event=>{if(!event.target.closest('button'))toggle();});
    card.addEventListener('dblclick',event=>{if(!event.target.closest('button')){event.preventDefault();openWorkspace(entry.id);}});
    card.addEventListener('keydown',event=>{if(event.target.closest('button'))return;if(event.key==='Enter'){event.preventDefault();openWorkspace(entry.id);}else if(event.key===' '){event.preventDefault();toggle();}});
    card.append(body,actions);list.append(card);
   }
  }catch(ex){list.replaceChildren();const error=document.createElement('div');error.className='recent-meta';error.textContent='Item Analysis workspace storage unavailable: '+ex.message;list.append(error);}
 }
 function makeOverlay(){
  frameReady=false;overlay=document.createElement('section');overlay.className='ib-analysis-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Item Analysis workspace');
  const bar=document.createElement('div');bar.className='ib-analysis-toolbar';
  const title=document.createElement('span');title.textContent='ItemBloom · Item Analysis';
  closeButton=btn('✕ Close',()=>requestClose());closeButton.setAttribute('aria-label','Close Item Analysis workspace');
  bar.append(title,closeButton);frame=document.createElement('iframe');frame.title='ItemBloom Item Analysis';frame.setAttribute('allow','');
  overlay.append(bar,frame);document.body.append(overlay);
 }
 function openWorkspace(id){open('record='+encodeURIComponent(id));}
 function open(mode='import=1'){
  if(overlay)return;
  previousFocus=document.activeElement;
  makeOverlay();
  const qs=mode.startsWith('record=')?'?'+mode:'?create=1';
  frame.src='./item-analysis/index.html'+qs;
  document.body.style.overflow='hidden';closeButton.focus();
 }
 function finishClose(){if(!overlay)return;overlay.remove();overlay=null;frame=null;frameReady=false;closing=false;document.body.style.overflow='';if(previousFocus?.isConnected)previousFocus.focus();void refreshWorkspaces();}
 function requestClose(){
  if(!overlay||closing)return;
  closing=true;closeButton.disabled=true;closeButton.textContent='Closing…';
  if(!frame?.contentWindow||!frameReady){finishClose();return;}
  const targetWindow=frame.contentWindow;
  let settled=false;
  const onAck=event=>{
   if(event.source!==targetWindow||((location.origin==='null'||location.protocol==='file:')?event.origin!=='null'&&event.origin!==location.origin:event.origin!==location.origin)||event.data?.type!=='IB_WORKSPACE_CLOSE_READY')return;
   settled=true;window.removeEventListener('message',onAck);clearTimeout(timeout);
   if(event.data.ok){finishClose();return;}
   closeButton.disabled=false;closeButton.textContent='✕ Close';closing=false;
   if(confirm('Local changes could not be saved. Close without saving them? Cancel to keep this workspace open.'))finishClose();
  };
  window.addEventListener('message',onAck);
  targetWindow.postMessage({type:'IB_WORKSPACE_CLOSE_REQUEST'},(location.origin==='null'||location.protocol==='file:')?'*':location.origin);
  const timeout=setTimeout(()=>{if(settled)return;window.removeEventListener('message',onAck);if(!overlay)return;
   closeButton.disabled=false;closeButton.textContent='✕ Close';closing=false;
   if(confirm('Item Analysis is not responding to the close request. Close anyway? Any unsaved changes may be lost.'))finishClose();
  },8000);
 }
 const backupStore=kind=>kind==='workspace'?STORE:'itembloom-item-analysis-v1';
 function readRestoreTarget(kind,id){return transaction(['metadata','data'],'readonly',tx=>Promise.all([
  requestResult(tx.objectStore('metadata').get(id)),requestResult(tx.objectStore('data').get(id))
 ]).then(([metadata,data])=>({metadata,data})),backupStore(kind));}
 function commitRestored(prepared,expected){
  const {kind,record}=prepared,id=record.metadata.id;
  return transaction(['metadata','data'],'readwrite',tx=>{
   const a=tx.objectStore('metadata').get(id),b=tx.objectStore('data').get(id);let done=0;
   const write=()=>{if(++done!==2)return;
    if(JSON.stringify({metadata:a.result,data:b.result})!==JSON.stringify(expected)){tx.abort();return;}
    tx.objectStore('metadata').put(record.metadata);
    tx.objectStore('data').put(kind==='workspace'?{id,snapshot:record.snapshot}:{id,payload:record.payload});
   };a.onsuccess=write;b.onsuccess=write;
  },backupStore(kind));
 }
 function restoreChoice(){return new Promise(resolve=>{
  const dialog=document.createElement('dialog'),message=document.createElement('p');
  message.textContent='This backup matches an existing Item Analysis record. Restore as Copy keeps the existing record. Replace overwrites it with this backup.';
  dialog.append(message);
  for(const [value,label] of [['copy','Restore as Copy'],['replace','Replace'],['cancel','Cancel']])dialog.append(btn(label,()=>dialog.close(value)));
  dialog.addEventListener('close',()=>{const value=dialog.returnValue;dialog.remove();resolve(['copy','replace'].includes(value)?value:'cancel');},{once:true});
  document.body.append(dialog);dialog.showModal();dialog.lastElementChild.focus();
 });}
 const restoreInput=document.createElement('input');restoreInput.type='file';restoreInput.accept='.json,application/json';restoreInput.hidden=true;
 const restoreButton=btn('Import/Restore Backup',()=>restoreInput.click());restoreButton.id='restoreAnalysisBackup';upload.before(restoreButton);document.body.append(restoreInput);
 restoreInput.addEventListener('change',async()=>{
  const file=restoreInput.files?.[0];restoreInput.value='';if(!file)return;
  if(overlay){notify('Close the current workspace before restoring a backup.');return;}
  restoreButton.disabled=true;
  try{
   const api=globalThis.ItemBloomBackup;if(file.size>api.MAX_BYTES)throw Error('Backup exceeds the 64 MB restore limit.');
   const decoded=api.decode(await file.text());
   const existing=await readRestoreTarget(decoded.kind,decoded.record.metadata.id);
   const choice=(existing.metadata||existing.data)?await restoreChoice():'new';if(choice==='cancel')return;
   const prepared=api.prepare(decoded,choice,'ib-restore-'+crypto.randomUUID());
   const expected=choice==='copy'?await readRestoreTarget(prepared.kind,prepared.record.metadata.id):existing;
   if(choice==='copy'&&(expected.metadata||expected.data))throw Error('Copy identity already exists. Try again.');
   await commitRestored(prepared,expected);
   const stored=await readRestoreTarget(prepared.kind,prepared.record.metadata.id);
   const wanted={metadata:prepared.record.metadata,data:prepared.kind==='workspace'?{id:prepared.record.metadata.id,snapshot:prepared.record.snapshot}:{id:prepared.record.metadata.id,payload:prepared.record.payload}};
   if(JSON.stringify(stored)!==JSON.stringify(wanted))throw Error('Restored record could not be verified. Keep your backup file.');
   await refreshWorkspaces();document.dispatchEvent(new Event('ib-backup-restored'));
   notify('Item Analysis backup restored and verified'+(choice==='copy'?' as a copy.':'.'));
  }catch(error){notify('Backup restore failed: '+(error?.message||'Storage failed or the existing record changed. No replacement was committed.'));}
  finally{restoreButton.disabled=false;}
 });
 // Capture to replace only the old extraction window action; existing saved extraction views are preserved.
 upload.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();open();},true);
 window.addEventListener('message',event=>{
  if(!overlay||event.source!==frame?.contentWindow||((location.origin==='null'||location.protocol==='file:')?event.origin!=='null'&&event.origin!==location.origin:event.origin!==location.origin))return;
  if(event.data?.type==='IB_WORKSPACE_READY'){frameReady=true;return;}
  if(event.data?.type==='IB_TOS_BRIDGE_REQUEST'){
   const {operation,id,requestId}=event.data;
   if(typeof requestId!=='string'||requestId.length>100||!['list','read'].includes(operation))return;
   (async()=>{
    let result,ok=true,error='';
    try{
     if(operation==='list')result=window.ItemBloomListAssessments();
     else if(typeof id==='string'&&id.length<150)result=await window.ItemBloomReadAssessment(id);
     else throw Error('Invalid TOS assessment ID.');
    }catch(ex){ok=false;error=String(ex?.message||'Unable to read TOS assessment.');}
    if(event.source===frame?.contentWindow)event.source.postMessage({type:'IB_TOS_BRIDGE_RESPONSE',requestId,ok,result,error},(location.origin==='null'||location.protocol==='file:')?'*':location.origin);
   })();
   return;
  }
  if(event.data?.type==='IB_WORKSPACE_SAVED')void refreshWorkspaces();
 });
 window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&overlay&&document.activeElement!==frame){event.preventDefault();requestClose();}
 });
 window.addEventListener('pageshow',()=>void refreshWorkspaces());
 void refreshWorkspaces();
})();
