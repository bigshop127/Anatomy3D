// Attachments worked out from the geometry, for muscles Z-Anatomy gives no patch for one end: the part of a bone's surface the
// muscle touches. scripts/attachment-contacts.json says which bones each end covers (written from the card text and checked by
// eye), since a muscle also lies against bones it does not attach to.
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {termKey} from '../../app/names.ts';

export const REACH=.0025,GAP=.0003;
const DEPTH=.015,MIN_AREA=2e-5,MIN_SHARE=.1;
const sideOf=name=>/\bleft\b/i.test(name)?'left':/\bright\b/i.test(name)?'right':'';

/** Area-weighted vertex normals from the winding, turned outward when the mesh as a whole winds inward. */
function outwardNormals(position,index){
 const sum=new Float64Array(position.length);let volume=0;
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),n=new T.Vector3();
 for(let t=0;t<index.length;t+=3){
  a.fromArray(position,index[t]*3);b.fromArray(position,index[t+1]*3);c.fromArray(position,index[t+2]*3);
  volume+=a.dot(new T.Vector3().crossVectors(b,c));
  n.subVectors(b,a).cross(new T.Vector3().subVectors(c,a));
  for(const k of [index[t],index[t+1],index[t+2]])for(let d=0;d<3;d++)sum[k*3+d]+=n.getComponent(d);
 }
 const sign=volume<0?-1:1;
 for(let v=0;v<position.length;v+=3){const l=Math.hypot(sum[v],sum[v+1],sum[v+2])||1;for(let d=0;d<3;d++)sum[v+d]=sign*sum[v+d]/l;}
 return sum;
}

export function contactTools(parts,geometryOf){
 const cache=new Map();
 const mesh=p=>{
  let m=cache.get(p.id);if(m)return m;
  const g=geometryOf(p),geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(g.position,3));geometry.setIndex(new T.BufferAttribute(g.index,1));
  m={part:p,position:g.position,index:g.index,normals:outwardNormals(g.position,g.index),bvh:new MeshBVH(geometry)};cache.set(p.id,m);return m;
 };
 const target={},point=new T.Vector3(),toward=new T.Vector3(),normal=new T.Vector3();
 /** How far a point is from a muscle surface; negative inside it (judged by the outward normal at the closest point). */
 const distance=(m,p)=>{
  const hit=m.bvh.closestPointToPoint(p,target,0,DEPTH);if(!hit)return Infinity;
  const [i,j,k]=[0,1,2].map(c=>m.index[hit.faceIndex*3+c]);
  normal.fromArray(m.normals,i*3).add(new T.Vector3().fromArray(m.normals,j*3)).add(new T.Vector3().fromArray(m.normals,k*3));
  toward.subVectors(p,hit.point);
  return toward.dot(normal)<0?-hit.distance:hit.distance;
 };
 /** Triangles of the bone within reach of (or inside) any of the muscles, kept by connected pieces of a fair size. */
 function contact(bone,muscles,reach=REACH){
  const b=mesh(bone),ms=muscles.map(mesh),keep=[];
  const box=new T.Box3();ms.forEach(m=>box.union(new T.Box3(new T.Vector3().fromArray(m.part.bounds[0]),new T.Vector3().fromArray(m.part.bounds[1]))));box.expandByScalar(reach);
  const a=new T.Vector3(),c=new T.Vector3();
  for(let t=0;t<b.index.length;t+=3){
   point.fromArray(b.position,b.index[t]*3).add(a.fromArray(b.position,b.index[t+1]*3)).add(c.fromArray(b.position,b.index[t+2]*3)).multiplyScalar(1/3);
   if(!box.containsPoint(point))continue;
   if(ms.some(m=>distance(m,point)<=reach))keep.push(t/3);
  }
  return pieces(b,keep);
 }
 /** Splits triangles into pieces joined by shared vertices and drops specks. */
 function pieces(b,tris){
  const parent=new Map(),find=x=>{while(parent.get(x)!==x){parent.set(x,parent.get(parent.get(x)));x=parent.get(x);}return x;};
  const byVertex=new Map();
  for(const t of tris){parent.set(t,t);for(let c=0;c<3;c++){const v=b.index[t*3+c],o=byVertex.get(v);if(o===undefined)byVertex.set(v,t);else parent.set(find(t),find(o));}}
  const groups=new Map(),area=t=>{const p=k=>new T.Vector3().fromArray(b.position,b.index[t*3+k]*3);return p(1).sub(p(0)).cross(p(2).sub(p(0))).length()/2;};
  for(const t of tris){const r=find(t),g=groups.get(r)??{tris:[],area:0};g.tris.push(t);g.area+=area(t);groups.set(r,g);}
  const list=[...groups.values()],largest=Math.max(0,...list.map(g=>g.area));
  const kept=list.filter(g=>g.area>=MIN_AREA&&g.area>=largest*MIN_SHARE);
  return {tris:kept.flatMap(g=>g.tris).sort((x,y)=>x-y),area:kept.reduce((s,g)=>s+g.area,0)};
 }
 /** Patch geometry: the chosen triangles lifted GAP off the bone so they draw on top of it. */
 function patchGeometry(bone,tris){
  const b=mesh(bone),remap=new Map(),position=[],index=[];
  for(const t of tris)for(let c=0;c<3;c++){
   const v=b.index[t*3+c];let to=remap.get(v);
   if(to===undefined){to=remap.size;remap.set(v,to);for(let d=0;d<3;d++)position.push(b.position[v*3+d]+b.normals[v*3+d]*GAP);}
   index.push(to);
  }
  return {position:new Float32Array(position),index:new Uint32Array(index)};
 }
 /** Splits triangles of a bone between the two ends (see the note in scripts/attachment-contacts.json). */
 function split(bone,tris,how){
  const b=mesh(bone),out={origin:[],insertion:[]},centre=(bone.bounds[0][0]+bone.bounds[1][0])/2,c=new T.Vector3();
  for(const t of tris){
   c.set(0,0,0);for(let k=0;k<3;k++)c.add(point.fromArray(b.position,b.index[t*3+k]*3));c.multiplyScalar(1/3);
   if(how.by==='midline'){out[Math.abs(c.x-centre)<how.within?how.near:how.far].push(t);continue;}
   // Height against the middle of the bone at that spot: the mean height of its vertices within 6 mm across.
   let sum=0,n=0;for(let v=0;v<b.position.length;v+=3)if(Math.hypot(b.position[v]-c.x,b.position[v+2]-c.z)<.006){sum+=b.position[v+1];n++;}
   out[n&&c.y>sum/n?how.upper:how.lower].push(t);
  }
  return {origin:pieces(b,out.origin).tris,insertion:pieces(b,out.insertion).tris};
 }
 /** On a bone of the midline, the triangles on one side of it (the patient's left is +x), so a vertebra carries a left and a
  * right patch rather than the same one twice. */
 function half(bone,tris,side){
  const b=mesh(bone),centre=(bone.bounds[0][0]+bone.bounds[1][0])/2,keep=[];
  for(const t of tris){let x=0;for(let k=0;k<3;k++)x+=b.position[b.index[t*3+k]*3];if(side==='left'?x/3>centre:x/3<=centre)keep.push(t);}
  return pieces(b,keep).tris;
 }
 return {contact,patchGeometry,split,half,mesh};
}

/** Parts of the given terms on one side (parts without a side belong to both). */
export const partsOf=(parts,terms,side)=>parts.filter(p=>terms.includes(termKey(p.name))&&(!sideOf(p.name)||sideOf(p.name)===side));

const ORDINAL=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth'];
const SPINE=[...Array(7)].map((_,i)=>i===0?'atlas':i===1?'axis':`${ORDINAL[i]} cervical vertebra`).concat([...Array(12)].map((_,i)=>`${ORDINAL[i]} thoracic vertebra`),[...Array(5)].map((_,i)=>`${ORDINAL[i]} lumbar vertebra`));
const level=s=>{const m=s.match(/^([CTL])(\d+)$/);return m?{C:0,T:7,L:19}[m[1]]+ +m[2]-1:-1;};
const range=(a,b)=>[...Array(b-a+1)].map((_,i)=>a+i);
/** Expands the shorthand of scripts/attachment-contacts.json into part terms. */
export function expand(token){
 let m=token.match(/^([CTL]\d+)(?:-([CTL]?\d+))?$/);
 if(m){const lo=level(m[1]),hi=m[2]?level(/^\d/.test(m[2])?m[1][0]+m[2]:m[2]):lo;return range(lo,hi).map(i=>SPINE[i]);}
 if((m=token.match(/^disk ([CTL]\d+)-([CTL]\d+)$/)))return range(level(m[1]),level(m[2])).map(i=>`intervertebral disk of ${SPINE[i]}`);
 if((m=token.match(/^(rib|costal cartilage) (\d+)(?:-(\d+))?$/)))return range(+m[2],+(m[3]??m[2])).map(i=>`${ORDINAL[i-1]} ${m[1]}`);
 return [token];
}
/** The computed patches of the table: one per muscle term, end, side and part touched; geometry in metres with outward normals. */
export function contactPatches(parts,geometryOf,table,idOf){
 const tools=contactTools(parts,geometryOf),terms=new Set(parts.map(p=>termKey(p.name))),out=[];
 for(const entry of table){
  const on=entry.on.flatMap(expand);
  for(const t of [...entry.muscles,...on])if(!terms.has(t))throw new Error(`attachment-contacts.json: ${t} is not in the atlas`);
  for(const term of entry.muscles)for(const side of entry.side?[entry.side]:['left','right']){
   const muscles=partsOf(parts,[term],side);if(!muscles.length)continue;
   for(const host of partsOf(parts,on,side)){
    let {tris}=tools.contact(host,muscles,entry.reach);
    if(!sideOf(host.name))tris=tools.half(host,tris,side);
    if(!tris.length)continue;
    const ends=entry.split?tools.split(host,tris,entry.split):{[entry.end]:tris};
    for(const [end,list] of Object.entries(ends)){
     if(!list.length)continue;
     const g=tools.patchGeometry(host,list),m=tools.mesh(host),normal=new Int16Array(g.position.length);
     // Normals of the bone at the same vertices, as normalized 16-bit integers.
     const remap=new Map();for(const t of list)for(let c=0;c<3;c++){const v=m.index[t*3+c];if(!remap.has(v))remap.set(v,remap.size);}
     for(const [v,to] of remap)for(let d=0;d<3;d++)normal[to*3+d]=Math.round(m.normals[v*3+d]*32767);
     out.push({id:idOf(`${term}|${end}|${side}|${host.id}`),muscles:[term],name:term,end,side,host:host.id,geometry:{...g,normal}});
    }
   }
  }
 }
 return out;
}
