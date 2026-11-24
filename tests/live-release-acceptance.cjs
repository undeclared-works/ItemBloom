// Release acceptance: real deployed site, normal UI clicks and browser-native OPFS.
// The ONLY browser API substituted is the directory picker, which returns a disposable native directory.
// No teacher files, accounts or data are used; the isolated browser profile is discarded.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const url='https://undeclared-works.github.io/ItemBloom/';
const suffix='.ibassessment.json';
test('live beta.11 teacher workflow',{timeout:120000},async t=>{
 const browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/google-chrome')?{channel:'chrome'}:{})});
 t.after(()=>browser.close());
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:768}});
 await context.addInitScript(()=>{window.showDirectoryPicker=async()=> (await navigator.storage.getDirectory()).getDirectoryHandle('QA disposable assessments',{create:true});});
 const page=await context.newPage();
 const errors=[];let accept=true;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>accept?d.accept():d.dismiss());
 const click=id=>page.locator('#'+id).click();
 const fill=(id,value)=>page.locator('#'+id).fill(value);
 const wait=fn=>page.waitForFunction(fn);
 const text=async id=>(await page.locator('#'+id).innerText()).trim();
 const read=async name=>page.evaluate(async name=>JSON.parse(await (await (await folderHandle.getFileHandle(name)).getFile()).text()),name);
 const card=name=>page.locator('#recentAssessments .recent-item').filter({hasText:name});
 const open=async name=>{await card(name).dblclick();await page.locator('#grade').waitFor({state:'visible'});};
 const home=async()=>{await click('homeNav');await page.locator('#newAssessment').waitFor({state:'visible'});};
 const saveAs=async(name,button='editorSaveAs')=>{await click(button);await fill('fileActionName',name);await click('fileActionSubmit');await wait(()=>!saveCommandBusy);};
 await page.goto(url,{waitUntil:'load',timeout:45000});
 assert.match(await page.title(),/beta\.11/);
 assert.equal(await page.locator('.appversion').innerText(),'v1.0.0-beta.11 · Pilot');
 await wait(()=>!!navigator.serviceWorker.controller);
 await click('createFolder');await wait(()=>!!folderHandle&&!folderChoiceBusy);
 assert.match(await text('folderName'),/QA disposable assessments/);
 // Create three assessments entirely through the teacher interface.
 const expected={};
 for(const grade of [7,8,9]){
  await click('newAssessment');await fill('schoolYear','2026-2027');
  await page.locator('#grade').selectOption('GRADE '+grade);
  await fill('subject','QA Creative Technologies '+grade);
  await fill('section','QA section');
  await fill('total','20');
  await click('nextStep');
  await page.getByLabel('Competency 1: Learning competency',{exact:true}).fill('Explain a concept '+grade);
  await page.getByLabel('Competency 1: Week',{exact:true}).fill('1');
  await click('addComp');
  await page.getByLabel('Competency 2: Learning competency',{exact:true}).fill('Apply a procedure '+grade);
  await page.getByLabel('Competency 2: Week',{exact:true}).fill('2');
  await page.getByLabel('Competency 2: Contact days',{exact:true}).fill(String(grade-6));
  await click('nextStep');await page.locator('#draftBody input').first().waitFor();
  await click('openPreview');await page.locator('#resultCard').waitFor({state:'visible'});
  assert.equal(await text('pGrade'),'GRADE '+grade);
  const exportEvent=page.waitForEvent('download');await click('exportCSV');
  const exported=await exportEvent;const csv=fs.readFileSync(await exported.path(),'utf8');assert.match(csv,new RegExp('Explain a concept '+grade));
  await saveAs('QA Grade '+grade,'editorSave');
  const obj=await read('QA Grade '+grade+suffix);assert.equal(obj.grade,'GRADE '+grade);assert.equal(obj.draftMatrix.flat().reduce((a,b)=>a+b,0),20);expected[grade]=obj;
  await home();
 }
 assert.equal(new Set(Object.values(expected).map(x=>x.assessmentId)).size,3);
 console.log('PASS creation, exact grade, distinct IDs, preview and CSV export for G7/G8/G9');
 // Verify saved files reopen without changes and preserve exact placement/item-number results.
 for(const grade of [7,8,9,7,8]){
  await open('QA Grade '+grade);
  assert.equal(await page.locator('#grade').inputValue(),'GRADE '+grade);
  assert.equal(await page.locator('#grade').isDisabled(),true);
  await page.locator('[data-screen="2"]').click();
  assert.deepEqual(await page.evaluate(()=>state.draftMatrix),expected[grade].draftMatrix);
  await click('openPreview');assert.equal(await text('pGrade'),'GRADE '+grade);
  assert.deepEqual(await read('QA Grade '+grade+suffix),expected[grade]);
  await home();
 }
 console.log('PASS read-only reopening and exact preservation');
 // Edit Grade 8: cancel grade change, change metadata, exercise Ctrl+S.
 await open('QA Grade 8');await click('switchEdit');
 accept=false;await page.locator('#grade').selectOption('GRADE 9');accept=true;
 assert.equal(await page.locator('#grade').inputValue(),'GRADE 8');
 await fill('section','Edited section');
 await page.keyboard.press('Control+s');await wait(()=>!saveCommandBusy);
 let obj=await read('QA Grade 8'+suffix);
 assert.equal(obj.section,'Edited section');assert.equal(obj.assessmentId,expected[8].assessmentId);assert.deepEqual(obj.draftMatrix,expected[8].draftMatrix);
 // Subject correction preserves matrix, requires review and prevents save.
 await fill('subject','QA Creative Technologies 8 corrected');await click('editorSave');
 await wait(()=>!saveCommandBusy);assert.equal((await read('QA Grade 8'+suffix)).subject,expected[8].subject);
 await page.locator('[data-screen="2"]').click();assert.equal(await page.locator('#openPreview').isDisabled(),true);
 assert.deepEqual(await page.evaluate(()=>state.draftMatrix),expected[8].draftMatrix);
 await click('reviewPlacements');assert.equal(await page.locator('#openPreview').isEnabled(),true);
 await click('editorSave');await wait(()=>!saveCommandBusy);
 obj=await read('QA Grade 8'+suffix);assert.equal(obj.subject,'QA Creative Technologies 8 corrected');assert.deepEqual(obj.draftMatrix,expected[8].draftMatrix);
 await saveAs('QA independent copy');let copy=await read('QA independent copy'+suffix);
 assert.notEqual(copy.assessmentId,obj.assessmentId);assert.deepEqual(copy.draftMatrix,obj.draftMatrix);assert.deepEqual(await read('QA Grade 8'+suffix),obj);
 await home();
 console.log('PASS grade-change cancellation, Ctrl+S, explicit placement review, and independent Save As');
 // Rename, move, copy, delete using home-screen controls.
 const act=async(name,label)=>{const c=card(name);if(await c.getAttribute('aria-expanded')!=='true')await c.click();await c.getByRole('button',{name:label,exact:true}).click();};
 await act('QA independent copy','Rename assessment');await fill('fileActionName','QA renamed copy');await click('fileActionSubmit');await card('QA renamed copy').waitFor();
 assert.equal((await read('QA renamed copy'+suffix)).assessmentId,copy.assessmentId);
 await act('QA renamed copy','Move assessment');await fill('fileActionSubfolder','QA moved');await click('fileActionSubmit');await wait(()=>savedLocations.get(state.assessmentId)?.path==='QA moved');
 const moved=await page.evaluate(async()=>JSON.parse(await(await(await(await folderHandle.getDirectoryHandle('QA moved')).getFileHandle('QA renamed copy'+FILE_SUFFIX)).getFile()).text()));
 assert.equal(moved.assessmentId,copy.assessmentId);assert.deepEqual(moved.draftMatrix,copy.draftMatrix);
 await act('QA Grade 7','Copy assessment');await card('QA Grade 7 (Copy)').waitFor();
 const cloned=await read('QA Grade 7 (Copy)'+suffix);assert.notEqual(cloned.assessmentId,expected[7].assessmentId);assert.deepEqual(cloned.draftMatrix,expected[7].draftMatrix);
 await act('QA Grade 7 (Copy)','Delete saved assessment');await card('QA Grade 7 (Copy)').waitFor({state:'detached'});assert.deepEqual(await read('QA Grade 7'+suffix),expected[7]);
 console.log('PASS rename/move/copy/delete on native browser filesystem');
 // Close dialog cancellation and discard preserve original.
 await open('QA Grade 8');await click('switchEdit');await fill('section','Discard me');await click('homeNav');await click('leaveCancel');
 assert.equal(await page.locator('#section').inputValue(),'Discard me');
 await click('homeNav');await click('leaveDiscard');await page.locator('#newAssessment').waitFor();
 assert.equal((await read('QA Grade 8'+suffix)).section,'Edited section');
 // Close and reopen offline.
 await context.setOffline(true);await page.reload();await wait(()=>savedLocations.has(''+state.assessmentId)||recentAssessments.some(a=>a.displayName==='QA Grade 8'));
 await open('QA Grade 8');await click('switchEdit');await fill('section','Offline edit');await click('homeNav');await click('leaveSave');await page.locator('#newAssessment').waitFor();
 assert.equal((await read('QA Grade 8'+suffix)).section,'Offline edit');
 console.log('PASS Save/Discard/Cancel and offline save');
 // Basic analysis workspace integration smoke test.
 await click('uploadAnalysisCSV');const frame=page.frameLocator('iframe[title="ItemBloom Item Analysis"]');await frame.locator('#pageTitle').waitFor({state:'visible'});
 assert.match(await frame.locator('#pageTitle').innerText(),/Import Exam Results/);
 await page.getByRole('button',{name:'Close Item Analysis workspace'}).click();
 await page.locator('iframe[title="ItemBloom Item Analysis"]').waitFor({state:'detached'});
 console.log('PASS offline Item Analysis workspace opens and closes');
 assert.deepEqual(errors,[]);
});
