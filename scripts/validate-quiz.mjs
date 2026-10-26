import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {termKey,createNamer} from '../app/names.ts';
import {indexCards} from '../app/muscle-cards.ts';
import {fixSystems} from '../app/system-fixes.ts';
import {regionBox} from '../app/regions.ts';
import {FIND_MIN,NAME_MIN,QUESTION_TYPES,QUIZ_ACTIONS,actionName,answerView,cardActions,isRight,makeRound,mightDo,questionCounts,questionView,quizItems,readSettings,recordAnswer,relatedNerves,weakRecords} from '../app/quiz.ts';

// Quiz mode (app/quiz.ts): the scope keeps questions where they belong, every multiple-choice question has exactly one right
// answer, and wrong answers are clear of the right one (no branch of the right nerve, no muscle that also does the movement).
const read=path=>readFile(new URL(path,import.meta.url),'utf8').then(JSON.parse);
const atlas=await read('../public/models/atlas.json'),layers=(await read('../app/muscle-layers.json')).layers;
fixSystems(atlas);atlas.parts.forEach(p=>{p.layer=layers[p.id];});
const namer=createNamer(await read('../app/names.zh-TW.json')),cards=indexCards(await read('../app/muscle-cards.json'));
const membership={regions:(await read('../app/region-members.json')).members,areas:await read('../app/area-members.json')};
const label=term=>namer.zh(term);
const byId=new Map(atlas.parts.map(p=>[p.id,p]));
const ALL=['skeletal','muscular','connective','nervous','vessels','organs'];
const pools=(settings)=>({items:quizItems(atlas,cards,{systems:ALL,scope:null,depth:'all',...settings},membership,label),cards});
/** A small seeded generator, so a failure can be repeated. */
const seeded=seed=>()=>{seed|=0;seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const names=item=>Object.values(item.parts).flat().map(id=>byId.get(id).name.toLowerCase());

// Items: one per Chinese name and system, every part in the scope, nothing left without a name.
const whole=pools({});
const seen=new Set();
for(const i of whole.items){
 const id=`${i.system}|${i.label}`;assert.ok(!seen.has(id),`Two items named ${i.label}`);seen.add(id);
 assert.ok(Object.values(i.parts).flat().length,`${i.label} has no parts`);assert.match(i.label,/\p{Script=Han}/u);
 for(const ids of Object.values(i.parts))for(const p of ids)assert.equal(byId.get(p).system,i.system,`${i.label} mixes systems`);
}
const counts=questionCounts(whole);
for(const t of QUESTION_TYPES)assert.ok(counts[t.id]>20,`Few ${t.name} questions for the whole body: ${counts[t.id]}`);
assert.ok(!whole.items.some(i=>i.size>=FIND_MIN&&names(i).some(n=>n.startsWith('nucleus pulposus c3'))),'A tiny disc nucleus is in the find pool');
console.log(`Quiz items (whole body): ${whole.items.length}; questions by type: ${QUESTION_TYPES.map(t=>`${t.name} ${counts[t.id]}`).join(' · ')}.`);

// Scopes: a joint region only asks about what it shows, a limb about its own side, depth about its layers.
const knee=pools({scope:{id:'knee',side:'right'},systems:['skeletal','muscular','connective']});
const kneeNames=knee.items.flatMap(names);
for(const n of ['right femur','right patella','right popliteus','right medial meniscus','right anterior cruciate ligament'])assert.ok(kneeNames.includes(n),`Right knee quiz misses ${n}`);
for(const n of kneeNames)assert.ok(!/\bleft\b/.test(n)&&!/humerus|scapula|vertebra|skull|radius/.test(n),`Right knee quiz asks about ${n}`);
const arm=pools({scope:{id:'upper-limb',side:'left'}});
assert.ok(arm.items.length>50&&arm.items.every(i=>names(i).every(n=>!/\bright\b/.test(n))),'Left upper limb quiz has right-side parts');
assert.ok(arm.items.some(i=>i.label==='肱二頭肌'),'Left upper limb quiz misses the biceps card');
const shallow=pools({systems:['muscular'],depth:'superficial'}),deep=pools({systems:['muscular'],depth:'deep'});
assert.ok(shallow.items.every(i=>i.layer>=1&&i.layer<=2)&&deep.items.every(i=>i.layer>=3),'Depth filter lets other layers through');
assert.ok(shallow.items.some(i=>i.label==='闊背肌')&&deep.items.some(i=>i.label==='多裂肌')&&!shallow.items.some(i=>i.label==='多裂肌'),'Depth filter puts known muscles in the wrong layer');
console.log(`Scopes: right knee ${knee.items.length} items, left upper limb ${arm.items.length}, superficial muscles ${shallow.items.length}, deep ${deep.items.length}.`);

// Actions: right answers say the movement in 主要作用, wrong answers may not do it at all.
const cardBy=new Map(cards.cards.map(c=>[c.zh,c])),acts=new Map(cards.cards.map(c=>[c.id,cardActions(c)]));
const doers=key=>cards.cards.filter(c=>acts.get(c.id).primary.has(key)).map(c=>c.zh).sort();
assert.deepEqual(doers('髖|外展'),['臀中肌','臀小肌','闊筋膜張肌'].sort());
assert.deepEqual(doers('前臂|旋後'),['旋後肌','肱二頭肌'].sort(),'Brackets or a joint after them were read as an action');
assert.deepEqual(doers('下頷|上提'),['咬肌','翼內肌','顳肌'].sort(),'閉口時 is a condition, not an action');
assert.deepEqual(doers('足|內翻'),['脛前肌','脛後肌'].sort());
assert.ok(doers('肘|屈曲').includes('肱橈肌')&&!doers('前臂|旋前').includes('肱肌'));
for(const [zh,key] of [['股直肌','髖|外展'],['縫匠肌','髖|外旋'],['腹內斜肌','軀幹|對側旋轉'],['肱橈肌','前臂|旋前'],['胸鎖乳突肌','頸部|伸展'],['翼外肌','下頷|上提']])
 assert.ok(mightDo(acts.get(cardBy.get(zh).id),key),`${zh} could be offered as not doing ${actionName(key)}`);
console.log(`Actions: ${QUIZ_ACTIONS.filter(k=>doers(k).length).length} of ${QUIZ_ACTIONS.length} joint movements have a muscle whose card names them.`);

// Nerves: branches and the nerves they come from count as the same answer.
for(const [a,b] of [['tibial nerve','sciatic nerve'],['deep fibular nerve','sciatic nerve'],['median nerve','roots of brachial plexus'],['axillary nerve','posterior cord of brachial plexus']])
 assert.ok(relatedNerves(a).has(b)&&relatedNerves(b).has(a),`${a} and ${b} should be related`);
assert.ok(!relatedNerves('tibial nerve').has('common fibular nerve'),'Sibling branches are not the same nerve');

// Rounds: right size, one right answer per question, wrong answers clear of it, and the views show the right structures.
const pool=pools({}),types=QUESTION_TYPES.map(t=>t.id),tally={};
for(let seed=1;seed<=60;seed++){
 const round=makeRound(pool,types,20,seeded(seed));
 assert.equal(round.length,20);assert.equal(new Set(round.map(q=>q.key)).size,20,'A round asks the same question twice');
 for(const q of round){
  tally[q.type]=(tally[q.type]??0)+1;
  assert.ok(q.item.parts[q.side]?.length,`${q.title}: nothing to show on side '${q.side}'`);
  const qv=questionView(atlas,q,{box:[[0,0,0],[1,1,1]],look:[0,0,1]});
  if(q.type==='find'){assert.ok(q.item.size>=FIND_MIN);assert.equal(qv.selected.length,0,'A find question shows its answer');assert.ok(isRight(q,q.item.parts[q.side][0]));
   const wrongPart=atlas.parts.find(p=>p.system===q.item.system&&!isRight(q,p.id));assert.ok(!isRight(q,wrongPart.id));
   const av=answerView(atlas,q,{correct:false,tapped:{id:wrongPart.id,label:'x'}});assert.equal(av.pins.length,2);assert.ok(av.selected.every(id=>isRight(q,id)));continue;}
  assert.equal(q.options.length,4);assert.equal(new Set(q.options.map(o=>o.label)).size,4,`${q.title}: repeated options`);
  assert.equal(q.options.filter(o=>o.correct).length,1);assert.equal(q.options.find(o=>o.correct).label,q.answer);
  const wrong=q.options.filter(o=>!o.correct).map(o=>o.label);
  if(q.type==='name'){assert.ok(q.item.size>=NAME_MIN);assert.deepEqual(qv.selected,q.item.parts[q.side]);}
  if(q.type==='action'){const key=q.key.slice(7);assert.ok(acts.get(q.item.card.id).primary.has(key));for(const w of wrong)assert.ok(!mightDo(acts.get(cardBy.get(w).id),key),`${w} is offered as not doing ${q.subject}`);assert.equal(qv.selected.length,0,'An action question shows its answer');}
  if(q.type==='nerve'&&!q.nerveFirst){
   const card=q.item.card,related=new Set(card.innervation.flatMap(n=>n.term?[...relatedNerves(n.term)]:[]));
   assert.ok(card.innervation.some(n=>n.nerve===q.answer));
   for(const w of wrong){assert.ok(!card.innervation.some(n=>n.nerve===w),`${w} supplies ${card.zh}`);const term=cards.cards.flatMap(c=>c.innervation).find(n=>n.nerve===w)?.term;assert.ok(!term||!related.has(term),`${w} is a branch of the nerve of ${card.zh}`);}
  }
  if(q.type==='nerve'&&q.nerveFirst){
   const related=relatedNerves(q.nerve);assert.ok(q.item.card.innervation.some(n=>n.term===q.nerve));
   for(const w of wrong)assert.ok(!cardBy.get(w).innervation.some(n=>n.term&&related.has(n.term)),`${w} is supplied by ${q.subject} or a branch of it`);
   assert.ok(qv.selected.every(id=>byId.get(id).system==='nervous'),'A nerve question shows the muscle before the answer');
  }
  const av=answerView(atlas,q,{correct:true,picked:q.answer});assert.ok(av.selected.some(id=>isRight(q,id)));
 }
}
assert.ok(types.every(t=>tally[t]>100),`Types are not mixed: ${JSON.stringify(tally)}`);
const tiny=makeRound(knee,['find','name'],20,seeded(7));assert.ok(tiny.length>=10,`Right knee gives only ${tiny.length} questions`);
// A part of the same structure outside the scope's list (here the left one) still counts when the names are given.
const femur=makeRound(knee,['find'],60,seeded(8)).find(q=>q.title==='股骨'),leftFemur=atlas.parts.find(p=>p.name.toLowerCase()==='left femur');
assert.ok(femur&&!isRight(femur,leftFemur.id)&&isRight(femur,leftFemur.id,atlas,cards,label),'A same-name part does not count');
assert.ok(!isRight(femur,atlas.parts.find(p=>p.name.toLowerCase()==='right tibia').id,atlas,cards,label),'Another bone counts as the femur');
// A joint region cuts the model along its box, so an answer frames and labels only what is inside it.
const kneeBox=regionBox(atlas,'knee','right'),inBox=pt=>pt.every((v,i)=>v>=kneeBox[0][i]-1e-3&&v<=kneeBox[1][i]+1e-3);
const tibia=makeRound(knee,['find'],60,seeded(8)).find(q=>q.title==='脛骨'),kneeMid=kneeBox[0].map((v,i)=>(v+kneeBox[1][i])/2);
const kneeViews=[answerView(atlas,tibia,{correct:false,tapped:{id:atlas.parts.find(p=>p.name.toLowerCase()==='right femur').id,label:'右股骨',point:kneeMid}},kneeBox),
 ...makeRound(knee,types,40,seeded(9)).map(q=>answerView(atlas,q,{correct:false},kneeBox))];
assert.equal(kneeViews[0].pins.length,2);
for(const v of kneeViews){for(const p of v.pins)assert.ok(inBox(p.point),`A label (${p.label}) sits outside the knee`);if(v.frame)assert.ok(v.frame.every(inBox),'An answer frames more than the knee');}
const again=makeRound(pool,types,20,seeded(3)).slice(0,5),only=new Set(again.map(q=>q.key)),retry=makeRound(pool,types,20,seeded(4),only);
assert.equal(retry.length,5);assert.ok(retry.every(q=>only.has(q.key)),'Going over wrong answers asks something else');
console.log(`Rounds: 60 seeded rounds of 20 checked (${QUESTION_TYPES.map(t=>`${t.name} ${tally[t.id]}`).join(' · ')}); going over wrong answers repeats only those.`);

// The record: stored settings are checked, answers count up, and the weakest come first.
assert.deepEqual(readSettings({types:['find','bogus'],systems:[],scope:{id:'mars',side:'left'},depth:'x',count:7}),{types:['find'],systems:['skeletal','muscular'],scope:null,depth:'all',count:20});
assert.deepEqual(readSettings({scope:{id:'knee',side:'left'},count:10,depth:'deep'}).scope,{id:'knee',side:'left'});
let log={settings:readSettings(null),records:{},rounds:[]};const [q1,q2]=again;
log=recordAnswer(log,q1,false,1);log=recordAnswer(log,q1,false,2);log=recordAnswer(log,q2,false,3);log=recordAnswer(log,q2,true,4);
assert.deepEqual(log.records[q1.key],{title:q1.title,type:q1.type,right:0,wrong:2,at:2});
assert.deepEqual(weakRecords(log).map(([k])=>k),[q1.key,q2.key]);
console.log('Quiz record checks passed.');
