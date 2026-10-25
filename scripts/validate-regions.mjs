import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {REGIONS,regionBox} from '../app/regions.ts';

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
