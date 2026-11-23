/* ItemBloom CSV Extraction v1 — local Worker; never sends files or learner data over network. */
'use strict';
importScripts('./csv.js','./item-analysis/parser.js');
const BLOCK_ROWS=256;
const LIMIT_BYTES=250*1024*1024;
const MAX_ITEMS=10000;
const MAX_ROWS=200000;
const MAX_CELLS=20000000; // 40MB response matrix, plus metadata and IndexedDB copies.
const layouts={
 zipgrade:{given:2,family:3,roster:4,score:6,answer:12,key:13,stride:4,kind:'ZipGrade'},
 evalbee:{name:3,roster:2,score:7,answer:11,key:12,stride:3,kind:'EvalBee'}
};
let cancelled=false;
self.onmessage=async({data})=>{
 if(data?.type==='cancel'){cancelled=true;return;}
 if(data?.type!=='parse')return;
 cancelled=false;
 try{
  const result=await parseFile(data.file);
  const transfers=result.payload.blocks.map(b=>b.buffer);
  self.postMessage({type:'done',result},transfers);
 }catch(ex){self.postMessage({type:'error',message:String(ex?.message||ex)});}
};
function needs(value){return String(value??'').trim();}
async function parseFile(file){
 if(!file||typeof file.stream!=='function')throw Error('Select a CSV file from this device.');
 if(!/\.csv$/i.test(file.name||''))throw Error('Only .csv files exported from ZipGrade or EvalBee are accepted.');
 if(file.size<=0||file.size>LIMIT_BYTES)throw Error('CSV must be larger than 0 and at most 250 MB.');
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let header,kind,layout,itemCols,answerKey,seenRows=0,learners=[],blocks=[],block=null,within=0,dict=[''],dictCodes=new Map([['',0]]),warnings=new Map(),quizName='',version='',classNames=new Set();
 function warn(code,message,row){let w=warnings.get(code);if(!w){w={message,count:0,examples:[]};warnings.set(code,w);}w.count++;if(row&&w.examples.length<5)w.examples.push(row);}
 function encode(raw){const value=ItemBloomParser.responseToken(raw).value;const cached=dictCodes.get(value);if(cached!==undefined)return cached; if(dict.length>=65535)throw Error('Too many distinct answer values in CSV.');const n=dict.length;dict.push(value);dictCodes.set(value,n);return n;}
 function process(row){
  if(!row.some(x=>needs(x)))return;
  seenRows++;
  if(seenRows===1){
   header=row.map(x=>needs(x));const a=header[0],b=header[1];
   if(a==='QuizName'&&b==='QuizClass')kind='zipgrade';
   else if(a==='Exam'&&b==='Exam Set')kind='evalbee';
   else throw Error('Unrecognized CSV: expected ZipGrade headers QuizName, QuizClass or EvalBee headers Exam, Exam Set in A1 and B1.');
   layout=layouts[kind];itemCols=[];
   for(let i=0;i<MAX_ITEMS;i++){
    const ans=layout.answer+i*layout.stride,key=layout.key+i*layout.stride;
    if(ans>=header.length&&key>=header.length)break;
    const hasAns=!!header[ans],hasKey=!!header[key];
    if(!hasAns&&!hasKey){
     for(let j=i+1;j<MAX_ITEMS;j++){const a2=layout.answer+j*layout.stride,k2=layout.key+j*layout.stride;if(a2>=header.length&&k2>=header.length)break;if(header[a2]||header[k2])throw Error(`A missing item header was found before item ${j+1}. No items have been silently skipped.`);}
     break;
    }
    if(!hasAns||!hasKey)throw Error(`Incomplete item ${i+1} headers: both learner-answer and answer-key columns need headers.`);
    itemCols.push({ans,key});
   }
   if(!itemCols.length)throw Error('No item-answer columns found in the recognized CSV.');
   if(itemCols.length>MAX_CELLS)throw Error('The item count is above the safe processing limit.');
   if(itemCols.length>=MAX_ITEMS)throw Error('Item count exceeds the safety limit.');
   answerKey=new Array(itemCols.length).fill('');
   const selected=new Set([0,1,layout.score,layout.roster]);
   if(kind==='zipgrade'){selected.add(layout.given);selected.add(layout.family);}else selected.add(layout.name);
   for(const item of itemCols){selected.add(item.ans);selected.add(item.key);}
   self.postMessage({type:'progress',phase:'Reading '+layout.kind+' CSV',items:itemCols.length,learners:0});
   return selected;
  }
  if(cancelled)throw Error('Upload cancelled.');
  const rowKind=ItemBloomParser.csvRowKind(row,header,itemCols.map(c=>c.ans));
  if(rowKind==='empty'||rowKind==='summary')return;
  for(let i=0;i<itemCols.length;i++){
   const raw=rowKind==='key'?row[itemCols[i].ans]:row[itemCols[i].key];const value=needs(raw).toUpperCase();
   if(value&&answerKey[i]&&value!==answerKey[i])throw Error(`Conflicting answer key for item ${i+1}, row ${seenRows}. Verify the official key in Item Analysis.`);
   if(value){const key=ItemBloomParser.keyToken(value);if(!key?.length)throw Error(`Unrecognized official answer key for item ${i+1}.`);answerKey[i]=value;}
  }
  if(rowKind==='key')return;
  const a=needs(row[0]),b=needs(row[1]);
  if(!quizName)quizName=a;else if(a&&a!==quizName)throw Error(`Multiple exams detected in column A (row ${seenRows}). This module accepts one exam only.`);
  if(kind==='evalbee'){if(!version)version=b;else if(b&&b!==version)throw Error(`Multiple EvalBee Exam Sets detected (row ${seenRows}). Only one version is supported.`);}
  else if(b)classNames.add(b);
  // Both sources produce the SAME learner schema: {name, rosterNumber, score}.
  // ZipGrade names are explicitly assembled as 'Family, Given'; EvalBee supplies column D.
  let name;
  if(kind==='zipgrade'){
   const family=needs(row[layout.family]),given=needs(row[layout.given]);
   name=family&&given?`${family}, ${given}`:(family||given);
   if(!family||!given)warn('incomplete-name','Some ZipGrade records have a missing family or given name; available text was retained.',seenRows);
  }else{
   name=needs(row[layout.name]).replace(/\s*,\s*/g,', ');
   if(name&&!/^[^,]+,\s*[^,]+/.test(name))warn('name-order','Some EvalBee names are not in “Family, Given” format; original name text was preserved for review.',seenRows);
  }
  const rosterNumber=needs(row[layout.roster]);
  const score=needs(row[layout.score]);
  if(!name)warn('missing-name','Some records have missing learner names.',seenRows);
  if(!score)warn('missing-score','Some records have no score.',seenRows);
  if(score&&!/^\d+(?:\.\d+)?$/.test(score))warn('score-format','Some scores are not plain numbers and were preserved as text.',seenRows);
  learners.push({name,rosterNumber,score});
  if(!block){block=new Uint16Array(BLOCK_ROWS*itemCols.length);within=0;}
  const offset=within*itemCols.length;
  for(let i=0;i<itemCols.length;i++){
   const raw=needs(row[itemCols[i].ans]);
   block[offset+i]=encode(raw);
   if(raw&&!/^[A-Z]$/i.test(raw))warn('answer-format','Some answers are not single letters; original distinct values were retained.',seenRows);
  }
  within++;
  if(within===BLOCK_ROWS){blocks.push(block);block=null;within=0;}
  if(learners.length>MAX_ROWS)throw Error('Too many learner rows for this module.');
  if(learners.length*itemCols.length>MAX_CELLS)throw Error('Dataset exceeds the safe extraction limit of 20 million learner-answer cells; split it into smaller files.');
  if(learners.length%500===0)self.postMessage({type:'progress',phase:'Extracting locally',items:itemCols.length,learners:learners.length});
 }
 const reader=file.stream().getReader();const parser=ItemBloomCSV.autoRows(process,{maxColumns:MAX_ITEMS*4+32});let bytes=0;
 try{while(true){if(cancelled)throw Error('Upload cancelled.');const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>LIMIT_BYTES)throw Error('CSV file exceeds the 250 MB limit.');parser.feed(decoder.decode(value,{stream:true}));}parser.feed(decoder.decode());parser.finish();}
 finally{reader.releaseLock();}
 if(seenRows<2)throw Error('CSV must include a header row and at least one data row.');
 if(!learners.length)throw Error('No learner-response records found.');
 if(block)blocks.push(block.slice(0,within*itemCols.length));
 if(kind==='zipgrade'&&classNames.size>1)warn('multiple-classes',`The file includes ${classNames.size} ZipGrade classes; they are combined under the same quiz name.`);
 for(let i=0;i<answerKey.length;i++)if(!answerKey[i])warn('blank-key',`Answer key for item ${i+1} is missing. Verify it before analysis.`);
 const messages=[...warnings.values()];
 return {metadata:{id:`ia-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,title:file.name.replace(/\.csv$/i,'').slice(0,140),source:layout.kind,sourceFile:file.name,itemCount:itemCols.length,learnerCount:learners.length,exam:quizName,examSet:version,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'Extracted — analysis pending',warnings:messages},payload:{schema:'ItemBloom-CSV-Extraction-v2',source:layout.kind,learnerCount:learners.length,itemCount:itemCols.length,answerKey,learners,dictionary:dict,blocks}};
}
