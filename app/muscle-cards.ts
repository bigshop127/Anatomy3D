import {termKey} from './names.ts';
/** Muscle cards. The master copy is one Markdown page per region in the owner's notes; scripts/muscle-cards.mjs apply copies
 * every card into app/muscle-cards.json, and reviewed marks the ones the owner has checked (the app labels the rest 未核對).
 * Text fields keep the page's lines in order; a nested bullet such as "上束：…" is its own line. */
export type CardRegion='neck'|'shoulder'|'elbow'|'wrist'|'trunk'|'hip'|'knee'|'ankle'|'tmj';
/** One nerve of the 神經支配 line. term is the atlas nerve term when the Chinese name matches one, so the app can
 * select the nerve and every muscle it supplies; roots are the main spinal roots, minorRoots the lesser ones. */
export interface Innervation {nerve:string;term?:string;roots?:string;minorRoots?:string;note?:string}
export interface MuscleCard {
 id:string;zh:string;en:string;region:CardRegion;reviewed:boolean;
 /** Title of the English Wikipedia article the blood supply was checked against. */
 wiki?:string;
 /** Atlas muscle terms (lowercase English without left/right) this card describes. */
 parts:string[];
 origin:string[];insertion:string[];primary:string[];secondary:string[];
 innervation:Innervation[];innervationText:string[];
 blood:string[];palpation:string[];sources:string[];notes:string[];
 /** Planned fields (decided 2026-10-25), absent until a later batch fills them. */
 mmt?:string[];stretch?:string[];triggerPoints?:string[];injuries?:string[];
}
export interface MuscleCardData {version:1;cards:MuscleCard[]}

/** Branches whose muscles count for the nerve they come from, so a tap on the sciatic nerve also lists what the tibial and
 * fibular nerves supply. The brachial plexus goes trunk → division → cord → nerve (lateral cord: anterior divisions of the
 * superior and middle trunks; medial cord: anterior division of the inferior trunk; posterior cord: every posterior division). */
const LATERAL_CORD=['lateral pectoral nerve','musculocutaneous nerve','median nerve'],MEDIAL_CORD=['medial pectoral nerve','ulnar nerve','median nerve'];
export const NERVE_BRANCHES:Record<string,string[]>={
 'roots of brachial plexus':['dorsal scapular nerve','long thoracic nerve','superior trunk of brachial plexus','middle trunk of brachial plexus','inferior trunk of brachial plexus'],
 'superior trunk of brachial plexus':['suprascapular nerve','subclavian nerve','anterior division of superior trunk of brachial plexus','posterior division of superior trunk of brachial plexus'],
 'middle trunk of brachial plexus':['anterior division of middle trunk of brachial plexus','posterior division of middle trunk of brachial plexus'],
 'inferior trunk of brachial plexus':['anterior division of inferior trunk of brachial plexus','posterior division of inferior trunk of brachial plexus'],
 'anterior division of superior trunk of brachial plexus':LATERAL_CORD,'anterior division of middle trunk of brachial plexus':LATERAL_CORD,
 'anterior division of inferior trunk of brachial plexus':MEDIAL_CORD,
 'posterior division of superior trunk of brachial plexus':['posterior cord of brachial plexus'],'posterior division of middle trunk of brachial plexus':['posterior cord of brachial plexus'],
 'posterior division of inferior trunk of brachial plexus':['posterior cord of brachial plexus'],
 'posterior cord of brachial plexus':['axillary nerve','radial nerve','thoracodorsal nerve','superior subscapular nerve','inferior subscapular nerve'],
 'sciatic nerve':['tibial nerve','common fibular nerve'],
 'common fibular nerve':['deep fibular nerve','superficial fibular nerve'],
 'tibial nerve':['medial plantar nerve','lateral plantar nerve'],
 'trigeminal nerve':['motor root of trigeminal nerve'],
 'motor root of trigeminal nerve':['anterior division of mandibular nerve','posterior division of mandibular nerve'],
 'posterior division of mandibular nerve':['inferior alveolar nerve'],
 'inferior alveolar nerve':['nerve to mylohyoid'],
};
/** Branches the cards never name: the nerve they belong to. */
const PARENT:Record<string,string>={
 'deep branch of radial nerve':'radial nerve','posterior interosseous nerve of forearm':'radial nerve','anterior interosseous nerve of forearm':'median nerve',
 'saphenous nerve':'femoral nerve',
};
export function nerveParent(term:string){
 return PARENT[term]??term.match(/^(?:.+ )?branch(?:es)? of (.+ nerve)$/)?.[1];
}

export interface CardIndex {cards:MuscleCard[];byTerm:Map<string,MuscleCard>;byNerve:Map<string,MuscleCard[]>}
export function indexCards(data:MuscleCardData):CardIndex{
 const byTerm=new Map<string,MuscleCard>(),byNerve=new Map<string,MuscleCard[]>();
 for(const card of data.cards){
  for(const t of card.parts)byTerm.set(t,card);
  for(const n of card.innervation)if(n.term){const list=byNerve.get(n.term)??[];if(!list.includes(card))list.push(card);byNerve.set(n.term,list);}
 }
 return {cards:data.cards,byTerm,byNerve};
}
/** The card a part belongs to (muscle parts only). */
export const cardOf=(index:CardIndex|null,name:string)=>index?.byTerm.get(termKey(name));
export interface NerveMuscles {direct:MuscleCard[];branches:{nerve:string;cards:MuscleCard[]}[]}
/** Muscles a nerve supplies by the cards: its own, then each branch's (a muscle listed under the nerve itself is not repeated). */
export function nerveMuscles(index:CardIndex,term:string):NerveMuscles{
 const direct=index.byNerve.get(term)??[],seen=new Set(direct),branches:NerveMuscles['branches']=[],visited=new Set([term]);
 const queue=[...(NERVE_BRANCHES[term]??[])];
 while(queue.length){
  const nerve=queue.shift()!;if(visited.has(nerve))continue;visited.add(nerve);
  const cards=(index.byNerve.get(nerve)??[]).filter(c=>!seen.has(c));cards.forEach(c=>seen.add(c));
  if(cards.length)branches.push({nerve,cards});
  queue.push(...(NERVE_BRANCHES[nerve]??[]));
 }
 return {direct,branches};
}
/** Every nerve term below the given one (itself included), for selecting the whole branching nerve. */
export function nerveTree(term:string){const out=new Set([term]),queue=[term];while(queue.length)for(const b of NERVE_BRANCHES[queue.shift()!]??[])if(!out.has(b)){out.add(b);queue.push(b);}return out;}
/** Loads the cards in their own chunk, after the model, so the first visit does not wait for them. */
export const loadCards=()=>import('./muscle-cards.json').then(m=>indexCards(m.default as MuscleCardData));
