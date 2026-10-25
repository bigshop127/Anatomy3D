// Checks public/models: the catalogue, every model chunk and its .gz copy, and every part's encoded geometry.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {fixSystems} from '../app/system-fixes.ts';
import {loadGeometry,readAtlas,readChunks,root} from './lib/atlas-geometry.mjs';

const atlas=await readAtlas(),fixes=JSON.parse(await readFile(new URL('scripts/source-fixes.json',root),'utf8'));
assert.deepEqual(atlas.encoding,{format:'meshopt-1',grid:5e-5},'Model encoding');
const ids=new Set(atlas.parts.map(p=>p.id));assert.equal(ids.size,atlas.parts.length,'Duplicate part ids');
// BodyParts3D has 2,234 meshes; only the ones source-fixes.json removes may be missing.
assert.equal(atlas.parts.filter(p=>p.source==='bp3d').length,2234-fixes.remove.length,'BodyParts3D part count');
for(const {id} of fixes.remove)assert.ok(!ids.has(id),`${id} should have been removed`);
for(const [id,s] of Object.entries(atlas.sources))assert.ok(s.name&&s.license&&s.url,`Source ${id} needs a name, license and url`);

const chunks=await readChunks(atlas);
atlas.chunks.forEach((c,i)=>{
 const bytes=chunks[i];assert.equal(bytes.length,c.bytes,`${c.url}: size`);
 assert.equal(c.url,`/models/m-${createHash('sha256').update(bytes).digest('hex').slice(0,16)}.bin`,`${c.url}: name must be its content hash`);
 assert.equal(c.gzip,c.url+'.gz');
});
await Promise.all(atlas.chunks.map(async(c,i)=>{const gz=await readFile(new URL('public'+c.gzip,root));assert.equal(gz.length,c.gzipBytes,`${c.gzip}: size`);assert.ok(gunzipSync(gz).equals(chunks[i]),`${c.gzip}: content`);}));
// The parts' streams fill each chunk exactly, back to back.
atlas.chunks.forEach((c,i)=>{
 let end=0;for(const p of atlas.parts.filter(p=>p.chunk===i).sort((a,b)=>a.streams[0]-b.streams[0])){assert.equal(p.streams[0],end,`${p.id}: stream offset`);assert.ok(p.streams.slice(1).every(n=>n>0));end+=p.streams[1]+p.streams[2]+p.streams[3];}
 assert.equal(end,c.bytes,`${c.url}: parts do not fill the chunk`);
});

const geometryOf=await loadGeometry(atlas),seen=new Map();let triangles=0;
for(const p of atlas.parts){
 assert.ok(p.name.trim()&&p.name!=='-'&&!p.name.includes('Bounds('),`${p.id}: name`);assert.ok(p.conceptId&&p.conceptId!=='-',`${p.id}: concept`);assert.ok(p.system,`${p.id}: system`);
 assert.ok(atlas.sources[p.source],`${p.id}: unknown source ${p.source}`);
 const g=geometryOf(p);assert.ok(p.indexCount>=3&&p.indexCount%3===0,`${p.id}: index count`);
 for(const i of g.index)assert.ok(i<p.vertexCount,`${p.id}: invalid vertex`);
 for(let v=0;v<p.vertexCount;v++)for(let a=0;a<3;a++){const x=g.position[v*3+a];assert.ok(Number.isFinite(x)&&x>=p.bounds[0][a]-1e-6&&x<=p.bounds[1][a]+1e-6,`${p.id}: vertex outside its bounds`);}
 for(let v=0;v<p.vertexCount;v++)assert.ok(Math.abs(Math.hypot(g.normal[v*3],g.normal[v*3+1],g.normal[v*3+2])-127)<3,`${p.id}: normal not unit length`);
 // Two parts with the same encoded geometry would be the same mesh listed twice.
 const [offset,...sizes]=p.streams,key=createHash('sha256').update(chunks[p.chunk].subarray(offset,offset+sizes[0]+sizes[1]+sizes[2])).update(p.origin.join()).digest('hex');
 assert.ok(!seen.has(key),`${p.id} duplicates the geometry of ${seen.get(key)}`);seen.set(key,p.id);
 triangles+=p.indexCount/3;
}
assert.equal(triangles,atlas.triangles,'Triangle total');

const conceptIds=new Set(atlas.concepts.map(c=>c.id));assert.equal(conceptIds.size,atlas.concepts.length,'Duplicate concept ids');
for(const c of atlas.concepts){assert.ok(c.elements.length,`${c.id}: empty`);assert.equal(new Set(c.elements).size,c.elements.length,`${c.id}: repeated element`);for(const id of c.elements)assert.ok(ids.has(id),`${c.id}: missing ${id}`);}

// Left and right names match where the mesh sits (the patient's left is +X). Heart, liver and gut vessels are named by their
// own anatomy rather than the body side, so the check covers the musculoskeletal and nervous systems plus every side fix.
fixSystems(atlas);
const centre=p=>(p.bounds[0][0]+p.bounds[1][0])/2,swapped=new Set(fixes.swapSides.flat());
const misplaced=atlas.parts.filter(p=>{
 if(!['skeletal','muscular','connective','nervous','respiratory'].includes(p.system)&&!swapped.has(p.id))return false;
 const left=/\bleft\b/i.test(p.name),right=/\bright\b/i.test(p.name),x=centre(p);
 return left!==right&&Math.abs(x)>.002&&(left?x<0:x>0);
}).map(p=>`${p.id} ${p.name}`);
assert.deepEqual(misplaced,[],'Left/right names on the wrong side (add the pair to scripts/source-fixes.json)');

const mb=n=>(n/1e6).toFixed(1)+' MB';
console.log(`Verified ${ids.size} parts (${Object.keys(atlas.sources).join(', ')}), ${atlas.concepts.length} concepts, ${triangles.toLocaleString()} triangles in ${atlas.chunks.length} chunks (${mb(atlas.chunks.reduce((n,c)=>n+c.bytes,0))}, ${mb(atlas.chunks.reduce((n,c)=>n+c.gzipBytes,0))} gzip), and left/right names.`);
