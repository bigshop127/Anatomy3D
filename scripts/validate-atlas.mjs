// Checks public/models: the catalogues (atlas.json and the muscle attachment patches in attachments.json), every model chunk and
// its .gz copy, and every part's encoded geometry.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {fixSystems} from '../app/system-fixes.ts';
import {loadGeometry,readAtlas,readChunks,root} from './lib/atlas-geometry.mjs';

const atlas=await readAtlas(),fixes=JSON.parse(await readFile(new URL('scripts/source-fixes.json',root),'utf8'));
const manifest=JSON.parse(await readFile(new URL('scripts/zanatomy-parts.json',root),'utf8'));
const attachments=JSON.parse(await readFile(new URL('public/models/attachments.json',root),'utf8'));
assert.deepEqual(atlas.encoding,{format:'meshopt-1',grid:5e-5},'Model encoding');
assert.deepEqual(attachments.encoding,atlas.encoding,'Attachment encoding');
const ids=new Set(atlas.parts.map(p=>p.id));assert.equal(ids.size,atlas.parts.length,'Duplicate part ids');
// BodyParts3D has 2,234 meshes; only the ones source-fixes.json removes may be missing.
assert.equal(atlas.parts.filter(p=>p.source==='bp3d').length,2234-fixes.remove.length,'BodyParts3D part count');
for(const {id} of fixes.remove)assert.ok(!ids.has(id),`${id} should have been removed`);
// The Z-Anatomy parts and patches are exactly the manifest's, with its names and systems (npm run atlas after changing it).
const byId=new Map(atlas.parts.map(p=>[p.id,p]));
assert.equal(atlas.parts.filter(p=>p.source==='z-anatomy').length,manifest.parts.length,'Z-Anatomy part count');
for(const m of manifest.parts){const p=byId.get(m.id);assert.ok(p&&p.source==='z-anatomy'&&p.name===m.name&&p.system===m.system,`${m.id} (${m.z}) does not match scripts/zanatomy-parts.json`);}
// Z-Anatomy's patches are the manifest's; the worked-out ones (scripts/attachment-contacts.json) carry ZC ids.
assert.deepEqual(attachments.patches.filter(p=>p.source==='z-anatomy').map(p=>p.id),manifest.attachments.map(a=>a.id),'Attachment patches');
assert.ok(attachments.patches.every(p=>p.source==='z-anatomy'||(p.source==='computed'&&p.id.startsWith('ZC'))),'Attachment sources');
assert.ok(atlas.sources['z-anatomy']?.license==='CC BY-SA 4.0','Z-Anatomy source and license');
for(const [id,s] of Object.entries(atlas.sources))assert.ok(s.name&&s.license&&s.url,`Source ${id} needs a name, license and url`);

/** Chunk files match their catalogue entry, and the parts' streams fill each chunk exactly, back to back. */
async function checkChunks(catalogue,parts){
 const chunks=await readChunks(catalogue);
 catalogue.chunks.forEach((c,i)=>{
  const bytes=chunks[i];assert.equal(bytes.length,c.bytes,`${c.url}: size`);
  assert.equal(c.url,`/models/m-${createHash('sha256').update(bytes).digest('hex').slice(0,16)}.bin`,`${c.url}: name must be its content hash`);
  assert.equal(c.gzip,c.url+'.gz');
 });
 await Promise.all(catalogue.chunks.map(async(c,i)=>{const gz=await readFile(new URL('public'+c.gzip,root));assert.equal(gz.length,c.gzipBytes,`${c.gzip}: size`);assert.ok(gunzipSync(gz).equals(chunks[i]),`${c.gzip}: content`);}));
 catalogue.chunks.forEach((c,i)=>{
  let end=0;for(const p of parts.filter(p=>p.chunk===i).sort((a,b)=>a.streams[0]-b.streams[0])){assert.equal(p.streams[0],end,`${p.id}: stream offset`);assert.ok(p.streams.slice(1).every(n=>n>0));end+=p.streams[1]+p.streams[2]+p.streams[3];}
  assert.equal(end,c.bytes,`${c.url}: parts do not fill the chunk`);
 });
 return chunks;
}
/** Every part decodes to valid geometry inside its bounds; returns the triangle count. */
async function checkGeometry(catalogue,parts,chunks){
 const geometryOf=await loadGeometry(catalogue),seen=new Map();let triangles=0;
 for(const p of parts){
  const g=geometryOf(p);assert.ok(p.indexCount>=3&&p.indexCount%3===0,`${p.id}: index count`);
  for(const i of g.index)assert.ok(i<p.vertexCount,`${p.id}: invalid vertex`);
  for(let v=0;v<p.vertexCount;v++)for(let a=0;a<3;a++){const x=g.position[v*3+a];assert.ok(Number.isFinite(x)&&x>=p.bounds[0][a]-1e-6&&x<=p.bounds[1][a]+1e-6,`${p.id}: vertex outside its bounds`);}
  for(let v=0;v<p.vertexCount;v++)assert.ok(Math.abs(Math.hypot(g.normal[v*3],g.normal[v*3+1],g.normal[v*3+2])-127)<3,`${p.id}: normal not unit length`);
  // Two parts with the same encoded geometry would be the same mesh listed twice.
  const [offset,...sizes]=p.streams,key=createHash('sha256').update(chunks[p.chunk].subarray(offset,offset+sizes[0]+sizes[1]+sizes[2])).update(p.origin.join()).digest('hex');
  assert.ok(!seen.has(key),`${p.id} duplicates the geometry of ${seen.get(key)}`);seen.set(key,p.id);
  triangles+=p.indexCount/3;
 }
 return triangles;
}
for(const p of atlas.parts){
 assert.ok(p.name.trim()&&p.name!=='-'&&!p.name.includes('Bounds('),`${p.id}: name`);assert.ok(p.conceptId&&p.conceptId!=='-',`${p.id}: concept`);assert.ok(p.system,`${p.id}: system`);
 assert.ok(atlas.sources[p.source],`${p.id}: unknown source ${p.source}`);
}
const triangles=await checkGeometry(atlas,atlas.parts,await checkChunks(atlas,atlas.parts));
assert.equal(triangles,atlas.triangles,'Triangle total');
for(const p of attachments.patches){assert.ok(['origin','insertion'].includes(p.end)&&['left','right'].includes(p.side)&&p.name&&p.host,`${p.id}: attachment fields`);assert.ok(Array.isArray(p.muscles)&&p.muscles.length,`${p.id}: no muscles`);}
const patchTriangles=await checkGeometry(attachments,attachments.patches,await checkChunks(attachments,attachments.patches));
const atlasChunks=new Set(atlas.chunks.map(c=>c.url));assert.ok(attachments.chunks.every(c=>!atlasChunks.has(c.url)),'Attachment chunks are separate from the atlas chunks');

const conceptIds=new Set(atlas.concepts.map(c=>c.id));assert.equal(conceptIds.size,atlas.concepts.length,'Duplicate concept ids');
for(const c of atlas.concepts){assert.ok(c.elements.length,`${c.id}: empty`);assert.equal(new Set(c.elements).size,c.elements.length,`${c.id}: repeated element`);for(const id of c.elements)assert.ok(ids.has(id),`${c.id}: missing ${id}`);}
for(const p of atlas.parts)assert.ok(conceptIds.has(p.conceptId)||p.source==='bp3d',`${p.id}: concept ${p.conceptId} is missing`);

// Left and right names match where the mesh sits (the patient's left is +X). Heart, liver and gut vessels are named by their
// own anatomy rather than the body side, so the check covers the musculoskeletal and nervous systems plus every side fix.
// A structure reaching more than 1 cm across the midline (the right vagus nerve) cannot be judged by its bounds.
fixSystems(atlas);
const centre=p=>(p.bounds[0][0]+p.bounds[1][0])/2,swapped=new Set(fixes.swapSides.flat());
const misplaced=atlas.parts.filter(p=>{
 if(!['skeletal','muscular','connective','fascia','nervous','respiratory'].includes(p.system)&&!swapped.has(p.id))return false;
 if(p.bounds[0][0]<-.01&&p.bounds[1][0]>.01&&!swapped.has(p.id))return false;
 const left=/\bleft\b/i.test(p.name),right=/\bright\b/i.test(p.name),x=centre(p);
 return left!==right&&Math.abs(x)>.002&&(left?x<0:x>0);
}).map(p=>`${p.id} ${p.name}`);
assert.deepEqual(misplaced,[],'Left/right names on the wrong side (add the pair to scripts/source-fixes.json)');

const mb=n=>(n/1e6).toFixed(1)+' MB',bySource=Object.keys(atlas.sources).map(s=>`${atlas.parts.filter(p=>p.source===s).length} ${s}`).join(', ');
console.log(`Verified ${ids.size} parts (${bySource}), ${atlas.concepts.length} concepts, ${triangles.toLocaleString()} triangles in ${atlas.chunks.length} chunks (${mb(atlas.chunks.reduce((n,c)=>n+c.bytes,0))}, ${mb(atlas.chunks.reduce((n,c)=>n+c.gzipBytes,0))} gzip), and left/right names; ${attachments.patches.length} attachment patches (${patchTriangles.toLocaleString()} triangles, ${mb(attachments.chunks.reduce((n,c)=>n+c.gzipBytes,0))} gzip).`);
