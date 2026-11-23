/* IB-IA-EXTRACT-001: browser-only ZipGrade/EvalBee CSV extraction and local record list.
   No server calls, no scores recomputed, and no item-analysis statistics at this stage. */
'use strict';
(() => {
  const DB_NAME='itembloom-item-analysis-v1';
  let worker=null,pending=null,saving=false,opened=false;
  const modal=$('analysisOverlay'),preview=$('analysisPreview'),progress=$('analysisProgress'),input=$('analysisCSVInput');
  const parseButton=$('analysisParse'),saveButton=$('analysisSave');
  function database(){return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window))return reject(Error('This browser does not support IndexedDB local storage.'));
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('metadata',{keyPath:'id'});db.createObjectStore('data',{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||Error('Could not open local item analysis storage.'));
  });}
  async function transaction(stores,mode,fn){const db=await database();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let value;
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error||Error('Local storage transaction failed.'));
    tx.onabort=()=>reject(tx.error||Error('Local storage was interrupted.'));
    try{value=fn(tx);}catch(ex){tx.abort();reject(ex);}
  });}finally{db.close();}}
  const getAllMeta=()=>transaction(['metadata'],'readonly',tx=>new Promise((resolve,reject)=>{const q=tx.objectStore('metadata').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);})).then(x=>x);
  const getMeta=id=>transaction(['metadata'],'readonly',tx=>new Promise((resolve,reject)=>{const q=tx.objectStore('metadata').get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);})).then(x=>x);
  function unifyPayload(payload){
    if(!payload||!Array.isArray(payload.learners))return payload;
    if(payload.schema==='ItemBloom-CSV-Extraction-v2')return payload;
    // Backward-compatible read of beta2 preview datasets, without keeping redundant name fields.
    payload.learners=payload.learners.map(p=>({
      name:String((p.name??(p.fullName||[p.familyName,p.givenName].filter(Boolean).join(', ')))||''),
      rosterNumber:String(p.rosterNumber??''),score:String(p.score??'')
    }));
    payload.schema='ItemBloom-CSV-Extraction-v2';
    return payload;
  }
  const getData=id=>transaction(['data'],'readonly',tx=>new Promise((resolve,reject)=>{const q=tx.objectStore('data').get(id);q.onsuccess=()=>resolve(q.result?.payload);q.onerror=()=>reject(q.error);})).then(unifyPayload);
  const putMeta=record=>transaction(['metadata'],'readwrite',tx=>{tx.objectStore('metadata').put(record);});
  const removeRecord=id=>transaction(['metadata','data'],'readwrite',tx=>{tx.objectStore('metadata').delete(id);tx.objectStore('data').delete(id);});
  const putRecord=(meta,payload)=>transaction(['metadata','data'],'readwrite',tx=>{tx.objectStore('metadata').put(meta);tx.objectStore('data').put({id:meta.id,payload});});
  const status=message=>{progress.textContent=message;};
  function closeDialog(){if(saving)return;if(worker){worker.terminate();worker=null;}modal.classList.add('hidden');input.value='';pending=null;preview.classList.add('hidden');preview.replaceChildren();parseButton.disabled=true;saveButton.disabled=true;opened=false;}
  function openDialog(){if(opened)return;opened=true;modal.classList.remove('hidden');$('analysisModalTitle').textContent='Upload CSV for Item Analysis';input.value='';preview.classList.add('hidden');preview.replaceChildren();parseButton.disabled=true;saveButton.disabled=true;pending=null;status('CSV has not been selected.');modal.querySelector('.analysis-dialog').focus();}
  function fragmentText(parent,tag,text,cls){const el=e(tag,text,cls);parent.append(el);return el;}
  function showPreview(meta,payload){
    preview.replaceChildren();preview.classList.remove('hidden');
    const count=payload.itemCount||meta.itemCount;
    fragmentText(preview,'strong',`${meta.source} · ${meta.learnerCount.toLocaleString()} learners · ${meta.itemCount.toLocaleString()} items`);
    fragmentText(preview,'div',`Exam: ${meta.exam||'—'}${meta.examSet?' · Exam Set: '+meta.examSet:''}`,'recent-meta');
    fragmentText(preview,'div',`Stage: ${meta.status} · No item-analysis computations have been performed.`,'recent-meta');
    if(meta.source==='EvalBee')fragmentText(preview,'div','EvalBee: learner names are read from column D and roster numbers from column C. The complete name is retained in the shared name field.','analysis-warning');
    for(const w of meta.warnings||[])fragmentText(preview,'div',`⚠ ${w.message}${w.count>1?' ('+w.count+' occurrences)':''}${w.examples?.length?' [CSV row '+w.examples.join(', ')+']':''}`,'analysis-warning');
    const first=Math.min(count,8);
    fragmentText(preview,'div','Answer key (first '+first+' items): '+payload.answerKey.slice(0,first).map((v,i)=>(i+1)+': '+(v||'blank')).join(' · '),'analysis-warning');
    const wrap=fragmentText(preview,'div',undefined,'analysis-table-wrap');const table=e('table'),thead=e('thead'),tr=e('tr');
    for(const h of ['Learner','Roster','Score',...Array.from({length:first},(_,i)=>'Item '+(i+1))])fragmentText(tr,'th',h);
    thead.append(tr);table.append(thead);const body=e('tbody');
    for(let i=0;i<Math.min(5,payload.learners.length);i++){
      const person=payload.learners[i],row=e('tr'),name=person.name;
      for(const v of [name,person.rosterNumber,person.score])fragmentText(row,'td',v||'—');
      const group=Math.floor(i/256),offset=(i%256)*count,chunk=payload.blocks[group];
      for(let j=0;j<first;j++)fragmentText(row,'td',payload.dictionary[chunk[offset+j]]||'—');
      body.append(row);
    }
    table.append(body);wrap.append(table);
    fragmentText(preview,'div',`Preview of the first ${Math.min(5,payload.learners.length)} learner records and ${first} items. All extracted responses are retained locally.`,'recent-meta');
  }
  function iconButton(actions,glyph,title,handler,danger=false){const btn=e('button',undefined,'btn '+(danger?'danger':'secondary')+' compact icon-btn');btn.type='button';btn.title=title;btn.setAttribute('aria-label',title);btn.innerHTML=ASSESSMENT_ICONS[glyph]||glyph;btn.addEventListener('click',handler);actions.append(btn);return btn;}
  async function refreshList(){const root=$('analysisList');root.replaceChildren();try{
    const query=($('homeAnalysisSearch')?.value||'').trim().toLocaleLowerCase();
    const all=(await getAllMeta()).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).filter(m=>!query||[m.title,m.source,m.exam,m.examSet,m.itemCount].some(v=>String(v||'').toLocaleLowerCase().includes(query)));
    $('analysisCount').textContent=`${all.length} local records`;
    if(!all.length){root.append(e('div','No item analysis records yet. Upload a ZipGrade or EvalBee CSV to extract its data.','empty-recent'));return;}
    for(const meta of all){
      const card=e('div',undefined,'recent-item'),main=e('div'),title=e('div',meta.title||'Untitled extraction','recent-title');
      const sub=e('div',`${meta.itemCount} items · ${meta.updatedAt?new Date(meta.updatedAt).toLocaleString('en-US'):''}`,'recent-meta'),fileline=e('div',`${meta.title||'Local extraction'} · ${meta.source} · ${meta.learnerCount} examinees`,'recent-path');
      const marker=e('span','EXTRACTED','kind-pill draft'),actions=e('div',undefined,'recent-actions');
      main.append(title,marker,sub,fileline);
      iconButton(actions,'👁','View extracted data',()=>viewRecord(meta.id));
      iconButton(actions,'⧉','Copy extracted dataset',()=>copyRecord(meta.id));
      iconButton(actions,'Aa','Rename record',()=>renameRecord(meta.id));
      iconButton(actions,'↪','Download local backup',()=>downloadRecord(meta.id));
      iconButton(actions,'🗑','Delete record',()=>deleteRecord(meta.id),true);
      const selected=window.itemBloomHomeSelectedAnalysis==='legacy:'+meta.id;
      card.classList.add('ib-selectable');card.classList.toggle('ib-selected',selected);actions.hidden=!selected;
      card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-expanded',String(selected));card.setAttribute('aria-label','Select '+(meta.title||'extraction')+' actions; double click to view');
      card.dataset.analysisId='legacy:'+meta.id;
      const toggle=()=>{window.itemBloomHomeSelectedAnalysis=window.itemBloomHomeSelectedAnalysis===card.dataset.analysisId?'':card.dataset.analysisId;document.dispatchEvent(new Event('ib-analysis-selection'));};
      card.addEventListener('click',e=>{if(!e.target.closest('button'))toggle();});
      card.addEventListener('dblclick',e=>{if(!e.target.closest('button')){e.preventDefault();viewRecord(meta.id);}});
      card.addEventListener('keydown',e=>{if(e.target.closest('button'))return;if(e.key==='Enter'){e.preventDefault();viewRecord(meta.id);}else if(e.key===' '){e.preventDefault();toggle();}});
      card.append(main,actions);root.append(card);
    }
  }catch(ex){$('analysisCount').textContent='Unavailable';root.append(e('div',`Local item analysis storage unavailable: ${ex.message}`,'empty-recent'));}}
  async function viewRecord(id){try{
    if(worker){worker.terminate();worker=null;}const meta=await getMeta(id),payload=await getData(id);
    if(!meta||!payload)throw Error('The saved extraction is incomplete or unavailable.');
    openDialog();$('analysisModalTitle').textContent='Extracted data preview';input.closest('.field').classList.add('hidden');
    parseButton.classList.add('hidden');saveButton.classList.add('hidden');
    status('Saved locally in this browser.');showPreview(meta,payload);
  }catch(ex){showMessage(`Cannot open extracted data: ${ex.message}`,'error');}}
  function restoreUploadControls(){input.closest('.field').classList.remove('hidden');parseButton.classList.remove('hidden');saveButton.classList.remove('hidden');}
  async function renameRecord(id){const meta=await getMeta(id);if(!meta)return;const newName=window.prompt('Name of extracted dataset:',meta.title);if(newName===null)return;const clean=safeName(newName);if(!clean){showMessage('Enter a valid name for the dataset.','warn');return;}meta.title=clean;meta.updatedAt=new Date().toISOString();try{await putMeta(meta);await refreshList();}catch(ex){showMessage('Rename failed: '+ex.message,'error');}}
  async function deleteRecord(id){const meta=await getMeta(id);if(!meta||!window.confirm(`Delete the locally saved extracted data “${meta.title}”? This action cannot be undone.`))return;try{await removeRecord(id);await refreshList();showMessage('Local extraction deleted.','');}catch(ex){showMessage('Could not delete extraction: '+ex.message,'error');}}
  async function copyRecord(id){try{const meta=await getMeta(id),payload=await getData(id);if(!meta||!payload)throw Error('Record not found.');const now=new Date().toISOString();const copy={...meta,id:`ia-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,title:meta.title+' (Copy)',createdAt:now,updatedAt:now};await putRecord(copy,payload);await refreshList();showMessage('Local extraction copied.','');}catch(ex){showMessage('Copy failed: '+ex.message,'error');}}
  async function downloadRecord(id){try{
    const meta=await getMeta(id),payload=await getData(id);if(!meta||!payload)throw Error('Record not found.');
    // Build one JSON blob in pieces, never expanding the entire answer matrix as one giant JS array.
    const parts=['{"metadata":',JSON.stringify(meta),',"payload":{"schema":',JSON.stringify(payload.schema),',"source":',JSON.stringify(payload.source),',"itemCount":',String(payload.itemCount),',"learnerCount":',String(payload.learnerCount),',"answerKey":',JSON.stringify(payload.answerKey),',"learners":',JSON.stringify(payload.learners),',"dictionary":',JSON.stringify(payload.dictionary),',"blockRows":256,"blocks":['];
    // Serialize bounded numeric slices; avoid Array.from() on a multi-million-cell block.
    for(let i=0;i<payload.blocks.length;i++){
      if(i)parts.push(',');parts.push('[');
      const block=payload.blocks[i];
      for(let j=0;j<block.length;j+=8192){
        if(j)parts.push(',');parts.push(block.subarray(j,Math.min(j+8192,block.length)).join(','));
      }
      parts.push(']');
    }
    parts.push(']}}');
    const blob=new Blob(parts,{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=safeName(meta.title||'ItemBloom extraction')+'.ibextraction.json';link.style.display='none';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    showMessage('Local extraction backup downloaded.','');
  }catch(ex){showMessage('Download failed: '+ex.message,'error');}}
  function startParse(){
    const file=input.files?.[0];if(!file)return status('Choose a CSV file.');
    if(worker){worker.terminate();worker=null;}pending=null;preview.replaceChildren();preview.classList.add('hidden');saveButton.disabled=true;parseButton.disabled=true;
    if(!/\.csv$/i.test(file.name)||file.size>250*1024*1024){status('Select a .csv file smaller than 250 MB.');parseButton.disabled=false;return;}
    status('Reading CSV only on this device…');
    try{worker=new Worker('./csv-extractor.worker.js');}catch(ex){status('Browser worker unavailable: '+ex.message);parseButton.disabled=false;return;}
    const active=worker;
    active.onmessage=({data})=>{
      if(active!==worker)return;
      if(data.type==='progress')status(`${data.phase}: ${data.learners.toLocaleString()} learners, ${data.items.toLocaleString()} items. Processing on this device.`);
      if(data.type==='error'){status('CSV not accepted: '+data.message);active.terminate();worker=null;parseButton.disabled=false;}
      if(data.type==='done'){
        pending=data.result;active.terminate();worker=null;parseButton.disabled=false;saveButton.disabled=false;
        status(`Detected ${pending.metadata.source}. Extracted ${pending.metadata.learnerCount.toLocaleString()} learners and ${pending.metadata.itemCount.toLocaleString()} items locally. Review below, then save.`);
        showPreview(pending.metadata,pending.payload);
      }
    };
    active.onerror=ev=>{if(active!==worker)return;status('Extraction failed: '+(ev.message||'Unexpected local error'));active.terminate();worker=null;parseButton.disabled=false;};
    active.postMessage({type:'parse',file});
  }
  $('uploadAnalysisCSV').addEventListener('click',()=>{restoreUploadControls();openDialog();});
  input.addEventListener('change',()=>{parseButton.disabled=!input.files?.length;if(input.files?.length){status('Selected: '+input.files[0].name+' — click Upload CSV to process locally.');preview.classList.add('hidden');pending=null;saveButton.disabled=true;}});
  parseButton.addEventListener('click',startParse);
  saveButton.addEventListener('click',async()=>{
    if(!pending||saving)return;saving=true;saveButton.disabled=true;parseButton.disabled=true;status('Saving extracted data in this browser…');
    try{const {metadata,payload}=pending;await putRecord(metadata,payload);pending=null;status('Extraction saved locally. Item-analysis calculations remain pending.');await refreshList();showMessage('CSV extraction saved in local browser storage.','');}
    catch(ex){saveButton.disabled=false;status('Local save failed: '+ex.message);}
    finally{saving=false;parseButton.disabled=false;}
  });
  $('analysisClose').addEventListener('click',()=>{closeDialog();restoreUploadControls();});
  $('analysisCancel').addEventListener('click',()=>{closeDialog();restoreUploadControls();});
  modal.addEventListener('click',ev=>{if(ev.target===modal){closeDialog();restoreUploadControls();}});
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&!modal.classList.contains('hidden')){closeDialog();restoreUploadControls();}});
  document.addEventListener('ib-backup-restored',()=>refreshList());
  window.addEventListener('pageshow',()=>refreshList());
  document.getElementById('homeAnalysisSearch')?.addEventListener('input',()=>refreshList());
  document.addEventListener('ib-analysis-selection',()=>{
   document.querySelectorAll('#analysisCombinedScroll .ib-selectable').forEach(card=>{
    const yes=!!window.itemBloomHomeSelectedAnalysis&&card.dataset.analysisId===window.itemBloomHomeSelectedAnalysis;
    card.classList.toggle('ib-selected',yes);
    const tools=card.querySelector('.record-actions,.recent-actions');if(tools)tools.hidden=!yes;
    card.setAttribute('aria-expanded',String(yes));
   });
  });
  refreshList();
})();
