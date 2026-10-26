// Which large body areas (head and neck, trunk, upper body, lower body, each upper and lower limb) each structure belongs to.
// The areas keep crossing structures whole, so they cannot be clipping boxes: the arms hang beside the pelvis and thighs.
// The skeleton is divided into segments (head, neck, thorax, abdomen, pelvis, each limb) and every point of the body is
// labelled with the segment of its nearest bone. Then:
//  - bones belong to the areas made of their segment (a lower limb also shows its hip bone);
//  - muscles, ligaments, fasciae, discs and cartilages belong to an area when they touch one of its attachment bones
//    (so the latissimus dorsi is part of the upper limb and the psoas of the lower body) or when half of them lies in it;
//  - everything else (vessels, nerves, organs) belongs where at least 30 % of it lies.
// Textbook corrections go in scripts/area-member-overrides.json.
// Usage: node scripts/compute-area-members.mjs [--report]   → writes app/area-members.json
import {readFile,writeFile} from 'node:fs/promises';
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {AREAS,AREA_KEYS} from '../app/regions.ts';
import {termKey} from '../app/names.ts';
import {loadAtlas,loadGeometry,root} from './lib/atlas-geometry.mjs';

const atlas=await loadAtlas(),geometryOf=await loadGeometry(atlas);
const report=process.argv.includes('--report');
const TOUCH=.004,PAD=.01,MIN_CONTACTS=3,SAMPLES=1500,ATTACHED_SHARE=.5,OTHER_SHARE=.3,CELL=.008;

// Segments of the skeleton; the pelvis is split so the trunk can count the sacrum as an attachment without the hip bones
// (otherwise every thigh muscle starting on the hip bone would join the trunk).
const SEGMENT_RULES=[
 ['head',/^(frontal bone|parietal bone|occipital bone|temporal bone|sphenoid bone|ethmoid|maxilla|mandible|nasal bone|palatine bone|zygomatic bone|vomer|major alar cartilage|gingiva of (upper|lower) jaw|.* tooth)$/],
 ['neck',/^(atlas|axis|(third|fourth|fifth|sixth|seventh) cervical vertebra|hyoid bone|(cricoid|thyroid|arytenoid|cuneiform|corniculate) cartilage|intervertebral disk of (axis|(third|fourth|fifth|sixth|seventh) cervical vertebra)|nucleus pulposus c\d-(c\d|t1))$/],
 ['thorax',/^(\w+ thoracic vertebra|\w+ rib|\w+ costal cartilage|manubrium|body of sternum|xiphoid process|intervertebral disk of \w+ thoracic vertebra|nucleus pulposus t\d+-(t\d+|l1))$/],
 ['abdomen',/^(\w+ lumbar vertebra|intervertebral disk of \w+ lumbar vertebra|nucleus pulposus l\d-(l\d|s1))$/],
 ['sacrum',/^(sacrum|coccyx)$/],
 ['hip',/^hip bone$/],
 ['upper-limb',/^(clavicle|scapula|humerus|radius|ulna|scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate|\w+ metacarpal bone|(proximal|middle|distal) phalanx of (thumb|index finger|middle finger|ring finger|little finger))$/],
 ['lower-limb',/^(femur|patella|tibia|fibula|talus|calcaneus|navicular bone of foot|cuboid bone|\w+ cuneiform bone|\w+ metatarsal bone|(proximal|middle|distal) phalanx of (big toe|second toe|third toe|fourth toe|little toe)|sesamoid bone of foot)$/],
];
const SIDED=new Set(['hip','upper-limb','lower-limb']);
/** Segments (with the side for paired ones) count towards an area's share; attachments are the bones whose muscles join it.
 * muscleShare and nerveShare replace the segments for the share of muscles (and other attached parts) and of one-sided
 * nerves: the hip muscles lie mostly on the hip bone but belong to the lower limb, while the sciatic and gluteal nerves run
 * past the hip bone into it. (The vessels beside the hip bone are mostly pelvic, so the gluteal ones are named in the
 * overrides instead.) */
const RULES={
 'head-neck':{segments:['head','neck'],attachments:['head','neck']},
 trunk:{segments:['thorax','abdomen','sacrum','hip'],attachments:['thorax','abdomen','sacrum'],muscleShare:['thorax','abdomen','sacrum']},
 upper:{segments:['head','neck','thorax','abdomen','upper-limb'],attachments:['head','neck','thorax','abdomen','upper-limb']},
 lower:{segments:['sacrum','hip','lower-limb'],attachments:['lower-limb']},
 'upper-limb':{segments:['upper-limb'],attachments:['upper-limb']},
 'lower-limb':{segments:['lower-limb'],attachments:['lower-limb'],bones:['hip'],nerveShare:['lower-limb','hip']},
};
const missing=AREAS.map(a=>a.id).filter(id=>!RULES[id]);if(missing.length)throw new Error(`No membership rule for ${missing}`);

const nameSide=p=>/\bleft\b/i.test(p.name)?'left':/\bright\b/i.test(p.name)?'right':null;
// Some paired structures have no side in their name ("external intercostal muscle" twice): their position tells.
const sideOf=p=>nameSide(p)??(p.bounds[1][0]<-.005?'right':p.bounds[0][0]>.005?'left':null);
const bones=[],unknown=[];
for(const p of atlas.parts){
 if(p.system!=='skeletal')continue;
 const rule=SEGMENT_RULES.find(([,pattern])=>pattern.test(termKey(p.name)));
 if(!rule){unknown.push(p.name);continue;}
 const segment=rule[0],side=SIDED.has(segment)?sideOf(p):null;
 if(SIDED.has(segment)&&!side)throw new Error(`${p.name} should be on one side`);
 bones.push({part:p,segment,side,label:side?`${segment}:${side}`:segment});
}
if(unknown.length)throw new Error(`Skeletal parts without a segment (add them to SEGMENT_RULES): ${unknown.join(', ')}`);
const LABELS=[...new Set(bones.map(b=>b.label))],labelIndex=new Map(LABELS.map((l,i)=>[l,i]));
const boneOf=new Map(bones.map(b=>[b.part.id,b]));

// Nearest-bone labels on a voxel grid: seeded with every bone vertex, then spread by two forward and backward sweeps that
// pass each voxel's nearest seed to its neighbours (a close approximation of the exact nearest bone).
const body=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
for(const p of atlas.parts)for(let i=0;i<3;i++){body[0][i]=Math.min(body[0][i],p.bounds[0][i]-.02);body[1][i]=Math.max(body[1][i],p.bounds[1][i]+.02);}
const dims=[0,1,2].map(i=>Math.ceil((body[1][i]-body[0][i])/CELL)),[nx,ny,nz]=dims,count=nx*ny*nz;
const seedX=new Float32Array(count),seedY=new Float32Array(count),seedZ=new Float32Array(count),best=new Float32Array(count).fill(Infinity),label=new Int8Array(count).fill(-1);
const centre=(x,y,z)=>[body[0][0]+(x+.5)*CELL,body[0][1]+(y+.5)*CELL,body[0][2]+(z+.5)*CELL];
const voxel=(px,py,pz)=>{const x=Math.min(nx-1,Math.max(0,Math.floor((px-body[0][0])/CELL))),y=Math.min(ny-1,Math.max(0,Math.floor((py-body[0][1])/CELL))),z=Math.min(nz-1,Math.max(0,Math.floor((pz-body[0][2])/CELL)));return (z*ny+y)*nx+x;};
// The clavicle is left out: the vessels at the root of the neck (common carotid, brachiocephalic vein) lie nearer to its
// inner end than to any other bone, but they are not upper limb structures.
for(const b of bones){
 if(termKey(b.part.name)==='clavicle')continue;
 const g=geometryOf(b.part),l=labelIndex.get(b.label);
 for(let v=0;v<b.part.vertexCount;v++){
  const px=g.position[v*3],py=g.position[v*3+1],pz=g.position[v*3+2],i=voxel(px,py,pz),x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny)),[cx,cy,cz]=centre(x,y,z);
  const d=(px-cx)**2+(py-cy)**2+(pz-cz)**2;if(d<best[i]){best[i]=d;seedX[i]=px;seedY[i]=py;seedZ[i]=pz;label[i]=l;}
 }
}
const offsets=[];for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy||dz)offsets.push([dx,dy,dz]);
const before=offsets.filter(([dx,dy,dz])=>dz<0||(dz===0&&(dy<0||(dy===0&&dx<0)))),after=offsets.filter(o=>!before.includes(o));
const sweep=(forward)=>{
 const near=forward?before:after;
 for(let n=0;n<count;n++){
  const i=forward?n:count-1-n,x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny));let [cx,cy,cz]=[0,0,0],computed=false;
  for(const [dx,dy,dz] of near){
   const X=x+dx,Y=y+dy,Z=z+dz;if(X<0||Y<0||Z<0||X>=nx||Y>=ny||Z>=nz)continue;const j=(Z*ny+Y)*nx+X;if(label[j]<0)continue;
   if(!computed){[cx,cy,cz]=centre(x,y,z);computed=true;}
   const d=(seedX[j]-cx)**2+(seedY[j]-cy)**2+(seedZ[j]-cz)**2;if(d<best[i]){best[i]=d;seedX[i]=seedX[j];seedY[i]=seedY[j];seedZ[i]=seedZ[j];label[i]=label[j];}
  }
 }
};
for(let pass=0;pass<2;pass++){sweep(true);sweep(false);}

const bvhs=new Map();
const bvhOf=p=>{let b=bvhs.get(p.id);if(!b){const g=geometryOf(p),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(g.position,3));geometry.setIndex(new T.BufferAttribute(g.index,1));b=new MeshBVH(geometry);bvhs.set(p.id,b);}return b;};
const near=(a,b,pad)=>a[0].every((v,i)=>v<=b[1][i]+pad&&a[1][i]>=b[0][i]-pad);
const within=(x,y,z,box,pad)=>x>=box[0][0]-pad&&x<=box[1][0]+pad&&y>=box[0][1]-pad&&y<=box[1][1]+pad&&z>=box[0][2]-pad&&z<=box[1][2]+pad;
const ATTACHED=new Set(['muscular','connective','fascia','skeletal']);
const {add,remove}=JSON.parse(await readFile(new URL('scripts/area-member-overrides.json',root),'utf8'));
// A key is a name, or a pattern between slashes ("/brachial plexus$/") for a family of names.
const matcher=key=>{const m=key.match(/^\/(.+)\/$/);if(!m)return term=>term===key;const pattern=new RegExp(m[1]);return term=>pattern.test(term);};
const overrides=[['add',add],['remove',remove]].flatMap(([kind,list])=>Object.entries(list).map(([key,ids])=>({kind,key,ids,matches:matcher(key)})));
for(const {kind,key,ids,matches} of overrides){
 if(!atlas.parts.some(p=>matches(termKey(p.name))))throw new Error(`Area overrides (${kind}) name a structure that is not in the atlas: ${key}`);
 const wrong=ids.filter(id=>!RULES[id]);if(wrong.length)throw new Error(`Area overrides (${kind}) name unknown areas for ${key}: ${wrong}`);
}
// Bones carrying a muscle's attachment patches (public/models/attachments.json, batch 06), on the muscle's side.
const {patches}=JSON.parse(await readFile(new URL('public/models/attachments.json',root),'utf8'));
const patchBones=(term,side)=>[...new Set(patches.filter(pt=>pt.muscles.includes(term)&&(!side||!pt.side||pt.side===side)).map(pt=>boneOf.get(pt.host)).filter(Boolean))];
const point=new T.Vector3(),target={};
const members={},detail=new Map();
for(const p of atlas.parts){
 const bone=boneOf.get(p.id),side=sideOf(p),found=new Set();
 // Each paired area is decided for one side; a midline part is tested against both.
 const keys=AREAS.flatMap(a=>a.sided?['left','right'].filter(s=>!side||s===side).map(s=>({area:a.id,side:s})):[{area:a.id,side:null}]);
 const labels=(names,s)=>new Set(names.flatMap(n=>SIDED.has(n)?(s?[`${n}:${s}`]:[`${n}:left`,`${n}:right`]):[n]).filter(l=>labelIndex.has(l)).map(l=>labelIndex.get(l)));
 // keys already hold only the bone's own side; a lower limb also shows its hip bone, which is not one of its segments.
 if(bone){for(const k of keys){const r=RULES[k.area];if(r.segments.includes(bone.segment)||r.bones?.includes(bone.segment))found.add(AREA_KEYS.indexOf(k.side?`${k.area}:${k.side}`:k.area));}}
 else{
  const g=geometryOf(p),step=Math.max(1,Math.floor(p.vertexCount/SAMPLES)),hits=new Map(),shares=new Int32Array(LABELS.length);let samples=0;
  const attached=ATTACHED.has(p.system),candidates=attached?bones.filter(b=>near(p.bounds,b.part.bounds,PAD+TOUCH)):[];
  for(let v=0;v<p.vertexCount;v+=step){
   const x=g.position[v*3],y=g.position[v*3+1],z=g.position[v*3+2];samples++;shares[label[voxel(x,y,z)]]++;
   for(const b of candidates){
    if(!within(x,y,z,b.part.bounds,PAD))continue;point.set(x,y,z);
    if(bvhOf(b.part).closestPointToPoint(point,target,0,TOUCH))hits.set(b,(hits.get(b)??0)+1);
   }
  }
  // A muscle's bones are the hosts of its attachment patches when it has any; touching is only the fallback, since muscles
  // also lie against bones they do not attach to (the intercostals under the scapula).
  const patched=p.system==='muscular'?patchBones(termKey(p.name),side):[];
  const ends=patched.length?patched:[...hits].filter(([,n])=>n>=MIN_CONTACTS).map(([b])=>b);
  const share=(names,s)=>{let n=0;for(const l of labels(names,s))n+=shares[l];return n/samples;};
  const onSide=(b,s)=>!s||!b.side||b.side===s;
  for(const k of keys){
   const r=RULES[k.area],s=share((attached?r.muscleShare:p.system==='nervous'&&side?r.nerveShare:null)??r.segments,k.side);
   // Attached to one of the area's attachment bones, or lying entirely on its skeleton (the pelvic floor on the pelvis).
   const attaches=attached&&(ends.some(b=>r.attachments.includes(b.segment)&&onSide(b,k.side))||(ends.length>0&&ends.every(b=>r.segments.includes(b.segment)&&onSide(b,k.side))));
   if(attaches||s>=(attached?ATTACHED_SHARE:OTHER_SHARE))found.add(AREA_KEYS.indexOf(k.side?`${k.area}:${k.side}`:k.area));
  }
  if(report)detail.set(p.id,{[patched.length?'attached':'touched']:[...new Set(ends.map(b=>b.label))],shares:Object.fromEntries(LABELS.map((l,i)=>[l,+(shares[i]/samples).toFixed(2)]).filter(([,v])=>v>0))});
 }
 const term=termKey(p.name),keyed=(id)=>AREA_KEYS.map((k,i)=>[k,i]).filter(([k])=>k===id||k.startsWith(id+':')).filter(([k])=>!k.includes(':')||!side||k.endsWith(':'+side)).map(([,i])=>i);
 for(const o of overrides)if(o.matches(term))for(const id of o.ids)keyed(id).forEach(i=>o.kind==='add'?found.add(i):found.delete(i));
 if(found.size)members[p.id]=[...found].reduce((mask,i)=>mask|(1<<i),0);
}
const counts=Object.fromEntries(AREA_KEYS.map((k,i)=>[k,Object.values(members).filter(m=>m&(1<<i)).length]));
await writeFile(new URL('app/area-members.json',root),JSON.stringify({note:'Generated by scripts/compute-area-members.mjs: part id → bit mask of the areas it belongs to, bit i = keys[i].',keys:AREA_KEYS,members},null,0)+'\n');
console.log(`Area members: ${Object.keys(members).length} of ${atlas.parts.length} parts in an area; per area ${JSON.stringify(counts)}`);
if(report){
 // Muscles per area, and the structures of each system that are in no area, for reading through.
 const zh=JSON.parse(await readFile(new URL('app/names.zh-TW.json',root),'utf8')).terms;
 for(const [i,k] of AREA_KEYS.entries()){
  const terms=[...new Set(atlas.parts.filter(p=>p.system==='muscular'&&members[p.id]&(1<<i)).map(p=>termKey(p.name)))];
  console.log(`\n## ${k} (${terms.length} muscles)\n${terms.map(t=>zh[t]??t).join('、')}`);
 }
 const none=atlas.parts.filter(p=>!members[p.id]);console.log(`\n## In no area (${none.length})\n${none.map(p=>`${p.name} [${p.system}] ${JSON.stringify(detail.get(p.id))}`).join('\n')}`);
 const ask=process.env.PARTS?.split('|')??[];
 for(const name of ask)for(const p of atlas.parts.filter(p=>p.name.toLowerCase()===name.toLowerCase()))console.log(`\n${p.name}: ${AREA_KEYS.filter((k,i)=>members[p.id]&(1<<i)).join(', ')} ${JSON.stringify(detail.get(p.id))}`);
}
