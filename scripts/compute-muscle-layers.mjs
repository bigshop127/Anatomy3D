// Assigns every muscle part a peel layer (1 = most superficial) by "onion peeling":
// sample points on each remaining muscle and cast rays outward; a muscle whose rays escape the body often enough
// without hitting another remaining muscle or a bone belongs to the current layer. Those muscles are then removed
// and the next layer is computed from what is left.
// Usage: node scripts/compute-muscle-layers.mjs [--report]   → writes app/muscle-layers.json
import {readFile,writeFile} from 'node:fs/promises';
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {fixSystems} from '../app/system-fixes.ts';

const root=new URL('..',import.meta.url),report=process.argv.includes('--report');
const atlas=JSON.parse(await readFile(new URL('public/models/atlas.json',root)));fixSystems(atlas);
const overrides=JSON.parse(await readFile(new URL('scripts/muscle-layer-overrides.json',root),'utf8'));
const buffers=await Promise.all(atlas.chunks.map(c=>readFile(new URL('public'+c.url,root))));
const SAMPLES=48,FAR=.6,THRESHOLD=Number(process.argv.find(a=>a.startsWith('--threshold='))?.slice(12)??.15),CONE=Math.PI/9,MAX_LAYERS=5;
// Organs block rays too, so muscles behind the viscera (psoas, iliacus, diaphragm) count as deep.
const SOLID=['skeletal','digestive','respiratory','urinary','cardiac','reproductive','endocrine'];

const geometryOf=p=>{const b=buffers[p.chunk],ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);return {position:new Float32Array(ab,p.positions,p.vertexCount*3),normal:new Int16Array(ab,p.normals,p.vertexCount*3),index:new Uint32Array(ab,p.indices,p.indexCount)};};
const muscles=atlas.parts.map((p,i)=>({p,i})).filter(({p})=>p.system==='muscular');
const bones=atlas.parts.map((p,i)=>({p,i})).filter(({p})=>SOLID.includes(p.system));
const geo=new Map([...muscles,...bones].map(({p,i})=>[i,geometryOf(p)]));

// "Acromial part of left deltoid" and its siblings peel together; heads ("long head of biceps femoris") stay separate.
const side=n=>/\bleft\b/i.test(n)?'L':/\bright\b/i.test(n)?'R':'';
const groupOf=n=>{const m=n.toLowerCase().match(/ part of (.+)$/);return m?side(n)+':'+m[1].replace(/\b(left|right) /g,''):n;};

function buildOccluders(indices){
 let vertices=0,triangles=0;for(const i of indices){vertices+=geo.get(i).position.length/3;triangles+=geo.get(i).index.length/3;}
 const position=new Float32Array(vertices*3),index=new Uint32Array(triangles*3),owner=new Int32Array(vertices);let v=0,t=0;
 for(const i of indices){const g=geo.get(i);position.set(g.position,v*3);owner.fill(i,v,v+g.position.length/3);for(let k=0;k<g.index.length;k++)index[t+k]=g.index[k]+v;v+=g.position.length/3;t+=g.index.length;}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(position,3));geometry.setIndex(new T.BufferAttribute(index,1));
 // MeshBVH reorders the index, so ownership is looked up through the vertex of each hit triangle.
 return {bvh:new MeshBVH(geometry),index:geometry.index.array,owner};
}
function random(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
const directionsAround=n=>{
 const tangent=new T.Vector3(Math.abs(n.x)<.9?1:0,Math.abs(n.x)<.9?0:1,0).cross(n).normalize(),bitangent=n.clone().cross(tangent);
 const out=[];for(const sign of [1,-1]){const axis=n.clone().multiplyScalar(sign);out.push(axis);for(let k=0;k<4;k++){const a=k*Math.PI/2;out.push(axis.clone().multiplyScalar(Math.cos(CONE)).addScaledVector(tangent,Math.sin(CONE)*Math.cos(a)).addScaledVector(bitangent,Math.sin(CONE)*Math.sin(a)).normalize());}}
 return out;
};
function exposure(i,occ){
 const g=geo.get(i),rand=random(i+1),areas=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let total=0;
 for(let t=0;t<g.index.length;t+=3){a.fromArray(g.position,g.index[t]*3);b.fromArray(g.position,g.index[t+1]*3);c.fromArray(g.position,g.index[t+2]*3);total+=b.sub(a).cross(c.sub(a)).length()/2;areas.push(total);}
 const ray=new T.Ray(),point=new T.Vector3(),normal=new T.Vector3(),na=new T.Vector3(),nb=new T.Vector3(),nc=new T.Vector3();let escaped=0,rays=0;
 for(let s=0;s<SAMPLES;s++){
  const target=rand()*total;let lo=0,hi=areas.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(areas[mid]<target)lo=mid+1;else hi=mid;}
  const t=lo*3,[ia,ib,ic]=[g.index[t],g.index[t+1],g.index[t+2]];let u=rand(),v=rand();if(u+v>1){u=1-u;v=1-v;}const w=1-u-v;
  point.set(0,0,0).addScaledVector(a.fromArray(g.position,ia*3),w).addScaledVector(b.fromArray(g.position,ib*3),u).addScaledVector(c.fromArray(g.position,ic*3),v);
  normal.set(0,0,0).addScaledVector(na.fromArray(g.normal,ia*3),w).addScaledVector(nb.fromArray(g.normal,ib*3),u).addScaledVector(nc.fromArray(g.normal,ic*3),v).normalize();
  // Normals may face either way in the source meshes, so both hemispheres are tested; a fully exposed muscle scores about 0.5.
  for(const d of directionsAround(normal)){ray.origin.copy(point).addScaledVector(d,.0015);ray.direction.copy(d);rays++;if(!occ.bvh.raycast(ray,T.DoubleSide,0,FAR).some(h=>occ.owner[occ.index[h.faceIndex*3]]!==i))escaped++;}
 }
 return escaped/rays;
}

const layers=new Map(),groups=new Map();for(const {p,i} of muscles){const k=groupOf(p.name);groups.set(k,[...(groups.get(k)??[]),i]);}
let remaining=new Set(muscles.map(m=>m.i));
for(let layer=1;remaining.size;layer++){
 if(layer===MAX_LAYERS){for(const i of remaining)layers.set(i,layer);break;}
 const occ=buildOccluders([...remaining,...bones.map(b=>b.i)]),scores=new Map();
 for(const i of remaining)scores.set(i,exposure(i,occ));
 if(process.argv.includes('--scores')){const seen=new Set();console.log(`layer ${layer} scores:`,[...scores].filter(([i])=>/^right |^(?!left )/i.test(atlas.parts[i].name)).map(([i,v])=>[atlas.parts[i].name.replace(/^Right /,''),v]).filter(([n])=>!seen.has(n)&&seen.add(n)).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`${n} ${v.toFixed(2)}`).join(' · '));}
 // A muscle peels as one piece: its parts take the layer of its most exposed part.
 const peeled=new Set();for(const ids of groups.values()){const live=ids.filter(i=>remaining.has(i));if(live.length&&Math.max(...live.map(i=>scores.get(i)))>=THRESHOLD)live.forEach(i=>peeled.add(i));}
 if(!peeled.size){for(const i of remaining)layers.set(i,layer);break;}
 for(const i of peeled){layers.set(i,layer);remaining.delete(i);}
 if(report)console.log(`layer ${layer}: ${peeled.size} parts — ${[...new Set([...peeled].map(i=>atlas.parts[i].name.replace(/^(Left|Right) /,'')))].sort().join(', ')}`);
}
// Left and right sides can land in different layers by sampling chance; both take the more superficial one.
const base=p=>p.name.toLowerCase().replace(/\b(left|right) /g,'');
const shallowest=new Map();for(const {p,i} of muscles)shallowest.set(base(p),Math.min(shallowest.get(base(p))??Infinity,layers.get(i)));
for(const {p,i} of muscles)layers.set(i,shallowest.get(base(p)));
const unknown=Object.keys(overrides.layers).filter(name=>!shallowest.has(name));
if(unknown.length)throw new Error(`Overrides name muscles that are not in the atlas: ${unknown.join(', ')}`);
let applied=0;for(const {p,i} of muscles){if(base(p) in overrides.layers){layers.set(i,overrides.layers[base(p)]);applied++;}}
const out={note:'Generated by scripts/compute-muscle-layers.mjs; manual corrections go in scripts/muscle-layer-overrides.json. 1 is the most superficial layer.',layers:Object.fromEntries(muscles.map(({p,i})=>[p.id,layers.get(i)]))};
await writeFile(new URL('app/muscle-layers.json',root),JSON.stringify(out,null,1)+'\n');
const counts={};for(const l of layers.values())counts[l]=(counts[l]??0)+1;
console.log(`Muscle layers written: ${JSON.stringify(counts)} (${applied} parts from overrides).`);
