import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {termKey} from '../app/names.ts';
import {loadAtlas,root} from './lib/atlas-geometry.mjs';

// public/models/attachments.json (scripts/build-atlas.mjs): every patch belongs to atlas muscles, has an end, lies on the side
// it names and on a bone, ligament or fascia of that side, and points into a chunk that is there.
const atlas=await loadAtlas(),data=JSON.parse(await readFile(new URL('public/models/attachments.json',root),'utf8'));
const cards=JSON.parse(await readFile(new URL('app/muscle-cards.json',root),'utf8')).cards;
const muscles=new Set(atlas.parts.filter(p=>p.system==='muscular').map(p=>termKey(p.name))),parts=new Map(atlas.parts.map(p=>[p.id,p]));
const sideOf=name=>/\bleft\b/i.test(name)?'left':/\bright\b/i.test(name)?'right':'';

assert.equal(data.encoding?.format,'meshopt-1','Unknown attachment encoding');
const ids=new Set(),chunks=await Promise.all(data.chunks.map(c=>readFile(new URL('public'+c.url,root))));
data.chunks.forEach((c,i)=>assert.equal(chunks[i].length,c.bytes,`${c.url} has the wrong size`));
for(const p of data.patches){
 assert.ok(!ids.has(p.id),`Duplicate patch ${p.id}`);ids.add(p.id);
 assert.ok(['z-anatomy','computed'].includes(p.source),`${p.id}: unknown source ${p.source}`);
 assert.ok(['origin','insertion'].includes(p.end),`${p.id}: unknown end ${p.end}`);
 assert.ok(['left','right'].includes(p.side),`${p.id}: unknown side ${p.side}`);
 assert.ok(p.muscles.length&&p.muscles.every(t=>muscles.has(t)),`${p.id}: ${p.muscles.join(', ')} is not an atlas muscle`);
 const host=parts.get(p.host);
 assert.ok(host,`${p.id}: host ${p.host} is not in the atlas`);
 assert.ok(['skeletal','connective','fascia'].includes(host.system),`${p.id}: lies on ${host.name}, which is ${host.system}`);
 const x=(p.bounds[0][0]+p.bounds[1][0])/2;
 if(Math.abs(x)>.005)assert.equal(p.side,x>0?'left':'right',`${p.id}: lies on the other side`);
 if(sideOf(host.name))assert.equal(sideOf(host.name),p.side,`${p.id} (${p.side}) lies on ${host.name}`);
 const [offset,...sizes]=p.streams;
 assert.ok(p.chunk<chunks.length&&offset+sizes.reduce((a,b)=>a+b,0)<=chunks[p.chunk].length,`${p.id}: outside its chunk`);
}
// How many cards the patches cover (both sides alike, so the left is counted).
const ends=new Map();for(const p of data.patches)if(p.side==='left')for(const t of p.muscles){const e=ends.get(t)??new Set();e.add(p.end);ends.set(t,e);}
const count=k=>cards.filter(c=>{const e=new Set(c.parts.flatMap(t=>[...(ends.get(t)??[])]));return k===2?e.size===2:k===0?!e.size:e.size===1;}).length;
console.log(`Attachments: ${data.patches.length} patches (${data.patches.filter(p=>p.source==='computed').length} computed); cards with origin and insertion ${count(2)}, one end ${count(1)}, none ${count(0)} of ${cards.length}.`);

// The app's own lookups, on the examples batch 06 was planned with: rectus femoris shows its origin on the hip bone and its
// insertion on the patella and the tibial tuberosity; the scapula carries the subscapularis and serratus anterior.
const {patchesFor,musclesOn}=await import('../app/attachments.ts');
const {indexCards}=await import('../app/muscle-cards.ts');
const index=indexCards({version:1,cards}),part=name=>atlas.parts.find(p=>p.name===name);
const hostsOf=(list,end)=>new Set(list.filter(p=>p.end===end).map(p=>termKey(parts.get(p.host).name)));
const rf=patchesFor(data,[part('Left rectus femoris')],index);
assert.ok(rf.every(p=>p.side==='left'),'Left rectus femoris shows right-side patches');
assert.ok(hostsOf(rf,'origin').has('hip bone'),'Rectus femoris: no origin on the hip bone');
for(const t of ['patella','tibia'])assert.ok(hostsOf(rf,'insertion').has(t),`Rectus femoris: no insertion on the ${t}`);
const scapula=musclesOn(data,part('Right scapula').id,index),on=(id,end)=>scapula.some(m=>m.card?.id===id&&m.ends.includes(end));
assert.ok(on('subscapularis','origin')&&on('serratus-anterior','insertion')&&on('teres-major','origin'),'Scapula: attached muscles missing');
