/* IB-PWA-UPDATE-001: app shell offline cache, safe background update activation. */
const CACHE = 'itembloom-tos-shell-v1-beta10-20261123-rc1';
const CORE = ['./csv.js','./','./index.html','./manifest.webmanifest','./item-analysis.js','./csv-extractor.worker.js','./analysis-integration.js','./pwa-update.js','./save-guard.js','./drafts.js','./item-analysis/backup.js','./item-analysis/index.html','./item-analysis/styles.css','./item-analysis/parser.js','./item-analysis/excel.js','./item-analysis/compression.js','./item-analysis/workspace.js','./item-analysis/app.js','./item-analysis/paper-parser.js'];
const EXTRA = ['./assets/deped-seal.png','./assets/itembloom-logo.png',
  './assets/itembloom-background.jpg','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})))));
  // Deliberately do not skipWaiting: an open assessment must not reload mid-edit.
});
// Ask the live client set each time; closed tabs leave no stale readiness records.
let updateAttempt=null;
function hasWaitingUpdate(){return self.registration.waiting?.state==='installed';}
async function updateClients(){return (await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>c.url.startsWith(self.registration.scope));}
function updateProbe(client,type,token){return new Promise(resolve=>{
 const channel=new MessageChannel();let finished=false;
 const finish=safe=>{if(finished)return;finished=true;clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(safe);};
 const timer=setTimeout(()=>finish(false),2500);
 channel.port1.onmessage=event=>finish(event.data?.token===token&&event.data.safe===true);
 try{client.postMessage({type,token},[channel.port2]);}catch{finish(false);}
});}
async function activateWhenReady(){
 if(!hasWaitingUpdate())return;
 const clients=await updateClients(),token=crypto.randomUUID();let committed=false;
 const sameClients=async()=>{const live=await updateClients();return live.length===clients.length&&live.every(c=>clients.some(old=>old.id===c.id));};
 try{
  if(!(await Promise.all(clients.map(c=>updateProbe(c,'IB_UPDATE_QUERY',token)))).every(Boolean))return;
  if(!hasWaitingUpdate()||!await sameClients())return;
  if(!(await Promise.all(clients.map(c=>updateProbe(c,'IB_UPDATE_PREPARE',token)))).every(Boolean))return;
  if(!await sameClients())return;
  if(!(await Promise.all(clients.map(c=>updateProbe(c,'IB_UPDATE_CHECK',token)))).every(Boolean))return;
  if(!hasWaitingUpdate()||!await sameClients())return;
  for(const client of clients)client.postMessage({type:'IB_UPDATE_COMMIT',token});
  await self.skipWaiting();committed=true;
 }finally{
  if(!committed)for(const client of clients){try{client.postMessage({type:'IB_UPDATE_ABORT',token});}catch{}}
 }
}
self.addEventListener('message',event=>{
 if(!['IB_REQUEST_SAFE_UPDATE','IB_ACTIVATE_UPDATE'].includes(event.data?.type)||!hasWaitingUpdate())return;
 if(!updateAttempt)updateAttempt=activateWhenReady().catch(()=>{}).finally(()=>{updateAttempt=null;});
 event.waitUntil(updateAttempt);
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('itembloom-tos-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
// A release is an atomic shell: never combine new network HTML with cached scripts.
function unavailable(){return new Response('ItemBloom offline files are incomplete. Reconnect and update the application, then retry.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
self.addEventListener('fetch', event => {
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin||url.pathname.includes('/api/')||url.pathname.endsWith('.ibassessment.json'))return;
 const pathOf=path=>new URL(path,self.registration.scope).pathname;
 const file=CORE.find(path=>pathOf(path)===url.pathname);
 if(req.mode==='navigate'){
  const fallback=url.pathname===pathOf('./item-analysis/index.html')||url.pathname===pathOf('./item-analysis/')?'./item-analysis/index.html':'./index.html';
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(fallback)).then(hit=>hit||unavailable()));return;
 }
 if(file){event.respondWith(caches.open(CACHE).then(cache=>cache.match(file)).then(hit=>hit||unavailable()));return;}
 const extra=EXTRA.find(path=>pathOf(path)===url.pathname);if(!extra)return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE),hit=await cache.match(extra);if(hit)return hit;
  try{const response=await fetch(req);if(!response.ok)return unavailable();await cache.put(extra,response.clone());return response;}catch{return unavailable();}
 })());
});
