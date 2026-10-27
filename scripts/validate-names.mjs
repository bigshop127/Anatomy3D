import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNamer,termKey} from '../app/names.ts';

// The body model, the high-detail knee and the female model share one dictionary.
const atlases=await Promise.all(['atlas.json','knee/atlas.json','female/atlas.json'].map(async f=>JSON.parse(await readFile(new URL(`../public/models/${f}`,import.meta.url)))));
const data=JSON.parse(await readFile(new URL('../app/names.zh-TW.json',import.meta.url)));
const namer=createNamer(data);
const names=[...new Set(atlases.flatMap(atlas=>[...atlas.parts.map(p=>p.name),...atlas.concepts.map(c=>c.name)]))];

const missing=names.filter(n=>!namer.zh(n));
assert.deepEqual(missing,[],`Names without a Chinese translation: ${missing.slice(0,10).join(', ')}`);
for(const n of names){
 const zh=namer.zh(n);
 assert.match(zh,/\p{Script=Han}/u,`Translation has no Chinese characters: ${n} → ${zh}`);
 assert.doesNotMatch(zh.replace(/[IVX]+|[CTLS]\d+/g,''),/[a-z]/i,`Translation still contains English: ${n} → ${zh}`);
}

const usedTerms=new Set(names.map(termKey)),lowerNames=new Set(names.map(n=>n.toLowerCase()));
const unusedTerms=Object.keys(data.terms).filter(k=>!usedTerms.has(k));
assert.deepEqual(unusedTerms,[],`Terms no structure uses: ${unusedTerms.join(', ')}`);
const unusedOverrides=Object.keys(data.overrides).filter(k=>!lowerNames.has(k));
assert.deepEqual(unusedOverrides,[],`Overrides no structure uses: ${unusedOverrides.join(', ')}`);
const unknownReviewed=data.reviewed.filter(k=>!(k in data.terms)&&!(k in data.overrides));
assert.deepEqual(unknownReviewed,[],`Reviewed keys that are not terms: ${unknownReviewed.join(', ')}`);

assert.equal(namer.zh('Left femur'),'左股骨');
assert.equal(namer.zh('Articular cartilage of lateral condyle of right tibia'),'右脛骨外髁關節軟骨');
assert.equal(namer.zh('Right upper lobe of lung'),'右肺上葉');
assert.equal(namer.zh('right anterior branch of anterior interventricular branch of left coronary artery'),'左冠狀動脈前室間支右前支');

console.log(`Chinese names: ${names.length} structure names covered by ${Object.keys(data.terms).length} terms and ${Object.keys(data.overrides).length} overrides; ${data.reviewed.length} reviewed.`);
