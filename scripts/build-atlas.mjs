// Rebuilds public/models from the current atlas: applies scripts/source-fixes.json, merges the Z-Anatomy structures listed in
// scripts/zanatomy-parts.json and writes the meshopt-1 encoding that app/model-decode.ts reads. Parts already in meshopt-1 are
// copied byte for byte, so rebuilding never degrades them; parts still in the older uncompressed format (or new ones) are encoded:
// - positions: 16-bit steps of GRID from a per-part origin, 8-byte vertices (x, y, z, padding);
// - normals: 8-bit octahedral, 4-byte vertices, decoded with meshopt's OCTAHEDRAL filter;
// - indices: triangles reordered for vertex cache and fetch locality, then index-buffer encoded.
// With --zanatomy <dir> (written by scripts/blender/export.py) the Z-Anatomy structures and their muscle attachment patches take
// their geometry from that export, simplified the way the BodyParts3D meshes were; without it the ones built before are kept.
// Their names, systems and search concepts always follow the manifest. The attachment patches go in a catalogue of their own,
// public/models/attachments.json, which the app only needs for muscle cards.
// Chunks of about CHUNK bytes are named by content hash (plus a .gz copy); public/sw.js gets a model cache name that
// follows the content, so installed apps replace their offline copy when the model changes.
// Usage: node scripts/build-atlas.mjs [--zanatomy work/zanatomy/export]
import {createHash} from 'node:crypto';
import {readFile,readdir,unlink,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {MeshoptEncoder} from 'meshoptimizer/encoder';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {MeshoptSimplifier} from 'meshoptimizer/simplifier';
import {decodePart} from '../app/model-decode.ts';
import {loadGeometry,readAtlas,readChunks,root} from './lib/atlas-geometry.mjs';

const GRID=5e-5,CHUNK=1.2e6,FORMAT='meshopt-1';
const SOURCES={
 bp3d:{name:'BodyParts3D 4.0',license:'CC BY 4.0',url:'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/'},
 'z-anatomy':{name:'Z-Anatomy',license:'CC BY-SA 4.0',url:'https://www.z-anatomy.com/'},
};
// Z-Anatomy meshes are simplified like the BodyParts3D ones (0.2% of the structure's size), but by no more than MAX_ERROR metres,
// so that nerves a few millimetres thick keep a round section.
const RELATIVE_ERROR=.002,MAX_ERROR={nervous:1e-4,other:2.5e-4};
const models=new URL('public/models/',root);
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready,MeshoptSimplifier.ready]);

const atlas=await readAtlas(),encoded=atlas.encoding?.format===FORMAT;
if(atlas.encoding&&!encoded)throw new Error(`Unknown model encoding: ${atlas.encoding.format}`);
const chunks=encoded?await readChunks(atlas):null,geometryOf=encoded?null:await loadGeometry(atlas);
const fixes=JSON.parse(await readFile(new URL('scripts/source-fixes.json',root),'utf8'));
const manifest=JSON.parse(await readFile(new URL('scripts/zanatomy-parts.json',root),'utf8'));
const zAt=process.argv.indexOf('--zanatomy'),exportDir=zAt>0?pathToFileURL(resolve(process.argv[zAt+1]??'')+'/'):null;
const log=[];

// --- Source fixes. Each one checks the current state first, so applying it again changes nothing.
const byId=new Map(atlas.parts.map(p=>[p.id,p]));
const part=id=>{const p=byId.get(id);if(!p)throw new Error(`source-fixes.json names a part that is not in the atlas: ${id}`);return p;};
if(fixes.remove.length){
 const gone=new Set(fixes.remove.map(r=>r.id).filter(id=>byId.has(id)));
 atlas.parts=atlas.parts.filter(p=>!gone.has(p.id));
 for(const c of atlas.concepts)c.elements=c.elements.filter(id=>!gone.has(id));
 atlas.concepts=atlas.concepts.filter(c=>c.elements.length);
 if(gone.size)log.push(`removed ${gone.size} parts`);
}
// The patient's left is +X.
const wrongSide=p=>{const left=/\bleft\b/i.test(p.name),right=/\bright\b/i.test(p.name),x=(p.bounds[0][0]+p.bounds[1][0])/2;return left!==right&&(left?x<0:x>0);};
for(const [a,b] of fixes.swapSides){
 const pa=part(a),pb=part(b);if(!wrongSide(pa))continue;
 [pa.name,pb.name]=[pb.name,pa.name];[pa.conceptId,pb.conceptId]=[pb.conceptId,pa.conceptId];
 for(const c of atlas.concepts){const ia=c.elements.indexOf(a),ib=c.elements.indexOf(b);if(ia>=0&&ib<0)c.elements[ia]=b;else if(ib>=0&&ia<0)c.elements[ib]=a;}
 log.push(`swapped sides of ${a} and ${b}`);
}
for(const fix of fixes.rename){
 const p=part(fix.id);
 if(p.name!==fix.name){log.push(`renamed ${fix.id} "${p.name}" → "${fix.name}"`);p.name=fix.name;}
 if(fix.concept&&!atlas.concepts.some(c=>c.id===fix.concept)){atlas.concepts.push({id:fix.concept,name:fix.name.toLowerCase(),elements:[fix.id]});log.push(`added concept ${fix.concept}`);}
 if(fix.like){
  const twin=part(fix.like);p.conceptId=twin.conceptId;
  for(const c of atlas.concepts){const should=c.elements.includes(twin.id),has=c.elements.includes(p.id);if(should&&!has)c.elements.push(p.id);else if(has&&!should)c.elements=c.elements.filter(id=>id!==p.id);}
 }
}
atlas.concepts=atlas.concepts.filter(c=>c.elements.length);

// --- Z-Anatomy structures.
async function readExport(dir){
 const {parts}=JSON.parse(await readFile(new URL('parts.json',dir),'utf8')),blob=await readFile(new URL('geometry.bin',dir));
 const slice=(offset,bytes)=>blob.buffer.slice(blob.byteOffset+offset,blob.byteOffset+offset+bytes);
 return new Map(parts.map(e=>[e.z,{position:new Float32Array(slice(e.positions,e.vertexCount*12)),index:new Uint32Array(slice(e.indices,e.indexCount*4))}]));
}
const exported=exportDir?await readExport(exportDir):null;
// Area-weighted vertex normals as normalized 16-bit integers (what encodePart takes).
function vertexNormals(position,index){
 const sum=new Float64Array(position.length),out=new Int16Array(position.length);
 for(let t=0;t<index.length;t+=3){
  const a=index[t]*3,b=index[t+1]*3,c=index[t+2]*3;
  const ux=position[b]-position[a],uy=position[b+1]-position[a+1],uz=position[b+2]-position[a+2];
  const vx=position[c]-position[a],vy=position[c+1]-position[a+1],vz=position[c+2]-position[a+2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  for(const k of [a,b,c]){sum[k]+=nx;sum[k+1]+=ny;sum[k+2]+=nz;}
 }
 for(let v=0;v<position.length;v+=3){const l=Math.hypot(sum[v],sum[v+1],sum[v+2]),n=l?[sum[v]/l,sum[v+1]/l,sum[v+2]/l]:[0,1,0];for(let a=0;a<3;a++)out[v+a]=Math.round(n[a]*32767);}
 return out;
}
/** Exported geometry of a Z-Anatomy object, with coincident vertices welded and simplified. */
function simplified(z,system){
 const g=exported.get(z);if(!g)throw new Error(`${z} is not in the Z-Anatomy export (run scripts/blender/export.py again)`);
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let v=0;v<g.position.length;v+=3)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],g.position[v+a]);hi[a]=Math.max(hi[a],g.position[v+a]);}
 const error=Math.min(RELATIVE_ERROR*Math.max(...hi.map((h,a)=>h-lo[a])),MAX_ERROR[system]??MAX_ERROR.other);
 const remap=MeshoptSimplifier.generatePositionRemap(g.position,3),welded=g.index.map(i=>remap[i]);
 // Attachment patches are open surfaces; their outline is the attachment, so it stays put.
 let [index]=MeshoptSimplifier.simplify(welded,g.position,3,0,error,system==='attachment'?['ErrorAbsolute','LockBorder']:['ErrorAbsolute']);
 if(!index.length)index=welded;
 return {position:g.position,normal:vertexNormals(g.position,index),index};
}
const zIds=new Set([...manifest.parts.map(m=>m.id),...atlas.parts.filter(p=>p.source==='z-anatomy').map(p=>p.id)]);
const built=new Map(atlas.parts.filter(p=>p.source==='z-anatomy').map(p=>[p.id,p])),fresh=new Map();
atlas.parts=atlas.parts.filter(p=>p.source!=='z-anatomy');
for(const m of manifest.parts){
 const p=exported?{id:m.id}:built.get(m.id);
 if(!p)throw new Error(`${m.id} (${m.z}) has not been built yet: run node scripts/build-atlas.mjs --zanatomy work/zanatomy/export`);
 Object.assign(p,{name:m.name,conceptId:m.concept,system:m.system,source:'z-anatomy'});
 if(exported){const g=simplified(m.z,m.system);fresh.set(m.id,g);p.vertexCount=g.position.length/3;p.indexCount=g.index.length;}
 atlas.parts.push(p);
}
const dropped=[...built.keys()].filter(id=>!manifest.parts.some(m=>m.id===id));
if(dropped.length)log.push(`dropped ${dropped.length} Z-Anatomy parts the manifest no longer lists`);
// Search concepts: the Z-Anatomy parts leave every concept and the Z-Anatomy concepts go, then the manifest's come back; one whose
// name the atlas already has (spinal cord, cranial nerve) adds its parts to that concept.
for(const c of atlas.concepts)c.elements=c.elements.filter(id=>!zIds.has(id));
atlas.concepts=atlas.concepts.filter(c=>c.elements.length&&!c.id.startsWith('Z:'));
const conceptNamed=new Map(atlas.concepts.map(c=>[c.name,c])),mergedInto=new Map();
for(const c of manifest.concepts){
 const same=conceptNamed.get(c.name);
 if(same){same.elements.push(...c.elements);mergedInto.set(c.id,same.id);}else atlas.concepts.push({id:c.id,name:c.name,elements:[...c.elements]});
}
for(const p of atlas.parts)if(mergedInto.has(p.conceptId))p.conceptId=mergedInto.get(p.conceptId);

// --- Encoding.
function encodePart(p,g){
 const n=p.vertexCount,index=Uint32Array.from(g.index);
 // reorderMesh renumbers the index buffer in place and drops unreferenced vertices; remap gives each old vertex its new slot
 // (it only covers vertices up to the highest index).
 const [remap,count]=MeshoptEncoder.reorderMesh(index,true,false);
 const steps=new Int32Array(count*3),normals=new Float32Array(count*4),normalScale=g.normal instanceof Int16Array?32767:127;
 for(let v=0;v<n;v++){
  const to=remap[v]??0xffffffff;if(to===0xffffffff)continue;
  for(let a=0;a<3;a++)steps[to*3+a]=Math.round(g.position[v*3+a]/GRID);
  const x=g.normal[v*3]/normalScale,y=g.normal[v*3+1]/normalScale,z=g.normal[v*3+2]/normalScale,length=Math.hypot(x,y,z)||1;
  normals.set([x/length,y/length,z/length,0],to*4);
 }
 const low=[0,1,2].map(a=>{let m=Infinity;for(let v=0;v<count;v++)m=Math.min(m,steps[v*3+a]);return m;});
 const packed=new Uint16Array(count*4);
 for(let v=0;v<count;v++)for(let a=0;a<3;a++){const s=steps[v*3+a]-low[a];if(s>65535)throw new Error(`${p.id} is larger than 16-bit steps of ${GRID} m allow`);packed[v*4+a]=s;}
 const position=MeshoptEncoder.encodeVertexBufferLevel(new Uint8Array(packed.buffer),count,8,3,1);
 const normal=MeshoptEncoder.encodeVertexBufferLevel(MeshoptEncoder.encodeFilterOct(normals,count,4,8),count,4,3,1);
 const indices=MeshoptEncoder.encodeIndexBuffer(new Uint8Array(index.buffer),index.length,4);
 return {vertexCount:count,origin:low.map(s=>+(s*GRID).toFixed(5)),sizes:[position.length,normal.length,indices.length],bytes:Buffer.concat([position,normal,indices]),source:{packed,index}};
}
const header={encoding:{format:FORMAT,grid:GRID}};
/** Encodes the parts that have new geometry (geometry(p) returns it), copies the others out of their old chunks, and packs
 * everything into chunks. Returns the chunks and how many parts were encoded. */
function pack(list,geometry,oldChunks){
 const out=[];let pending=[],pendingBytes=0,converted=0;
 const flush=()=>{
  if(!pending.length)return;
  const bytes=Buffer.concat(pending),hash=createHash('sha256').update(bytes).digest('hex').slice(0,16),url=`/models/m-${hash}.bin`;
  out.push({url,bytes,gzip:gzipSync(bytes,{level:9})});pending=[];pendingBytes=0;
 };
 for(const p of list){
  let bytes,sizes=p.streams?.slice(1),origin=p.origin;
  const g=geometry(p);
  if(!g)bytes=oldChunks[p.chunk].subarray(p.streams[0],p.streams[0]+sizes[0]+sizes[1]+sizes[2]);
  else{
   const e=encodePart(p,g);({bytes,sizes,origin}=e);p.vertexCount=e.vertexCount;converted++;
   // The encoding must decode back to exactly the quantized geometry.
   const back=decodePart(header,{...p,origin,streams:[0,...sizes]},bytes,MeshoptDecoder);
   for(let v=0;v<p.vertexCount;v++)for(let a=0;a<3;a++)if(Math.abs(back.position[v*3+a]-(origin[a]+e.source.packed[v*4+a]*GRID))>1e-6)throw new Error(`${p.id}: positions do not decode`);
   // The index codec may rotate a triangle's corners, which keeps its winding.
   const s=e.source.index,d=back.index;
   for(let t=0;t<s.length;t+=3)if(![0,1,2].some(r=>d[t]===s[t+r]&&d[t+1]===s[t+(r+1)%3]&&d[t+2]===s[t+(r+2)%3]))throw new Error(`${p.id}: indices do not decode`);
   // Bounds follow the stored geometry (vertices nothing referenced are gone).
   const steps=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
   for(let v=0;v<p.vertexCount;v++)for(let a=0;a<3;a++){const s=e.source.packed[v*4+a];steps[0][a]=Math.min(steps[0][a],s);steps[1][a]=Math.max(steps[1][a],s);}
   p.bounds=steps.map(end=>end.map((s,a)=>+(origin[a]+s*GRID).toFixed(5)));
  }
  if(pendingBytes&&pendingBytes+bytes.length>CHUNK)flush();
  p.chunk=out.length;p.streams=[pendingBytes,...sizes];p.origin=origin;pending.push(bytes);pendingBytes+=bytes.length;
  delete p.positions;delete p.normals;delete p.indices;
 }
 flush();
 return {out,converted};
}
for(const p of atlas.parts)p.source??='bp3d';
const {out,converted}=pack(atlas.parts,p=>fresh.get(p.id)??(encoded?null:geometryOf(p)),chunks);

// --- Muscle attachment patches.
const attachmentsFile=new URL('attachments.json',models);
let previous=null;try{previous=JSON.parse(await readFile(attachmentsFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const oldPatches=new Map(previous?.patches.map(p=>[p.id,p])),patchGeometry=new Map();
const patches=manifest.attachments.map(a=>{
 const p=exported?{id:a.id}:oldPatches.get(a.id);
 if(!p)throw new Error(`Attachment ${a.z} has not been built yet: run with --zanatomy`);
 Object.assign(p,{muscle:a.term??null,name:a.muscle,end:a.end,side:a.side});
 if(exported){const g=simplified(a.z,'attachment');patchGeometry.set(a.id,g);p.vertexCount=g.position.length/3;p.indexCount=g.index.length;}
 return p;
});
const patchPack=pack(patches,p=>patchGeometry.get(p.id)??null,previous?await readChunks(previous):[]);

// --- Write the model files, the catalogues and the cache name; then delete model files nothing references.
const used=Object.fromEntries(Object.entries(SOURCES).filter(([id])=>atlas.parts.some(p=>p.source===id)));
const unknown=[...new Set(atlas.parts.map(p=>p.source))].filter(id=>!used[id]);
if(unknown.length)throw new Error(`Parts from undeclared sources: ${unknown.join(', ')}`);
const chunkList=list=>list.map(c=>({url:c.url,bytes:c.bytes.length,gzip:c.url+'.gz',gzipBytes:c.gzip.length}));
const {version,sex,source,parts,concepts,sourceTriangles,optimized}=atlas,bp3d=parts.filter(p=>p.source==='bp3d').length;
const scope=`Adult male reference anatomy · ${bp3d.toLocaleString('en')} BodyParts3D meshes + ${(parts.length-bp3d).toLocaleString('en')} Z-Anatomy structures`;
const result={version,sex,source,scope,...header,sources:used,parts,concepts,chunks:chunkList(out),
 triangles:parts.reduce((n,p)=>n+p.indexCount/3,0),sourceTriangles,
 optimized:{...optimized,zAnatomy:{maximumRelativeError:RELATIVE_ERROR,maximumAbsoluteError:MAX_ERROR}}};
const attachments={note:'Origin and insertion patches of the muscles (Z-Anatomy, CC BY-SA 4.0), warped onto the atlas bones. muscle is the atlas muscle term (lowercase, without the side) or null where batch 06 still has to match it; name is the Z-Anatomy muscle name.',
 ...header,source:'z-anatomy',patches,chunks:chunkList(patchPack.out)};
for(const c of [...out,...patchPack.out]){const name=c.url.split('/').pop();await writeFile(new URL(name,models),c.bytes);await writeFile(new URL(name+'.gz',models),c.gzip);}
await writeFile(new URL('atlas.json',models),JSON.stringify(result));
await writeFile(attachmentsFile,JSON.stringify(attachments));
const cacheName='anatomy3d-models-'+createHash('sha256').update([...out,...patchPack.out].map(c=>c.url).join()).digest('hex').slice(0,12);
const swFile=new URL('public/sw.js',root),sw=await readFile(swFile,'utf8'),nextSw=sw.replace(/MODELS='[^']*'/,`MODELS='${cacheName}'`);
if(nextSw===sw&&!sw.includes(`MODELS='${cacheName}'`))throw new Error('public/sw.js has no MODELS cache name to update');
await writeFile(swFile,nextSw);
const keep=new Set([...out,...patchPack.out].flatMap(c=>{const name=c.url.split('/').pop();return [name,name+'.gz'];}));
let deleted=0;for(const name of await readdir(models))if(/\.bin(\.gz)?$/.test(name)&&!keep.has(name)){await unlink(new URL(name,models));deleted++;}

const mb=n=>(n/1e6).toFixed(2)+' MB',size=list=>`${mb(list.reduce((n,c)=>n+c.bytes.length,0))}, download ${mb(list.reduce((n,c)=>n+c.gzip.length,0))} gzip`;
for(const line of log)console.log('fix: '+line);
console.log(`${parts.length} parts (${bp3d} BodyParts3D, ${parts.length-bp3d} Z-Anatomy; ${converted} encoded, ${parts.length-converted} copied), ${concepts.length} concepts, ${result.triangles.toLocaleString()} triangles`);
console.log(`${out.length} chunks: ${size(out)}; attachments: ${patches.length} patches in ${patchPack.out.length} chunks, ${size(patchPack.out)}; ${deleted} old model files deleted; cache ${cacheName}`);
