// Checks the high-detail knee (public/models/knee/, built by scripts/build-knee.mjs): every listed structure is there and
// decodes, it is a left knee at the body's left knee, its surfaces face outward, mirroring makes a right knee, and the license
// travels with it.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {decodePart,mirrorGeometry} from '../app/model-decode.ts';
import {mirrorAtlas} from '../app/models.ts';

const read=async path=>readFile(new URL(`../${path}`,import.meta.url));
const knee=JSON.parse(await read('public/models/knee/atlas.json')),body=JSON.parse(await read('public/models/atlas.json'));
const manifest=JSON.parse(await read('scripts/knee-parts.json'));
await MeshoptDecoder.ready;
const chunks=await Promise.all(knee.chunks.map(c=>read(`public${c.url}`)));
const geometry=p=>decodePart(knee,p,new Uint8Array(chunks[p.chunk]),MeshoptDecoder);

assert.equal(knee.side,'left');
assert.deepEqual(knee.parts.map(p=>p.name).sort(),manifest.parts.map(m=>m.name).sort(),'Every structure in scripts/knee-parts.json is built');
assert.equal(new Set(knee.parts.map(p=>p.id)).size,knee.parts.length,'Part ids are unique');
for(const p of knee.parts){assert.ok(knee.sources[p.source],`${p.id} has a declared source`);assert.ok(knee.concepts.some(c=>c.elements.includes(p.id)),`${p.id} can be found by search`);}

/** Six times the signed volume: positive when the triangles face outward. */
const volume=({position:x,index:t})=>{let v=0;for(let i=0;i<t.length;i+=3){const a=t[i]*3,b=t[i+1]*3,c=t[i+2]*3;v+=x[a]*(x[b+1]*x[c+2]-x[b+2]*x[c+1])-x[a+1]*(x[b]*x[c+2]-x[b+2]*x[c])+x[a+2]*(x[b]*x[c+1]-x[b+1]*x[c]);}return v;};
// Open meshes (cut at the edge of the scan) still give the sign; small or thin ones are left out.
const solid=knee.parts.filter(p=>['Left femur','Left tibia','Left patella','Left medial meniscus','Left vastus medialis','Medial head of left gastrocnemius'].includes(p.name));
for(const p of solid)assert.ok(volume(geometry(p))>0,`${p.name} faces outward`);

// The left knee: on the patient's left (+x), the joint at the body model's left knee joint, the patella in front.
const named=(atlas,name)=>atlas.parts.find(p=>p.name===name);
const centre=b=>b[0].map((v,i)=>(v+b[1][i])/2);
for(const name of ['Left femur','Left tibia','Left patella','Left fibula'])assert.ok(centre(named(knee,name).bounds)[0]>0,`${name} lies left of the midline`);
const kneeJoint=(named(knee,'Left femur').bounds[0][1]+named(knee,'Left tibia').bounds[1][1])/2,bodyJoint=(named(body,'Left femur').bounds[0][1]+named(body,'Left tibia').bounds[1][1])/2;
assert.ok(Math.abs(kneeJoint-bodyJoint)<.005,`The knee joint sits at the body's knee joint (${kneeJoint.toFixed(3)} vs ${bodyJoint.toFixed(3)} m)`);
assert.ok(centre(named(knee,'Left patella').bounds)[2]>centre(named(knee,'Left femur').bounds)[2],'The patella is in front of the femur');
assert.ok(centre(named(knee,'Left fibula').bounds)[0]>centre(named(knee,'Left tibia').bounds)[0],'The fibula is lateral to the tibia');

// Mirrored: right names, boxes across the midline, surfaces still facing outward.
const right=structuredClone(knee);mirrorAtlas(right);
assert.equal(right.side,'right');assert.ok(right.mirrored);
assert.ok(right.parts.every(p=>!/\bleft\b/i.test(p.name)&&/\bright\b/i.test(p.name)),'Mirrored names are all right-sided');
assert.ok(right.concepts.every(c=>!/\bleft\b/i.test(c.name)),'Mirrored search names are right-sided');
const femur=named(right,'Right femur'),original=named(knee,'Left femur');
assert.deepEqual(femur.bounds,[[-original.bounds[1][0],original.bounds[0][1],original.bounds[0][2]],[-original.bounds[0][0],original.bounds[1][1],original.bounds[1][2]]]);
const flipped=mirrorGeometry(geometry(original));
assert.ok(volume(flipped)>0,'The mirrored femur still faces outward');
for(let v=0;v<flipped.position.length;v+=3)assert.ok(flipped.position[v]>=femur.bounds[0][0]-1e-6&&flipped.position[v]<=femur.bounds[1][0]+1e-6,'Mirrored geometry stays in the mirrored box');

const license=(await read('public/models/knee/LICENSE.md')).toString();
assert.ok(license.includes('All or portions of this licensed product (such portions are the "Software") have been obtained under license from The Brigham and Women\'s Hospital, Inc. and are subject to the following terms and conditions:'),'LICENSE.md carries the preface the Slicer license asks for');
assert.ok(license.includes('PART B. DOWNLOADING AGREEMENT')&&/modified version/i.test(license),'LICENSE.md has the license terms and marks the models as modified');

const triangles=knee.parts.reduce((n,p)=>n+p.indexCount/3,0),bytes=knee.chunks.reduce((n,c)=>n+(c.gzipBytes??c.bytes),0);
console.log(`High-detail knee: ${knee.parts.length} structures, ${triangles.toLocaleString()} triangles, ${(bytes/1e6).toFixed(2)} MB download; left knee at the body's knee, facing outward; right knee by mirroring.`);
