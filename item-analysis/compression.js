/* Bounded, offline decompression shared by Excel and test-paper importers. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.ItemBloomCompression=api;})(globalThis,()=>{
 'use strict';
 const FILE_LIMIT=15*1024*1024,ENTRY_LIMIT=48*1024*1024,TOTAL_LIMIT=96*1024*1024;
 const decoder=new TextDecoder(),table=new Uint32Array(256);
 for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
 function crcUpdate(crc,bytes){for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return crc;}
 const crc32=bytes=>(crcUpdate(-1,bytes)^-1)>>>0;
 function bad(message){const e=Error(message);e.code='IMPORT_MALFORMED';return e;}
 function limit(message){const e=Error(message);e.code='IMPORT_RESOURCE_LIMIT';return e;}
 function budget(total=TOTAL_LIMIT){return {used:0,limit:total};}
 function charge(bytes,b,label){if(bytes>b.limit-b.used)throw limit(label+': total decompressed-size limit exceeded.');b.used+=bytes;}
 async function collect(stream,b,{label='Import',max=ENTRY_LIMIT,expected,crc}={}){
  const reader=stream.getReader(),chunks=[];let length=0,checksum=-1;
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;
    // Reject before retaining a chunk or allocating the joined output.
    if(value.byteLength>max-length)throw limit(label+': decompressed entry limit exceeded.');
    if(expected!==undefined&&value.byteLength>expected-length)throw bad(label+': decompressed size exceeds its declared size.');
    charge(value.byteLength,b,label);length+=value.byteLength;checksum=crcUpdate(checksum,value);chunks.push(value);
   }
   if(expected!==undefined&&length!==expected)throw bad(label+': decompressed size mismatch.');
   if(crc!==undefined&&((checksum^-1)>>>0)!==crc)throw bad(label+': ZIP checksum mismatch.');
   const out=new Uint8Array(length);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}return out;
  }catch(e){try{await reader.cancel(e)}catch{}throw e;}finally{reader.releaseLock();}
 }
 async function inflate(bytes,format,b,options={}){
  if(typeof DecompressionStream==='undefined')throw bad('Offline decompression is unavailable. Update your browser or use CSV/TXT.');
  // Bound each native decompressor input write too; a Blob's large chunks can
  // inflate substantially before JavaScript gets a chance to reject the output.
  let offset=0;
  const input=new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const end=Math.min(offset+1024,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;}},{highWaterMark:0});
  try{return await collect(input.pipeThrough(new DecompressionStream(format)),b,options);}
  catch(e){if(['IMPORT_MALFORMED','IMPORT_RESOURCE_LIMIT'].includes(e.code))throw e;throw bad((options.label||'Import')+': compressed content is damaged or unsupported.');}
 }
 function ascii85(bytes,b,{label='PDF',max=ENTRY_LIMIT}={}){
  const chunks=[];let block=new Uint8Array(16384),at=0,length=0,group=[];
  function emit(values){if(values.length>max-length)throw limit(label+': ASCII85 output limit exceeded.');charge(values.length,b,label);length+=values.length;for(const v of values){block[at++]=v;if(at===block.length){chunks.push(block);block=new Uint8Array(16384);at=0;}}}
  function flush(partial){const n=group.length;if(n<2)throw bad(label+': malformed ASCII85 group.');while(group.length<5)group.push(84);let v=0;for(const x of group)v=v*85+x;if(v>0xffffffff)throw bad(label+': invalid ASCII85 value.');emit([(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255].slice(0,partial?n-1:4));group=[];}
  let i=bytes[0]===60&&bytes[1]===126?2:0;
  for(;i<bytes.length;i++){const c=bytes[i];if([0,9,10,12,13,32].includes(c))continue;
   if(c===126){if(bytes[i+1]!==62)throw bad(label+': malformed ASCII85 terminator.');i+=2;for(;i<bytes.length;i++)if(![0,9,10,12,13,32].includes(bytes[i]))throw bad(label+': trailing ASCII85 data.');break;}
   if(c===122){if(group.length)throw bad(label+': misplaced ASCII85 z.');emit([0,0,0,0]);continue;}
   if(c<33||c>117)throw bad(label+': malformed ASCII85 data.');group.push(c-33);if(group.length===5)flush(false);
  }
  if(group.length)flush(true);const out=new Uint8Array(length);let pos=0;for(const chunk of chunks){out.set(chunk,pos);pos+=chunk.length;}out.set(block.subarray(0,at),pos);return out;
 }
 class ZipArchive{
  constructor(buffer,{label='Office document',entryLimit=ENTRY_LIMIT,totalLimit=TOTAL_LIMIT,fileLimit=FILE_LIMIT}={}){
   this.label=label;this.max=entryLimit;this.budget=budget(totalLimit);this.bytes=new Uint8Array(buffer);this.view=new DataView(buffer);this.files=new Map();
   if(buffer.byteLength>fileLimit)throw limit(label+': compressed file size limit exceeded.');this.directory(totalLimit);
  }
  check(at,length,end=this.bytes.length){if(!Number.isSafeInteger(at)||at<0||length<0||at>end-length)throw bad(this.label+': ZIP entry exceeds archive boundaries.');}
  u16(at){this.check(at,2);return this.view.getUint16(at,true)}
  u32(at){this.check(at,4);return this.view.getUint32(at,true)}
  extra(at,length){const end=at+length;while(at<end){this.check(at,4,end);const tag=this.u16(at),size=this.u16(at+2);at+=4;this.check(at,size,end);if(tag===1)throw bad(this.label+': ZIP64 is not supported.');at+=size;}}
  directory(totalLimit){
   const b=this.bytes;let end=-1;
   for(let p=b.length-22;p>=Math.max(0,b.length-65557);p--)if(this.u32(p)===0x06054b50&&p+22+this.u16(p+20)===b.length){end=p;break;}
   if(end<0)throw bad(this.label+': ZIP directory was not found.');
   const count=this.u16(end+10),size=this.u32(end+12),offset=this.u32(end+16);
   if(this.u16(end+4)||this.u16(end+6)||this.u16(end+8)!==count||count>5000||count===65535||offset===0xffffffff||size===0xffffffff)throw bad(this.label+': unsupported multi-disk or ZIP64 archive.');
   this.check(offset,size,end);if(offset+size!==end)throw bad(this.label+': inconsistent ZIP directory size.');
   let p=offset,total=0;const ranges=[];
   for(let i=0;i<count;i++){
    this.check(p,46,end);if(this.u32(p)!==0x02014b50)throw bad(this.label+': damaged ZIP directory.');
    const disk=this.u16(p+34),flags=this.u16(p+8),method=this.u16(p+10),crc=this.u32(p+16),packed=this.u32(p+20),unpacked=this.u32(p+24),nl=this.u16(p+28),el=this.u16(p+30),cl=this.u16(p+32),start=this.u32(p+42);
    this.check(p+46,nl+el+cl,end);this.extra(p+46+nl,el);const nameBytes=b.subarray(p+46,p+46+nl),name=decoder.decode(nameBytes);p+=46+nl+el+cl;
    if(disk!==0||flags&65||![0,8].includes(method))throw bad(this.label+': encrypted, multi-disk or unsupported ZIP entry.');
    if(packed===0xffffffff||unpacked===0xffffffff||start===0xffffffff)throw bad(this.label+': ZIP64 is not supported.');
    if(unpacked>this.max)throw limit(this.label+': declared entry size limit exceeded.');
    total+=unpacked;if(total>totalLimit)throw limit(this.label+': total declared decompressed-size limit exceeded.');
    if(!name||[...name].some(c=>c.charCodeAt(0)===0||c.charCodeAt(0)===92)||name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').includes('..')||this.files.has(name))throw bad(this.label+': unsafe or duplicate ZIP entry path.');
    this.check(start,30,offset);if(this.u32(start)!==0x04034b50)throw bad(this.label+': invalid local ZIP header.');
    const localFlags=this.u16(start+6),localMethod=this.u16(start+8),ln=this.u16(start+26),le=this.u16(start+28),begin=start+30+ln+le;
    this.check(start+30,ln+le,offset);this.extra(start+30+ln,le);
    if(localFlags!==flags||localMethod!==method||ln!==nl||!nameBytes.every((v,j)=>b[start+30+j]===v))throw bad(this.label+': local and central ZIP headers disagree.');
    for(const [at,value] of [[start+14,crc],[start+18,packed],[start+22,unpacked]]){const local=this.u32(at);if(local!==value&&(!(flags&8)||local!==0))throw bad(this.label+': inconsistent ZIP entry sizes/checksum.');}
    if(method===0&&packed!==unpacked)throw bad(this.label+': stored ZIP entry size mismatch.');
    this.check(begin,packed,offset);let finish=begin+packed;
    if(flags&8){
     let d=finish;this.check(d,12,offset);
     if(this.u32(d)===0x08074b50){this.check(d,16,offset);d+=4;}
     if(this.u32(d)!==crc||this.u32(d+4)!==packed||this.u32(d+8)!==unpacked)throw bad(this.label+': invalid ZIP data descriptor.');finish=d+12;
    }
    ranges.push([start,finish]);this.files.set(name,{begin,packed,unpacked,method,crc});
   }
   if(p!==end)throw bad(this.label+': ZIP entry count/directory size mismatch.');
   ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])throw bad(this.label+': overlapping ZIP entries.');
  }
  async readBytes(name,required=true){
   const f=this.files.get(name);if(!f){if(required)throw bad(this.label+': missing '+name+'.');return null;}
   const bytes=this.bytes.subarray(f.begin,f.begin+f.packed),label=this.label+' ('+name+')';
   if(f.method===8)return inflate(bytes,'deflate-raw',this.budget,{label,max:this.max,expected:f.unpacked,crc:f.crc});
   charge(bytes.length,this.budget,label);if(crc32(bytes)!==f.crc)throw bad(label+': ZIP checksum mismatch.');return bytes;
  }
  async read(name,required=true){const bytes=await this.readBytes(name,required);return bytes?decoder.decode(bytes):'';}
 }
 return {ZipArchive,inflate,collect,ascii85,budget,charge,crc32,FILE_LIMIT,ENTRY_LIMIT,TOTAL_LIMIT};
});
