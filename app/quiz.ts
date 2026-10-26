import {termKey} from './names.ts';
import {NERVE_BRANCHES,nerveParent,nerveTree,type CardIndex,type MuscleCard} from './muscle-cards.ts';
import {REGIONS,areaKey,isArea,regionBox,type AreaId,type RegionId,type Side} from './regions.ts';
import type {Atlas,Box,Part,SystemId} from './anatomy';
/** Quiz mode (batch 07): questions drawn from the model and the muscle cards, and the record of answers kept on this device. */

export type QuestionType='find'|'name'|'nerve'|'action';
export const QUESTION_TYPES:{id:QuestionType;name:string;note:string;cards?:boolean}[]=[
 {id:'find',name:'看名稱點構造',note:'給名稱，在模型上點出來'},
 {id:'name',name:'看構造選名稱',note:'亮起一個構造，四選一'},
 {id:'nerve',name:'神經支配',note:'肌肉卡：神經和它支配的肌肉',cards:true},
 {id:'action',name:'肌肉作用',note:'肌肉卡：哪塊肌肉做這個動作',cards:true},
];
export type SystemGroup='skeletal'|'muscular'|'connective'|'nervous'|'vessels'|'organs';
export const SYSTEM_GROUPS:{id:SystemGroup;name:string;systems:SystemId[]}[]=[
 {id:'skeletal',name:'骨骼',systems:['skeletal']},{id:'muscular',name:'肌肉',systems:['muscular']},
 {id:'connective',name:'韌帶與關節',systems:['connective']},{id:'nervous',name:'神經',systems:['nervous']},
 {id:'vessels',name:'血管',systems:['arterial','venous']},
 {id:'organs',name:'器官',systems:['cardiac','respiratory','digestive','urinary','reproductive','endocrine','lymphatic','sensory']},
];
export type Depth='all'|'superficial'|'deep';
export const DEPTHS:{id:Depth;name:string}[]=[{id:'all',name:'全部'},{id:'superficial',name:'淺層（1–2 層）'},{id:'deep',name:'深層（3–5 層）'}];
export type Scope={id:RegionId|AreaId;side:Side}|null;
export interface QuizSettings {types:QuestionType[];systems:SystemGroup[];scope:Scope;depth:Depth;count:number}
export const COUNTS=[10,20];
export const DEFAULT_SETTINGS:QuizSettings={types:['find','name'],systems:['skeletal','muscular'],scope:null,depth:'all',count:20};
/** Structures smaller than this (the largest side of what the scope shows) are left out: too small to tap on a phone, or to see. */
export const FIND_MIN=.015,NAME_MIN=.008;
export const QUIZ_XRAY=.7;

export type Rng=()=>number;
const shuffle=<T>(list:readonly T[],rng:Rng)=>{const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const pick=<T>(list:readonly T[],rng:Rng)=>list[Math.floor(rng()*list.length)];
/** Takes n distinct entries from the groups in order of preference, at random within each group. */
function takeFrom<T>(groups:T[][],n:number,rng:Rng,key:(t:T)=>string){
 const out:T[]=[],seen=new Set<string>();
 for(const g of groups)for(const t of shuffle(g,rng)){if(out.length>=n)return out;const k=key(t);if(!seen.has(k)){seen.add(k);out.push(t);}}
 return out;
}
const sideOf=(name:string)=>/\bleft\b/i.test(name)?'left':/\bright\b/i.test(name)?'right':'';
const clip=(a:Box,b:Box):Box|null=>{const lo=a[0].map((v,i)=>Math.max(v,b[0][i])),hi=a[1].map((v,i)=>Math.min(v,b[1][i]));return lo.every((v,i)=>v<=hi[i])?[lo,hi]:null;};
const extent=(b:Box)=>Math.max(...b[1].map((v,i)=>v-b[0][i]));
export const union=(a:Box|undefined,b:Box):Box=>a?[a[0].map((v,i)=>Math.min(v,b[0][i])),a[1].map((v,i)=>Math.max(v,b[1][i]))]:[[...b[0]],[...b[1]]];
const center=(b:Box)=>b[0].map((v,i)=>(v+b[1][i])/2);
const distance=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

/** Which structures belong where: app/region-members.json (joint regions) and app/area-members.json (large areas). */
export interface Membership {regions:Record<string,string[]>;areas:{keys:string[];members:Record<string,number>}}
/** What of a part the scope shows: its bounds, cut to the box of a joint region, or null when it is outside the scope. */
export function scopeTest(atlas:Atlas,scope:Scope,m:Membership):(p:Part)=>Box|null{
 const whole=(p:Part)=>p.bounds as Box;
 if(!scope)return whole;
 if(isArea(scope.id)){const bit=m.areas.keys.indexOf(areaKey(scope.id,scope.side));return p=>bit>=0&&(m.areas.members[p.id]??0)&(1<<bit)?whole(p):null;}
 // A joint region cuts along its box: a structure counts when it belongs to the region and part of it is inside the box.
 const id=scope.id,sided=REGIONS.find(r=>r.id===id)?.sided,box=regionBox(atlas,id,scope.side);
 return p=>{if(!box||!m.regions[p.id]?.includes(id))return null;const s=sideOf(p.name);if(sided&&s&&s!==scope.side)return null;return clip(p.bounds as Box,box);};
}

/** One thing to ask about: a muscle card, or one structure name with both sides together. parts are the parts the scope shows
 * by side ('' for the midline), boxes what of them the scope shows; layer is the shallowest muscle layer (0 if none). */
export interface QuizItem {key:string;label:string;system:SystemId;card?:MuscleCard;parts:Record<string,string[]>;boxes:Record<string,Box>;size:number;layer:number}
/** The structures a quiz can ask about. label gives the Chinese name of a term; structures without one are left out, and
 * names that read the same in Chinese are one item. */
export function quizItems(atlas:Atlas,cards:CardIndex|null,settings:Pick<QuizSettings,'systems'|'scope'|'depth'>,m:Membership,label:(term:string)=>string|undefined):QuizItem[]{
 const systems=new Set(SYSTEM_GROUPS.filter(g=>settings.systems.includes(g.id)).flatMap(g=>g.systems)),shows=scopeTest(atlas,settings.scope,m);
 const items=new Map<string,QuizItem>();
 for(const p of atlas.parts){
  if(!systems.has(p.system))continue;const box=shows(p);if(!box)continue;
  const term=termKey(p.name),card=p.system==='muscular'?cards?.byTerm.get(term):undefined,name=card?.zh??label(term);
  if(!name||!/\p{Script=Han}/u.test(name))continue;
  const id=`${p.system}|${name}`;let item=items.get(id);
  if(!item){item={key:card?`card:${card.id}`:`term:${term}`,label:name,system:p.system,card,parts:{},boxes:{},size:0,layer:0};items.set(id,item);}
  const side=sideOf(p.name);(item.parts[side]??=[]).push(p.id);item.boxes[side]=union(item.boxes[side],box);
  if(p.system==='muscular'&&p.layer)item.layer=item.layer?Math.min(item.layer,p.layer):p.layer;
 }
 const list=[...items.values()];for(const i of list)i.size=Math.max(...Object.values(i.boxes).map(extent));
 return list.filter(i=>settings.depth==='all'||i.system!=='muscular'||(settings.depth==='superficial'?i.layer>0&&i.layer<=2:i.layer>=3));
}

// Muscle actions, read from the card text. The right answer must name the joint and the movement in 主要作用; a wrong answer
// must not do the movement at all, so anything close in either list (or a movement without a joint) keeps a card out of the
// wrong answers. Words follow the cards.
const JOINT_WORDS:[string,string][]=[['GH','GH'],['肩胛','肩胛'],['肩帶','肩胛'],['前臂','前臂'],['肘','肘'],['腕','腕'],['髖','髖'],['膝','膝'],['踝','踝'],['大拇趾','大拇趾'],['足','足'],
 ['軀幹','軀幹'],['脊椎','軀幹'],['腰椎','軀幹'],['胸椎','軀幹'],['頭頸','頸部'],['頸部','頸部'],['寰枕','寰枕'],['寰樞','寰樞'],['下頷','下頷'],['舌骨','舌骨'],['拇指','拇指'],['小指','小指']];
/** word, movement, and the joint for words that name both (張口 is the jaw going down). */
const MOVEMENT_WORDS:[string,string,string?][]=[['水平內收','水平內收'],['水平外展','水平外展'],['同側側屈','側屈'],['側屈','側屈'],['同側旋轉','同側旋轉'],['對側旋轉','對側旋轉'],['轉向對側','對側旋轉'],['旋轉','旋轉'],
 ['對側側移','對側側移'],['同側側移','同側側移'],['屈曲','屈曲'],['伸展','伸展'],['外展','外展'],['內收','內收'],['內旋','內旋'],['外旋','外旋'],['上提','上提'],['下壓','下壓'],['上旋','上旋'],['下旋','下旋'],
 ['前突','前突'],['後縮','後縮'],['前傾','前傾'],['後傾','後傾'],['旋前','旋前'],['旋後','旋後'],['橈偏','橈偏'],['尺偏','尺偏'],['背屈','背屈'],['蹠屈','蹠屈'],['內翻','內翻'],['外翻','外翻'],['對掌','對掌'],
 ['張口','下壓','下頷']];
const TOKEN=new RegExp([...JOINT_WORDS.map(w=>w[0]),...MOVEMENT_WORDS.map(w=>w[0])].sort((a,b)=>b.length-a.length).join('|'),'g');
const JOINT=new Map(JOINT_WORDS),MOVEMENT=new Map(MOVEMENT_WORDS.map(w=>[w[0],w]));
/** The actions a quiz asks about, by joint: the name shown, the movements, and words that mean the joint in card text. */
const ACTION_JOINTS:Record<string,{name:string;movements:string[];words:string[]}>={
 肩胛:{name:'肩胛',movements:['上提','下壓','後縮','前突','上旋','下旋'],words:['肩胛','肩帶']},
 GH:{name:'肩（GH）',movements:['屈曲','伸展','外展','內收','內旋','外旋','水平內收','水平外展'],words:['GH','肩']},
 肘:{name:'肘',movements:['屈曲','伸展'],words:['肘']},前臂:{name:'前臂',movements:['旋前','旋後'],words:['前臂']},
 腕:{name:'腕',movements:['屈曲','伸展','橈偏','尺偏'],words:['腕']},
 髖:{name:'髖',movements:['屈曲','伸展','外展','內收','內旋','外旋'],words:['髖']},膝:{name:'膝',movements:['屈曲','伸展','內旋','外旋'],words:['膝']},
 踝:{name:'踝',movements:['背屈','蹠屈'],words:['踝']},足:{name:'足',movements:['內翻','外翻'],words:['足']},
 軀幹:{name:'軀幹',movements:['屈曲','伸展','側屈','同側旋轉','對側旋轉'],words:['軀幹','脊椎','腰椎','胸椎']},
 頸部:{name:'頸部',movements:['屈曲','伸展','側屈','同側旋轉','對側旋轉'],words:['頸','頭']},
 下頷:{name:'下頷',movements:['上提','下壓','前突'],words:['下頷','口']},
};
/** Card words that may mean a movement, for keeping wrong answers clear (a rotation either way counts for both). */
const MOVEMENT_TEXT:Record<string,string[]>={同側旋轉:['旋轉','轉向'],對側旋轉:['旋轉','轉向'],上提:['上提','閉口'],下壓:['下壓','張口']};
/** Upper neck joints count as the neck when keeping wrong answers clear. */
const NECK_ALIAS:Record<string,string>={寰枕:'頸部',寰樞:'頸部'};
const ACTION_NAMES:Record<string,string>={'下頷|上提':'下頷上提（閉口）','下頷|下壓':'下頷下壓（張口）'};
export const QUIZ_ACTIONS=Object.entries(ACTION_JOINTS).flatMap(([joint,a])=>a.movements.map(m=>`${joint}|${m}`));
export const actionName=(key:string)=>{const [joint,movement]=key.split('|');return ACTION_NAMES[key]??`${ACTION_JOINTS[joint]?.name??joint}${movement}`;};
/** Pairs the parser reads wrongly from a card, removed from its right answers (card id → joint|movement). */
const NOT_ACTIONS:Record<string,string[]>={sternohyoid:['下頷|下壓']};
export interface CardActions {primary:Set<string>;loose:Set<string>;joints:Set<string>;text:string}
function readLines(lines:string[]){
 const pairs=new Set<string>(),jointless=new Set<string>(),joints=new Set<string>();
 for(const clause of lines.flatMap(l=>l.split(/[；;。]/))){
  const tokens=[...clause.matchAll(TOKEN)].map(m=>({word:m[0],index:m.index!,end:m.index!+m[0].length}));
  let current:string[]=[],lastEnd=0,lastJoint=false;
  tokens.forEach((t,k)=>{
   const joint=JOINT.get(t.word);
   // Joints listed with 、 share the movement after them: 頭頸、胸椎伸展.
   if(joint){joints.add(joint);current=lastJoint&&/^[、\s]*$/.test(clause.slice(lastEnd,t.index))?[...current,joint]:[joint];lastJoint=true;lastEnd=t.end;return;}
   const [,movement,fixed]=MOVEMENT.get(t.word)!,next=tokens[k+1],after=next&&JOINT.get(next.word);
   // A joint right after the movement is its object (上提下頷); otherwise the joint named before it in the clause.
   const target=fixed?[fixed]:after&&next.index===t.end?[after]:current;
   if(fixed)joints.add(fixed);
   if(target.length)target.forEach(j=>pairs.add(`${j}|${movement}`));else jointless.add(movement);
   lastJoint=false;lastEnd=t.end;
  });
 }
 return {pairs,jointless,joints};
}
export function cardActions(card:MuscleCard):CardActions{
 // Notes in brackets qualify an action (肘屈曲（不論前臂旋前或旋後…）), so they only count against wrong answers.
 const right=readLines(card.primary.map(l=>l.replace(/（[^）]*）/g,''))),primary=readLines(card.primary),secondary=readLines(card.secondary);
 const joints=new Set([...primary.joints,...secondary.joints]),loose=new Set([...primary.pairs,...secondary.pairs]);
 for(const m of [...primary.jointless,...secondary.jointless])for(const j of joints)loose.add(`${j}|${m}`);
 for(const key of [...loose]){const [j,m]=key.split('|');if(NECK_ALIAS[j])loose.add(`${NECK_ALIAS[j]}|${m}`);}
 const not=NOT_ACTIONS[card.id]??[];
 return {primary:new Set([...right.pairs].filter(k=>!not.includes(k))),loose,joints,text:[...card.primary,...card.secondary].join('；')};
}
/** Whether a card might do the action, so it cannot be a wrong answer for it. */
export function mightDo(a:CardActions,key:string){
 if(a.loose.has(key)||a.primary.has(key))return true;
 const [joint,movement]=key.split('|'),words=ACTION_JOINTS[joint]?.words??[joint];
 return (MOVEMENT_TEXT[movement]??[movement]).some(m=>a.text.includes(m))&&(!a.joints.size||words.some(w=>a.text.includes(w)));
}

// Nerves. A wrong answer may not be the nerve itself under another name, a branch of it, or the nerve it branches from.
const GENERIC=/(腹|背)枝|直接分支/;
const PARENTS=new Map<string,string[]>();
for(const [parent,children] of Object.entries(NERVE_BRANCHES))for(const c of children)PARENTS.set(c,[...(PARENTS.get(c)??[]),parent]);
export function relatedNerves(term:string){
 const out=nerveTree(term),queue=[term];
 while(queue.length){const t=queue.shift()!,up=[...(PARENTS.get(t)??[])],named=nerveParent(t);if(named)up.push(named);for(const p of up)if(!out.has(p)){out.add(p);queue.push(p);}}
 return out;
}
interface NerveName {name:string;term?:string;regions:Set<string>}
const nerveNames=new WeakMap<CardIndex,NerveName[]>();
function namesOf(index:CardIndex){
 let list=nerveNames.get(index);if(list)return list;
 const map=new Map<string,NerveName>();
 for(const c of index.cards)for(const n of c.innervation){const e=map.get(n.nerve)??{name:n.nerve,term:n.term,regions:new Set()};e.term??=n.term;e.regions.add(c.region);map.set(n.nerve,e);}
 list=[...map.values()];nerveNames.set(index,list);return list;
}
const overlapping=(a:string,b:string)=>a.includes(b)||b.includes(a);
/** Card regions next to each other: wrong answers come from the same region first, then from these. */
const NEAR:Record<string,string[]>={neck:['tmj','shoulder','trunk'],tmj:['neck'],shoulder:['neck','elbow'],elbow:['shoulder','wrist'],wrist:['elbow','shoulder'],trunk:['hip','neck'],hip:['knee','trunk'],knee:['hip','ankle'],ankle:['knee','hip']};
const nearby=(region:string)=>(r:string)=>NEAR[region]?.includes(r)??false;
/** Whether a card names the nerve, a branch of it or the nerve it comes from. */
const suppliedNear=(card:MuscleCard,name:string,related:Set<string>)=>card.innervation.some(n=>(n.term&&related.has(n.term))||overlapping(n.nerve,name));

export interface Option {label:string;correct:boolean}
export interface Question {type:QuestionType;
 /** What was asked, for the record: the same key asks the same question again. */ key:string;
 /** What was asked in a few words, for the record and the results. */ title:string;
 prompt:string;subject?:string;
 /** The structure to find or name, or the muscle of the card; side is the side shown. */ item:QuizItem;side:string;
 options?:Option[];answer:string;
 /** A nerve shown with the answer (the nerve of a card, or the nerve asked about). */ nerve?:string;
 /** The nerve is what the question shows, before the answer (which muscle does it supply). */ nerveFirst?:boolean}
const options=(right:string,wrong:string[],rng:Rng)=>shuffle([{label:right,correct:true},...wrong.map(label=>({label,correct:false}))],rng);
interface Candidate {key:string;item:string;make:(rng:Rng)=>Question|null}
export interface Pools {items:QuizItem[];cards:CardIndex|null}

function candidates(pools:Pools,type:QuestionType):Candidate[]{
 const {items,cards}=pools,sides=(i:QuizItem)=>Object.keys(i.parts);
 if(type==='find')return items.filter(i=>i.size>=FIND_MIN).map(item=>({key:`find:${item.key}`,item:item.key,make:rng=>({type,key:`find:${item.key}`,title:item.label,prompt:'在模型上點出',subject:item.label,item,side:pick(sides(item),rng),answer:item.label})}));
 if(type==='name'){
  const nameable=items.filter(i=>i.size>=NAME_MIN);
  return nameable.map(item=>({key:`name:${item.key}`,item:item.key,make:rng=>{
   // Wrong answers are the structures nearest to it, of the same system first.
   const side=pick(sides(item),rng),c=center(item.boxes[side]);
   const near=nameable.filter(o=>o.label!==item.label).map(o=>({o,d:Math.min(...Object.values(o.boxes).map(b=>distance(center(b),c)))})).sort((a,b)=>a.d-b.d);
   const wrong=takeFrom([near.filter(x=>x.o.system===item.system).slice(0,6),near.slice(0,6)],3,rng,x=>x.o.label).map(x=>x.o.label);
   return wrong.length<3?null:{type,key:`name:${item.key}`,title:item.label,prompt:'亮起來的構造是？',item,side,options:options(item.label,wrong,rng),answer:item.label};
  }}));
 }
 if(!cards)return [];
 const cardItems=items.filter(i=>i.card),inScope=cardItems.map(i=>i.card!);
 if(type==='nerve'){
  const out:Candidate[]=cardItems.map(item=>({key:`nerve:${item.card!.id}`,item:item.key,make:rng=>{
   const card=item.card!,right=card.innervation.find(n=>n.term)??card.innervation[0],related=new Set(card.innervation.flatMap(n=>n.term?[...relatedNerves(n.term)]:[]));
   const ok=namesOf(cards).filter(n=>!GENERIC.test(n.name)&&!card.innervation.some(o=>overlapping(o.nerve,n.name))&&!(n.term&&related.has(n.term)));
   const wrong=takeFrom([ok.filter(n=>n.regions.has(card.region)),ok.filter(n=>[...n.regions].some(nearby(card.region))),ok],3,rng,n=>n.name).map(n=>n.name);
   return wrong.length<3?null:{type,key:`nerve:${card.id}`,title:`${card.zh}的神經`,prompt:'支配這塊肌肉的神經是？',subject:card.zh,item,side:pick(sides(item),rng),options:options(right.nerve,wrong,rng),answer:right.nerve,nerve:right.term};
  }}));
  // The other way round: a named nerve, and which muscle it supplies.
  for(const n of namesOf(cards)){
   if(!n.term||GENERIC.test(n.name))continue;const term=n.term,supplied=cardItems.filter(i=>i.card!.innervation.some(x=>x.term===term));if(!supplied.length)continue;
   out.push({key:`nerve-of:${n.name}`,item:`nerve:${term}`,make:rng=>{
    const item=pick(supplied,rng),related=relatedNerves(term),clear=(c:MuscleCard)=>!suppliedNear(c,n.name,related);
    const region=item.card!.region,ok=inScope.filter(clear),wrong=takeFrom([ok.filter(c=>c.region===region),ok.filter(c=>nearby(region)(c.region)),ok,cards.cards.filter(c=>c.region===region&&clear(c)),cards.cards.filter(clear)],3,rng,c=>c.zh).map(c=>c.zh);
    return wrong.length<3?null:{type,key:`nerve-of:${n.name}`,title:`${n.name}支配的肌肉`,prompt:'這條神經支配下列哪塊肌肉？',subject:n.name,item,side:pick(sides(item),rng),options:options(item.label,wrong,rng),answer:item.label,nerve:term,nerveFirst:true};
   }});
  }
  return out;
 }
 const actions=new Map(cards.cards.map(c=>[c.id,cardActions(c)]));
 return QUIZ_ACTIONS.flatMap(key=>{
  const right=cardItems.filter(i=>actions.get(i.card!.id)!.primary.has(key));if(!right.length)return [];
  return [{key:`action:${key}`,item:`action:${key}`,make:(rng:Rng)=>{
   // Wrong answers: muscles that move the same joint some other way, from the scope first.
   const item=pick(right,rng),joint=key.split('|')[0],region=item.card!.region,clear=(c:MuscleCard)=>!mightDo(actions.get(c.id)!,key),sameJoint=(c:MuscleCard)=>actions.get(c.id)!.joints.has(joint);
   const wrong=takeFrom([inScope.filter(c=>clear(c)&&sameJoint(c)),cards.cards.filter(c=>clear(c)&&sameJoint(c)),cards.cards.filter(c=>clear(c)&&c.region===region),cards.cards.filter(c=>clear(c)&&nearby(region)(c.region)),cards.cards.filter(clear)],3,rng,c=>c.zh).map(c=>c.zh);
   return wrong.length<3?null:{type:'action' as const,key:`action:${key}`,title:`${actionName(key)}的肌肉`,prompt:'哪塊肌肉的主要作用包含',subject:actionName(key),item,side:pick(sides(item),rng),options:options(item.label,wrong,rng),answer:item.label};
  }}];
 });
}
/** How many different questions each type can ask in these pools. */
export const questionCounts=(pools:Pools)=>Object.fromEntries(QUESTION_TYPES.map(t=>[t.id,candidates(pools,t.id).length])) as Record<QuestionType,number>;
/** A round of questions. The types take turns; a structure is asked about once while there are others left. only limits the
 * round to questions asked before (by record key), to go over the ones answered wrong. */
export function makeRound(pools:Pools,types:QuestionType[],count:number,rng:Rng=Math.random,only?:Set<string>):Question[]{
 const byType=new Map(types.map(t=>[t,shuffle(candidates(pools,t).filter(c=>!only||only.has(c.key)),rng)]));
 const out:Question[]=[],asked=new Set<string>();
 for(const strict of [true,false]){
  let progress=true;
  while(out.length<count&&progress){
   progress=false;
   for(const t of shuffle(types,rng)){
    if(out.length>=count)break;const list=byType.get(t)!,i=list.findIndex(c=>!strict||!asked.has(c.item));if(i<0)continue;
    const [c]=list.splice(i,1),q=c.make(rng);progress=true;if(q){out.push(q);asked.add(c.item);}
   }
  }
 }
 return out;
}

/** What the model shows for a question, before and after the answer. Pins without a point sit at the centre of the part. */
export interface QuizView {visible:SystemId[];selected:string[];xray:number;pins:{part:string;label:string;point?:number[]}[];
 /** Box to frame, looking from look (or the current direction); null keeps the camera. */ frame:Box|null;look?:number[]}
/** What the scope box shows of a part (a joint region cuts the model along its box), or null when the part is outside it. */
const shownBox=(p:Part,scope?:Box|null)=>scope?clip(p.bounds as Box,scope):p.bounds as Box;
/** The biggest part (of what the scope shows), where a label goes. */
const mainPart=(atlas:Atlas,ids:string[],scope?:Box|null)=>{let best='',size=-1;for(const id of ids){const p=atlas.parts.find(x=>x.id===id),b=p&&shownBox(p,scope);if(b){const s=b[1].reduce((n,v,i)=>n*(v-b[0][i]+.001),1);if(s>size){size=s;best=id;}}}return best;};
const boxOf=(atlas:Atlas,ids:string[],scope?:Box|null)=>{let box:Box|undefined;const set=new Set(ids);for(const p of atlas.parts)if(set.has(p.id)){const b=shownBox(p,scope);if(b)box=union(box,b);}return box??null;};
/** A label on the biggest of the parts, at the centre of what the scope shows of it (a point outside the cut would hide it). */
const pinOn=(atlas:Atlas,ids:string[],label:string,scope?:Box|null)=>{const part=mainPart(atlas,ids,scope),p=atlas.parts.find(x=>x.id===part),b=p&&shownBox(p,scope);return b?[{part,label,point:center(b).map(v=>+v.toFixed(4))}]:[];};
/** Where to look at a structure from: the side of the body it lies on (front, back, left or right). */
export function lookAt(box:Box){const [x,,z]=center(box),lateral=x*1.6,flat=Math.hypot(lateral,z);return flat<.04?[-.3,.15,1]:[lateral/flat,.25,z/flat];}
export function nerveParts(atlas:Atlas,term:string,side:string){const tree=nerveTree(term);return atlas.parts.filter(p=>p.system==='nervous'&&tree.has(termKey(p.name))&&(!side||!sideOf(p.name)||sideOf(p.name)===side)).map(p=>p.id);}
const shown=(item:QuizItem):SystemId[]=>item.system==='skeletal'?['skeletal']:[item.system,'skeletal'];
export function questionView(atlas:Atlas,q:Question,scope:{box:Box;look:number[]}):QuizView{
 const parts=q.item.parts[q.side]??[],box=q.item.boxes[q.side];
 if(q.type==='find')return {visible:shown(q.item),selected:[],xray:0,pins:[],frame:scope.box,look:scope.look};
 if(q.type==='action')return {visible:['muscular','skeletal'],selected:[],xray:0,pins:[],frame:scope.box,look:scope.look};
 if(q.nerveFirst&&q.nerve){const nerve=nerveParts(atlas,q.nerve,q.side),nb=boxOf(atlas,nerve,scope.box);return {visible:['muscular','skeletal'],selected:nerve,xray:QUIZ_XRAY,pins:[],frame:nb??scope.box,look:nb?lookAt(nb):scope.look};}
 return {visible:q.type==='name'?shown(q.item):['muscular','skeletal'],selected:parts,xray:QUIZ_XRAY,pins:[],frame:box,look:lookAt(box)};
}
export interface Answer {correct:boolean;picked?:string;tapped?:{id:string;point?:number[];label:string}}
/** The answer on the model: the right structure (on the side tapped, when it has one), what was tapped instead, and the nerve.
 * scope is the box of the round's scope; labels and framing keep to what it shows. */
export function answerView(atlas:Atlas,q:Question,a:Answer,scope?:Box|null):QuizView{
 const tappedSide=a.tapped?sideOf(atlas.parts.find(p=>p.id===a.tapped!.id)?.name??''):'',side=q.type==='find'&&a.tapped&&q.item.parts[tappedSide]?tappedSide:q.side;
 const parts=q.item.parts[side]??[];
 if(q.type==='find'){
  if(a.correct)return {visible:shown(q.item),selected:parts,xray:QUIZ_XRAY,pins:[{part:a.tapped!.id,label:q.item.label,point:a.tapped!.point}],frame:null};
  const pins=[...pinOn(atlas,parts,`正確：${q.item.label}`,scope),...(a.tapped?[{part:a.tapped.id,label:`你點的：${a.tapped.label}`,point:a.tapped.point}]:[])];
  const tapped=a.tapped&&atlas.parts.find(p=>p.id===a.tapped!.id),tappedBox=tapped&&shownBox(tapped,scope);
  return {visible:shown(q.item),selected:parts,xray:QUIZ_XRAY,pins,frame:tappedBox?union(q.item.boxes[side],tappedBox):q.item.boxes[side]};
 }
 if(q.type==='name')return {visible:shown(q.item),selected:parts,xray:QUIZ_XRAY,pins:pinOn(atlas,parts,q.item.label,scope),frame:null};
 const nerve=q.nerve?nerveParts(atlas,q.nerve,side):[],pins=pinOn(atlas,parts,q.item.label,scope);
 if(nerve.length)pins.push(...pinOn(atlas,nerve,q.type==='nerve'?q.nerveFirst?q.subject!:q.answer:'神經',scope));
 const box=boxOf(atlas,[...parts,...nerve],scope)??q.item.boxes[side];
 return {visible:['muscular','skeletal'],selected:[...parts,...nerve],xray:QUIZ_XRAY,pins,frame:box,look:lookAt(q.item.boxes[side])};
}
/** Whether a tapped part is the structure asked for: one of its parts, or (given the names) another part with the same name, such
 * as a piece the region's list leaves out. */
export function isRight(q:Question,partId:string,atlas?:Atlas|null,cards?:CardIndex|null,label?:(term:string)=>string|undefined){
 if(Object.values(q.item.parts).some(ids=>ids.includes(partId)))return true;
 const p=atlas?.parts.find(x=>x.id===partId);if(!p||!label||p.system!==q.item.system)return false;
 const term=termKey(p.name),name=(p.system==='muscular'?cards?.byTerm.get(term)?.zh:undefined)??label(term);
 return name===q.item.label;
}

/** The record on this device: settings, every question asked (by record key) and past rounds. */
export interface QuizRecord {title:string;type:QuestionType;right:number;wrong:number;at:number}
export interface QuizLog {settings:QuizSettings;records:Record<string,QuizRecord>;rounds:{at:number;right:number;total:number;scope:string}[]}
const LOG_KEY='anatomy3d.quiz';
const TYPE_IDS=QUESTION_TYPES.map(t=>t.id),GROUP_IDS=SYSTEM_GROUPS.map(g=>g.id);
/** Stored values are checked field by field, so an old or damaged record falls back to defaults instead of breaking the quiz. */
export function readSettings(raw:any):QuizSettings{
 const list=<T extends string>(v:unknown,ids:T[],fallback:T[])=>{const out=Array.isArray(v)?ids.filter(id=>v.includes(id)):[];return out.length?out:fallback;};
 const scope=raw?.scope&&typeof raw.scope.id==='string'&&(isArea(raw.scope.id)||REGIONS.some(r=>r.id===raw.scope.id))&&(raw.scope.side==='left'||raw.scope.side==='right')?{id:raw.scope.id,side:raw.scope.side}:null;
 return {types:list(raw?.types,TYPE_IDS,DEFAULT_SETTINGS.types),systems:list(raw?.systems,GROUP_IDS,DEFAULT_SETTINGS.systems),scope,depth:DEPTHS.some(d=>d.id===raw?.depth)?raw.depth:'all',count:COUNTS.includes(raw?.count)?raw.count:DEFAULT_SETTINGS.count};
}
export function loadLog():QuizLog{
 try{
  const raw=JSON.parse(localStorage.getItem(LOG_KEY)??'null'),records:Record<string,QuizRecord>={};
  for(const [k,r] of Object.entries(raw?.records??{}) as [string,any][])if(r&&typeof r.title==='string'&&TYPE_IDS.includes(r.type)&&Number.isInteger(r.right)&&Number.isInteger(r.wrong))records[k]={title:r.title,type:r.type,right:r.right,wrong:r.wrong,at:Number(r.at)||0};
  const rounds=Array.isArray(raw?.rounds)?raw.rounds.filter((r:any)=>Number.isInteger(r?.right)&&Number.isInteger(r?.total)).slice(0,30):[];
  return {settings:readSettings(raw?.settings),records,rounds};
 }catch{return {settings:DEFAULT_SETTINGS,records:{},rounds:[]};}
}
/** The record is a per-device convenience: failing to store it (private mode, blocked storage) only loses the history. */
export function saveLog(log:QuizLog){try{localStorage.setItem(LOG_KEY,JSON.stringify(log));return true;}catch{return false;}}
export function recordAnswer(log:QuizLog,q:Question,correct:boolean,at=Date.now()):QuizLog{
 const r=log.records[q.key]??{title:q.title,type:q.type,right:0,wrong:0,at};
 return {...log,records:{...log.records,[q.key]:{title:q.title,type:q.type,right:r.right+(correct?1:0),wrong:r.wrong+(correct?0:1),at}}};
}
/** Questions answered wrong at least as often as right, the most often wrong first. */
export const weakRecords=(log:QuizLog)=>Object.entries(log.records).filter(([,r])=>r.wrong>0&&r.wrong>=r.right).sort((a,b)=>(b[1].wrong-b[1].right)-(a[1].wrong-a[1].right)||b[1].wrong-a[1].wrong||b[1].at-a[1].at);
