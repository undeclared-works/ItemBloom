/* ItemBloom import module UI. Standalone offline prototype; no requests or external dependencies. */
(() => {
'use strict';
const parser=globalThis.ItemBloomParser;
const $=id=>document.getElementById(id);
const state={data:null,key:[],points:[],modes:[],choiceCount:4,originalKey:[],undo:[],redo:[],view:'import',query:'',analysis:null,threshold:70,groupPercent:27,edits:[],linkedAssessment:null,competencyMap:[],paper:null,manualMode:null,sectionsText:''};
const get=id=>$(id);
let editingLearnerId=null;
const multipleEntryMode=new Set();
function el(tag, attrs={},text){const n=document.createElement(tag);Object.entries(attrs).forEach(([k,v])=>{if(k==='class')n.className=v;else n.setAttribute(k,v)});if(text!==undefined)n.textContent=String(text);return n;}
function clear(node){node.replaceChildren();}
const decimal=x=>Number.isFinite(x)?x.toFixed(2):'—';
const HISTORY_LIMIT=100;
let loadingWorkspace=false, saveTimer=null, saveSerial=Promise.resolve(true), dirtyRevision=0, persistedRevision=0, queuedRevision=0, lastSaveOk=true;
let workspaceId=null,workspaceBaseline=null,workspaceGeneration=0,conflictBlocked=false;
function sectionsDisplay(text){
 const arr=String(text||'').split(/[,;\n]+/).map(v=>v.trim()).filter(Boolean);
 if(!arr.length)return '';
 const clean=[...new Set(arr)];
 return clean.length>1?'Combined ('+clean.join(' + ')+')':clean[0];
}
function recordContext(){
 const linked=state.linkedAssessment||{};
 const manual=sectionsDisplay(state.sectionsText||'');
 const section=manual||(linked.section||'');
 const grade=String(linked.grade||'').replace(/^GRADE\s+/i,'Grade ').trim();
 return [grade,section,linked.subject||''].filter(Boolean).join(' · ');
}
function safeWorkspaceMeta(){
 if(!state.data)return null;
 const linked=state.linkedAssessment||{};
 return {id:workspaceId,source:state.data.provider||state.data.sourceSchema||'Imported',filename:state.data.filename||'Results',linkedAssessmentTitle:linked.title||'',grade:linked.grade||'',subject:linked.subject||'',section:sectionsDisplay(state.sectionsText)||linked.section||'',term:linked.term||'',schoolYear:linked.schoolYear||'',testType:linked.testType||'',otherTestType:linked.otherTestType||'',itemCount:state.data.itemCount,learnerCount:state.data.examineeCount,updatedAt:new Date().toISOString()};
}
function showSaveFailure(){
 let status=$('localSaveStatus');
 if(!status){
  status=el('p',{id:'localSaveStatus',class:'notice',role:'status'});
  const retry=el('button',{type:'button',class:'light'},'Retry save');
  retry.addEventListener('click',()=>{conflictBlocked=false;void flushWorkspace();});
  status.append(el('span',{},'Local save failed. Keep this workspace open and retry before closing or replacing it. '),retry);
  document.querySelector('main').prepend(status);
 }
 status.hidden=false;
}
function clearVerifiedSaveWarning(){
 if(loadingWorkspace||conflictBlocked||!lastSaveOk||dirtyRevision!==persistedRevision)return;
 const status=$('localSaveStatus');if(status)status.hidden=true;
}
function currentWorkspaceSnapshot(){return {data:state.data,key:state.key,originalKey:state.originalKey,points:state.points,modes:state.modes,choiceCount:state.choiceCount,threshold:state.threshold,groupPercent:state.groupPercent,edits:state.edits,linkedAssessment:state.linkedAssessment,competencyMap:state.competencyMap,paper:state.paper,manualMode:state.manualMode,sectionsText:state.sectionsText,view:state.view};}
async function resolveWorkspaceConflict(error){
 conflictBlocked=true;clearTimeout(saveTimer);saveTimer=null;
 const api=globalThis.ItemBloomWorkspace,guard=globalThis.ItemBloomSaveGuard;
 const choice=await guard.choose('A newer Item Analysis workspace exists. Your pending edits were preserved in a recovery copy. Choose Reload latest, Save as Copy, or Cancel to keep editing.');
 const recovery=await api.load(error.recoveryId);
 if(!recovery)throw Error('Recovery copy is unavailable; keep this editor open.');
 recovery.metadata={...recovery.metadata,...safeWorkspaceMeta(),id:error.recoveryId,filename:(safeWorkspaceMeta().filename||'Analysis')+(choice==='copy'?' (Copy)':' (Recovery)')};
 await api.save(recovery.metadata,currentWorkspaceSnapshot(),recovery.baseline);
 if(choice==='cancel'){showSaveFailure();return false;}
 const id=choice==='copy'?error.recoveryId:workspaceId;
 await loadWorkspace(id);clearVerifiedSaveWarning();return true;
}
async function saveWorkspace(){
 if(conflictBlocked)return false;
 if(loadingWorkspace||!state.data||!workspaceId)return true;
 if(dirtyRevision<=Math.max(persistedRevision,queuedRevision))return saveSerial;
 const meta=safeWorkspaceMeta();
 const rev=dirtyRevision;queuedRevision=rev;
 const snapshot=currentWorkspaceSnapshot(),generation=workspaceGeneration;
 saveSerial=saveSerial.catch(()=>false).then(async()=>{
  if(generation!==workspaceGeneration||conflictBlocked){if(queuedRevision===rev)queuedRevision=persistedRevision;return false;}
  try{
   // IndexedDB performs its own structured clone on put(); avoid a duplicate full-sized clone.
   workspaceBaseline=await globalThis.ItemBloomWorkspace.save(meta,snapshot,workspaceBaseline)??workspaceBaseline;
   persistedRevision=Math.max(persistedRevision,rev);lastSaveOk=true;
   clearVerifiedSaveWarning();
   // The Home list refreshes once on close, not after each keystroke/save.
   return true;
  }catch(error){
   lastSaveOk=false;if(queuedRevision===rev)queuedRevision=persistedRevision;console.error('Local workspace save failed:',error);
   if(error?.code==='SAVE_CONFLICT'){try{return await resolveWorkspaceConflict(error)}catch(recoveryError){console.error('Conflict recovery failed:',recoveryError);}}
   showSaveFailure();
   return false;
  }
 });
 return saveSerial;
}
function scheduleWorkspaceSave(){
 if(loadingWorkspace||!state.data||!workspaceId)return;
 dirtyRevision++;
 clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=null;void saveWorkspace();},950);
}
async function flushWorkspace(){
 clearTimeout(saveTimer);saveTimer=null;
 await saveSerial;
 while(state.data&&workspaceId&&dirtyRevision>persistedRevision){
  if(!await saveWorkspace())return false;
 }
 return dirtyRevision===persistedRevision&&lastSaveOk;
}

async function loadWorkspace(id){
 loadingWorkspace=true;
 try{
 const record=await globalThis.ItemBloomWorkspace.load(id);
 if(!record)throw Error('Saved Item Analysis record not found.');
 const a=record.snapshot;setCSV(a.data,true);workspaceId=record.metadata.id;workspaceBaseline=record.baseline;conflictBlocked=false;dirtyRevision=0;persistedRevision=0;queuedRevision=0;lastSaveOk=true;
 state.key=a.key.map(x=>[...x]);state.originalKey=a.originalKey.map(x=>[...x]);state.points=[...a.points];state.modes=[...a.modes];state.choiceCount=a.choiceCount;state.threshold=Number(a.threshold??70);state.groupPercent=Number(a.groupPercent??27);state.edits=a.edits||[];state.linkedAssessment=a.linkedAssessment||null;state.competencyMap=a.competencyMap||[];state.paper=a.paper||null;state.manualMode=a.manualMode||null;state.sectionsText=String(a.sectionsText||'');$('analysisSections').value=state.sectionsText;state.undo=[];state.redo=[];state.analysis=null;
 $('passThreshold').value=state.threshold;$('groupPercent').value=String(state.groupPercent);renderChoiceCount();updateHistoryButtons();renderImport();switchView('import');await refreshAssessmentOptions();renderPaperPreview();if(a.view==='analysis'&&(isAggregate()?validAggregate():validKey()))performAnalysis();
 }finally{loadingWorkspace=false;}
}

function snapshotKeyEditor(){return {key:state.key.map(a=>[...a]),points:[...state.points],modes:[...state.modes],choiceCount:state.choiceCount};}
function sameSnapshot(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function restoreKeyEditor(snap){
 state.key=snap.key.map(x=>[...x]);state.points=[...snap.points];state.modes=[...snap.modes];state.choiceCount=snap.choiceCount;
 if(state.choiceCount<minimumChoiceCount())state.choiceCount=minimumChoiceCount();
 invalidateAnalysis();renderKeys();refreshReadiness();renderAnswerKeyPreview();
}
function updateHistoryButtons(){
 $('undoKey').disabled=!state.undo.length;$('redoKey').disabled=!state.redo.length;
 $('undoKey').title=state.undo.length?`Undo (${state.undo.length} available)`:'Nothing to undo';
 $('redoKey').title=state.redo.length?`Redo (${state.redo.length} available)`:'Nothing to redo';
}
function historyPush(before){
 if(sameSnapshot(before,snapshotKeyEditor()))return false;
 state.undo.push(before);if(state.undo.length>HISTORY_LIMIT)state.undo.shift();state.redo.length=0;updateHistoryButtons();return true;
}
function keyNotice(message){$('keyActionMessage').textContent=message;}
function invalidateAnalysis(){state.analysis=null;$('tab-analysis').disabled=true;}
function editorMutation(mutator,notice){
 const before=snapshotKeyEditor();mutator();
 if(!historyPush(before))return false;
 if(state.choiceCount<minimumChoiceCount())state.choiceCount=minimumChoiceCount();
 invalidateAnalysis();renderKeys();refreshReadiness();renderAnswerKeyPreview();
 if(notice)keyNotice(notice);scheduleWorkspaceSave();return true;
}
function undoKeyEdit(){if(!state.undo.length)return;const prior=state.undo.pop();state.redo.push(snapshotKeyEditor());restoreKeyEditor(prior);updateHistoryButtons();keyNotice('Last editor change undone.');scheduleWorkspaceSave();}
function redoKeyEdit(){if(!state.redo.length)return;const next=state.redo.pop();state.undo.push(snapshotKeyEditor());if(state.undo.length>HISTORY_LIMIT)state.undo.shift();restoreKeyEditor(next);updateHistoryButtons();keyNotice('Editor change restored.');scheduleWorkspaceSave();}
// The choices floor covers both the accepted key and observed marked options.
// T/F rows use a separate response kind; an ambiguous stand-alone F is treated
// conservatively as option F unless a true/false T appears in that same item.
function minimumChoiceCount(){
 if(!state.data)return 2;
 let required=2;
 for(let j=0;j<state.data.itemCount;j++){
  const counts=state.data.optionCounts?.[j]||{};
  const values=[...state.key[j],...state.data.learners.map(l=>l.answers[j]),...Object.entries(counts).filter(([letter,n])=>Number(n)>0).map(([letter])=>letter)].map(x=>String(x||'').toUpperCase());
  const trueFalse=values.some(x=>x==='T');
  for(const value of values){
   if(!/^[A-J]+$/.test(value))continue;
   for(const letter of value){
    if(letter==='F'&&trueFalse&&value.length===1)continue;
    required=Math.max(required,letter.charCodeAt(0)-64);
   }
  }
 }
 return Math.max(2,Math.min(10,required));
}
function renderChoiceCount(){
 const min=minimumChoiceCount(),sel=$('choiceCount');
 for(const option of sel.options)option.disabled=Number(option.value)<min;
 sel.value=String(state.choiceCount);
 $('choiceCountHint').textContent=min>2?`Minimum ${min} choices: current key or learner answers include option ${String.fromCharCode(min+64)}.`:'Minimum 2 choices. Default 4.';
}

function switchView(name){
 if(!state.data && name!=='import')return;
 if(name==='analysis'&&!state.analysis)return;
 if(name==='edit'&&(!state.data?.learners?.length||isAggregate()))return;
 state.view=name;
 const names={import:['Import Exam Results','Review the extracted results before running Item Analysis.'],edit:['Edit Individual Responses','Select a learner and edit the answers in a compact, three-column layout.'],key:['Answer Key Editor','Verify accepted answers and point values.'],analysis:['Item Analysis','All statistics refer to the current imported assessment.']};
 ['import','edit','key','analysis'].forEach(id=>{$(id+'View').classList.toggle('hide',id!==name);$('tab-'+id).classList.toggle('active',id===name)});
 $('pageTitle').textContent=names[name][0];$('pageSubtitle').textContent=names[name][1]+(recordContext()?' · '+recordContext():'');
 if(name==='import'&&isAggregate())renderAggregateGrid();
 if(name==='edit')renderIndividualEditor();if(name==='key')renderKeys();if(name==='analysis')renderAnalysis();
}
function isTrueFalseItem(j){return state.key[j].includes('T')||state.data.learners.some(l=>l.answers[j]==='T');}
function keyWithinChoices(letter,j){return !(/^[A-J]$/.test(letter))||(letter==='F'&&isTrueFalseItem(j))||letter.charCodeAt(0)-64<=state.choiceCount;}
function isAggregate(){return state.data?.entryMode==='aggregate'||state.data?.entryMode==='option-counts'}
function isOptionCounts(){return state.data?.entryMode==='option-counts'}
const invalidOptionInputs=new Set();
function optionCount(value){if(value==null||typeof value==='string'&&!value.trim())return 0;if(typeof value!=='number'&&typeof value!=='string')return NaN;const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:NaN;}
function validAggregate(){
 if(!isAggregate()||invalidOptionInputs.size)return false;
 if(!state.points.every(x=>Number.isFinite(x)&&x>=0)||!state.points.some(x=>x>0))return false;
 const data=state.data;
 if(!isOptionCounts())return data.correctCounts?.length===data.itemCount&&data.correctCounts.every(x=>Number.isInteger(x)&&x>=0&&x<=data.examineeCount);
 if(!state.key.every((keys,j)=>state.points[j]===0||(keys.length>0&&keys.every(k=>keyWithinChoices(k,j))&&state.modes[j]!=='all')))return false;
 return data.optionCounts?.length===data.itemCount&&data.optionCounts.every((counts,j)=>{
  let sum=0;for(let i=0;i<state.choiceCount;i++){
   const val=optionCount(counts?.[String.fromCharCode(65+i)]);
   if(!Number.isFinite(val)||val>data.examineeCount)return false;
   sum+=val;
  }
  return sum<=data.examineeCount;
 });
}
function validKey(){const d=state.data;return d&&d.invalidCells===0&&state.key.length===d.itemCount&&state.key.every((ks,j)=>state.points[j]===0||(ks.length>0&&ks.every(a=>keyWithinChoices(a,j))))&&state.points.every(x=>Number.isFinite(x)&&x>=0)&&state.points.some(x=>x>0);}
function refreshReadiness(){const valid=isAggregate()?validAggregate():validKey();const has=state.data!==null;
 $('tab-key').disabled=!has;$('tab-edit').disabled=!has||isAggregate()||!state.data.learners?.length;$('tab-analysis').disabled=!state.analysis;
 $('analyzeButton').disabled=!valid;
 const count=state.key.filter((a,i)=>state.points[i]===0||(a.length>0&&a.every(t=>keyWithinChoices(t,i)))).length;
 if(has){$('keyCount').textContent=`${count} / ${state.data.itemCount}`;$('keySummary').textContent=`${count} of ${state.data.itemCount} items have a valid key or zero points`;
 $('readyText').textContent=valid?(isOptionCounts()?'Option totals validated (empty = zero). Difficulty and option frequencies only.':isAggregate()?'Correct counts validated. Difficulty only.':'Ready for local item analysis.'):isOptionCounts()?'Verify the answer key, use Any one scoring, and keep each item’s option counts within the examinee total.':isAggregate()?'Enter every item’s correct count (including 0), from 0 through the number of examinees.':state.data.invalidCells?'Unrecognized responses must be resolved before analysis.':'Complete the answer key and check the configured number of choices before analyzing.';
 }
}
function displayWarnings(){const a=$('alertBox');clear(a);if(!state.data.warnings.length){a.className='notice ok';a.textContent='Response data verified. Review the entries below.';return;}
 a.className='notice';const title=el('b',{},`${state.data.warnings.length} original import notice(s)`);a.appendChild(title);
 const list=el('ul');state.data.warnings.slice(0,8).forEach(w=>list.appendChild(el('li',{},w)));a.appendChild(list);
 if(state.data.warnings.length>8)a.appendChild(el('p',{},`Plus ${state.data.warnings.length-8} additional notices.`));
}
function renderImport(){const d=state.data; if(!d){$('emptyState').classList.remove('hide');$('resultsState').classList.add('hide');return;}
 $('emptyState').classList.add('hide');$('resultsState').classList.remove('hide');
 $('fileDetails').textContent=`${d.filename || 'Imported file'} · ${d.sourceSchema||d.provider} · Imported locally`+(recordContext()?' · '+recordContext():'');
 $('itemCount').textContent=d.itemCount;$('learnerCount').textContent=d.examineeCount;
 $('fieldCount').textContent=isAggregate()?'Counts only':`${d.blankCells} / ${d.invalidCells}`;
 $('aggregateWrap').classList.toggle('hide',!isAggregate());$('gridWrap').classList.toggle('hide',isAggregate());$('manualRowActions').classList.toggle('hide',state.manualMode==='full'?false:true);
 $('responseSectionTitle').textContent=isOptionCounts()?'Total responses per item':isAggregate()?'Correct responses per item':'Learner Response Table';
 $('aggregateHelp').textContent=isOptionCounts()?'Enter how many examinees selected each option. Leave a box blank for zero (0). Counts must be nonnegative and the sum for one item cannot exceed the examinee count. Unaccounted responses are treated as unanswered/other. These counts support difficulty and mean percentage only, not learner-group discrimination.':'Legacy correct-count record. Enter how many examinees answered each item correctly.';
 $('goEditResponses').classList.toggle('hide',isAggregate()||!d.learners?.length);
 $('searchLearner').closest('label').classList.toggle('hide',isAggregate());
 $('goEditKey').textContent=isAggregate()?'✎ Optional answer key & points':'✎ Edit answer key & points';
 displayWarnings();refreshReadiness();renderAnswerKeyPreview();if(isAggregate())renderAggregateGrid();else renderResponseGrid();renderPaperPreview();
}
function renderAnswerKeyPreview(){const parent=$('answerKeyPreview');clear(parent);state.key.forEach((choices,i)=>{const item=el('span',{class:'keychip'},`Q${i+1}: ${choices.length?choices.join(' / '):'?'}`);if(state.points[i]!==1)item.appendChild(el('small',{},` · ${state.points[i]} pt`));if(state.modes[i]==='all')item.appendChild(el('small',{},' · All required')); parent.appendChild(item);});}
let responseRowPage=0,responseItemPage=0;
const RESPONSE_ROWS=10,RESPONSE_ITEMS=25;
function renderResponseGrid(){const d=state.data;if(!d)return;
 const thead=$('responseGrid').querySelector('thead'),tbody=$('responseGrid').querySelector('tbody');clear(thead);clear(tbody);
 responseItemPage=Math.max(0,Math.min(responseItemPage,Math.ceil(d.itemCount/RESPONSE_ITEMS)-1));
 const itemStart=responseItemPage*RESPONSE_ITEMS,itemEnd=Math.min(d.itemCount,itemStart+RESPONSE_ITEMS);
 const headers=el('tr');['#','Learner name','Roster no.',...d.headers.slice(itemStart,itemEnd)].forEach((v,i)=>headers.appendChild(el('th', {class:i===0?'number':i===1?'name':''},v)));
 thead.appendChild(headers);
 const query=state.query.trim().toLowerCase();
 const matches=d.learners.filter(x=>!query||x.name.toLowerCase().includes(query)||x.roster.toLowerCase().includes(query));
 responseRowPage=Math.max(0,Math.min(responseRowPage,Math.ceil(matches.length/RESPONSE_ROWS)-1));
 const rowStart=responseRowPage*RESPONSE_ROWS;
 matches.slice(rowStart,rowStart+RESPONSE_ROWS).forEach((l,offset)=>{
 const index=d.learners.indexOf(l);
 const tr=el('tr');tr.appendChild(el('td',{class:'number'},String(index+1)));
 if(state.manualMode==='full'){
  const nameCell=el('td',{class:'name'}),nameInput=el('input',{type:'text',class:'ib-learner-field',placeholder:'Learner name (optional)','aria-label':`Learner ${index+1} name`,maxlength:'120'});nameInput.value=l.nameMissing?'':l.name;
  nameInput.addEventListener('change',()=>{const value=nameInput.value.trim();l.name=value||`Learner ${index+1}`;l.nameMissing=!value;state.analysis=null;$('tab-analysis').disabled=true;scheduleWorkspaceSave();});nameCell.append(nameInput);tr.append(nameCell);
  const idCell=el('td'),idInput=el('input',{type:'text',class:'ib-roster-field',placeholder:'Optional','aria-label':`Learner ${index+1} roster number`,maxlength:'35'});idInput.value=l.roster;idInput.addEventListener('change',()=>{l.roster=idInput.value.trim();scheduleWorkspaceSave();});idCell.append(idInput);tr.append(idCell);
 }else{tr.appendChild(el('td',{class:'name'},l.name));tr.appendChild(el('td',{},l.roster||'—'));}
 l.answers.slice(itemStart,itemEnd).forEach((a,offset)=>{const j=itemStart+offset;const ok=parser.responseToken(a).valid;const td=el('td',{class:!ok?'invalid':!a?'blank':parser.responseToken(a).multiple?'multimark':''});if(state.manualMode==='full'){
   const select=el('select',{class:'ib-answer-select','aria-label':`Learner ${index+1}, item ${j+1}`});
   for(const val of ['',...Array.from({length:state.choiceCount},(_,n)=>String.fromCharCode(65+n))]){const option=el('option',{value:val},val||'—');select.append(option);}
   if(a&&!([...select.options].some(opt=>opt.value===a))){select.append(el('option',{value:a},a));}
   select.append(el('option',{value:'__multi__'},'Multiple…'));
   select.value=a;
   select.addEventListener('change',()=>{
    let value=select.value;
    if(value==='__multi__'){
     const raw=prompt(`Enter selected options for ${l.name}, item ${j+1} (e.g. AC):`,l.answers[j]||'');
     if(raw===null){select.value=l.answers[j];return;}
     const parsed=parser.responseToken(raw);
     if(!parsed.valid||!parsed.value||parsed.value.length<2){alert('Select two or more valid option letters, such as AC.');select.value=l.answers[j];return;}
     value=parsed.value;
    }
    l.answers[j]=value;
    const d=state.data;d.blankCells=d.learners.reduce((sum,row)=>sum+row.answers.filter(v=>!v).length,0);
    invalidateAnalysis();refreshReadiness();$('fieldCount').textContent=`${d.blankCells} / 0`;
    renderResponseGrid();scheduleWorkspaceSave();
   });td.append(select);
  }else{const btn=el('button',{type:'button',class:'answerbutton',title:`Edit ${l.name} Q${j+1}${parser.responseToken(a).multiple?' (multiple marks; currently incorrect)':''}`,'aria-label':`Edit response for ${l.name}, question ${j+1}`},a||'—');btn.addEventListener('click',()=>openIndividualEditor(l.id,j));td.appendChild(btn);}tr.appendChild(td);});tbody.appendChild(tr);
 });
 $('pageInfo').textContent=matches.length?`Learners ${rowStart+1}–${Math.min(rowStart+RESPONSE_ROWS,matches.length)} of ${matches.length}; items ${itemStart+1}–${itemEnd} of ${d.itemCount}`:'No matching learner';
 $('gridPrevRows').disabled=responseRowPage===0;$('gridNextRows').disabled=rowStart+RESPONSE_ROWS>=matches.length;
 $('gridPrevItems').disabled=responseItemPage===0;$('gridNextItems').disabled=itemEnd>=d.itemCount;
}
function openIndividualEditor(learnerId=null,itemIndex=0){
 if(!state.data?.learners?.length||isAggregate())return;
 editingLearnerId=learnerId||editingLearnerId||state.data.learners[0].id;
 switchView('edit');
 if(itemIndex>=0){const row=$('edit-item-'+(itemIndex+1));if(row)row.scrollIntoView({block:'nearest'});}
}
function currentEditingLearner(){return state.data?.learners.find(l=>l.id===editingLearnerId)||state.data?.learners[0]||null;}
function updateResponseSummary(){const d=state.data;d.blankCells=d.learners.reduce((sum,row)=>sum+row.answers.filter(a=>!a).length,0);d.invalidCells=d.learners.reduce((sum,row)=>sum+row.answers.filter(a=>!parser.responseToken(a).valid).length,0);d.multiMarkCells=d.learners.reduce((sum,row)=>sum+row.answers.filter(a=>parser.responseToken(a).multiple).length,0);invalidateAnalysis();refreshReadiness();}
function setIndividualAnswer(l,j,value){
 const parsed=parser.responseToken(value);if(!parsed.valid)return;
 const old=l.answers[j];if(old===parsed.value)return;
 l.answers[j]=parsed.value;state.edits.push({learner:l.id,item:j+1,from:old,to:parsed.value});
 updateResponseSummary();scheduleWorkspaceSave();renderIndividualEditor();
}
function renderIndividualEditor(){
 const learners=state.data?.learners||[];if(!learners.length)return;
 const learner=currentEditingLearner();editingLearnerId=learner.id;
 const picker=$('editLearnerSelect');picker.replaceChildren();
 for(let n=0;n<learners.length;n++){const l=learners[n],opt=el('option',{value:String(n)},`${n+1}. ${l.name||'Learner '+(n+1)}${l.roster?' · #'+l.roster:''}`);picker.append(opt);}
 const idx=learners.indexOf(learner);picker.value=String(idx);
 $('editPrevLearner').disabled=idx===0;$('editNextLearner').disabled=idx===learners.length-1;
 $('editLearnerName').value=learner.nameMissing?'':learner.name;
 $('editLearnerRoster').value=learner.roster||'';
 $('editLearnerProgress').textContent=`Learner ${idx+1} of ${learners.length}`;
 const grid=$('editResponseCards');grid.replaceChildren();
 const columnsCount=window.matchMedia('(max-width:750px)').matches?1:window.matchMedia('(max-width:1150px)').matches?2:3;
 const perColumn=Math.ceil(state.data.itemCount/columnsCount);
 const columns=Array.from({length:columnsCount},()=>{const col=el('div',{class:'key-card-column'});grid.append(col);return col;});
 const choices=Array.from({length:state.choiceCount},(_,j)=>String.fromCharCode(65+j));
 for(let j=0;j<state.data.itemCount;j++){
  const current=String(learner.answers[j]||'');
  const card=el('section',{id:`edit-item-${j+1}`,class:'key-card ib-edit-answer-card',role:'group','aria-label':`Item ${j+1} response`});
  card.append(el('span',{class:'key-card-title'},String(j+1)));
  const opts=el('div',{class:'ib-edit-choices'});
  const trueFalse=isTrueFalseItem(j)||current==='T'||current==='F';
  const validChoices=[...new Set([...choices,...(trueFalse?['T','F']:[]),...current.replace(/[^A-J]/g,'').split('')])].filter(Boolean);
  const multi=current.length>1&&/^[A-J]+$/.test(current),modeKey=learner.id+':'+j;
  const multiToggle=el('label',{class:'ib-multi-toggle',title:'Enable multiple marks for this item'}),multiInput=el('input',{type:'checkbox','aria-label':`Allow multiple marks for item ${j+1}`});multiInput.checked=multi||multipleEntryMode.has(modeKey);multiInput.disabled=trueFalse;
  multiInput.addEventListener('change',()=>{if(multiInput.checked)multipleEntryMode.add(modeKey);else multipleEntryMode.delete(modeKey);});
  multiToggle.append(multiInput,el('span',{},'Multiple'));
  // A card switch changes how the next click behaves without silently changing a response.
  for(const option of validChoices){
   const marked=current.includes(option),btn=el('button',{type:'button',class:'choice'+(marked?' selected':''),'aria-pressed':String(marked),'aria-label':`Item ${j+1}, mark ${option}`},option);
   btn.addEventListener('click',()=>{
    const multiMode=multiInput.checked&&!trueFalse;
    let next;
    if(multiMode){next=marked?current.replace(option,''):[...new Set((current+option).split(''))].sort().join('');}
    else next=marked&&current.length===1?'':option;
    setIndividualAnswer(learner,j,next);
   });opts.append(btn);
  }
  const clearBtn=el('button',{type:'button',class:'ib-clear-answer','aria-label':`Clear response for item ${j+1}`,title:'Clear answer'},'×');clearBtn.addEventListener('click',()=>setIndividualAnswer(learner,j,''));
  card.append(opts,multiToggle,clearBtn);columns[Math.floor(j/perColumn)].append(card);
 }
 $('editResponseStatus').textContent=`${learner.answers.filter(Boolean).length} of ${state.data.itemCount} responses entered · ${state.data.blankCells} blank cells in all learners`;
}
function editAnswer(learner,j){const old=learner.answers[j];const raw=prompt(`Response for ${learner.name}, Q${j+1} (A–J, T/F, or blank):`,old);if(raw===null)return;const v=parser.responseToken(raw);if(!v.valid){alert('Unrecognized answer value. Use A–J, T, F, or leave blank.');return;}if(v.value===old)return;learner.answers[j]=v.value;state.edits.push({learner:learner.id,item:j+1,from:old,to:v.value});const d=state.data;d.invalidCells=d.learners.reduce((s,l)=>s+l.answers.filter(a=>!parser.responseToken(a).valid).length,0);d.blankCells=d.learners.reduce((s,l)=>s+l.answers.filter(a=>!a).length,0);d.warnings=d.warnings.filter(w=>!w.includes('unrecognized answer cell(s)')&&!w.includes('blank learner response(s)')&&!w.includes('manual response correction'));if(d.invalidCells)d.warnings.push(`${d.invalidCells} unrecognized answer cell(s). Please correct them.`);if(d.blankCells)d.warnings.push(`${d.blankCells} blank learner response(s); scored as incorrect.`);d.warnings.push(`${state.edits.length} manual response correction(s) in this session.`);state.analysis=null;$('tab-analysis').disabled=true;renderImport();scheduleWorkspaceSave();}

function scoreOptionCounts(){
 if(!validAggregate())throw Error('Verify the option counts before analyzing.');
 const data=state.data,n=data.examineeCount,max=state.points.reduce((a,b)=>a+b,0);
 const perItem=data.optionCounts.map((counts,j)=>{
  const options=Array.from({length:state.choiceCount},(_,i)=>String.fromCharCode(65+i));
  const choices=Object.fromEntries(options.map(letter=>[letter,optionCount(counts[letter])]));
  const sum=Object.values(choices).reduce((a,b)=>a+b,0),unanswered=n-sum;
  if(unanswered)choices['Unanswered / other']=unanswered;
  const correct=state.key[j].reduce((total,key)=>total+(choices[key]||0),0);
  const p=state.points[j]>0?correct/n:null;
  return {item:j+1,p,d:null,correct,choices,unanswered,aggregateOnly:true,optionCountsAvailable:true,
    action:p===null?'Review':p<.20||p>.80?'Review':'More data needed',
    reason:p===null?'This item has zero points and is excluded from scoring.':p<.20?'Few learners chose an accepted answer. Review the question, key and instruction.':p>.80?'Most learners selected an accepted answer; this may be appropriate for foundational knowledge.':'These answer-option totals show selection frequencies and difficulty only. They do not establish discrimination or reliability.'};
 });
 const correctPoints=perItem.reduce((sum,item,j)=>sum+item.correct*state.points[j],0);
 const possiblePoints=n*max,mean=correctPoints/n;
 return {aggregateOnly:true,optionCountsAvailable:true,total:max,mean,median:null,sd:null,mps:possiblePoints>0?correctPoints/possiblePoints*100:0,correctPoints,possiblePoints,passed:null,below:null,threshold:state.threshold,groupPercent:state.groupPercent,groupSize:0,totals:[],pct:[],perItem};
}
function scoreAggregate(){
 if(isOptionCounts())return scoreOptionCounts();
 const d=state.data,n=d.examineeCount,max=state.points.reduce((a,b)=>a+b,0);
 const perItem=d.correctCounts.map((num,j)=>{
   const p=state.points[j]>0?num/n:null;
   return {item:j+1,p,d:null,correct:num,choices:{},aggregateOnly:true,
   action:p===null?'Review':(p<.20||p>.80?'Review':'More data needed'),
   reason:p===null?'This item has zero points.':p<.20?'Few examinees answered correctly. Check the stem, accepted key, and instruction. Discrimination cannot be calculated from counts.':p>.80?'Most examinees answered correctly. This can be appropriate for foundational content; discrimination cannot be calculated from counts.':'This item has no item-level discrimination or distractor evidence. Difficulty alone is insufficient to recommend retaining, revising or discarding.'};
 });
 const mean=d.correctCounts.reduce((sum,c,j)=>sum+c/n*state.points[j],0);
 return {aggregateOnly:true,total:max,mean,median:null,sd:null,mps:mean/max*100,passed:null,below:null,threshold:state.threshold,groupPercent:state.groupPercent,groupSize:0,totals:[],pct:[],perItem};
}
function renderAggregateGrid(){const wrap=$('aggregateGrid');clear(wrap);if(!isAggregate())return;const d=state.data;
 if(isOptionCounts()){
  wrap.className='ib-option-counts-columns';
  const columnsCount=window.matchMedia('(max-width:750px)').matches?1:window.matchMedia('(max-width:1150px)').matches?2:3;
  const perColumn=Math.ceil(d.itemCount/columnsCount);
  const columns=Array.from({length:columnsCount},()=>{const column=el('div',{class:'ib-count-column'});wrap.append(column);return column;});
  d.optionCounts.forEach((counts,j)=>{
   const item=el('section',{class:'ib-option-count-card',role:'group','aria-label':`Responses for item ${j+1}`});
   const header=el('div',{class:'ib-count-head'});header.append(el('strong',{},String(j+1)),el('span',{class:'subtle'},state.key[j]?.length?'Key: '+state.key[j].join(' / '):'Set key in Answer Key'));
   const row=el('div',{class:'ib-option-count-fields'});
   let total=0;
   for(let i=0;i<state.choiceCount;i++){
    const letter=String.fromCharCode(65+i),value=counts?.[letter];
    const label=el('label',{},letter),input=el('input',{type:'number',min:'0',max:String(d.examineeCount),step:'1','aria-label':`Item ${j+1} option ${letter} response count`,placeholder:'—'});
    input.value=Number(value)>0?String(value):''; // Blank displays as zero without visual clutter.
    input.title='Blank means zero';
    input.addEventListener('keydown',event=>{if(event.key==='-'||event.key==='e'||event.key==='E'){event.preventDefault();}});
    const field=j+':'+letter;
    const check=()=>{const v=optionCount(input.value);const valid=!input.validity.badInput&&Number.isFinite(v)&&v<=d.examineeCount;if(valid)invalidOptionInputs.delete(field);else invalidOptionInputs.add(field);input.setCustomValidity(valid?'':`Enter a whole number from 0 to ${d.examineeCount}.`);invalidateAnalysis();refreshReadiness();return valid;};
    if(invalidOptionInputs.has(field))input.setCustomValidity('Re-enter a valid whole number.');
    input.addEventListener('input',check);
    input.addEventListener('change',()=>{
     if(!check()){input.reportValidity();return;}
     counts[letter]=optionCount(input.value);invalidateAnalysis();refreshReadiness();renderAggregateGrid();scheduleWorkspaceSave();
    });label.append(input);row.append(label);
    total+=optionCount(value);
   }
   const footer=el('div',{class:'ib-count-foot'},!Number.isFinite(total)?'⚠ Invalid option count':total>d.examineeCount?`⚠ Total ${total} exceeds ${d.examineeCount}`:`Unanswered / other: ${d.examineeCount-total}`);
   if(total>d.examineeCount)footer.classList.add('ib-invalid');
   item.append(header,row,footer);columns[Math.floor(j/perColumn)].append(item);
  });
  updateAggregateValidation();return;
 }
 wrap.className='aggregate-grid';
 d.correctCounts.forEach((count,j)=>{const label=el('label',{class:'ib-count-cell'},`Q${j+1}`),input=el('input',{type:'number',min:'0',max:String(d.examineeCount),step:'1','aria-label':`Number correct for question ${j+1}`});input.value=count===null?'':count;
  input.addEventListener('change',()=>{const value=input.value.trim(),v=value===''?null:Number(value);if(v!==null&&(!Number.isInteger(v)||v<0||v>d.examineeCount)){input.setCustomValidity(`Enter a whole number from 0 to ${d.examineeCount}.`);input.reportValidity();return;}input.setCustomValidity('');d.correctCounts[j]=v;invalidateAnalysis();refreshReadiness();updateAggregateValidation();scheduleWorkspaceSave();});label.append(input);wrap.append(label);});updateAggregateValidation();
}
function updateAggregateValidation(){if(!isAggregate())return;const d=state.data;
 if(isOptionCounts()){
  const complete=d.optionCounts.filter(counts=>{
   let sum=0;for(let j=0;j<state.choiceCount;j++){const n=optionCount(counts?.[String.fromCharCode(65+j)]);if(!Number.isInteger(n)||n<0)return false;sum+=n;}return sum<=d.examineeCount;
  }).length;
  $('aggregateValidation').textContent=`${complete} / ${d.itemCount} items valid · Blank boxes count as 0 · Each item’s option total must not exceed ${d.examineeCount}. Remaining responses are unanswered/other.`;
  return;
 }
 const filled=d.correctCounts.filter(x=>Number.isInteger(x)&&x>=0&&x<=d.examineeCount).length;$('aggregateValidation').textContent=`${filled} of ${d.itemCount} legacy correct-count entries complete.`;
}
let manualStartMode='full';
function openManual(kind){$('uploadDialog').close();manualStartMode=kind;$('manualTitle').textContent=kind==='full'?'Enter complete learner responses':'Enter total responses per choice';$('manualDescription').textContent=kind==='full'?'Enter each examinee’s answers in the individual response editor.':'Record how many examinees selected A, B, C, D (and additional configured options) for each item.';$('manualNotes').textContent=kind==='full'?'The answer key will be entered separately. Blank answers are scored incorrect.':'Option totals allow difficulty and distractor selection frequencies. They do not identify learner scores, discrimination, passing rates or reliability. Every item needs its correct key.';$('manualDialog').showModal();}
async function createManual(kind,n,k,title){const values=Array.from({length:k},()=>[]);const isFull=kind==='full';const learners=isFull?Array.from({length:n},(_,i)=>({id:`manual-${i+1}`,name:`Learner ${i+1}`,roster:'',nameMissing:true,answers:Array(k).fill('')})):[];
 const data={format:'itembloom-normalized-responses',schemaVersion:1,provider:kind==='full'?'Manual complete responses':'Manual option totals',sourceSchema:kind==='full'?'Manual learner answers':'Response totals by option',entryMode:kind,filename:title||'Untitled manual analysis',itemCount:k,examineeCount:n,headers:Array.from({length:k},(_,i)=>'Q'+(i+1)),answerKey:values,points:Array(k).fill(1),learners,correctCounts:kind==='aggregate'?Array(k).fill(null):null,optionCounts:kind==='option-counts'?Array.from({length:k},()=>({A:0,B:0,C:0,D:0})):null,invalidCells:0,blankCells:isFull?n*k:0,multiMarkCells:0,missingNameCount:isFull?n:0,warnings:kind==='option-counts'?['Option totals cannot identify individual learner scores, discrimination or reliability. Multiple-mark response patterns require complete learner responses.']:kind==='aggregate'?['Legacy correct-count-only data does not contain individual learner answers.']:['Manual entries are not imported from a grading provider. Review the answer key and unentered responses before analysis.']};
 if(!await replaceCSV(data)){alert('The current workspace could not be saved. Keep it open and retry saving before creating another.');return false;}
 state.manualMode=isFull?'full':null;renderImport();scheduleWorkspaceSave();return true;
}
function addManualLearner(){if(state.manualMode!=='full')return;const d=state.data;if(d.examineeCount>=500)return alert('Maximum 500 learners in manual entry.');const n=d.examineeCount+1;d.learners.push({id:'manual-'+n,name:'Learner '+n,roster:'',nameMissing:true,answers:Array(d.itemCount).fill('')});d.examineeCount=n;d.blankCells+=d.itemCount;renderImport();invalidateAnalysis();scheduleWorkspaceSave();}
// Iframe-safe TOS bridge. Never access window.parent properties directly: file:// may give each frame an opaque origin.
const tosRequests=new Map();let tosRequestSequence=0;
const tosTargetOrigin=(location.origin==='null'||location.protocol==='file:')?'*':location.origin;
function requestTOS(operation,id){
 if(window.parent===window)return Promise.resolve(operation==='list'?[]:null);
 return new Promise((resolve,reject)=>{
  const requestId='tos-'+(++tosRequestSequence)+'-'+Math.random().toString(36).slice(2);
  const timeout=setTimeout(()=>{tosRequests.delete(requestId);reject(Error('TOS link request timed out. Open Item Analysis from ItemBloom Home and try Refresh list.'));},5000);
  tosRequests.set(requestId,{resolve,reject,timeout});
  window.parent.postMessage({type:'IB_TOS_BRIDGE_REQUEST',operation,id,requestId},tosTargetOrigin);
 });
}
async function refreshAssessmentOptions(){const select=$('linkedAssessment');if(!select)return;const old=state.linkedAssessment?.id||'';select.replaceChildren(el('option',{value:''},'Not connected'));
 try{const options=await requestTOS('list');for(const a of options){const option=el('option',{value:a.id},`${a.title} (${a.total} items${a.saved?' · saved':' · draft'})`);option.disabled=!!state.data&&a.total!==state.data.itemCount;select.append(option);}select.value=[...select.options].some(o=>o.value===old)?old:'';$('linkedAssessmentNotice').textContent=options.length?'Select a matching assessment, or leave this optional. Competency mapping is assigned per item after linking.':'No available TOS assessments. Save or connect an assessment on the Home screen first.';}
 catch(ex){$('linkedAssessmentNotice').textContent='TOS linkage unavailable: '+ex.message;}
}
async function chooseAssessment(id){if(!id){state.linkedAssessment=null;state.competencyMap=[];scheduleWorkspaceSave();renderImport();switchView(state.view);$('linkedAssessmentNotice').textContent='Not connected to a TOS assessment.';return;}
 try{const detail=await requestTOS('read',id);if(!detail)throw Error('Assessment not found.');if(detail.total!==state.data.itemCount)throw Error(`This assessment has ${detail.total} items, but the results have ${state.data.itemCount}.`);state.linkedAssessment=detail;state.competencyMap=[];scheduleWorkspaceSave();renderImport();switchView(state.view);$('linkedAssessmentNotice').textContent=`Connected to ${detail.title}. Assign an appropriate learning competency while inspecting each item.`;}
 catch(ex){$('linkedAssessment').value=state.linkedAssessment?.id||'';$('linkedAssessmentNotice').textContent='Unable to link: '+ex.message;}
}
function renderPaperPreview(){const box=$('paperPreview');if(!box)return;clear(box);const paper=state.paper;if(!paper){box.classList.add('hide');$('paperStatus').textContent='No test paper linked';return;}box.classList.remove('hide');
 globalThis.ItemBloomPaperParser.validateQuestions(paper.questions,state.data?.itemCount);
 const warnings=paper.questions.filter(q=>q.warnings.length),match=paper.questions.length===state.data?.itemCount&&new Set(paper.questions.map(q=>q.number)).size===state.data?.itemCount&&paper.questions.every(q=>q.number>=1&&q.number<=state.data.itemCount);
 $('paperStatus').textContent=`${paper.filename} · ${paper.questions.length} recognized questions · ${warnings.length} needing review${match?'':' · Item count mismatch'}`;
 const details=el('details',{class:'ib-paper-results'}),summary=el('summary',{},`Review ${paper.questions.length} recognized questions (${warnings.length} flagged)`);details.append(summary);
 for(const note of paper.notes||[])details.append(el('p',{class:'notice info'},note));
 if(!match)details.append(el('p',{class:'notice info'},`Item count differs from the current ${state.data.itemCount}-item assessment. Verify missing or duplicated questions.`));
 for(const q of paper.questions){const row=el('div',{class:'ib-paper-row'}),label=el('span',{},`Q${q.number} · ${q.stem.slice(0,92)}${q.stem.length>92?'…':''}`),edit=el('button',{type:'button',class:'light'},'Edit');if(q.warnings.length)label.append(el('strong',{class:'ib-paper-flag'},' ⚠ '+q.warnings.join(', ')));edit.addEventListener('click',()=>editPaperQuestion(paper.questions.indexOf(q)));row.append(label,edit);details.append(row);}box.append(details);
}
let paperEditing=null;
function editPaperQuestion(index){paperEditing=index;const q=state.paper?.questions[index];if(!q)return;$('paperEditTitle').textContent='Question '+q.number;$('paperEditNumber').value=q.number;$('paperEditStem').value=q.stem;const area=$('paperEditOptions');clear(area);for(const letter of [...new Set([...Array.from({length:state.choiceCount},(_,i)=>String.fromCharCode(65+i)),...Object.keys(q.options)])]){const label=el('label',{class:'ib-paper-label'},letter+'.'),text=el('textarea',{rows:'2','data-letter':letter});text.value=q.options[letter]||'';label.append(text);area.append(label);}if(q.duplicateOptions?.length)area.append(el('p',{},'Duplicate source options (first occurrence retained): '+q.duplicateOptions.map(o=>o.letter+'. '+o.text).join(' | ')));$('paperEditDialog').showModal();}
function savePaperQuestion(){const q=state.paper?.questions[paperEditing];if(!q)return;const number=Number($('paperEditNumber').value);if(!Number.isInteger(number)||number<1||number>500){alert('Enter an item number from 1 to 500.');return;}if(number!==q.number&&!confirm('Map this parsed question from item '+q.number+' to item '+number+'? Answer keys and learner scores will remain unchanged.'))return;q.number=number;q.stem=$('paperEditStem').value.trim();q.options={};$('paperEditOptions').querySelectorAll('[data-letter]').forEach(text=>{if(text.value.trim())q.options[text.dataset.letter]=text.value.trim();});q.reviewed=true;$('paperEditDialog').close();renderPaperPreview();scheduleWorkspaceSave();}
function setCSV(data,deferRender=false){invalidOptionInputs.clear();responseRowPage=0;responseItemPage=0;workspaceGeneration++;state.edits=[];state.linkedAssessment=null;state.competencyMap=[];state.paper=null;state.manualMode=data.entryMode==='full'?'full':null;state.sectionsText=String(data.section||'');$('analysisSections').value=state.sectionsText;state.data=data;state.key=data.answerKey.map(a=>[...a]);state.originalKey=data.answerKey.map(a=>[...a]);state.points=[...data.points];state.undo=[];state.redo=[];state.query='';state.analysis=null;state.threshold=70;state.groupPercent=27;state.modes=Array(data.itemCount).fill('any');
 const maxAnswer=minimumChoiceCount();
 state.choiceCount=Math.max(4,maxAnswer);renderChoiceCount();updateHistoryButtons();keyNotice('');
 if(state.choiceCount>4)data.warnings.push(`Detected option ${String.fromCharCode(64+state.choiceCount)}; the answer choices setting was adjusted from the default 4 to ${state.choiceCount}.`);
 editingLearnerId=null;multipleEntryMode.clear();$('searchLearner').value='';$('passThreshold').value='70';$('groupPercent').value='27';$('tab-analysis').disabled=true;if(!deferRender){refreshReadiness();renderImport();switchView('import');}
 if(!loadingWorkspace){workspaceBaseline=null;conflictBlocked=false;workspaceId='ib-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);scheduleWorkspaceSave();void refreshAssessmentOptions();}
 }
let replacingWorkspace=false;
async function replaceCSV(data){
 if(replacingWorkspace||loadingWorkspace)return false;
 replacingWorkspace=true;
 try{
  if(!await flushWorkspace())return false;
  setCSV(data);return true;
 }finally{replacingWorkspace=false;}
}
function showUpload(){ $('uploadError').classList.add('hide');$('fileInput').value='';$('uploadDialog').showModal();}
function selectResultSheet(candidates){return new Promise(resolve=>{
 const dialog=el('dialog',{'aria-labelledby':'sheetChoiceTitle'}),title=el('h2',{id:'sheetChoiceTitle'},'Choose result worksheet');
 const label=el('label',{},'Worksheet to import'),select=el('select',{'aria-label':'Result worksheet'});
 select.append(el('option',{value:''},'Select a worksheet…'));
 candidates.forEach(c=>select.append(el('option',{value:String(c.index)},c.name+' · '+c.examineeCount+' learners · '+c.itemCount+' items')));
 label.append(select);const accept=el('button',{type:'button'},'Import selected worksheet'),cancel=el('button',{type:'button',class:'light'},'Cancel');accept.disabled=true;
 const finish=value=>{dialog.close();dialog.remove();resolve(value);};select.addEventListener('change',()=>accept.disabled=select.value==='');accept.addEventListener('click',()=>{if(select.value!=='')finish(Number(select.value));});cancel.addEventListener('click',()=>finish(null));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
 dialog.append(title,el('p',{},'Several worksheets contain learner responses. Choose the intended assessment; other result sheets will not supply answer keys.'),label,accept,cancel);document.body.append(dialog);dialog.showModal();select.focus();
});}
async function readFile(file){
 if(!file)return;if(!/\.(?:csv|xlsx|xls)$/i.test(file.name)){setError('Please choose a ZipGrade/EvalBee CSV or Excel file (.csv, .xlsx or XML .xls).');return;}
 if(file.size>parser.MAX_BYTES){setError('The selected file is larger than 15 MB.');return;}
 try{const data=/\.csv$/i.test(file.name)?parser.extract(await file.text(),file.name):await globalThis.ItemBloomExcel.normalize(file,parser,selectResultSheet);if(!data)return;if(await replaceCSV(data))$('uploadDialog').close();else setError('The current workspace could not be saved. Close this dialog and retry saving before replacing it.');}
 catch(e){setError(e.message||'Unable to read the file.');}
}
function setError(message){$('uploadError').textContent=message;$('uploadError').classList.remove('hide');}
function renderKeys(){
 const grid=$('keyRows'),wrap=grid.parentElement;const scroll=wrap.scrollTop;
 clear(grid);const d=state.data;if(!d)return;
 renderChoiceCount();updateHistoryButtons();
 const numberOfColumns=window.matchMedia('(max-width:750px)').matches?1:window.matchMedia('(max-width:1150px)').matches?2:3;
 const itemsPerColumn=Math.ceil(d.itemCount/numberOfColumns);
 const columns=Array.from({length:numberOfColumns},()=>{const column=el('div',{class:'key-card-column'});grid.appendChild(column);return column;});
 for(let i=0;i<d.itemCount;i++){
  const card=el('section',{class:'key-card',id:`key-row-${i+1}`,role:'group','aria-label':`Answer key item ${i+1}`});
  const title=el('div',{class:'key-card-top'});
  title.appendChild(el('span',{class:'key-card-title'},String(i+1)));
  card.appendChild(title);
  const choices=el('div',{class:'key-card-choices'});
  const allowed=Array.from({length:state.choiceCount},(_,j)=>String.fromCharCode(65+j));
  const unexpected=state.key[i].filter(v=>!allowed.includes(v)&&v!=='T'&&v!=='F');
  const trueFalse=[...state.key[i],...d.learners.map(l=>l.answers[i])].some(v=>v==='T');
  const options=[...allowed,...(trueFalse?['T',...(allowed.includes('F')?[]:['F'])]:[]),...unexpected];
  for(const option of [...new Set(options)]){
   const outside=unexpected.includes(option);
   const btn=el('button',{type:'button',class:'choice'+(state.key[i].includes(option)?' selected':'')+(outside?' out-of-range':''),title:outside?'Outside chosen option count: click to remove':'Toggle accepted answer','aria-pressed':String(state.key[i].includes(option)),'aria-label':`Item ${i+1}, accept option ${option}`},option+(outside?' ⚠':''));
   btn.addEventListener('click',()=>{editorMutation(()=>{if(state.key[i].includes(option))state.key[i]=state.key[i].filter(x=>x!==option);else state.key[i]=[...state.key[i],option].sort();},`Item ${i+1} answer updated.`);});
   choices.appendChild(btn);
  }
  const controls=el('div',{class:'key-card-controls'});
  const modeLabel=el('label',{'class':'key-mode-label'});const select=el('select',{'aria-label':`Scoring rule for item ${i+1}`,class:'scoring-mode'});
  for(const [value,label] of [['any','Any one'],['all','All required']]){const option=el('option',{value},label);if(state.modes[i]===value)option.selected=true;select.appendChild(option);}
  select.addEventListener('change',()=>{if(isOptionCounts()&&select.value==='all'){alert('All required cannot be calculated from option totals because we do not know which options each learner marked together. Enter complete learner responses for this scoring rule.');select.value=state.modes[i];return;}editorMutation(()=>{state.modes[i]=select.value;},`Item ${i+1} scoring rule updated.`)});modeLabel.appendChild(select);controls.appendChild(modeLabel);
  const pointLabel=el('label',{'class':'key-points-label'});const input=el('input',{type:'number',min:'0',max:'1000',step:'0.5','aria-label':`Points for item ${i+1}`});input.value=state.points[i];
  let focusedSnapshot=null;
  input.addEventListener('focus',()=>{focusedSnapshot=snapshotKeyEditor();});
  input.addEventListener('input',()=>{const v=input.value.trim();state.points[i]=v===''?NaN:Number(v);invalidateAnalysis();refreshReadiness();updateKeyStatus();});
  input.addEventListener('change',()=>{if(!focusedSnapshot)focusedSnapshot=snapshotKeyEditor();if(historyPush(focusedSnapshot))keyNotice(`Item ${i+1} points changed. Undo available.`);focusedSnapshot=null;renderAnswerKeyPreview();scheduleWorkspaceSave();});
  pointLabel.appendChild(input);controls.appendChild(pointLabel);card.append(title,choices,controls);
  const columnIndex=Math.floor(i/itemsPerColumn);columns[columnIndex].appendChild(card);
 }
 wrap.scrollTop=scroll;
 updateKeyStatus();
}
function updateKeyStatus(){const missing=state.key.reduce((arr,k,i)=>{if(state.points[i]>0&&!k.length)arr.push(i+1);return arr;},[]);
 const outOfRange=state.key.flatMap((ks,i)=>ks.some(k=>!keyWithinChoices(k,i))?[i+1]:[]);
 $('keyStatus').textContent=isOptionCounts()?'Choose the official key and point values for each item. Use Any one; All required cannot be inferred from per-option totals.':isAggregate()?'Legacy correct-counts data: the answer key is optional.':outOfRange.length?`Key option beyond ${state.choiceCount} choices on item(s): ${outOfRange.slice(0,12).join(', ')}. Increase the number of choices or remove those keys.`:!missing.length?'All scored items have a valid key. Any one = one alternative; All required = exact full set of marks.':`Missing keys on ${missing.length} scored item(s): ${missing.slice(0,18).join(', ')}${missing.length>18?'…':''}. Complete them before analyzing.`;
 $('keyStatus').className='notice '+(missing.length||outOfRange.length?'info':'ok');
}
// Confirmation describes the teacher's current rules; source earned evidence stays intact.
function confirmSourceScoring(){
 if(!confirmExcelKeyReview())return false;
 if(state.data.provider!=='ZipGrade')return true;
 const rules=JSON.stringify({key:state.key,points:state.points,modes:state.modes});
 if(state.data.scoringConfirmation===rules)return true;
 if(!confirm('ZipGrade Points are earned points, not verified maximum item weights. The export does not establish maximum weights or partial-credit rules.\n\nCurrent maximum item points: '+state.points.join(', ')+'.\nReview weights (including zero-point items), accepted answers, and Any one / All required in the Answer Key Editor.\n\nOK confirms intentional rescoring with these current rules; results may differ from ZipGrade. Cancel returns to the editor.'))return false;
 state.data.scoringConfirmation=rules;scheduleWorkspaceSave();return true;
}
function confirmExcelKeyReview(){
 const review=state.data.keyReview;
 if(!review||(!review.ambiguousSources.length&&!review.items.some(item=>item.status==='conflicting')))return true;
 const key=JSON.stringify(state.key);
 if(state.data.keyReviewConfirmation===key)return true;
 if(!confirm('This workbook contains ambiguous or conflicting answer-key sources. Unlabeled rows were not accepted and conflicts were left blank. Verify the official answers in the Answer Key Editor.\n\nCurrent key: '+state.key.map((k,i)=>(i+1)+': '+k.join('/')).join(', ')+'\n\nOK confirms these teacher-verified answers. Cancel returns to the editor.'))return false;
 state.data.keyReviewConfirmation=key;scheduleWorkspaceSave();return true;
}
function performAnalysis(){if(isAggregate()){if(!validAggregate()){switchView('import');refreshReadiness();return;}if(isOptionCounts()&&!state.data.optionCounts.some(counts=>Object.values(counts).some(x=>Number(x)>0))&&!confirm('All answer-option response counts are blank or zero. This will report an MPS of 0%. Continue anyway?'))return;state.analysis=scoreAggregate();$('tab-analysis').disabled=false;switchView('analysis');return;}if(!validKey()){switchView('key');updateKeyStatus();return;}
 if(!confirmSourceScoring()){switchView('key');return;}
 if(state.manualMode==='full'&&state.data.blankCells>0&&!confirm(`${state.data.blankCells} response cells are blank and will count as incorrect. Continue to Item Analysis?`))return;
 try{state.analysis=parser.score(state.data,state.key,state.points,state.threshold,state.modes,Array(state.data.itemCount).fill(state.choiceCount),state.groupPercent);$('tab-analysis').disabled=false;switchView('analysis');}
 catch(e){alert(e.message);}
}
function renderAnalysis(){const a=state.analysis;if(!a)return;
 const cards=[{v:String(state.data.examineeCount),l:'Examinees'},{v:String(state.data.itemCount),l:'Items'},{v:decimal(a.mps)+'%',l:'MPS'},{v:decimal(a.mean)+' / '+decimal(a.total),l:'Mean score'}];
 const sum=$('analysisSummary');clear(sum);cards.forEach(c=>{const card=el('div',{class:'metric'});card.append(el('strong',{},c.v),el('small',{},c.l));sum.append(card)});
 $('passCounts').textContent=a.aggregateOnly?'Option/correct counts do not reveal which answers belong to each learner. Individual passing rates and reliability are unavailable.':`${a.passed} reached ${a.threshold}% · ${a.below} below (${decimal(a.passed/state.data.examineeCount*100)}% passed)`;
 $('passThreshold').disabled=!!a.aggregateOnly;
 $('groupPercent').disabled=!!a.aggregateOnly;
 $('groupInfo').textContent=a.aggregateOnly?'Upper/lower groups require complete learner responses. The 27% setting does not apply to counts-only input.':`Top ${a.groupSize} and bottom ${a.groupSize} learners (${a.groupPercent}% each, rounded).${a.boundaryTies?' Boundary score ties: group membership uses original learner order.':''}`;
 $('countsFormula').textContent=a.aggregateOnly?`Class MPS = ${(a.correctPoints??a.mean*state.data.examineeCount).toFixed(2)} correct points ÷ ${(a.possiblePoints??a.total*state.data.examineeCount).toFixed(2)} possible points × 100 = ${decimal(a.mps)}%. This is the mean across all examinees, not a discrimination index.`:'';
 $('countsFormula').hidden=!a.aggregateOnly;
 $('analysisLimitations').textContent=a.optionCountsAvailable?'Difficulty and selection frequencies are calculated from option totals. Learner scores, passing rates, discrimination and reliability require individual responses. Multiple-mark response combinations cannot be inferred.':a.aggregateOnly?'Only difficulty and class mean can be estimated from legacy correct counts; distractors and learner-level statistics are unavailable.': 'Rule-based recommendations are advisory. Review each item, its question text when supplied, and the actual response distribution.';
 const counts={Retain:0,Revise:0,Review:0,Discard:0,'More data needed':0};a.perItem.forEach(i=>{counts[i.action]=(counts[i.action]||0)+1;});
 const summary=$('decisionSummary');clear(summary);
 for(const key of (a.aggregateOnly?['Review','More data needed']:['Retain','Revise','Review','Discard'])){const box=el('div',{class:'actionbox '+({Retain:'success',Review:'warning',Discard:'danger'}[key]||'')});box.append(el('b',{},counts[key]),el('span',{},key));summary.appendChild(box);}
 const tbody=$('itemTable').querySelector('tbody');clear(tbody);
 const filter=$('actionFilter').value;
 a.perItem.filter(i=>filter==='All'||(filter==='attention'?i.action!=='Retain'&&i.action!=='More data needed':i.action===filter)).forEach(i=>{
 const tr=el('tr',{tabindex:'0',role:'button','aria-label':`Inspect item ${i.item}`});
 for(const v of [i.item,i.p===null?'N/A':decimal(i.p),i.d===null?'N/A':decimal(i.d),i.correct, i.action]){
 const td=el('td',{class:typeof v==='string'&&['Retain','Revise','Review','Discard'].includes(v)?`chip ${v}`:''},v);tr.appendChild(td);}
 tr.addEventListener('click',()=>showItem(i));tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showItem(i);}});tbody.appendChild(tr);
 });
 if(!tbody.childNodes.length){const tr=el('tr');const td=el('td',{colspan:'5'},'No items in this category.');tr.appendChild(td);tbody.appendChild(tr);}
}
function showItem(item){$('inspectTitle').textContent=`Item ${item.item} — ${item.action}`;
 $('inspectSub').textContent=`Difficulty ${item.p===null?'N/A':decimal(item.p)} · Discrimination ${item.d===null?'N/A':decimal(item.d)}`;
 const body=$('inspectBody');clear(body);
 if(!item.aggregateOnly && state.analysis.groupSize){body.appendChild(el('p',{class:'subtle'},`Upper group: ${item.upperCorrect}/${state.analysis.groupSize} correct · Lower group: ${item.lowerCorrect}/${state.analysis.groupSize} correct · ${state.groupPercent}% group setting`));}
 const paperQuestion=globalThis.ItemBloomPaperParser.uniqueQuestion(state.paper?.questions,item.item);
 if(!paperQuestion&&state.paper?.questions?.some(q=>q.number===item.item))body.append(el('p',{class:'notice'},'Conflicting test-paper numbers: review the parsed questions before linking this item.'));
 if(paperQuestion){const paper=el('div',{class:'ib-paper-in-inspect'});paper.append(el('h3',{},`Question ${item.item}`),el('p',{},paperQuestion.stem||'Stem not extracted'));for(const [letter,choice] of Object.entries(paperQuestion.options||{}))paper.appendChild(el('p',{},`${letter}. ${choice}`));body.appendChild(paper);}
 const p=el('p',{class:'detailtext'},item.reason);body.appendChild(p);
 if(state.linkedAssessment?.rows?.length){const label=el('label',{class:'ib-competency-chooser'},'Learning competency: '),sel=el('select');sel.append(el('option',{value:''},'Not mapped'));state.linkedAssessment.rows.forEach((row,i)=>{const opt=el('option',{value:String(i)},`${i+1}. ${row.text.slice(0,90)}`);sel.append(opt);});sel.value=state.competencyMap[item.item-1]===undefined?'':String(state.competencyMap[item.item-1]);sel.addEventListener('change',()=>{state.competencyMap[item.item-1]=sel.value===''?undefined:Number(sel.value);scheduleWorkspaceSave();});label.append(sel);body.append(label);}
 if(item.aggregateOnly){
  body.appendChild(el('p',{class:'subtle'},`Correct answers: ${item.correct} of ${state.data.examineeCount}.`));
  if(!item.optionCountsAvailable){body.appendChild(el('p',{class:'subtle'},'No answer-option distribution exists in this legacy correct-count record.'));$('itemDialog').showModal();return;}
  body.appendChild(el('h3',{},'Answer-option totals'));
  const t=el('table',{class:'detailtable'}),header=el('tr');header.append(el('th',{},'Response'),el('th',{},'Examinees'),el('th',{},'Accepted?'));t.append(header);
  Object.entries(item.choices).forEach(([choice,count])=>{const r=el('tr');r.append(el('td',{},choice),el('td',{},count),el('td',{},state.key[item.item-1].includes(choice)?'Yes':''));t.append(r);});body.append(t);
  body.appendChild(el('p',{class:'subtle'},'Group discrimination and learner reliability cannot be derived from option totals.'));
  $('itemDialog').showModal();return;
 }
 body.appendChild(el('h3',{},'Answer distribution'));
 const t=el('table',{class:'detailtable'}),header=el('tr');header.append(el('th',{},'Response'),el('th',{},'Learners'),el('th',{},'Key?'));t.appendChild(header);
 Object.entries(item.choices).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([val,n])=>{const tr=el('tr');tr.append(el('td',{},val),el('td',{},n),el('td',{},state.key[item.item-1].includes(val)?'Yes':''));t.appendChild(tr);});body.appendChild(t);
 body.appendChild(el('p',{class:'subtle'},'The teacher must confirm whether the item is suitable. “Discard” is never assigned automatically by this prototype.'));
 $('itemDialog').showModal();
}
$('editLearnerSelect').addEventListener('change',e=>{const row=state.data?.learners[Number(e.target.value)];if(row){editingLearnerId=row.id;renderIndividualEditor();}});
$('editPrevLearner').addEventListener('click',()=>{const rows=state.data?.learners||[],idx=rows.findIndex(l=>l.id===editingLearnerId);if(idx>0){editingLearnerId=rows[idx-1].id;renderIndividualEditor();}});
$('editNextLearner').addEventListener('click',()=>{const rows=state.data?.learners||[],idx=rows.findIndex(l=>l.id===editingLearnerId);if(idx>=0&&idx<rows.length-1){editingLearnerId=rows[idx+1].id;renderIndividualEditor();}});
$('editLearnerName').addEventListener('change',e=>{const l=currentEditingLearner();if(!l)return;const name=e.target.value.trim();l.name=name||`Learner ${state.data.learners.indexOf(l)+1}`;l.nameMissing=!name;state.data.missingNameCount=state.data.learners.filter(v=>v.nameMissing).length;renderIndividualEditor();renderResponseGrid();scheduleWorkspaceSave();});
$('editLearnerRoster').addEventListener('change',e=>{const l=currentEditingLearner();if(!l)return;l.roster=e.target.value.trim();renderIndividualEditor();renderResponseGrid();scheduleWorkspaceSave();});
$('editBackResults').addEventListener('click',()=>{renderImport();switchView('import');});
$('editDone').addEventListener('click',()=>{renderImport();switchView('import');});
$('openImport').addEventListener('click',showUpload);$('replaceImport').addEventListener('click',showUpload);
$('browseFile').addEventListener('click',()=>$('fileInput').click());$('fileInput').addEventListener('change',e=>readFile(e.target.files[0]));
const zone=$('dropZone');zone.addEventListener('click',e=>{if(e.target!==$('browseFile')&&!e.target.closest('button'))$('fileInput').click();});zone.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===zone){e.preventDefault();$('fileInput').click();}});
['dragenter','dragover'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.add('dragging');}));
['dragleave','drop'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.remove('dragging');}));
zone.addEventListener('drop',e=>readFile(e.dataTransfer.files[0]));
$('searchLearner').addEventListener('input',e=>{state.query=e.target.value;responseRowPage=0;renderResponseGrid();});
for(const [id,rows,step] of [['gridPrevRows',true,-1],['gridNextRows',true,1],['gridPrevItems',false,-1],['gridNextItems',false,1]])$(id).addEventListener('click',()=>{if(rows)responseRowPage+=step;else responseItemPage+=step;renderResponseGrid();});
$('choiceCount').addEventListener('change',e=>{
 const requested=Number(e.target.value),minimum=minimumChoiceCount();
 if(requested<minimum){e.target.value=String(state.choiceCount);keyNotice(`Cannot select ${requested} choices: the current key or learner responses require at least ${minimum}.`);return;}
 editorMutation(()=>{state.choiceCount=requested;},`Number of choices set to ${requested}.`);
});
$('goEditKey').addEventListener('click',()=>switchView('key'));$('goEditResponses').addEventListener('click',()=>openIndividualEditor());$('backResults').addEventListener('click',()=>switchView('import'));$('cancelKey').addEventListener('click',()=>switchView('import'));
$('saveKey').addEventListener('click',()=>{refreshReadiness();if(isAggregate()||validKey())performAnalysis();else switchView('import');});
$('findItemButton').addEventListener('click',()=>{const i=Number($('findItem').value);const row=$(`key-row-${i}`);if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.style.outline='2px solid #57a678';setTimeout(()=>{row.style.outline='';},1500)}});
$('undoKey').addEventListener('click',undoKeyEdit);
$('redoKey').addEventListener('click',redoKeyEdit);
$('resetImportedKey').addEventListener('click',()=>{
 if(state.originalKey.every((arr,i)=>JSON.stringify(arr)===JSON.stringify(state.key[i]))){keyNotice('The answer key already matches the imported original.');return;}
 if(!confirm('Restore all accepted answers exactly as imported? Current points and scoring rules will be kept. You can Undo this reset.'))return;
 editorMutation(()=>{state.key=state.originalKey.map(arr=>[...arr]);},'Original imported answer key restored. Points and scoring rules were preserved; Undo is available.');
});
$('resetPoints').addEventListener('click',()=>{editorMutation(()=>state.points.fill(1),'All item points set to 1. Undo available.');});
// Respect native text-field Undo; provide keyboard shortcuts only in the key editor outside text inputs.
document.addEventListener('keydown',e=>{if(state.view!=='key'||!(e.ctrlKey||e.metaKey)||e.altKey)return;
 if(e.target.closest('input, textarea, select, [contenteditable]'))return;
 const k=e.key.toLowerCase();if(k==='z'){e.preventDefault();if(e.shiftKey)redoKeyEdit();else undoKeyEdit();}
 else if(k==='y'){e.preventDefault();redoKeyEdit();}
});
$('applyBulkKey').addEventListener('click',()=>{const raw=$('bulkKeyInput').value.trim();const tokens=raw.split(/[\s,]+/).filter(Boolean);if(tokens.length!==state.data.itemCount){$('bulkStatus').textContent=`Expected ${state.data.itemCount} keys; found ${tokens.length}. Nothing changed.`;return;}const parsed=tokens.map(parser.keyToken);if(parsed.some(x=>x===null||!x.length)){$('bulkStatus').textContent='Invalid key format. Nothing changed.';return;}const required=parsed.flatMap(arr=>arr).reduce((highest,letter)=>Math.max(highest,/^[A-J]$/.test(letter)?letter.charCodeAt(0)-64:2),2);
 const modified=editorMutation(()=>{state.key=parsed;if(required>state.choiceCount)state.choiceCount=required;},`Complete answer key updated. Undo available.`);
 $('bulkStatus').textContent=modified?`Keys applied. ${required>4?'Choice count expanded if needed. ':''}Undo is available.`:'Keys already match the current answer key.';});
$('analyzeButton').addEventListener('click',performAnalysis);$('backKey').addEventListener('click',()=>switchView('key'));
$('actionFilter').addEventListener('change',renderAnalysis);
$('passThreshold').addEventListener('change',e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||n<0||n>100){e.target.value=state.threshold;return;}state.threshold=n;performAnalysis();scheduleWorkspaceSave();});
$('groupPercent').addEventListener('change',e=>{const raw=e.target.value.trim(),n=Number(raw);if(!raw||!Number.isFinite(n)||n<1||n>50){e.target.value=String(state.groupPercent);$('groupInfo').textContent='Enter a percentage from 1 to 50. The recommended default is 27%.';return;}state.groupPercent=n;performAnalysis();scheduleWorkspaceSave();});
$('closeItem').addEventListener('click',()=>$('itemDialog').close());$('dismissItem').addEventListener('click',()=>$('itemDialog').close());
['import','edit','key','analysis'].forEach(v=>$('tab-'+v).addEventListener('click',()=>switchView(v)));
$('manualFullStart').addEventListener('click',()=>openManual('full'));
$('manualCountsStart').addEventListener('click',()=>openManual('option-counts'));
$('closeManual').addEventListener('click',()=>$('manualDialog').close());$('cancelManual').addEventListener('click',()=>$('manualDialog').close());
$('manualSetupForm').addEventListener('submit',async e=>{e.preventDefault();const k=Number($('manualItems').value),n=Number($('manualExaminees').value);if(!Number.isInteger(k)||k<1||k>500||!Number.isInteger(n)||n<1||n>500)return alert('Choose 1–500 items and 1–500 examinees.');if(await createManual(manualStartMode,n,k,$('manualLabel').value.trim()))$('manualDialog').close();});
$('addManualLearner').addEventListener('click',addManualLearner);
$('refreshTOSLinks').addEventListener('click',()=>void refreshAssessmentOptions());
$('analysisSections').addEventListener('input',e=>{
 state.sectionsText=e.target.value.slice(0,180);
 if(state.data){renderImport();switchView(state.view);scheduleWorkspaceSave();}
});
$('linkedAssessment').addEventListener('change',e=>void chooseAssessment(e.target.value));
$('importTestPaper').addEventListener('click',()=>$('testPaperFile').click());
$('testPaperFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;e.target.value='';try{const paper=await globalThis.ItemBloomPaperParser.parse(file);state.paper=paper;renderPaperPreview();scheduleWorkspaceSave();}catch(ex){$('paperStatus').textContent='Test paper not imported: '+ex.message;}});
$('paperEditClose').addEventListener('click',()=>$('paperEditDialog').close());$('paperEditSave').addEventListener('click',savePaperQuestion);
switchView('import');
const params=new URLSearchParams(location.search);
if(params.has('record'))loadWorkspace(params.get('record')).catch(error=>{
 console.error(error);alert('Unable to open saved Item Analysis: '+error.message);
});
else if(params.get('import')==='1'||params.get('create')==='1')showUpload();
window.addEventListener('message',async event=>{
 if(event.source!==window.parent)return;
 if(location.origin!=='null'&&location.protocol!=='file:'&&event.origin!==location.origin)return;
 if((location.origin==='null'||location.protocol==='file:')&&event.origin!=='null'&&event.origin!==location.origin)return;
 if(event.data?.type==='IB_TOS_BRIDGE_RESPONSE'){
  const pending=tosRequests.get(event.data.requestId);if(!pending)return;clearTimeout(pending.timeout);tosRequests.delete(event.data.requestId);
  if(event.data.ok)pending.resolve(event.data.result);else pending.reject(Error(event.data.error||'TOS linkage failed.'));return;
 }
 if(event.data?.type==='IB_WORKSPACE_CLOSE_REQUEST'){
  const saved=await flushWorkspace();
  window.parent.postMessage({type:'IB_WORKSPACE_CLOSE_READY',ok:saved,dirty:dirtyRevision>persistedRevision},tosTargetOrigin);
 }
});
window.ItemBloomAnalysisUpdateState=()=>({open:true,loading:loadingWorkspace,editing:['edit','key'].includes(state.view),saving:queuedRevision>persistedRevision,dirty:dirtyRevision>persistedRevision,saveFailed:!lastSaveOk});
if('serviceWorker' in navigator&&globalThis.ItemBloomPWAUpdate){
 globalThis.ItemBloomPWAUpdate.install({serviceWorker:navigator.serviceWorker,scriptURL:new URL('../sw.js',location.href).href,
  ready:()=>false,freeze:()=>{},reload:()=>{}});
}
window.parent!==window&&window.parent.postMessage({type:'IB_WORKSPACE_READY'},tosTargetOrigin);
window.addEventListener('beforeunload',event=>{
 if(dirtyRevision>persistedRevision||!lastSaveOk){event.preventDefault();event.returnValue='';}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)void flushWorkspace();});
window.addEventListener('pagehide',()=>{if(saveTimer||dirtyRevision>persistedRevision){clearTimeout(saveTimer);saveTimer=null;void saveWorkspace();}});
})();
