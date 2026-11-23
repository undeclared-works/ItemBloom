/* ItemBloom modern Excel (.xlsx) and XML-Excel 2003 reader.
 * Fully local. Uses browser-native DOMParser and DecompressionStream; no CDN.
 * Supports .xlsx ZIP OpenXML, .xls files exported as XML Spreadsheet 2003.
 * Legacy binary .xls BIFF is intentionally rejected with conversion guidance.
 */
(function (root,factory) {
  const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.ItemBloomExcel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const UTF8=new TextDecoder('utf-8',{fatal:false});
 const MAX_FILE=15*1024*1024,MAX_ENTRY=48*1024*1024,MAX_CELLS=1200,MAX_ROWS=20000;
 const localNodes=(node,local)=>Array.from(node.getElementsByTagName('*')).filter(x=>x.localName===local);
 const first=(node,local)=>localNodes(node,local)[0]||null;
 function parseXML(text,source){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error(`${source}: external or custom XML entities are not permitted.`);
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length||!doc.documentElement)throw new Error(`${source} contains invalid XML.`);
  return doc;
 }
 function decode(bytes){return UTF8.decode(bytes);}
 function cellColumn(ref){const m=String(ref||'').match(/^([A-Z]+)\d+$/i);if(!m)return null;let n=0;for(const ch of m[1].toUpperCase())n=n*26+(ch.charCodeAt(0)-64);return n-1;}
 function booleanCell(raw){if(String(raw).trim()==='1'||String(raw).trim().toLowerCase()==='true')return 'TRUE';if(String(raw).trim()==='0'||String(raw).trim().toLowerCase()==='false')return 'FALSE';throw new Error('Invalid Excel TRUE/FALSE cell. Verify the source workbook.');}
 function readXML2003(text){
  const doc=parseXML(text,'Excel XML');
  if(doc.documentElement.localName!=='Workbook')throw new Error('Not an Excel XML Spreadsheet workbook.');
  const result=[];
  for(const ws of localNodes(doc,'Worksheet')){
    const rows=[],table=first(ws,'Table');if(!table)continue;
    for(const rowEl of localNodes(table,'Row')){
      let idx=Number(rowEl.getAttribute('ss:Index')||rowEl.getAttribute('Index')||rows.length+1)-1;
      if(idx<0||idx>=MAX_ROWS)throw new Error('Workbook exceeds the 20,000-row limit.');
      while(rows.length<idx)rows.push([]);
      const cells=[];let col=0;
      for(const c of Array.from(rowEl.children).filter(x=>x.localName==='Cell')){
        col=Number(c.getAttribute('ss:Index')||c.getAttribute('Index')||col+1)-1;
        if(col<0||col>=MAX_CELLS)throw new Error('Workbook exceeds the 1,200-column limit.');
        const data=first(c,'Data');cells[col]=data?((data.getAttribute('ss:Type')||data.getAttribute('Type'))==='Boolean'?booleanCell(data.textContent):data.textContent):'';col++;
      }
      rows[idx]=cells;idx++;
    }
    result.push({name:ws.getAttribute('ss:Name')||ws.getAttribute('Name')||`Sheet ${result.length+1}`,rows});
  }
  return result;
 }
 class ZipParts {constructor(buffer){return new globalThis.ItemBloomCompression.ZipArchive(buffer,{label:'Excel'});}}
 function sheetRows(doc,shared){
  const rows=[],sheet=first(doc,'sheetData');if(!sheet)return rows;
  for(const rowNode of Array.from(sheet.children).filter(x=>x.localName==='row')){
   const rowNum=Number(rowNode.getAttribute('r')||rows.length+1)-1;
   if(!Number.isInteger(rowNum)||rowNum<0||rowNum>=MAX_ROWS)throw new Error('Excel worksheet has too many rows.');
   while(rows.length<rowNum)rows.push([]);
   const values=[];let previous=-1;
   for(const c of Array.from(rowNode.children).filter(x=>x.localName==='c')){
    const col=cellColumn(c.getAttribute('r'))??previous+1;
    if(col>=MAX_CELLS)throw new Error('Excel worksheet has too many columns.');
    previous=col;
    const t=c.getAttribute('t')||'',v=first(c,'v');
    let value='';
    if(t==='inlineStr'){
     const inline=first(c,'is');value=inline?localNodes(inline,'t').map(x=>x.textContent).join(''):'';
    }else if(v){
     const raw=v.textContent||'';value=t==='s'?(shared[Number(raw)]??''):t==='b'?booleanCell(raw):raw;
    }
    values[col]=String(value);
   }
   rows[rowNum]=values;
  }
  while(rows.length && !rows[rows.length-1]?.some(v=>String(v||'').trim()))rows.pop();
  return rows;
 }
 async function readXLSX(buffer){
  const zip=new ZipParts(buffer);
  const workbook=parseXML(await zip.read('xl/workbook.xml'),'Workbook');
  const rels=parseXML(await zip.read('xl/_rels/workbook.xml.rels'),'Workbook relationships');
  const paths=new Map();
  for(const rel of localNodes(rels,'Relationship')){
   const id=rel.getAttribute('Id'),target=rel.getAttribute('Target')||'';
   if(!target||!id||rel.getAttribute('TargetMode')==='External')continue;
   let path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
   const parts=[];
   for(const part of path.split('/')){if(part==='..'){parts.pop();continue;}if(part&&part!=='.')parts.push(part);}
   path=parts.join('/');
   if(path.startsWith('xl/worksheets/'))paths.set(id,path);
  }
  let strings=[];
  const stringDoc=await zip.read('xl/sharedStrings.xml',false);
  if(stringDoc){const doc=parseXML(stringDoc,'Shared strings');strings=localNodes(doc,'si').map(si=>localNodes(si,'t').map(t=>t.textContent).join(''));}
  const sheets=[];
  for(const sh of localNodes(workbook,'sheet')){
   const id=sh.getAttribute('r:id')||sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
   const target=paths.get(id);if(!target)continue;
   const xml=parseXML(await zip.read(target),target);
   sheets.push({name:sh.getAttribute('name')||`Sheet ${sheets.length+1}`,rows:sheetRows(xml,strings)});
  }
  if(!sheets.length)throw new Error('No readable worksheet was found.');
  return sheets;
 }
 async function parse(file){
  if(file.size>MAX_FILE)throw new Error('Excel file is larger than the 15 MB limit.');
  const buffer=await file.arrayBuffer(),bytes=new Uint8Array(buffer);
  const isZip=bytes[0]===0x50&&bytes[1]===0x4b;
  const isOle=bytes.length>=8&&[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((n,i)=>bytes[i]===n);
  if(isZip)return readXLSX(buffer);
  if(isOle)throw new Error('Legacy binary .xls is not yet supported offline. Open the file in Excel and Save As .xlsx or CSV.');
  const text=decode(bytes);
  if(/<(?:(?:\w+:)?Workbook)\b/i.test(text))return readXML2003(text);
  throw new Error('The selected file is not a recognized Excel .xlsx or XML Spreadsheet workbook.');
 }
 const canonical=key=>[...new Set(key)].sort().join('|');
 function keySourcesFromSheet(rows,itemCount){
  const parser=globalThis.ItemBloomParser,sources=[],ambiguous=[];
  const clean=v=>String(v??'').trim();
  const label=/^(?:answer\s*keys?|official\s*(?:answers?|keys?)|correct\s*answers?|keys?)\s*:?$/i;
  // Horizontal keys need an explicit key label, not just Q columns or a sheet name.
  for(let i=0;i<Math.min(rows.length,25);i++){
   const headers=rows[i].map(parser.questionNumber);
   if(!headers.some(n=>n&&n<=itemCount))continue;
   const identity=rows[i].some(v=>/^(?:name|(?:student|learner|first|last|full)\s*name|roster|(?:student|learner)\s*id)$/i.test(clean(v)));
   const title=i>0&&rows[i-1].filter(v=>clean(v)).length===1&&rows[i-1].some(v=>label.test(clean(v)));
   for(let j=i+1;j<rows.length;j++){
    const values=Array.from({length:itemCount},()=>[]);
    headers.forEach((n,col)=>{if(n&&n<=itemCount)values[n-1]=parser.keyToken(rows[j][col])||[];});
    if(!values.some(k=>k.length))continue;
    const meta=rows[j].filter((v,col)=>!headers[col]&&clean(v));
    if((meta.length===1&&label.test(clean(meta[0])))||(title&&!identity&&meta.length===0))sources.push({label:'row '+(j+1),values});
    else if(!identity)ambiguous.push('Unlabeled horizontal row '+(j+1));
   }
  }
  // An explicit Item/Answer table identifies a vertical key, regardless of sheet name.
  for(let i=0;i<Math.min(rows.length,20);i++){
   const h=rows[i].map(clean);
   const qi=h.findIndex(v=>/^(?:item|question|question no\.?|item no\.?|number|no\.?|q)$/i.test(v));
   const ki=h.findIndex(v=>/^(?:answer|answer key|correct answer|key)$/i.test(v));
   if(qi<0||ki<0)continue;
   for(let j=i+1;j<rows.length;j++){
    const m=clean(rows[j][qi]).match(/^(?:q|question|item)?\s*0*(\d+)\s*\.?$/i);
    if(!m||Number(m[1])<1||Number(m[1])>itemCount)continue;
    const values=Array.from({length:itemCount},()=>[]);values[Number(m[1])-1]=parser.keyToken(rows[j][ki])||[];
    if(values.some(k=>k.length))sources.push({label:'row '+(j+1),values});
   }
  }
  return {sources,ambiguous};
 }
 function mergeKeySources(initial,sources,conflicts=[]){
  return initial.map((key,i)=>{
   const choices=new Map(),origins=[];
   if(key?.length){choices.set(canonical(key),key);origins.push('results table');}
   for(const source of sources){const k=source.values[i];if(k?.length){choices.set(canonical(k),k);origins.push(source.label);}}
   const conflict=conflicts.includes(i)||choices.size>1;
   return {status:conflict?'conflicting':choices.size?'verified':'missing',key:conflict?[]:([...choices.values()][0]||[]),sources:origins};
  });
 }
 function keysFromSheet(rows,itemCount){
  const {sources}=keySourcesFromSheet(rows,itemCount);
  if(!sources.length)return [];
  return mergeKeySources(Array.from({length:itemCount},()=>[]),sources).map(item=>item.key);
 }
 async function normalize(file,parser,chooseSheet){
   const sheets=await parse(file);const candidates=[];
   for(const s of sheets){
    try{const res=parser.extractRows(s.rows,file.name);
      candidates.push({data:res,sheet:s,rank:res.itemCount*1000+res.examineeCount});
    }catch(e){/* Key-only and unrelated sheets are not result sets. */}
   }
   if(!candidates.length)throw new Error('No worksheet contains a recognized ZipGrade/EvalBee response table. Verify that this is a full-results export with individual answers.');
   candidates.sort((a,b)=>b.rank-a.rank);
   let selected=0;
   if(candidates.length>1){
    if(typeof chooseSheet!=='function')throw new Error('Multiple result worksheets detected. Select the intended worksheet before importing.');
    selected=await chooseSheet(candidates.map((c,index)=>({index,name:c.sheet.name,itemCount:c.data.itemCount,examineeCount:c.data.examineeCount})));
    if(selected===null||selected===undefined)return null;
    if(!Number.isInteger(selected)||!candidates[selected])throw new Error('Invalid worksheet selection.');
   }
   const chosen=candidates[selected];const d=chosen.data;
   d.sourceSchema=(d.sourceSchema||d.provider)+` · sheet: ${chosen.sheet.name}`;
   const sources=[],ambiguousSources=[];
   for(const sheet of sheets.filter(s=>s!==chosen.sheet)){
    const found=keySourcesFromSheet(sheet.rows,d.itemCount);
    if(!candidates.some(c=>c.sheet===sheet))sources.push(...found.sources.map(s=>({...s,label:sheet.name+' · '+s.label})));
    else d.warnings.push('Unselected result worksheet “'+sheet.name+'” was not used for responses or official keys.');
    ambiguousSources.push(...found.ambiguous.map(label=>sheet.name+' · '+label));
   }
   const items=mergeKeySources(d.answerKey,sources,d.keyConflicts||[]);
   d.answerKey=items.map(item=>item.key);
   d.keyConflicts=items.flatMap((item,i)=>item.status==='conflicting'?[i]:[]);
   d.keyReview={items,ambiguousSources};
   if(d.keyConflicts.length)d.warnings.push('Conflicting official keys on item(s): '+d.keyConflicts.map(i=>i+1).join(', ')+'. Enter the verified key in the editor and confirm before analysis.');
   if(ambiguousSources.length)d.warnings.push('Unlabeled possible key rows were not used. Verify the official key in the editor and confirm before analysis.');
   return d;
 }
 return {parse,normalize,keysFromSheet,keySourcesFromSheet,mergeKeySources};
});
