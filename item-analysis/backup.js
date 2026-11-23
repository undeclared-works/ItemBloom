/* Local backup validation. Additive defaults preserve older Beta workspace snapshots. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.ItemBloomBackup=api;})(globalThis,()=>{
 'use strict';
 const SCHEMA='ItemBloom-ItemAnalysis-Workspace-v1',MAX_BYTES=64*1024*1024;
 const fail=message=>{throw Error('Invalid backup: '+message);};
 const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
 const text=v=>typeof v==='string';
 function array(v,n,label,check){if(!Array.isArray(v)||v.length!==n||!v.every(check))fail(label);}
 function safeTree(v){if(v&&typeof v==='object')for(const k of Object.keys(v)){if(['__proto__','prototype','constructor'].includes(k))fail('unsafe object key');safeTree(v[k]);}}
 function keys(v,n,label){array(v,n,label,k=>Array.isArray(k)&&k.length<=10&&k.every(x=>text(x)&&/^(?:[A-JTF]|10|[0-9])$/.test(x)));}
 function metadata(m){if(!object(m)||!text(m.id)||! /^[A-Za-z0-9_-]{1,150}$/.test(m.id))fail('workspace identity');for(const [k,v] of Object.entries(m))if(!['itemCount','learnerCount','warnings'].includes(k)&&!text(v))fail('metadata '+k);if(m.warnings!==undefined&&(!Array.isArray(m.warnings)||!m.warnings.every(w=>object(w)&&text(w.message))))fail('metadata warnings');}
 function decode(input){
  const b=typeof input==='string'?JSON.parse(input):JSON.parse(JSON.stringify(input));safeTree(b);
  if(!object(b))fail('expected an object');metadata(b.metadata);
  if(b.payload){if(b.schema!==undefined||(b.version!==undefined&&b.version!==1))fail('unsupported extraction envelope');return extraction(b);}
  if(b.schema!==undefined&&b.schema!==SCHEMA)fail('unsupported workspace format/version');
  if(b.version!==undefined&&b.version!==1)fail('unsupported backup version');
  const s=b.snapshot,d=s?.data;if(!object(s)||!object(d)||d.format!=='itembloom-normalized-responses'||d.schemaVersion!==1)fail('unsupported response format/version');
  const n=d.itemCount,count=d.examineeCount;if(!integer(n,1,500)||!integer(count,1,20000))fail('item/examinee count');
  if(b.metadata.itemCount!==n||b.metadata.learnerCount!==count)fail('metadata counts do not match data');
  if(!text(d.provider)||!text(d.filename)||!Array.isArray(d.warnings)||!d.warnings.every(text))fail('response metadata');
  array(d.headers,n,'headers',text);keys(d.answerKey,n,'source key');array(d.points,n,'source points',p=>Number.isFinite(p)&&p>=0);
  keys(s.key,n,'edited key');keys(s.originalKey,n,'original key');array(s.points,n,'edited points',p=>Number.isFinite(p)&&p>=0);
  s.modes??=Array(n).fill('any');array(s.modes,n,'scoring modes',m=>['any','all'].includes(m));
  if(!integer(s.choiceCount,2,10))fail('choice count');
  for(const [k,value,min,max] of [['threshold',70,0,100],['groupPercent',27,1,50]]){s[k]??=value;if(!Number.isFinite(s[k])||s[k]<min||s[k]>max)fail(k);}
  const aggregate=['aggregate','option-counts'].includes(d.entryMode);
  if(!Array.isArray(d.learners)||d.learners.length!==(aggregate?0:count))fail('learner count');
  const ids=new Set();for(const l of d.learners){if(!object(l)||!text(l.id)||ids.has(l.id)||!text(l.name)||!text(l.roster))fail('learner identity');ids.add(l.id);array(l.answers,n,'learner responses',text);}
  if(d.entryMode==='aggregate')array(d.correctCounts,n,'correct counts',v=>v===null||integer(v,0,count));
  if(d.entryMode==='option-counts')array(d.optionCounts,n,'option counts',v=>object(v)&&Object.entries(v).every(([k,x])=>/^[A-J]$/.test(k)&&(x===null||integer(x,0,count)))&&Object.values(v).reduce((a,x)=>a+(x??0),0)<=count);
  for(const k of ['invalidCells','blankCells'])if(!integer(d[k],0,n*count))fail(k);
  s.edits??=[];if(!Array.isArray(s.edits)||!s.edits.every(e=>object(e)&&ids.has(e.learner)&&integer(e.item,1,n)&&text(e.from)&&text(e.to)))fail('correction history');
  s.competencyMap??=[];if(!Array.isArray(s.competencyMap)||s.competencyMap.length>n||!s.competencyMap.every(v=>v==null||integer(v,0,99)))fail('competency map');
  if(s.linkedAssessment!=null){const l=s.linkedAssessment;if(!object(l)||!text(l.id)||!text(l.title)||!Array.isArray(l.rows)||!l.rows.every(r=>object(r)&&text(r.text)))fail('TOS snapshot');if(l.total!==n)fail('TOS item count');}
  if(s.paper!=null){const p=s.paper;if(!object(p)||!text(p.filename)||!Array.isArray(p.questions)||!p.questions.every(q=>object(q)&&integer(q.number,1,500)&&text(q.stem)&&object(q.options)&&Object.entries(q.options).every(([k,v])=>/^[A-J]$/.test(k)&&text(v))&&Array.isArray(q.warnings)&&q.warnings.every(text)))fail('test paper');if(p.notes!==undefined&&(!Array.isArray(p.notes)||!p.notes.every(text)))fail('paper notes');}
  s.sectionsText??='';s.manualMode??=null;s.view??='import';if(!text(s.sectionsText)||![null,'full'].includes(s.manualMode)||!['import','edit','key','analysis'].includes(s.view))fail('workspace settings');
  if(d.keyReview!==undefined){const r=d.keyReview;if(!object(r)||!Array.isArray(r.ambiguousSources)||!r.ambiguousSources.every(text))fail('key review');array(r.items,n,'key provenance',i=>object(i)&&['missing','verified','conflicting'].includes(i.status)&&Array.isArray(i.sources)&&i.sources.every(text));}
  return {kind:'workspace',record:{metadata:b.metadata,snapshot:s}};
 }
 function extraction(b){
  const p=b.payload;if(!object(p)||!['ItemBloom-CSV-Extraction-v1','ItemBloom-CSV-Extraction-v2'].includes(p.schema))fail('unsupported extraction version');
  if(p.blockRows!==undefined&&p.blockRows!==256)fail('unsupported extraction block size');
  const n=p.itemCount,count=p.learnerCount;if(!integer(n,1,10000)||!integer(count,1,200000)||n*count>20000000||b.metadata.itemCount!==n||b.metadata.learnerCount!==count)fail('extraction dimensions');
  array(p.answerKey,n,'extraction key',text);array(p.learners,count,'extraction learners',l=>object(l)&&['name','fullName','familyName','givenName','rosterNumber','score'].every(k=>l[k]===undefined||text(l[k])));
  if(!Array.isArray(p.dictionary)||p.dictionary[0]!==''||!p.dictionary.every(text)||p.dictionary.length>65535||!Array.isArray(p.blocks)||p.blocks.length!==Math.ceil(count/256))fail('extraction matrix');
  p.blocks=p.blocks.map((block,i)=>{const length=Math.min(256,count-i*256)*n;array(block,length,'extraction block',v=>integer(v,0,p.dictionary.length-1));return Uint16Array.from(block);});
  return {kind:'extraction',record:{metadata:b.metadata,payload:p}};
 }
 function exportWorkspace(record){return JSON.stringify({schema:SCHEMA,...record});}
 function prepare(decoded,choice,newId){
  if(!['copy','replace','new','cancel'].includes(choice))throw Error('Unknown restore action');if(choice==='cancel')return null;
  const record=structuredClone(decoded.record);
  if(choice==='copy'){if(!text(newId)||newId===record.metadata.id)throw Error('A copy needs a new identity');record.metadata.id=newId;if(decoded.kind==='workspace')record.metadata.filename=(record.metadata.filename||'Analysis')+' (Restored copy)';else record.metadata.title=(record.metadata.title||'Extraction')+' (Restored copy)';}
  return {kind:decoded.kind,record};
 }
 return {decode,prepare,exportWorkspace,MAX_BYTES};
});
