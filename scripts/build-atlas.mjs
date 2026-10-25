// Rebuilds public/models from the current atlas: applies scripts/source-fixes.json and writes the meshopt-1 encoding
// that app/model-decode.ts reads. Parts already in meshopt-1 are copied byte for byte, so rebuilding never degrades them;
// parts still in the older uncompressed format (or new ones) are encoded:
// - positions: 16-bit steps of GRID from a per-part origin, 8-byte vertices (x, y, z, padding);
// - normals: 8-bit octahedral, 4-byte vertices, decoded with meshopt's OCTAHEDRAL filter;
// - indices: triangles reordered for vertex cache and fetch locality, then index-buffer encoded.
// Chunks of about CHUNK bytes are named by content hash (plus a .gz copy); public/sw.js gets a model cache name that
// follows the content, so installed apps replace their offline copy when the model changes.
// Usage: node scripts/build-atlas.mjs
import {createHash} from 'node:crypto';
import {readFile,readdir,unlink,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {MeshoptEncoder} from 'meshoptimizer/encoder';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {decodePart} from '../app/model-decode.ts';
import {loadGeometry,readAtlas,readChunks,root} from './lib/atlas-geometry.mjs';

const GRID=5e-5,CHUNK=1.2e6,FORMAT='meshopt-1';
const SOURCES={bp3d:{name:'BodyParts3D 4.0',license:'CC BY 4.0',url:'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/'}};
const models=new URL('public/models/',root);
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);

const atlas=await readAtlas(),encoded=atlas.encoding?.format===FORMAT;
if(atlas.encoding&&!encoded)throw new Error(`Unknown model encoding: ${atlas.encoding.format}`);
const chunks=encoded?await readChunks(atlas):null,geometryOf=encoded?null:await loadGeometry(atlas);
const fixes=JSON.parse(await readFile(new URL('scripts/source-fixes.json',root),'utf8'));
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
const out=[];let pending=[],pendingBytes=0,converted=0;
const flush=()=>{
 if(!pending.length)return;
 const bytes=Buffer.concat(pending),hash=createHash('sha256').update(bytes).digest('hex').slice(0,16),url=`/models/m-${hash}.bin`;
 out.push({url,bytes,gzip:gzipSync(bytes,{level:9})});pending=[];pendingBytes=0;
};
const header={encoding:{format:FORMAT,grid:GRID}};
for(const p of atlas.parts){
 p.source??='bp3d';
 let bytes,sizes=p.streams?.slice(1),origin=p.origin;
 if(encoded)bytes=chunks[p.chunk].subarray(p.streams[0],p.streams[0]+sizes[0]+sizes[1]+sizes[2]);
 else{
  const e=encodePart(p,geometryOf(p));({bytes,sizes,origin}=e);p.vertexCount=e.vertexCount;converted++;
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

// --- Write the model files, the catalogue and the cache name; then delete model files nothing references.
const used=Object.fromEntries(Object.entries(SOURCES).filter(([id])=>atlas.parts.some(p=>p.source===id)));
const unknown=[...new Set(atlas.parts.map(p=>p.source))].filter(id=>!used[id]);
if(unknown.length)throw new Error(`Parts from undeclared sources: ${unknown.join(', ')}`);
const {version,sex,source,scope,parts,concepts,sourceTriangles,optimized}=atlas;
const result={version,sex,source,scope,...header,sources:used,parts,concepts,
 chunks:out.map(c=>({url:c.url,bytes:c.bytes.length,gzip:c.url+'.gz',gzipBytes:c.gzip.length})),
 triangles:parts.reduce((n,p)=>n+p.indexCount/3,0),sourceTriangles,optimized};
for(const c of out){const name=c.url.split('/').pop();await writeFile(new URL(name,models),c.bytes);await writeFile(new URL(name+'.gz',models),c.gzip);}
await writeFile(new URL('atlas.json',models),JSON.stringify(result));
const cacheName='anatomy3d-models-'+createHash('sha256').update(out.map(c=>c.url).join()).digest('hex').slice(0,12);
const swFile=new URL('public/sw.js',root),sw=await readFile(swFile,'utf8'),nextSw=sw.replace(/MODELS='[^']*'/,`MODELS='${cacheName}'`);
if(nextSw===sw&&!sw.includes(`MODELS='${cacheName}'`))throw new Error('public/sw.js has no MODELS cache name to update');
await writeFile(swFile,nextSw);
const keep=new Set(out.flatMap(c=>{const name=c.url.split('/').pop();return [name,name+'.gz'];}));
let deleted=0;for(const name of await readdir(models))if(/\.bin(\.gz)?$/.test(name)&&!keep.has(name)){await unlink(new URL(name,models));deleted++;}

const mb=n=>(n/1e6).toFixed(2)+' MB';
for(const line of log)console.log('fix: '+line);
console.log(`${parts.length} parts (${converted} encoded, ${parts.length-converted} copied), ${concepts.length} concepts, ${result.triangles.toLocaleString()} triangles`);
console.log(`${out.length} chunks: ${mb(result.chunks.reduce((n,c)=>n+c.bytes,0))}, download ${mb(result.chunks.reduce((n,c)=>n+c.gzipBytes,0))} gzip; ${deleted} old model files deleted; cache ${cacheName}`);
