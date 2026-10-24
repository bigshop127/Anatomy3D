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
