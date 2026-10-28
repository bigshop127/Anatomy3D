// Offline cache for the installed app. The page shell is network-first so updates show up on the next visit;
// hashed build assets and the anatomy geometry are cache-first. scripts/build-atlas.mjs sets MODELS from the model content,
// so a new model replaces the old offline copy.
const SHELL='anatomy3d-shell-v1',MODELS='anatomy3d-models-ec0b38bec1e6';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key!==SHELL&&key!==MODELS)await caches.delete(key);
 await self.clients.claim();
})()));
const store=async(cacheName,request,response)=>{if(response.ok&&response.status===200)await (await caches.open(cacheName)).put(request,response.clone());return response;};
const networkFirst=async(request,cacheName)=>{try{return await store(cacheName,request,await fetch(request));}catch(error){const cached=await caches.match(request);if(cached)return cached;throw error;}};
const cacheFirst=async(request,cacheName)=>(await caches.match(request))??store(cacheName,request,await fetch(request));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==location.origin)return;
 if(request.mode==='navigate'||url.pathname.endsWith('.json')||url.pathname.endsWith('.webmanifest'))event.respondWith(networkFirst(request,SHELL));
 else if(url.pathname.includes('/models/'))event.respondWith(cacheFirst(request,MODELS));
 else event.respondWith(cacheFirst(request,SHELL));
});
