// Which atlas part each muscle attachment patch lies on: a bone, or a ligament, membrane or fascia where the muscle arises from
// soft tissue. The app moves a patch with its host when the model is pulled apart and hides it with the host.
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {fixSystems} from '../../app/system-fixes.ts';

const HOSTS=new Set(['skeletal','connective','fascia']),REACH=.006,SAMPLES=60,SHARE=.15;
const sideOf=name=>/\bleft\b/i.test(name)?'left':/\bright\b/i.test(name)?'right':'';
/** parts: the atlas parts; geometryOf(part) and patchGeometry(patch) return {position, index}. Returns patch id → part id. */
export function attachmentHosts(parts,geometryOf,patches,patchGeometry){
 // Systems as the app sees them: a few muscles are stored as bone.
 const view=parts.map(p=>({...p}));fixSystems({parts:view});
 const candidates=view.filter(p=>HOSTS.has(p.system)),trees=new Map(),target={},point=new T.Vector3();
 const tree=p=>{
  let t=trees.get(p.id);if(t)return t;
  const g=geometryOf(p),geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(g.position,3));geometry.setIndex(new T.BufferAttribute(g.index,1));
  t=new MeshBVH(geometry);trees.set(p.id,t);return t;
 };
 const hosts=new Map();
 for(const patch of patches){
  // Only parts of the patch's own side (or the midline) can carry it.
  const [lo,hi]=patch.bounds,near=candidates.filter(p=>(!sideOf(p.name)||sideOf(p.name)===patch.side)&&p.bounds[0].every((v,a)=>v<=hi[a]+REACH)&&p.bounds[1].every((v,a)=>v>=lo[a]-REACH));
  const {position}=patchGeometry(patch),n=position.length/3,step=Math.max(1,Math.floor(n/SAMPLES)),votes=new Map();
  // Each sampled vertex votes for the nearest candidate surface.
  for(let v=0;v<n;v+=step){
   point.fromArray(position,v*3);let best=null,distance=REACH;
   for(const p of near){const hit=tree(p).closestPointToPoint(point,target,0,distance);if(hit&&hit.distance<distance){distance=hit.distance;best=p;}}
   if(best)votes.set(best,(votes.get(best)??0)+1);
  }
  const ranked=[...votes].sort((a,b)=>b[1]-a[1]||a[0].id.localeCompare(b[0].id)),total=ranked.reduce((s,[,k])=>s+k,0);
  // Bone first, then ligament or capsule, fascia last: a patch on the greater trochanter also touches its bursa and one at a
  // finger joint its capsule, and the bone carries it when it has a fair share of the votes.
  const pick=system=>ranked.find(([p,k])=>p.system===system&&k>=total*SHARE);
  const host=(pick('skeletal')??pick('connective')??ranked.find(([p])=>p.system!=='fascia')??ranked[0])?.[0];
  if(!host)throw new Error(`Attachment ${patch.id} (${patch.name}) lies on no bone or ligament`);
  hosts.set(patch.id,host.id);
 }
 return hosts;
}
