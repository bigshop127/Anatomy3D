import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixSystems} from '../app/system-fixes.ts';

const atlas=JSON.parse(await readFile(new URL('../public/models/atlas.json',import.meta.url)));
const {layers}=JSON.parse(await readFile(new URL('../app/muscle-layers.json',import.meta.url)));
const fixed=fixSystems(atlas);
const muscles=atlas.parts.filter(p=>p.system==='muscular');
const missing=muscles.filter(p=>!layers[p.id]).map(p=>p.name);
assert.deepEqual(missing,[],`Muscles without a peel layer (rerun scripts/compute-muscle-layers.mjs): ${missing.join(', ')}`);
const stray=Object.keys(layers).filter(id=>!muscles.some(p=>p.id===id));
assert.deepEqual(stray,[],`Peel layers for parts that are not muscles: ${stray.join(', ')}`);
assert.ok(Object.values(layers).every(l=>Number.isInteger(l)&&l>=1&&l<=5),'Peel layers must be 1–5');
// Left and right copies of a muscle peel together.
const byName=new Map();for(const p of muscles){const n=p.name.toLowerCase().replace(/\b(left|right) /g,'');byName.set(n,[...(byName.get(n)??[]),layers[p.id]]);}
const uneven=[...byName].filter(([,ls])=>new Set(ls).size>1).map(([n])=>n);
assert.deepEqual(uneven,[],`Left and right sides in different layers: ${uneven.join(', ')}`);
const counts={};for(const l of Object.values(layers))counts[l]=(counts[l]??0)+1;
console.log(`Muscle layers: ${muscles.length} muscle parts (${fixed} moved to muscles from other systems) in layers ${JSON.stringify(counts)}.`);
