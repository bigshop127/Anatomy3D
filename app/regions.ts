import {termKey} from './names.ts';
import type {Atlas,Box,Part} from './anatomy';
/** Body regions for physical therapy. Each box is built from the bones that define the region, so it follows the model
 * instead of hard-coded coordinates. Patient's left is +x, front is +z, feet are at y = 0. */
export type RegionId='neck'|'tmj'|'thoracic'|'lumbar'|'shoulder'|'elbow'|'wrist'|'hip'|'knee'|'ankle';
export type Side='left'|'right';
/** look is the camera direction for the patient's right side (x is mirrored for the left). */
export const REGIONS:{id:RegionId;name:string;sided:boolean;look:number[]}[]=[
 {id:'neck',name:'頸椎',sided:false,look:[-.7,.15,1]},{id:'tmj',name:'顳顎關節',sided:false,look:[-1,.1,.25]},{id:'thoracic',name:'胸椎與肋骨',sided:false,look:[-.35,.12,1]},{id:'lumbar',name:'腰椎與骨盆',sided:false,look:[-.45,.2,-1]},
 {id:'shoulder',name:'肩',sided:true,look:[-.7,.2,1]},{id:'elbow',name:'肘',sided:true,look:[-.5,.1,1]},{id:'wrist',name:'腕與手',sided:true,look:[-.3,.05,1]},
 {id:'hip',name:'髖',sided:true,look:[-.8,.15,1]},{id:'knee',name:'膝',sided:true,look:[-.45,.1,1]},{id:'ankle',name:'踝與足',sided:true,look:[-.9,.35,.8]},
];
export const regionLook=(id:RegionId,side:Side)=>{const r=REGIONS.find(x=>x.id===id)!;return side==='left'&&r.sided?[-r.look[0],r.look[1],r.look[2]]:r.look;};
export type AreaId='upper'|'lower'|'head-neck'|'trunk'|'upper-limb'|'lower-limb';
/** Large body areas. They show whole structures (app/area-members.json, from scripts/compute-area-members.mjs) instead of
 * cutting along a box: the arms hang beside the pelvis and thighs, so no box separates them. */
export const AREAS:{id:AreaId;name:string;sided:boolean;look:number[]}[]=[
 {id:'upper',name:'上半身',sided:false,look:[-.35,.08,1]},{id:'lower',name:'下半身',sided:false,look:[-.35,.08,1]},
 {id:'head-neck',name:'頭頸',sided:false,look:[-.6,.1,1]},{id:'trunk',name:'軀幹',sided:false,look:[-.35,.1,1]},
 {id:'upper-limb',name:'上肢',sided:true,look:[-.8,.12,1]},{id:'lower-limb',name:'下肢',sided:true,look:[-.55,.1,1]},
];
/** One key per area and side, in the bit order of app/area-members.json. */
export const AREA_KEYS=AREAS.flatMap(a=>a.sided?[`${a.id}:left`,`${a.id}:right`]:[a.id]);
export const isArea=(id:string):id is AreaId=>AREAS.some(a=>a.id===id);
export const areaKey=(id:AreaId,side:Side)=>AREAS.find(a=>a.id===id)!.sided?`${id}:${side}`:id;
export const areaLook=(id:AreaId,side:Side)=>{const a=AREAS.find(x=>x.id===id)!;return side==='left'&&a.sided?[-a.look[0],a.look[1],a.look[2]]:a.look;};
/** The parts of an area, and the box of its bones for framing the camera. */
export function areaParts(atlas:Atlas,data:{keys:string[];members:Record<string,number>},id:AreaId,side:Side):{parts:Set<string>;box:Box}|null{
 const bit=data.keys.indexOf(areaKey(id,side));if(bit<0)return null;
 const parts=new Set<string>(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const p of atlas.parts){
  if(!((data.members[p.id]??0)&(1<<bit)))continue;parts.add(p.id);
  if(p.system==='skeletal')for(let i=0;i<3;i++){min[i]=Math.min(min[i],p.bounds[0][i]);max[i]=Math.max(max[i],p.bounds[1][i]);}
 }
 if(!parts.size||!Number.isFinite(min[0]))return null;
 return {parts,box:[min.map(v=>+(v-.02).toFixed(4)),max.map(v=>+(v+.02).toFixed(4))]};
}
const CARPALS=['scaphoid','lunate','triquetral','pisiform','trapezium','trapezoid','capitate','hamate'];
const FOOT=['talus','calcaneus','navicular bone of foot','cuboid bone','medial cuneiform bone','intermediate cuneiform bone','lateral cuneiform bone','sesamoid bone of foot'];
const sideOf=(p:Part):Side|null=>/\bleft\b/i.test(p.name)?'left':/\bright\b/i.test(p.name)?'right':null;
type Pick=(term:string)=>boolean;
/** A landmark is a set of bones, optionally trimmed to the top or bottom fraction of their height. */
interface Landmark {pick:Pick;top?:number;bottom?:number}
const named=(...terms:string[]):Pick=>term=>terms.includes(term);
const matching=(pattern:RegExp):Pick=>term=>pattern.test(term);
const RECIPES:Record<RegionId,{landmarks:Landmark[];pad:number[]}>={
 neck:{landmarks:[{pick:matching(/^(atlas|axis|(third|fourth|fifth|sixth|seventh) cervical vertebra|hyoid bone)$/)}],pad:[.035,.02,.03]},
 tmj:{landmarks:[{pick:named('mandible')},{pick:named('temporal bone'),bottom:.45}],pad:[.012,.012,.018]},
 thoracic:{landmarks:[{pick:matching(/(thoracic vertebra|\brib|costal cartilage)$|^(manubrium|body of sternum|xiphoid process)$/)}],pad:[.025,.015,.025]},
 lumbar:{landmarks:[{pick:matching(/(lumbar vertebra)$|^(sacrum|hip bone)$/)}],pad:[.03,.02,.035]},
 shoulder:{landmarks:[{pick:named('scapula','clavicle')},{pick:named('humerus'),top:.28}],pad:[.035,.035,.035]},
 elbow:{landmarks:[{pick:named('humerus'),bottom:.16},{pick:named('radius','ulna'),top:.2}],pad:[.03,.02,.03]},
 wrist:{landmarks:[{pick:term=>CARPALS.includes(term)||/metacarpal bone$|phalanx of (thumb|index finger|middle finger|ring finger|little finger)$/.test(term)},{pick:named('radius','ulna'),bottom:.15}],pad:[.02,.015,.02]},
 hip:{landmarks:[{pick:named('hip bone')},{pick:named('femur'),top:.2}],pad:[.03,.025,.035]},
 knee:{landmarks:[{pick:named('femur'),bottom:.16},{pick:named('tibia','fibula'),top:.16},{pick:named('patella')}],pad:[.035,.015,.035]},
 ankle:{landmarks:[{pick:term=>FOOT.includes(term)||/metatarsal bone$|phalanx of (big toe|second toe|third toe|fourth toe|little toe)$/.test(term)},{pick:named('tibia','fibula'),bottom:.14}],pad:[.02,.02,.02]},
};
/** The bones that define a region, each with the part of its bounds (top or bottom fraction) that counts. */
export function regionLandmarks(atlas:Atlas,id:RegionId,side:Side):{part:Part;box:Box}[]{
 const sided=REGIONS.find(r=>r.id===id)!.sided,found:{part:Part;box:Box}[]=[];
 for(const landmark of RECIPES[id].landmarks)for(const p of atlas.parts){
  if(!landmark.pick(termKey(p.name)))continue;const s=sideOf(p);if(sided&&s!==side)continue;
  const lo=[...p.bounds[0]],hi=[...p.bounds[1]],height=hi[1]-lo[1];
  if(landmark.top)lo[1]=hi[1]-height*landmark.top;if(landmark.bottom)hi[1]=lo[1]+height*landmark.bottom;
  found.push({part:p,box:[lo,hi]});
 }
 return found;
}
export function regionBox(atlas:Atlas,id:RegionId,side:Side):Box|null{
 const pad=RECIPES[id].pad,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const {box:[lo,hi]} of regionLandmarks(atlas,id,side))for(let i=0;i<3;i++){min[i]=Math.min(min[i],lo[i]);max[i]=Math.max(max[i],hi[i]);}
 if(!Number.isFinite(min[0]))return null;
 return [min.map((v,i)=>+(v-pad[i]).toFixed(4)),max.map((v,i)=>+(v+pad[i]).toFixed(4))];
}
