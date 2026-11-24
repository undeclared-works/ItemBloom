// Real browser-origin filesystem + deployed-release PWA upgrade.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const previous='43c7bb379dcf03b2d8823ee8e221c7248d7a85db';
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
const suffix='.ibassessment.json',matrix=[[4,2,2,1,1,0],[4,2,2,1,0,1]];
test('beta.10 to beta.11 upgrade, offline OPFS, and cross-tab save conflict',{timeout:120000},async t=>{
 let release='old';
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.replace(/^\/ItemBloom\/?/,'')||'index.html';
  const file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{const data=release==='old'?execFileSync('git',['show',previous+':'+name],{cwd:root,stdio:['ignore','pipe','ignore']}):fs.readFileSync(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(data);}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/google-chrome')?{channel:'chrome'}:{})});t.after(()=>browser.close());
 const ctx=await browser.newContext(),page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const url='http://127.0.0.1:'+server.address().port+'/ItemBloom/';
 await page.goto(url);
 await page.waitForFunction(()=>navigator.serviceWorker.controller&&document.body.classList.contains('home-mode'));
 assert.match(await page.title(),/beta\.10/);
 const original=await page.evaluate(async()=>{
  const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('test-assessments',{create:true});
  const fixture={...freshAssessmentState(),format:SCHEMA,assessmentId:'atest-native-grade8',grade:'GRADE 8',subject:'Creative Technologies',displayName:'Grade 8 native',total:20,dist:[40,20,20,10,5,5],rows:[{id:'c1',week:'1',text:'Explain a concept.',days:1},{id:'c2',week:'2',text:'Apply a procedure.',days:1}],header:{...defaultHeader,sy:'2026-2027'},draftMatrix:[[4,2,2,1,1,0],[4,2,2,1,0,1]],placementProvenance:{origin:'imported',edited:true,balanced:false},draftNotes:['Verified fixture.']};
  await writeJSON(dir,'Grade 8 native'+FILE_SUFFIX,fixture);await storeFolderHandle(dir);await attachFolder(dir);
  const draft={...fixture,assessmentId:'atest-old-recovery',displayName:'Legacy recovery',section:'Original recovery'};
  localStorage.setItem(DRAFT_STORE,JSON.stringify({[draft.assessmentId]:draft}));
  localStorage.setItem(STORE,JSON.stringify(draft));
  localStorage.setItem(PREF_STORE,JSON.stringify({dist:[30,20,20,20,5,5],header:{...defaultHeader,school:'Test school'},theme:'sage'}));
  await openSavedAssessment(fixture.assessmentId,false);
  return (await (await dir.getFileHandle('Grade 8 native'+FILE_SUFFIX)).getFile()).text();
 });
 release='new';
 await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
 await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);
 // Both versions must preserve the active assessment until the user leaves the editor.
 assert.match(await page.title(),/beta\.10/);
 await page.waitForTimeout(5500);
 assert.match(await page.title(),/beta\.10/);
 assert.equal(await page.evaluate(()=>state.grade),'GRADE 8');
 await page.locator('#homeNav').click();
 await page.waitForFunction(()=>document.title.includes('beta.11'),null,{timeout:45000});
 await page.waitForFunction(()=>savedLocations.has('atest-native-grade8'));
 assert.equal(await page.evaluate(()=>localStorage.getItem(PREF_STORE)&&JSON.parse(localStorage.getItem(PREF_STORE)).header.school),'Test school');
 assert.equal(await page.evaluate(()=>cachedDrafts['atest-old-recovery'].section),'Original recovery');
 assert.equal(await page.evaluate(async()=> (await (await folderHandle.getFileHandle('Grade 8 native'+FILE_SUFFIX)).getFile()).text()),original);
 // No network: reopen from native browser storage and save a metadata-only edit.
 await ctx.setOffline(true);await page.reload();await page.waitForFunction(()=>savedLocations.has('atest-native-grade8'));
 await page.evaluate(async()=>{await openSavedAssessment('atest-native-grade8',false);goScreen(2);});
 assert.deepEqual(await page.evaluate(()=>({grade:state.grade,matrix:state.draftMatrix,dirty:isSavedDirty(),preview:!!result})),{grade:'GRADE 8',matrix,dirty:false,preview:true});
 await page.evaluate(()=>{goScreen(0);state.section='Offline section';persist();});
 assert.equal(await page.evaluate(()=>saveNow()),true);
 await page.evaluate(()=>goScreen(-1));await page.reload();await page.waitForFunction(()=>savedLocations.has('atest-native-grade8'));
 assert.equal(await page.evaluate(async()=>JSON.parse(await (await (await folderHandle.getFileHandle('Grade 8 native'+FILE_SUFFIX)).getFile()).text()).section),'Offline section');
 // Real FileSystemFileHandle createWritable/exclusive locking, two independent tabs.
 const second=await ctx.newPage();second.on('pageerror',e=>errors.push(e.message));second.on('dialog',d=>d.accept());
 await second.goto(url);await second.waitForFunction(()=>savedLocations.has('atest-native-grade8'));
 for(const p of [page,second])await p.evaluate(()=>openSavedAssessment('atest-native-grade8',false));
 await page.evaluate(()=>{state.section='First editor';persist();});
 await second.evaluate(()=>{state.section='Second editor';persist();});
 assert.equal(await page.evaluate(()=>saveNow()),true);
 const pending=second.evaluate(()=>saveNow());
 await second.locator('dialog[open]').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await pending,false);
 assert.equal(await second.evaluate(async()=>JSON.parse(await (await (await folderHandle.getFileHandle('Grade 8 native'+FILE_SUFFIX)).getFile()).text()).section),'First editor');
 const recovery=await second.evaluate(async()=>{for await(const [name,h] of folderHandle.entries())if(name.startsWith('Recovery ')&&name.endsWith(FILE_SUFFIX)){const obj=JSON.parse(await (await h.getFile()).text());if(obj.section==='Second editor')return {id:obj.assessmentId,matrix:obj.draftMatrix};}return null;});
 assert.ok(recovery);assert.notEqual(recovery.id,'atest-native-grade8');assert.deepEqual(recovery.matrix,matrix);
 // Recover the pre-update draft as a new identity; neither saved file nor legacy draft changes.
 await second.evaluate(()=>goScreen(-1));
 const recovered=await second.evaluate(()=>{openCachedDraft('atest-old-recovery',false);return {grade:state.grade,id:state.assessmentId,matrix:state.draftMatrix,legacy:cachedDrafts['atest-old-recovery'].section};});
 assert.equal(recovered.grade,'GRADE 8');assert.notEqual(recovered.id,'atest-old-recovery');assert.deepEqual(recovered.matrix,matrix);assert.equal(recovered.legacy,'Original recovery');
 assert.deepEqual(errors,[]);
});
