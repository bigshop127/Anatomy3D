import {useState,type ReactNode} from 'react';
import {ArrowUpRight,ChevronRight} from 'lucide-react';
import {Switch} from '@/components/ui/switch';
import {END_COLOR,END_NAME,type HostedMuscle} from './attachments';
import {nerveMuscles,nerveParent,type CardIndex,type MuscleCard} from './muscle-cards';
// Detail panel sections for muscles (their card), nerves (the muscles they supply) and bones (the muscles attached to them).

const KEY='anatomy3d.cardSections',DEFAULT_OPEN=['attach','action','nerve','nerve-muscles','hosted'];
function loadOpen():string[]{try{const v=JSON.parse(localStorage.getItem(KEY)??'null');return Array.isArray(v)?v.filter(x=>typeof x==='string'):DEFAULT_OPEN;}catch{return DEFAULT_OPEN;}}
/** Which sections are open is remembered on this device, so the next card opens the way the last one was left. */
export function useSections(){
 const [open,setOpen]=useState(loadOpen);
 return {isOpen:(id:string)=>open.includes(id),set:(id:string,value:boolean)=>setOpen(o=>{const next=value?[...new Set([...o,id])]:o.filter(x=>x!==id);try{localStorage.setItem(KEY,JSON.stringify(next));}catch{/* a per-device convenience only */}return next;})};
}
export type Sections=ReturnType<typeof useSections>;
function Section({id,title,sections,children}:{id:string;title:ReactNode;sections:Sections;children:ReactNode}){
 return <details className="card-section" open={sections.isOpen(id)} onToggle={e=>{const open=e.currentTarget.open;if(open!==sections.isOpen(id))sections.set(id,open);}}>
  <summary><span>{title}</span><ChevronRight size={15} className="card-chevron"/></summary><div className="card-section-body">{children}</div>
 </details>;
}
/** "上束：鎖骨外側 1/3" shows its part in bold. */
const labelled=(line:string)=>{const m=line.match(/^([^：（]{1,10})：(.+)$/);return m?<><b>{m[1]}</b>{m[2]}</>:line;};
const Lines=({lines}:{lines:string[]})=>lines.length===1?<p>{labelled(lines[0])}</p>:<ul>{lines.map((l,i)=><li key={i}>{labelled(l)}</li>)}</ul>;
const dot=(end:'origin'|'insertion')=><i className="end-dot" style={{background:END_COLOR[end]}} aria-hidden="true"/>;

export interface MarksProps {on:boolean;onChange:(on:boolean)=>void;note:string}
function MarksToggle({on,onChange,note}:MarksProps){
 return <div className="marks-toggle"><label><Switch checked={on} onCheckedChange={onChange} aria-label="在骨頭上標出起止點"/><span>在骨頭上標出起止點</span></label>{note&&<p className="card-note">{note}</p>}</div>;
}
const PLANNED:[keyof MuscleCard,string][]=[['mmt','徒手肌力測試'],['stretch','伸展'],['triggerPoints','激痛點與轉移痛'],['injuries','常見損傷']];
const wikiUrl=(title:string)=>`https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g,'_'))}`;

export function CardView({card,sections,marks,onNerve,onWhole}:{card:MuscleCard;sections:Sections;marks:MarksProps;onNerve:(term:string)=>void;onWhole?:()=>void}){
 return <div className="muscle-card">
  <div className="card-head"><span>肌肉卡</span>{!card.reviewed&&<span className="unreviewed" title="這張卡的內容還沒經過你核對">未核對</span>}{onWhole&&<button type="button" className="card-link" onClick={onWhole}>選取整條{card.zh}</button>}</div>
  <Section id="attach" title="起點與止點" sections={sections}>
   <div className="attach-row">{dot('origin')}<b>起點</b><Lines lines={card.origin}/></div>
   <div className="attach-row">{dot('insertion')}<b>止點</b><Lines lines={card.insertion}/></div>
   <MarksToggle {...marks}/>
  </Section>
  <Section id="action" title="作用" sections={sections}>
   <div className="attach-row"><b>主要</b><Lines lines={card.primary}/></div>
   {card.secondary.length>0&&<div className="attach-row"><b>次要</b><Lines lines={card.secondary}/></div>}
  </Section>
  <Section id="nerve" title="神經支配" sections={sections}>
   <div className="nerve-list">{card.innervation.map((n,i)=>{
    const text=<><span>{n.nerve}</span>{n.roots&&<small>{n.roots}</small>}{n.minorRoots&&<small className="minor">次要 {n.minorRoots}</small>}</>;
    return <div key={i} className="nerve-item">{n.term?<button type="button" className="nerve-chip" onClick={()=>onNerve(n.term!)} title={`選取${n.nerve}和它支配的肌肉`}>{text}<ChevronRight size={13}/></button>:<span className="nerve-chip static">{text}</span>}{n.note&&<p className="card-note">{n.note}</p>}</div>;
   })}</div>
   {card.innervation.some(n=>n.term)&&<p className="card-note">點神經：選取這條神經和它支配的所有肌肉。</p>}
  </Section>
  {card.blood.length>0&&<Section id="blood" title="血液供應" sections={sections}><Lines lines={card.blood}/></Section>}
  {card.palpation.length>0&&<Section id="palpation" title="觸診提示" sections={sections}><Lines lines={card.palpation}/><p className="card-note">觸診提示是整理的臨床常用方法，沒有書本出處。</p></Section>}
  {PLANNED.map(([key,title])=>{const lines=card[key] as string[]|undefined;return lines?.length?<Section key={key} id={key} title={title} sections={sections}><Lines lines={lines}/></Section>:null;})}
  {card.notes.length>0&&<Section id="notes" title="備註" sections={sections}><Lines lines={card.notes}/></Section>}
  <Section id="sources" title="出處" sections={sections}>
   <Lines lines={card.sources}/>
   {card.wiki&&<a className="source-link" href={wikiUrl(card.wiki)} target="_blank" rel="noreferrer">英文維基百科：{card.wiki}（血液供應比對）<ArrowUpRight size={13}/></a>}
  </Section>
 </div>;
}

function MuscleButtons({cards,nerve,onCard}:{cards:MuscleCard[];nerve:string;onCard:(card:MuscleCard)=>void}){
 return <div className="chip-list">{cards.map(card=>{const n=card.innervation.find(x=>x.term===nerve);return <button type="button" key={card.id} onClick={()=>onCard(card)}>{card.zh}{n?.roots&&<small>{n.roots}</small>}</button>;})}</div>;
}
/** The muscles a nerve supplies by the cards, its own first and then each branch's. */
export function NerveView({cards,term,nameOf,sections,onCard,onNerve,onSelectAll}:{cards:CardIndex;term:string;nameOf:(term:string)=>string;sections:Sections;onCard:(card:MuscleCard)=>void;onNerve:(term:string)=>void;onSelectAll?:()=>void}){
 const {direct,branches}=nerveMuscles(cards,term),parent=nerveParent(term),count=direct.length+branches.reduce((n,b)=>n+b.cards.length,0);
 if(!count)return <Section id="nerve-muscles" title="支配的肌肉" sections={sections}>
  {parent?<><p>這是{nameOf(parent)}的分支，肌肉卡沒有單獨寫它。</p><button type="button" className="card-link" onClick={()=>onNerve(parent)}>看{nameOf(parent)}支配的肌肉</button></>
   :<p className="card-note">肌肉卡裡沒有寫到這條神經支配的肌肉（可能是感覺神經，或它支配的肌肉還沒有卡片）。</p>}
 </Section>;
 return <Section id="nerve-muscles" title={`支配的肌肉（${count}）`} sections={sections}>
  {direct.length>0&&<MuscleButtons cards={direct} nerve={term} onCard={onCard}/>}
  {branches.map(b=><div key={b.nerve} className="branch"><h4>經{nameOf(b.nerve)}</h4><MuscleButtons cards={b.cards} nerve={b.nerve} onCard={onCard}/></div>)}
  {onSelectAll&&<button type="button" className="card-link" onClick={onSelectAll}>一起選取神經和這些肌肉</button>}
  <p className="card-note">依肌肉卡的「神經支配」整理，數字是主要神經根。</p>
 </Section>;
}
/** The muscles whose attachment patches lie on a bone (or ligament). */
export function HostedView({muscles,nameOf,sections,marks,onPick}:{muscles:HostedMuscle[];nameOf:(term:string)=>string;sections:Sections;marks:MarksProps;onPick:(m:HostedMuscle)=>void}){
 const row=(end:'origin'|'insertion')=>{const list=muscles.filter(m=>m.ends.includes(end));return list.length?<div className="attach-row">{dot(end)}<b>{END_NAME[end]}</b><div className="chip-list">{list.map(m=><button type="button" key={m.key} onClick={()=>onPick(m)}>{m.card?.zh??nameOf(m.term)}</button>)}</div></div>:null;};
 return <Section id="hosted" title={`附著在這裡的肌肉（${muscles.length}）`} sections={sections}>{row('origin')}{row('insertion')}<MarksToggle {...marks}/></Section>;
}
