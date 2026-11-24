// Run: npm install --no-save --package-lock=false playwright@1.51.1
//      npx playwright install chromium
//      node --test tests/assessment-integrity.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('main JavaScript parses; branding and PWA identity are consistent',()=>{
 for(const [,source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(source.trim())new vm.Script(source);
 assert.ok(!/cloudflare/i.test(html));
 assert.match(html,/v1\.0\.0-beta\.11/);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest')));
 assert.equal(manifest.id,'./');assert.equal(manifest.scope,'./');assert.match(manifest.name,/Beta 11/);
 assert.match(fs.readFileSync(path.join(root,'sw.js'),'utf8'),/beta11/);
});
test('browser assessment lifecycle with simulated local files',async t=>{
 const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.replace(/^\/ItemBloom\/?/,'');const file=path.resolve(root,name||'index.html');if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>server.close());
 const browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/google-chrome')?{channel:'chrome'}:{})});
 t.after(()=>browser.close());
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 let confirm=true;page.on('dialog',dialog=>confirm?dialog.accept():dialog.dismiss());
 const url='http://127.0.0.1:'+server.address().port+'/ItemBloom/';
 await page.goto(url);await page.waitForFunction(()=>document.body.classList.contains('home-mode'));
 await page.evaluate(async()=>{
  window.testDirectory=(name='ItemBloom')=>{
   const entries=new Map();
   return {name,kind:'directory',entriesMap:entries,async *entries(){yield* entries.entries();},async queryPermission(){return 'granted';},async requestPermission(){return 'granted';},async isSameEntry(other){return other===this;},async getDirectoryHandle(name,{create=false}={}){if(!entries.has(name)&&create)entries.set(name,window.testDirectory(name));const dir=entries.get(name);if(!dir||dir.kind!=='directory')throw new DOMException('Missing','NotFoundError');return dir;},async getFileHandle(name,{create=false}={}){if(!entries.has(name)&&create){const file={name,kind:'file',text:'',fail:false,async getFile(){return new File([this.text],name,{type:'application/json'});},async createWritable(){const target=this;let staged=target.text;return {async write(value){if(target.fail)throw Error('Simulated permission/write failure');staged=typeof value==='string'?value:await value.text();},async close(){target.text=staged;},async abort(){}};}};entries.set(name,file);}const f=entries.get(name);if(!f||f.kind!=='file')throw new DOMException('Missing','NotFoundError');return f;},async removeEntry(name){if(!entries.delete(name))throw new DOMException('Missing','NotFoundError');}};
  };
  window.testRoot=window.testDirectory();window.fixture=(grade,id)=>({...freshAssessmentState(),format:SCHEMA,assessmentId:id,grade:'GRADE '+grade,subject:'Creative Technologies',displayName:'Grade '+grade,total:20,dist:[40,20,20,10,5,5],rows:[{id:'c1',week:'1',text:'Explain a concept.',days:1},{id:'c2',week:'2',text:'Apply a procedure.',days:1}],header:{...defaultHeader,sy:'2026-2027'},draftMatrix:[[4,2,2,1,1,0],[4,2,2,1,0,1]],placementProvenance:{origin:'imported',edited:true,balanced:false},draftNotes:['Verified fixture.']});
  window.putTestFile=async(dir,name,obj)=>{const h=await dir.getFileHandle(name,{create:true});h.text=JSON.stringify(obj);return h;};
  for(const g of [7,8,9])await putTestFile(testRoot,'Grade '+g+FILE_SUFFIX,fixture(g,'atest-grade-'+g));
  folderHandle=testRoot;await scanFolder();
 });
 const matrix=[[4,2,2,1,1,0],[4,2,2,1,0,1]];
 for(const grade of [7,8,9,7,8]){
  const status=await page.evaluate(async g=>{await openSavedAssessment('atest-grade-'+g,true);const before=comparable(state);goScreen(2);return {grade:state.grade,matrix:state.draftMatrix,same:before===comparable(state),ready:!!result,dirty:isSavedDirty()};},grade);
  assert.deepEqual(status,{grade:'GRADE '+grade,matrix,same:true,ready:true,dirty:false});
 }
 await page.evaluate(async()=>{await openSavedAssessment('atest-grade-8',false);});
 confirm=false;await page.locator('#grade').selectOption('GRADE 9');assert.equal(await page.evaluate(()=>state.grade),'GRADE 8');
 confirm=true;await page.locator('#subject').fill('Creative Technologies corrected');
 assert.deepEqual(await page.evaluate(()=>state.draftMatrix),matrix);
 assert.equal(await page.evaluate(()=>!!state.placementReview),true);
 assert.equal(await page.evaluate(()=>saveNow()),false);
 assert.equal(await page.evaluate(async()=>JSON.parse((await testRoot.getFileHandle('Grade 8'+FILE_SUFFIX)).text).subject),'Creative Technologies');
 await page.evaluate(()=>goScreen(2));assert.equal(await page.evaluate(()=>!!result),false);
 await page.locator('#reviewPlacements').click();
 assert.deepEqual(await page.evaluate(()=>state.draftMatrix),matrix);assert.equal(await page.evaluate(()=>!!result),true);
 assert.equal(await page.evaluate(()=>saveNow()),true);
 assert.equal(await page.evaluate(async()=>JSON.parse((await testRoot.getFileHandle('Grade 8'+FILE_SUFFIX)).text).subject),'Creative Technologies corrected');
 const beforeCopy=await page.evaluate(async()=> (await testRoot.getFileHandle('Grade 8'+FILE_SUFFIX)).text);
 const savingCopy=page.evaluate(()=>saveNow(true));await page.locator('#fileActionName').fill('Independent Grade 8');await page.locator('#fileActionSubmit').click();assert.equal(await savingCopy,true);
 const copy=await page.evaluate(async()=>({obj:JSON.parse((await testRoot.getFileHandle('Independent Grade 8'+FILE_SUFFIX)).text),original:(await testRoot.getFileHandle('Grade 8'+FILE_SUFFIX)).text}));
 assert.notEqual(copy.obj.assessmentId,'atest-grade-8');assert.deepEqual(copy.obj.draftMatrix,matrix);assert.equal(copy.original,beforeCopy);
 // Structural edits preserve the old counts until the user authorizes recalculation.
 await page.evaluate(()=>goScreen(1));await page.locator('#addComp').click();
 await page.evaluate(()=>{state.rows[2].text='Evaluate a solution.';persist();goScreen(2);});
 assert.deepEqual(await page.evaluate(()=>state.draftMatrix),matrix);
 confirm=false;await page.locator('#makeDraft').click();assert.deepEqual(await page.evaluate(()=>state.draftMatrix),matrix);
 confirm=true;await page.locator('#makeDraft').click();assert.equal(await page.evaluate(()=>state.draftMatrix.length),3);assert.equal(await page.evaluate(()=>!!state.placementReview),false);
 assert.equal(await page.evaluate(()=>saveNow()),true);
 // Copy and rename are independent of assessment content.
 await page.evaluate(async()=>{goScreen(-1);await copySavedAssessment('atest-grade-7');});
 assert.equal(await page.evaluate(()=>recentAssessments.filter(x=>x.grade==='GRADE 7').length),2);
 const rename=page.evaluate(()=>renameSavedAssessment('atest-grade-7'));await page.locator('#fileActionName').fill('Renamed Grade 7');await page.locator('#fileActionSubmit').click();await rename;
 assert.deepEqual(await page.evaluate(async()=>JSON.parse((await testRoot.getFileHandle('Renamed Grade 7'+FILE_SUFFIX)).text).draftMatrix),matrix);
 // Duplicate IDs cannot silently select a newer file.
 await page.evaluate(async()=>{const sub=await testRoot.getDirectoryHandle('duplicate',{create:true});await putTestFile(sub,'Duplicate'+FILE_SUFFIX,fixture(9,'atest-grade-9'));await scanFolder();});
 assert.equal(await page.evaluate(()=>savedLocations.has('atest-grade-9')),false);
 assert.equal(await page.evaluate(()=>ambiguousAssessmentIds.has('atest-grade-9')),true);
 // Malformed metadata is rejected without changing the current document.
 const rejection=await page.evaluate(()=>{const before=comparable(state),bad=fixture(7,'atest-bad');delete bad.grade;try{loadAssessment(bad,true);return false;}catch{return before===comparable(state);}});
 assert.equal(rejection,true);
 // Failure during a write leaves the on-disk file and browser recovery intact.
 await page.evaluate(async()=>{await openSavedAssessment('atest-grade-8',false);state.section='Failure test';persist();(await testRoot.getFileHandle('Grade 8'+FILE_SUFFIX)).fail=true;});
 assert.equal(await page.evaluate(()=>saveNow()),false);
 assert.equal(await page.evaluate(async()=> (await testRoot.getFileHandle('Grade 8'+FILE_SUFFIX)).text),beforeCopy);
 assert.equal(await page.evaluate(()=>!!currentRecoveryId&&!!localStorage.getItem(RECOVERY_PREFIX+currentRecoveryId)),true);
 await page.evaluate(async()=>{(await testRoot.getFileHandle('Grade 8'+FILE_SUFFIX)).fail=false;});
 // Concurrent browser editing sessions write to different recovery keys.
 const page2=await context.newPage();page2.on('pageerror',err=>errors.push(err.message));await page2.goto(url);await page2.waitForFunction(()=>document.body.classList.contains('home-mode'));
 const first=await page.evaluate(()=>currentRecoveryId);
 const second=await page2.evaluate(()=>{state=freshAssessmentState();state.assessmentId='atest-grade-8';state.subject='Independent tab edit';rememberDraft();return currentRecoveryId;});
 assert.notEqual(first,second);assert.equal(await page2.evaluate(ids=>ids.every(id=>!!localStorage.getItem(RECOVERY_PREFIX+id)),[first,second]),true);
 // File conflict cannot replace an external modification.
 await page.evaluate(async()=>{const h=await testRoot.getFileHandle('Grade 8'+FILE_SUFFIX);const obj=JSON.parse(h.text);obj.section='External update';h.text=JSON.stringify(obj);});
 const conflict=page.evaluate(()=>saveNow());await page.locator('dialog[open]').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await conflict,false);
 assert.equal(await page.evaluate(async()=>JSON.parse((await testRoot.getFileHandle('Grade 8'+FILE_SUFFIX)).text).section),'External update');
 assert.deepEqual(errors,[]);
});
