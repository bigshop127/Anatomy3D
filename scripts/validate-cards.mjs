import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {termKey} from '../app/names.ts';
import {loadAtlas,root} from './lib/atlas-geometry.mjs';

// app/muscle-cards.json holds only the cards the owner has checked (scripts/muscle-cards.mjs apply); it may be empty.
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
 const extra=Object.keys(c).filter(k=>!['id','zh','en','region','parts','innervation',...TEXT,...PLANNED].includes(k));
 assert.deepEqual(extra,[],`${c.id}: unknown fields ${extra.join(', ')}`);
}
console.log(`Muscle cards: ${data.cards.length} checked cards covering ${owner.size} muscle terms.`);
