import type {Atlas,Box} from './anatomy';
import type {Side} from './regions';
/** The models the app can show: the (male) body, the female body (HRA reference organs, built by scripts/build-female.mjs), or
 * the high-detail knee (SPL Knee Atlas, built by scripts/build-knee.mjs). */
export type Model={id:'body'}|{id:'female'}|{id:'knee';side:Side};
export const BODY:Model={id:'body'},FEMALE:Model={id:'female'};
export const modelKey=(m:Model)=>m.id==='knee'?`knee-${m.side}`:m.id;
export const modelPath=(m:Model)=>m.id==='knee'?'models/knee/atlas.json':m.id==='female'?'models/female/atlas.json':'models/atlas.json';
const swapSide=(name:string)=>name.replace(/\b(left|right)\b/gi,w=>{const to=/^l/i.test(w)?'right':'left';return w[0]===w[0].toUpperCase()?to[0].toUpperCase()+to.slice(1):to;});
const mirrorBox=([lo,hi]:Box|[number[],number[]]):[number[],number[]]=>[[-hi[0],lo[1],lo[2]],[-lo[0],hi[1],hi[2]]];
/** The other side's copy of a one-sided model: names change side and boxes flip across the midline; mirrored tells the scene
 * to flip the geometry as it decodes it (app/model-decode.ts mirrorGeometry). */
export function mirrorAtlas(atlas:Atlas){
 for(const p of atlas.parts){p.name=swapSide(p.name);p.bounds=mirrorBox(p.bounds);}
 for(const c of atlas.concepts)c.name=swapSide(c.name);
 atlas.side=atlas.side==='left'?'right':'left';atlas.mirrored=true;
}
