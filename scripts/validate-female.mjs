// Checks the female model (public/models/female/, built by scripts/build-female.mjs): every source mesh is there and decodes,
// names and systems follow scripts/female-parts.json, left and right match where the parts lie, the body is centred like the
// body model, search covers every part, and the source is credited.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {decodePart} from '../app/model-decode.ts';

const read=async path=>readFile(new URL(`../${path}`,import.meta.url));
const female=JSON.parse(await read('public/models/female/atlas.json')),manifest=JSON.parse(await read('scripts/female-parts.json'));
await MeshoptDecoder.ready;
const chunks=await Promise.all(female.chunks.map(c=>read(`public${c.url}`)));
for(const [i,c] of female.chunks.entries())assert.equal(chunks[i].length,c.bytes,`${c.url} has the listed size`);
const SYSTEMS=new Set(['skeletal','muscular','arterial','venous','nervous','digestive','respiratory','urinary','reproductive','lymphatic','endocrine','integumentary','connective','fascia','sensory','cardiac','pregnancy']);

assert.equal(female.sex,'female');
assert.equal(female.parts.length,888,'All 888 HRA meshes are kept');
assert.equal(new Set(female.parts.map(p=>p.id)).size,female.parts.length,'Part ids are unique');
assert.equal(new Set(female.concepts.map(c=>c.id)).size,female.concepts.length,'Search ids are unique');
const ids=new Set(female.parts.map(p=>p.id)),found=new Set(female.concepts.flatMap(c=>c.elements));
for(const c of female.concepts)for(const id of c.elements)assert.ok(ids.has(id),`${c.name} lists ${id}, which is not a part`);
let triangles=0;
for(const p of female.parts){
 assert.ok(female.sources[p.source],`${p.id} has a declared source`);
 assert.ok(SYSTEMS.has(p.system),`${p.id} is in a known system`);
 assert.ok(found.has(p.id),`${p.id} can be found by search`);
 assert.doesNotMatch(p.name,/\((left|right)\)|^[a-z]/,`${p.name}: side at the front, capitalized`);
 const g=decodePart(female,p,new Uint8Array(chunks[p.chunk]),MeshoptDecoder);
 assert.equal(g.index.length,p.indexCount);triangles+=p.indexCount/3;
 for(let v=0;v<g.position.length;v+=3)for(let a=0;a<3;a++)assert.ok(g.position[v+a]>=p.bounds[0][a]-1e-6&&g.position[v+a]<=p.bounds[1][a]+1e-6,`${p.id} stays in its bounds`);
}
assert.equal(triangles,female.triangles);
for(const [id,name] of Object.entries(manifest.names))assert.equal(female.parts.find(p=>p.id===id)?.name,name,`${id} has the manifest's name`);

const named=name=>{const p=female.parts.find(q=>q.name===name);assert.ok(p,`${name} is in the female model`);return p;};
const centre=p=>p.bounds[0].map((v,i)=>(v+p.bounds[1][i])/2);
// +x is the patient's left, as in the body model. Left and right of the liver and the heart are the organ's own, not the body's.
const ORGAN_SIDES=/hepatic|liver|portal|ventricle|coronary|thymus/i;
for(const p of female.parts){
 const sides=new Set((p.name.match(/\b(left|right)\b/gi)??[]).map(w=>w.toLowerCase()));if(sides.size!==1||ORGAN_SIDES.test(p.name))continue;
 const x=centre(p)[0];assert.ok(sides.has('left')?x>-.004:x<.004,`${p.name} lies on its side (x = ${x.toFixed(3)} m)`);
}
// The corrections: the Allen brain's sides, the round ligaments, the inferior pulmonary veins and the vessels named as arteries.
assert.ok(centre(named('Left putamen'))[0]>0&&centre(named('Right putamen'))[0]<0,'The brain\'s left half is on the left');
assert.ok(centre(named('Left round ligament of uterus'))[0]>centre(named('Right round ligament of uterus'))[0]);
assert.ok(centre(named('Left inferior pulmonary vein'))[0]>0&&centre(named('Right inferior pulmonary vein'))[0]<0);
assert.equal(named('Inferior mesenteric vein').system,'venous');assert.equal(named('Superior rectal vein').system,'venous');
assert.equal(named('Third ventricle').system,'nervous','Brain ventricles are nervous system');
// Systems: the breast with the reproductive organs, the skin alone in the integumentary system, the pregnancy reference apart.
assert.deepEqual(female.parts.filter(p=>p.system==='integumentary').map(p=>p.name),['Skin']);
assert.equal(named('Left nipple').system,'reproductive');
assert.deepEqual([...new Set(female.parts.filter(p=>p.system==='pregnancy').map(p=>p.name))].sort(),['Amnion','Basal plate of placenta','Chorionic plate of placenta','Placental vessels','Umbilical artery','Umbilical cord','Umbilical vein']);
assert.equal(named('Left anterior cruciate ligament').system,'connective');assert.equal(named('Arch of aorta').system,'arterial');
// The Allen brain is nervous system, apart from the pineal body, which the body model counts as endocrine.
assert.ok(female.parts.every(p=>!/^Allen_/.test(p.id)||p.system===(p.name==='Pineal body'?'endocrine':'nervous')),'The Allen brain is nervous system');

// Centred like the body model: spine on x = 0, the skin's depth around z = 0, standing on y = 0.
for(const name of ['Sacrum','Third lumbar vertebra','Sixth thoracic vertebra'])assert.ok(Math.abs(centre(named(name))[0])<.01,`${name} is on the midline`);
const skin=named('Skin');assert.ok(Math.abs(centre(skin)[2])<1e-3,'The skin is centred front to back');assert.ok(Math.abs(skin.bounds[0][1])<1e-3,'The feet are on the floor');

const license=(await read('public/models/LICENSE.md')).toString(),attribution=(await read('public/ATTRIBUTION.md')).toString();
for(const text of [license,attribution])assert.ok(text.includes('HBM352.BTSQ.586')&&/CC BY 4\.0/.test(text),'The HRA source and license are credited');

const bytes=female.chunks.reduce((n,c)=>n+(c.gzipBytes??c.bytes),0);
console.log(`Female model: ${female.parts.length} structures, ${female.concepts.length} search entries, ${triangles.toLocaleString()} triangles, ${(bytes/1e6).toFixed(2)} MB download; sides match the geometry, centred, credited.`);
