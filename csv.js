/* Shared, bounded CSV tokenization for local imports and the streaming worker. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.ItemBloomCSV=api;})(globalThis,()=>{'use strict';
  function delimiterOf(text) {
    const lines = String(text).split(/\r?\n/).slice(0, 6).filter(x => x.trim());
    let winner = ',', high = -1;
    for (const sep of [',', ';', '\t']) {
      const count = lines.reduce((sum, l) => {
        let quoted = false, n = 0;
        for (let i = 0; i < l.length; i++) {
          if (l[i] === '"') { if (quoted && l[i + 1] === '"') i++; else quoted = !quoted; }
          else if (l[i] === sep && !quoted) n++;
        }
        return sum + n;
      }, 0);
      if (count > high) { winner = sep; high = count; }
    }
    return winner;
  }

function csvRows(onRow,{delimiter=',',maxColumns=1200}={}){
 let firstCharacter=true;
 let state=0,cell='',row=[],col=0,hasAny=false,ignoreLF=false,keep=null;
 const append=c=>{if(!keep||keep.has(col)){cell+=c;if(cell.length>8192)throw Error('CSV contains an unusually long field. Check the exported file.');}};
 const endField=()=>{if(col>=maxColumns)throw Error('CSV has too many columns.');row[col++]=cell;cell='';state=0;};
 const endRow=()=>{endField();if(hasAny||col>1||row.some(x=>x)){const next=onRow(row);if(next instanceof Set)keep=next;}row=[];col=0;hasAny=false;};
 function feed(text){for(let i=0;i<text.length;i++){
  const c=text[i];if(firstCharacter){firstCharacter=false;if(c==='\uFEFF')continue;}if(ignoreLF){ignoreLF=false;if(c==='\n')continue;}
  if(state===2){if(c==='"')state=3;else append(c);hasAny=true;continue;}
  if(state===3&&c==='"'){append('"');state=2;hasAny=true;continue;}
  if(state===3&&c!==delimiter&&c!=='\r'&&c!=='\n'&&c!==' '&&c!=='\t')throw Error('Malformed quoted CSV field.');
  if(state===3&&c!==delimiter&&(c===' '||c==='\t'))continue;
  if(c===delimiter){endField();hasAny=true;continue;}
  if(c==='\r'||c==='\n'){endRow();if(c==='\r')ignoreLF=true;continue;}
  if((state===0||state===1&&!cell.trim())&&c==='"'){cell='';state=2;hasAny=true;continue;}
  if(state===3)throw Error('Invalid CSV delimiter after a quoted field.');
  append(c);state=1;hasAny=true;
 }}
 function finish(){if(state===2)throw Error('CSV contains an unmatched quotation mark.');if(hasAny||row.length||cell.length)endRow();}
 return {feed,finish};
}

function autoRows(onRow,options={}){
 let reader=null,selectedDelimiter=',',pending='',quoted=false,counts=[0,0,0],lines=0;const delimiters=[',',';','\t'],probeLimit=2*1024*1024;
 const start=delimiter=>{selectedDelimiter=delimiter;reader=csvRows(onRow,{...options,delimiter});reader.feed(pending);pending='';};
 return {get delimiter(){return selectedDelimiter;},feed(text){
  if(reader){reader.feed(text);return;}
  for(let i=0;i<text.length;i++){
   if(pending.length+i+1>probeLimit)throw Error('CSV header exceeds the safe size limit.');
   const ch=text[i];if(ch==='"')quoted=!quoted;else if(!quoted){
    const index=delimiters.indexOf(ch);if(index>=0)counts[index]++;
    if(ch==='\n'||ch==='\r'){lines++;const maximum=Math.max(...counts);if(maximum>0||lines>=12){pending+=text.slice(0,i+1);start(delimiters[counts.indexOf(maximum)]);reader.feed(text.slice(i+1));return;}}
   }
  }pending+=text;
 },finish(){if(!reader)start(delimiterOf(pending));reader.finish();}};
}
return {csvRows,delimiterOf,autoRows};});
