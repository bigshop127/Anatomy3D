// The meshopt-1 model encoding that app/model-decode.ts reads, shared by scripts/build-atlas.mjs and scripts/build-knee.mjs:
// - positions: 16-bit steps of GRID from a per-part origin, 8-byte vertices (x, y, z, padding);
// - normals: 8-bit octahedral, 4-byte vertices, decoded with meshopt's OCTAHEDRAL filter;
// - indices: triangles reordered for vertex cache and fetch locality, then index-buffer encoded.
// Chunks of about CHUNK bytes are named by content hash (plus a .gz copy).
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {MeshoptEncoder} from 'meshoptimizer/encoder';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {decodePart} from '../../app/model-decode.ts';

export const GRID=5e-5,CHUNK=1.2e6,FORMAT='meshopt-1';
export const header={encoding:{format:FORMAT,grid:GRID}};
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);

// Area-weighted vertex normals as normalized 16-bit integers (what encodePart takes).
export function vertexNormals(position,index){
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
/** Encodes the parts that have new geometry (geometry(p) returns it), copies the others out of their old chunks, and packs
 * everything into chunks whose urls start with prefix. Returns the chunks and how many parts were encoded. */
export function pack(list,geometry,oldChunks,prefix='/models/m-'){
 const out=[];let pending=[],pendingBytes=0,converted=0;
 const flush=()=>{
  if(!pending.length)return;
  const bytes=Buffer.concat(pending),hash=createHash('sha256').update(bytes).digest('hex').slice(0,16),url=`${prefix}${hash}.bin`;
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
/** Chunk entries of a catalogue: url, size and the gzip copy. */
export const chunkList=list=>list.map(c=>({url:c.url,bytes:c.bytes.length,gzip:c.url+'.gz',gzipBytes:c.gzip.length}));
export const mb=n=>(n/1e6).toFixed(2)+' MB',size=list=>`${mb(list.reduce((n,c)=>n+c.bytes.length,0))}, download ${mb(list.reduce((n,c)=>n+c.gzip.length,0))} gzip`;
