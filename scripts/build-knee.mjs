// Builds the high-detail knee (public/models/knee/) from the SPL Knee Atlas: reads the atlas models listed in
// scripts/knee-parts.json, turns them into app coordinates, smooths away the steps the MRI slices left on the surfaces,
// simplifies them and writes the same meshopt-1 encoding as the body model (scripts/lib/model-pack.mjs).
// The atlas is a left knee in RAS millimetres (+x right, +y anterior, +z superior); the app uses metres with +x the patient's
// left, +y up and +z anterior. The knee is moved so that its joint sits where the body model's left knee joint is.
// Usage: node scripts/build-knee.mjs <unzipped knee-2016-09 folder> [--ply <dir>]   (--ply also writes each result as a PLY)
import {mkdir,readFile,readdir,unlink,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MeshoptSimplifier} from 'meshoptimizer/simplifier';
import {root} from './lib/atlas-geometry.mjs';
import {header,chunkList,pack,size,vertexNormals} from './lib/model-pack.mjs';

// Taubin smoothing (shrink-free): ITERATIONS rounds of a LAMBDA step and a MU step. Then simplified by up to ERROR metres.
const ITERATIONS=24,LAMBDA=.5,MU=-.53,ERROR=5e-5;
await MeshoptSimplifier.ready;
const args=process.argv.slice(2),plyAt=args.indexOf('--ply'),plyDir=plyAt>=0?resolve(args[plyAt+1]):null;
const source=args.find((a,i)=>!a.startsWith('--')&&(plyAt<0||i!==plyAt+1));
if(!source)throw new Error('Usage: node scripts/build-knee.mjs <unzipped knee-2016-09 folder> [--ply <dir>]');
const data=pathToFileURL(resolve(source,'Data')+'/'),manifest=JSON.parse(await readFile(new URL('scripts/knee-parts.json',root),'utf8'));
const out=new URL('public/models/knee/',root);

/** Points and triangles of a binary legacy VTK polydata file (big-endian; polygons and/or triangle strips). */
function readVtk(buffer){
 const view=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength);let pos=0,points=null;const triangles=[];
 const line=()=>{const end=buffer.indexOf(10,pos),text=buffer.toString('latin1',pos,end).trim();pos=end+1;return text;};
 while(pos<buffer.length){
  const head=line().split(/\s+/);
  if(head[0]==='POINTS'){
   const n=+head[1],double=head[2]==='double';points=new Float64Array(n*3);
   for(let i=0;i<n*3;i++){points[i]=double?view.getFloat64(pos,false):view.getFloat32(pos,false);pos+=double?8:4;}
  }else if(head[0]==='POLYGONS'||head[0]==='TRIANGLE_STRIPS'||head[0]==='LINES'||head[0]==='VERTICES'){
   const total=+head[2],cells=new Int32Array(total);for(let i=0;i<total;i++){cells[i]=view.getInt32(pos,false);pos+=4;}
   for(let i=0;i<total;){
    const k=cells[i],ids=cells.subarray(i+1,i+1+k);i+=k+1;
    if(head[0]==='POLYGONS')for(let j=1;j<k-1;j++)triangles.push(ids[0],ids[j],ids[j+1]);
    else if(head[0]==='TRIANGLE_STRIPS')for(let j=0;j<k-2;j++)triangles.push(...(j%2?[ids[j+1],ids[j],ids[j+2]]:[ids[j],ids[j+1],ids[j+2]]));
   }
  }else if(head[0]==='POINT_DATA'||head[0]==='CELL_DATA')break;
 }
 if(!points)throw new Error('VTK file without points');
 return {points,index:Uint32Array.from(triangles)};
}
/** RAS millimetres to app metres. */
function toApp(points){const p=new Float32Array(points.length);for(let v=0;v<points.length;v+=3){p[v]=-points[v]/1000;p[v+1]=points[v+2]/1000;p[v+2]=points[v+1]/1000;}return p;}
/** Taubin smoothing on the welded mesh: every vertex moves toward (LAMBDA) and then away from (MU) its neighbours' average. */
function smooth(position,index){
 const n=position.length/3,remap=MeshoptSimplifier.generatePositionRemap(position,3),welded=index.map(i=>remap[i]);
 const edges=new Set();for(let t=0;t<welded.length;t+=3)for(let e=0;e<3;e++){const a=welded[t+e],b=welded[t+(e+1)%3];if(a!==b)edges.add(a<b?a*n+b:b*n+a);}
 const count=new Uint32Array(n);for(const k of edges){count[Math.floor(k/n)]++;count[k%n]++;}
 const start=new Uint32Array(n+1);for(let v=0;v<n;v++)start[v+1]=start[v]+count[v];
 const next=start.slice(0,n),neighbours=new Uint32Array(start[n]);for(const k of edges){const a=Math.floor(k/n),b=k%n;neighbours[next[a]++]=b;neighbours[next[b]++]=a;}
 let p=Float64Array.from(position);const q=new Float64Array(p.length);
 const step=f=>{for(let v=0;v<n;v++){const c=count[v];if(!c){q.set(p.subarray(v*3,v*3+3),v*3);continue;}let x=0,y=0,z=0;for(let i=start[v];i<start[v+1];i++){const u=neighbours[i]*3;x+=p[u];y+=p[u+1];z+=p[u+2];}q[v*3]=p[v*3]+f*(x/c-p[v*3]);q[v*3+1]=p[v*3+1]+f*(y/c-p[v*3+1]);q[v*3+2]=p[v*3+2]+f*(z/c-p[v*3+2]);}p.set(q);};
 // Duplicated points share their welded copy's place.
 for(let i=0;i<ITERATIONS;i++){step(LAMBDA);step(MU);}
 const result=new Float32Array(position.length);for(let v=0;v<n;v++){const w=remap[v]*3;result[v*3]=p[w];result[v*3+1]=p[w+1];result[v*3+2]=p[w+2];}
 return {position:result,index:welded};
}
function writePly(file,position,index){
 const head=Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${position.length/3}\nproperty float x\nproperty float y\nproperty float z\nelement face ${index.length/3}\nproperty list uchar int vertex_indices\nend_header\n`);
 const faces=Buffer.alloc(index.length/3*13);for(let t=0;t<index.length/3;t++){faces.writeUInt8(3,t*13);for(let k=0;k<3;k++)faces.writeInt32LE(index[t*3+k],t*13+1+k*4);}
 return writeFile(file,Buffer.concat([head,Buffer.from(position.buffer,position.byteOffset,position.byteLength),faces]));
}
const boundsOf=position=>{const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let v=0;v<position.length;v+=3)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],position[v+a]);hi[a]=Math.max(hi[a],position[v+a]);}return [lo,hi];};

const files=await readdir(data),meshes=new Map();let sourceTriangles=0;
for(const m of manifest.parts){
 const file=files.find(f=>f.startsWith(`Model_${m.model}_`)&&f.endsWith('.vtk'));if(!file)throw new Error(`Model ${m.model} is not in ${source}`);
 const {points,index}=readVtk(await readFile(new URL(file,data)));sourceTriangles+=index.length/3;
 meshes.set(m.model,{position:toApp(points),index});
}
// The joint: halfway between the bottom of the femur and the top of the tibia, over the middle of the tibia; the body model's
// left knee gives where it goes.
const atlas=JSON.parse(await readFile(new URL('public/models/atlas.json',root),'utf8'));
const jointOf=(femur,tibia)=>[(tibia[0][0]+tibia[1][0])/2,(femur[0][1]+tibia[1][1])/2,(tibia[0][2]+tibia[1][2])/2];
const named=name=>{const p=atlas.parts.find(q=>q.name===name);if(!p)throw new Error(`${name} is not in the body model`);return p.bounds;};
const target=jointOf(named('Left femur'),named('Left tibia')),joint=jointOf(boundsOf(meshes.get(95).position),boundsOf(meshes.get(96).position));
const shift=target.map((t,a)=>t-joint[a]);

if(plyDir)await mkdir(plyDir,{recursive:true});
const parts=[],geometry=new Map();
for(const m of manifest.parts){
 const g=meshes.get(m.model);for(let v=0;v<g.position.length;v+=3)for(let a=0;a<3;a++)g.position[v+a]+=shift[a];
 const smoothed=smooth(g.position,g.index);
 let [index]=MeshoptSimplifier.simplify(smoothed.index,smoothed.position,3,0,ERROR,['ErrorAbsolute']);
 if(!index.length)index=smoothed.index;
 const id=`SPLK${m.model}`;geometry.set(id,{position:smoothed.position,normal:vertexNormals(smoothed.position,index),index});
 parts.push({id,name:m.name,conceptId:`SPLK:${m.model}`,system:m.system,source:'spl-knee',vertexCount:smoothed.position.length/3,indexCount:index.length});
 if(plyDir)await writePly(resolve(plyDir,`${id}.ply`),smoothed.position,index);
}
const {out:chunks}=pack(parts,p=>geometry.get(p.id),[],'/models/knee/k-');
// Search: each structure, plus the four cartilages together.
const concepts=parts.map(p=>({id:p.conceptId,name:p.name.toLowerCase(),elements:[p.id]}));
concepts.push({id:'SPLK:cartilage',name:'articular cartilage of left knee joint',elements:parts.filter(p=>/^articular cartilage/i.test(p.name)).map(p=>p.id)});
const result={version:'SPL Knee Atlas 2016-09',side:'left',source:manifest.source.name,scope:`Left knee (MRI) · ${parts.length} structures`,...header,
 sources:{'spl-knee':{name:manifest.source.name,license:manifest.source.license,url:manifest.source.url}},parts,concepts,chunks:chunkList(chunks),
 triangles:parts.reduce((n,p)=>n+p.indexCount/3,0),sourceTriangles,
 optimized:{smoothing:{method:'Taubin',iterations:ITERATIONS,lambda:LAMBDA,mu:MU},maximumAbsoluteError:ERROR}};
await mkdir(out,{recursive:true});
for(const c of chunks){const name=c.url.split('/').pop();await writeFile(new URL(name,out),c.bytes);await writeFile(new URL(name+'.gz',out),c.gzip);}
await writeFile(new URL('atlas.json',out),JSON.stringify(result));
const keep=new Set(chunks.flatMap(c=>{const name=c.url.split('/').pop();return [name,name+'.gz'];}));
let deleted=0;for(const name of await readdir(out))if(/\.bin(\.gz)?$/.test(name)&&!keep.has(name)){await unlink(new URL(name,out));deleted++;}
console.log(`${parts.length} parts, ${result.triangles.toLocaleString()} triangles (from ${sourceTriangles.toLocaleString()}); ${chunks.length} chunks: ${size(chunks)}; moved by [${shift.map(v=>(v*1000).toFixed(1)).join(', ')}] mm; ${deleted} old files deleted`);
