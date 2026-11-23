/* ItemBloom local, deterministic test-paper parser. No network, no OCR, no generative AI. */
(function(root){'use strict';
const MAX=15*1024*1024, LIMIT=50*1024*1024,decoder=new TextDecoder();
function checkXML(xml){if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsafe XML entities are not allowed.');const d=new DOMParser().parseFromString(xml,'application/xml');if(d.querySelector('parsererror'))throw Error('Invalid Word document XML.');return d;}
async function unzipPart(buffer,target){return new root.ItemBloomCompression.ZipArchive(buffer,{label:'DOCX',entryLimit:LIMIT,totalLimit:100*1024*1024}).read(target);}
function parsePDFString(s){let value='';for(let i=0;i<s.length;i++){const ch=s[i];if(ch!=='\\'){value+=ch;continue;}const c=s[++i];if(c===undefined)break;if(c==='n')value+='\n';else if(c==='r')value+='\r';else if(c==='t')value+='\t';else if(/[0-7]/.test(c)){let oct=c;while(oct.length<3&&/[0-7]/.test(s[i+1]||''))oct+=s[++i];value+=String.fromCharCode(parseInt(oct,8));}else if(c==='\r'&&s[i+1]==='\n'){i++;}else if(c!=='\n'&&c!=='\r')value+=c;}return value;}
function decodeASCII85(bytes,budget,max){return root.ItemBloomCompression.ascii85(bytes,budget,{label:'PDF',max});}
async function parsePDF(file){const buffer=await file.arrayBuffer();const a=new Uint8Array(buffer);if(decoder.decode(a.slice(0,5))!=='%PDF-')throw Error('Not a PDF file.');if(a.length>MAX)throw Error('PDF file exceeds the 15 MB input limit.');const codec=root.ItemBloomCompression,resourceBudget=codec.budget();const bytes=new TextDecoder('latin1').decode(a);const lines=[];let at=0,streams=0;
 while(at<bytes.length){const ix=bytes.indexOf('stream',at);if(ix<0)break;at=ix+6;const ending=bytes[at]==='\r'&&bytes[at+1]==='\n'?2:bytes[at]==='\r'||bytes[at]==='\n'?1:0;if(!ending)continue;let end=bytes.indexOf('endstream',at);if(end<0)throw Error('Malformed PDF: missing endstream boundary.');const prefix=bytes.slice(Math.max(0,ix-500),ix);const flate=/\/FlateDecode/.test(prefix),ascii85=/\/ASCII85Decode/.test(prefix);const begin=at+ending;let final=end;if(bytes[final-1]==='\n')final--;if(bytes[final-1]==='\r')final--;at=end+9;if(final-begin>LIMIT)throw Error('PDF content stream is too large.');let raw=a.subarray(begin,final);if(ascii85)raw=decodeASCII85(raw,resourceBudget,flate?MAX:codec.ENTRY_LIMIT);
 let body;if(flate)body=decoder.decode(await codec.inflate(raw,'deflate',resourceBudget,{label:'PDF stream'}));
 else{if(!ascii85)codec.charge(raw.length,resourceBudget,'PDF stream');body=decoder.decode(raw);}
 if(!body.includes('BT'))continue;streams++;
  for(const block of body.matchAll(/BT([\s\S]*?)ET/g)){
    const content=block[1],pieces=[];const commands=/(\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f]+)>)\s*(?:Tj|\'|\")|\[([\s\S]*?)\]\s*TJ/g;let m;while((m=commands.exec(content))){if(m[3]){const matches=[...m[3].matchAll(/\((?:\\.|[^\\)])*\)/g)];pieces.push(matches.map(x=>parsePDFString(x[0].slice(1,-1))).join(''));}else if(m[2]){const bytes=String(m[2]).match(/.{2}/g)||[];pieces.push(bytes.map(x=>String.fromCharCode(parseInt(x,16))).join(''));}else pieces.push(parsePDFString(m[1].slice(1,-1)));}if(pieces.length){const text=pieces.join(' ').trim();if(text)lines.push(text);}
  }
 }
 if(!streams||!lines.length)throw Error('No selectable PDF text was found. Scanned PDFs require offline OCR; try exporting this test paper as DOCX or TXT.');return lines.join('\n');}
function validateQuestions(questions,expectedCount){
 const counts=new Map();questions.forEach(q=>counts.set(q.number,(counts.get(q.number)||0)+1));
 const seen=new Set();let previous=0;
 for(const q of questions){const warnings=q.reviewed?[]:[...(q.parseWarnings||[])];
  if(counts.get(q.number)>1)warnings.push('Duplicate question number; mapping requires review');
  if(q.number<previous)warnings.push('Out-of-order question number; source order preserved');
  if(q.number>previous+1)warnings.push('Missing number(s) before this question: '+Array.from({length:q.number-previous-1},(_,i)=>previous+i+1).filter(n=>!seen.has(n)).join(', '));
  if(expectedCount&&q.number>expectedCount)warnings.push('Number exceeds the assessment item count');
  if(Object.keys(q.options||{}).length<2)warnings.push('Fewer than two answer options recognized');
  if(!q.stem)warnings.push('Missing question stem');q.warnings=[...new Set(warnings)];seen.add(q.number);previous=q.number;
 }return questions;
}
function uniqueQuestion(questions,number){const matches=(questions||[]).filter(q=>q.number===number);return matches.length===1?matches[0]:null;}
function parseText(text){
 const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n').map(v=>v.trim()),result=[];
 // Recognition normalizes punctuation only; original wording and numbers remain intact.
 const normalized=line=>line.replace(/[．。]/g,'.').replace(/（/g,'(').replace(/）/g,')').replace(/：/g,':');
 const marker=/^(?:(?:Question|Item|Q)\s*(?:No\.?\s*)?#?\s*(\d{1,3})(?:\s*[.):\-]+|\s+|$)|\((\d{1,3})\)\s*|\[(\d{1,3})\]\s*|(\d{1,3})\s*(?:\.\)|[.):\-])(?:\s+|(?=[^\d\s])|$))\s*(.*)$/i;
 const option=/^(?:\(([A-J])\)|\[([A-J])\]|([A-J])(?:\.\)|[.):]))\s*(.*)$/i;
 let current=null,target='stem';
 const addOption=(letter,value,ambiguous=false)=>{letter=letter.toUpperCase();if(Object.hasOwn(current.options,letter)){current.parseWarnings.push('Repeated option '+letter+'; first occurrence retained, duplicate preserved for review');(current.duplicateOptions||(current.duplicateOptions=[])).push({letter,text:value});target='duplicate';}else{current.options[letter]=value;target=letter;}if(ambiguous)current.parseWarnings.push('Bare option labels require teacher review');};
 const inlineOptions=(line,isStem=false)=>{const markers=[...line.matchAll(/(?:^|\s)([A-J])(?:\.\)|[.)])\s+/g)];if(markers.length<2||markers[0][1]!=='A'||markers[1][1]!=='B')return false;const leading=line.slice(0,markers[0].index).trim();if(isStem)current.stem=leading;else if(leading)current.stem+=' '+leading;markers.forEach((m,k)=>addOption(m[1],line.slice(m.index+m[0].length,k+1<markers.length?markers[k+1].index:line.length).trim()));current.parseWarnings.push('Inline options require teacher review');return true;};
 for(let i=0;i<lines.length;i++){
  const raw=lines[i];if(!raw)continue;const line=normalized(raw),q=line.match(marker);
  if(q){const number=Number(q[1]||q[2]||q[3]||q[4]);if(number>0&&number<=500){current={number,sourceNumber:number,sourceLine:i+1,stem:q[5].trim(),options:{},warnings:[],parseWarnings:[]};result.push(current);target='stem';inlineOptions(current.stem,true);continue;}}
  if(!current)continue;
  if(inlineOptions(line))continue;
  const o=line.match(option);if(o){addOption(o[1]||o[2]||o[3],o[4]);continue;}
  const bare=raw.match(/^([A-J])(?:\s+(.+)|$)/),next=normalized(lines[i+1]||'');
  if(bare&&(Object.keys(current.options).length||new RegExp('^'+String.fromCharCode(bare[1].charCodeAt(0)+1)+'(?:\\s|[.)])').test(next))){addOption(bare[1],bare[2]||'',true);continue;}
  if(/^(?:\d+\s*[-:]|[IVX]+[.)]|\d+[.)])/.test(line))current.parseWarnings.push('Ambiguous numbering retained as text; verify item placement against the source');
  if(target==='stem')current.stem+=(current.stem?' ':'')+raw;else if(target==='duplicate')current.duplicateOptions[current.duplicateOptions.length-1].text+=' '+raw;else current.options[target]+=(current.options[target]?' ':'')+raw;
 }
 if(!result.length)throw Error('No reliable numbered questions were detected. Export explicit question numbers (for example 1. or Question #1) and review Word automatic numbering in the source.');
 return validateQuestions(result);
}
async function parse(file){if(!file||file.size>MAX)throw Error('Test paper must be 15 MB or smaller.');const name=file.name.toLowerCase();let text='',notes=[];
 if(/\.txt$/.test(name)){text=await file.text();}
 else if(/\.docx$/.test(name)){const xml=await unzipPart(await file.arrayBuffer(),'word/document.xml');const doc=checkXML(xml);const paragraphs=Array.from(doc.getElementsByTagNameNS('*','p'));text=paragraphs.map(p=>Array.from(p.getElementsByTagNameNS('*','t')).map(t=>t.textContent).join('')).join('\n');if(doc.getElementsByTagNameNS('*','numPr').length)notes.push('Word automatic list numbering is ambiguous and is not inferred. Convert list labels to explicit text numbers and reimport; verify every item placement.');if(doc.getElementsByTagNameNS('*','drawing').length)notes.push('Embedded images were not extracted; inspect image-based questions in the source file.');}
 else if(/\.pdf$/.test(name)){text=await parsePDF(file);notes.push('PDF text recognition is best-effort for simple single-column documents. Verify the question order and choices; complex layouts or scans may need DOCX/TXT conversion.');}
 else throw Error('Select a .txt or .docx test paper.');
 const questions=parseText(text);return {filename:file.name,questions,notes,importedAt:new Date().toISOString()};}
root.ItemBloomPaperParser={parse,parseText,validateQuestions,uniqueQuestion};
})(globalThis);
