import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AREAS,AREA_KEYS,REGIONS,areaParts,regionBox} from '../app/regions.ts';

const atlas=JSON.parse(await readFile(new URL('../public/models/atlas.json',import.meta.url)));
const lines=[];
for(const region of REGIONS)for(const side of region.sided?['left','right']:['left']){
 const box=regionBox(atlas,region.id,side);
 assert.ok(box,`${region.name} has no landmark bones`);
 const size=box[1].map((v,i)=>v-box[0][i]);
 assert.ok(size.every(s=>s>.04&&s<.75),`${region.name} box has an implausible size ${size}`);
 // Patient's left is +x: one-sided regions sit on their own side of the midline.
 const centerX=(box[0][0]+box[1][0])/2;
 if(region.sided)assert.ok(side==='left'?centerX>.03:centerX<-.03,`${region.name} (${side}) is on the wrong side: ${centerX}`);
 const parts=atlas.parts.filter(p=>p.bounds[0].every((v,i)=>v<=box[1][i]&&p.bounds[1][i]>=box[0][i])).length;
 assert.ok(parts>=10,`${region.name} contains only ${parts} parts`);
 lines.push(`${region.name}${region.sided?(side==='left'?'(左)':'(右)'):''} ${size.map(s=>(s*100).toFixed(0)).join('×')}cm ${parts} parts`);
}
console.log(`Regions: ${lines.join(' · ')}`);

// Region membership (app/region-members.json): known parts and regions, defining bones inside their regions, and textbook spot checks.
const {members}=JSON.parse(await readFile(new URL('../app/region-members.json',import.meta.url)));
const byName=new Map(atlas.parts.map(p=>[p.name.toLowerCase(),p])),ids=new Set(atlas.parts.map(p=>p.id)),regionIds=new Set(REGIONS.map(r=>r.id));
for(const [id,list] of Object.entries(members)){assert.ok(ids.has(id),`Region members name an unknown part ${id} (rerun npm run members)`);assert.ok(list.length&&list.every(r=>regionIds.has(r)),`${id} has unknown regions ${list}`);}
const expect={'right femur':['hip','knee'],'right sternocleidomastoid':['neck'],'right supraspinatus':['shoulder'],'right gluteus medius':['hip'],
 'right vastus medialis':['knee'],'right tibialis anterior':['knee','ankle'],'right flexor digitorum profundus':['elbow','wrist'],'fifth lumbar vertebra':['lumbar'],
 // Z-Anatomy structures (batch 04).
 'right medial meniscus':['knee'],'right lateral meniscus':['knee'],'right anterior cruciate ligament':['knee'],'right posterior cruciate ligament':['knee'],
 'right fibular collateral ligament':['knee'],'right superficial part of tibial collateral ligament':['knee'],'right multifidus lumborum':['lumbar'],
 'right quadratus lumborum':['lumbar'],'superficial part of right masseter':['tmj'],'right temporalis':['tmj'],'inferior head of right lateral pterygoid':['tmj'],
 'right articular disc of temporomandibular joint':['tmj'],'right latissimus dorsi':['shoulder','lumbar'],'right acetabular labrum':['hip'],
 'right glenoid labrum':['shoulder'],'right anterior talofibular ligament':['ankle'],'right sciatic nerve':['hip'],'right median nerve':['elbow'],'cauda equina':['lumbar']};
for(const [name,regions] of Object.entries(expect)){const p=byName.get(name);assert.ok(p,`Missing ${name}`);for(const r of regions)assert.ok(members[p.id]?.includes(r),`${name} should belong to ${r} (has ${members[p.id]})`);}
console.log(`Region members: ${Object.keys(members).length} parts belong to at least one region; spot checks passed.`);

// Large areas (app/area-members.json): bit order, known parts, both sides alike, and textbook members. The hand hangs beside
// the thigh, so the checks include structures a box could not separate.
const areas=JSON.parse(await readFile(new URL('../app/area-members.json',import.meta.url)));
assert.deepEqual(areas.keys,AREA_KEYS,'app/area-members.json was made for other areas (rerun npm run members)');
for(const id of Object.keys(areas.members))assert.ok(ids.has(id),`Area members name an unknown part ${id} (rerun npm run members)`);
const inArea=(name,key)=>{const p=byName.get(name);assert.ok(p,`Missing ${name}`);return !!(areas.members[p.id]&(1<<areas.keys.indexOf(key)));};
const areaLines=[];
for(const area of AREAS)for(const side of area.sided?['left','right']:['right']){
 const found=areaParts(atlas,areas,area.id,side);assert.ok(found,`${area.name} has no parts`);
 const size=found.box[1].map((v,i)=>v-found.box[0][i]);areaLines.push(`${area.name}${area.sided?(side==='left'?'(左)':'(右)'):''} ${found.parts.size}`);
 assert.ok(size.every(s=>s>.1&&s<2),`${area.name} frame has an implausible size ${size}`);
 if(area.sided){const centerX=(found.box[0][0]+found.box[1][0])/2;assert.ok(side==='left'?centerX>.05:centerX<-.05,`${area.name} (${side}) is framed on the wrong side`);}
}
for(const id of ['upper-limb','lower-limb']){const [l,r]=['left','right'].map(s=>areaParts(atlas,areas,id,s).parts.size);assert.ok(Math.abs(l-r)<=Math.max(l,r)*.05,`${id}: left ${l} and right ${r} parts differ too much`);}
const expectAreas={
 'upper-limb:right':{yes:['right humerus','right scapula','right clavicle','distal phalanx of right index finger','right latissimus dorsi','descending part of right trapezius','right pectoralis minor','right serratus anterior','right rhomboid major','right levator scapulae','right supraspinatus','right median nerve','right roots of brachial plexus','right subclavian artery','right axillary artery'],
  no:['left humerus','right femur','manubrium','external intercostal muscle','right iliocostalis thoracis','right sternocleidomastoid','right common carotid artery','right brachiocephalic vein','caudate lobe of liver']},
 'lower-limb:right':{yes:['right femur','right hip bone','right gluteus maximus','right gluteus medius','right psoas major','right iliacus','right piriformis','right tensor fasciae latae','right rectus femoris','long head of right biceps femoris','right sciatic nerve','right femoral nerve','right superior gluteal nerve','right femoral artery','right great saphenous vein','right medial meniscus','right anterior cruciate ligament'],
  no:['left femur','sacrum','urinary bladder','prostate','right ureter','right iliococcygeus','right external oblique','right latissimus dorsi','distal phalanx of right index finger']},
 upper:{yes:['right humerus','distal phalanx of right index finger','fifth lumbar vertebra','mandible','caudate lobe of liver','wall of left atrium','stomach','pons','right psoas major','right latissimus dorsi','right rectus abdominis'],
  no:['sacrum','right hip bone','right femur','urinary bladder','right gluteus maximus','right rectus femoris']},
 lower:{yes:['sacrum','right hip bone','right femur','urinary bladder','prostate','right psoas major','right gluteus maximus','right rectus femoris','right sciatic nerve'],
  no:['fifth lumbar vertebra','caudate lobe of liver','right humerus','distal phalanx of right index finger','right latissimus dorsi','right external oblique','right rectus abdominis']},
 'head-neck':{yes:['mandible','atlas','hyoid bone','pons','right temporalis','right sternocleidomastoid','right internal jugular vein'],
  no:['first thoracic vertebra','wall of left atrium','right humerus','stomach']},
 trunk:{yes:['first thoracic vertebra','fifth lumbar vertebra','sacrum','right hip bone','caudate lobe of liver','wall of left atrium','urinary bladder','right psoas major','right iliacus','right rectus abdominis','right latissimus dorsi','right iliococcygeus','right gluteus maximus'],
  no:['right femur','right humerus','mandible','pons','right gluteus medius','right subscapularis','right rectus femoris','right tensor fasciae latae']},
};
for(const [key,{yes,no}] of Object.entries(expectAreas)){
 for(const name of yes)assert.ok(inArea(name,key),`${name} should be in ${key}`);
 for(const name of no)assert.ok(!inArea(name,key),`${name} should not be in ${key}`);
}
console.log(`Areas: ${areaLines.join(' · ')}; spot checks passed.`);
