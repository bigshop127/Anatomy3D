import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {termKey} from '../app/names.ts';
import {loadAtlas,root} from './lib/atlas-geometry.mjs';

// app/muscle-cards.json holds every card (scripts/muscle-cards.mjs apply); reviewed marks the ones the owner has checked.
const data=JSON.parse(await readFile(new URL('app/muscle-cards.json',root),'utf8'));
const atlas=await loadAtlas();
const muscles=new Set(atlas.parts.filter(p=>p.system==='muscular').map(p=>termKey(p.name)));
const nerves=new Set(atlas.parts.filter(p=>p.system==='nervous').map(p=>termKey(p.name)));
const REGIONS=['neck','shoulder','elbow','wrist','trunk','hip','knee','ankle','tmj'];
const TEXT=['origin','insertion','primary','secondary','innervationText','blood','palpation','sources','notes'];
const PLANNED=['mmt','stretch','triggerPoints','injuries'];

assert.equal(data.version,1,'Unknown muscle card format');
const ids=new Set(),owner=new Map();
for(const c of data.cards){
 assert.match(c.id,/^[a-z0-9]+(-[a-z0-9]+)*$/,`Bad card id: ${c.id}`);
 assert.ok(!ids.has(c.id),`Duplicate card: ${c.id}`);ids.add(c.id);
 assert.ok(REGIONS.includes(c.region),`${c.id}: unknown region ${c.region}`);
 assert.equal(typeof c.reviewed,'boolean',`${c.id}: reviewed must be true or false`);
 if('wiki' in c)assert.ok(typeof c.wiki==='string'&&c.wiki.trim(),`${c.id}: empty wiki title`);
 assert.match(c.zh,/\p{Script=Han}/u,`${c.id}: no Chinese name`);
 assert.ok(c.parts.length,`${c.id}: no model parts`);
 for(const p of c.parts){
  assert.ok(muscles.has(p),`${c.id}: ${p} is not a muscle in the atlas`);
  assert.ok(!owner.has(p),`${p} is on two cards: ${owner.get(p)} and ${c.id}`);owner.set(p,c.id);
 }
 for(const k of TEXT)assert.ok(Array.isArray(c[k])&&c[k].every(s=>typeof s==='string'&&s.trim()),`${c.id}: ${k} must be a list of non-empty lines`);
 for(const k of ['origin','insertion','primary','sources'])assert.ok(c[k].length,`${c.id}: ${k} is empty`);
 assert.ok(c.innervation.length,`${c.id}: no innervation`);
 for(const n of c.innervation){
  assert.ok(n.nerve,`${c.id}: nerve without a name`);
  if(n.term)assert.ok(nerves.has(n.term),`${c.id}: ${n.term} is not a nerve in the atlas`);
 }
 for(const k of PLANNED)if(k in c)assert.ok(c[k].length,`${c.id}: ${k} is present but empty`);
 const extra=Object.keys(c).filter(k=>!['id','zh','en','region','reviewed','wiki','parts','innervation',...TEXT,...PLANNED].includes(k));
 assert.deepEqual(extra,[],`${c.id}: unknown fields ${extra.join(', ')}`);
}
console.log(`Muscle cards: ${data.cards.length} cards (${data.cards.filter(c=>c.reviewed).length} reviewed) covering ${owner.size} muscle terms.`);

// Nerve → muscles as the app finds them: the femoral nerve's own muscles, the sciatic nerve's through its branches, and every
// nerve term a card names reachable as a key.
const {indexCards,nerveMuscles}=await import('../app/muscle-cards.ts');
const index=indexCards(data),idSet=list=>new Set(list.map(c=>c.id));
const femoral=idSet(nerveMuscles(index,'femoral nerve').direct);
for(const id of ['rectus-femoris','vastus-lateralis','vastus-medialis','vastus-intermedius','sartorius','pectineus'])assert.ok(femoral.has(id),`Femoral nerve does not list ${id}`);
const sciatic=nerveMuscles(index,'sciatic nerve'),branches=new Set(sciatic.branches.map(b=>b.nerve));
for(const n of ['tibial nerve','deep fibular nerve','superficial fibular nerve','lateral plantar nerve'])assert.ok(branches.has(n),`Sciatic nerve does not reach the ${n}`);
assert.ok(idSet(sciatic.direct).has('semitendinosus'),'Sciatic nerve does not list the semitendinosus');
for(const c of data.cards)for(const n of c.innervation)if(n.term)assert.ok(index.byNerve.get(n.term)?.includes(c),`${c.id}: not found from ${n.term}`);
