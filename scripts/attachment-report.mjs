// Review list for the muscle attachments (npm run attachments): compares public/models/attachments.json with the card text.
//   1. patches on a bone the card names only for the other end (origin and insertion the wrong way round: FLIP or PATCH in
//      scripts/zanatomy-select.mjs);
//   2. bones the card names for an end that the muscle touches but no patch covers (add them to scripts/attachment-contacts.json
//      if the muscle really attaches there rather than lying on the bone);
//   3. cards with an end that has no patch at all.
// The card text is matched by keywords (scripts/lib/bone-keywords.mjs), so every line is a lead to look at, not a fault.
import {readFile} from 'node:fs/promises';
import {termKey} from '../app/names.ts';
import {namesBone} from './lib/bone-keywords.mjs';
import {contactTools,partsOf} from './lib/attachment-contacts.mjs';
import {loadAtlas,loadGeometry,root} from './lib/atlas-geometry.mjs';

const atlas=await loadAtlas(),geometry=await loadGeometry(atlas),names=JSON.parse(await readFile(new URL('app/names.zh-TW.json',root),'utf8'));
const data=JSON.parse(await readFile(new URL('public/models/attachments.json',root),'utf8'));
const cards=JSON.parse(await readFile(new URL('app/muscle-cards.json',root),'utf8')).cards;
const tools=contactTools(atlas.parts,geometry),byId=new Map(atlas.parts.map(p=>[p.id,p])),zh=t=>names.terms[t]??t;
const bones=atlas.parts.filter(p=>p.system==='skeletal'&&!/\bright\b/i.test(p.name));
const END={origin:'起點',insertion:'止點'},MIN_AREA=4e-5;
const wrong=[],uncovered=[],missing=[];
for(const c of cards){
 const patches=data.patches.filter(p=>p.side==='left'&&p.muscles.some(t=>c.parts.includes(t)));
 const text={origin:c.origin.join(' '),insertion:c.insertion.join(' ')},other={origin:'insertion',insertion:'origin'};
 // The worked-out patches cover bones picked from the card by hand, so only Z-Anatomy's are compared here.
 for(const p of patches.filter(p=>p.source==='z-anatomy')){
  const t=termKey(byId.get(p.host).name);
  if(!namesBone(text[p.end],t,zh(t))&&namesBone(text[other[p.end]],t,zh(t)))wrong.push(`${c.zh}：${p.name} 的${END[p.end]}貼片在${zh(t)}，卡片把${zh(t)}寫在${END[other[p.end]]}`);
 }
 const muscles=partsOf(atlas.parts,c.parts,'left');if(!muscles.length)continue;
 const lo=[0,1,2].map(a=>Math.min(...muscles.map(m=>m.bounds[0][a]))-.005),hi=[0,1,2].map(a=>Math.max(...muscles.map(m=>m.bounds[1][a]))+.005);
 const near=bones.filter(b=>b.bounds[0].every((v,a)=>v<=hi[a])&&b.bounds[1].every((v,a)=>v>=lo[a]));
 for(const end of ['origin','insertion']){
  const own=patches.filter(p=>p.end===end);
  if(!own.length){missing.push(`${c.zh}：沒有${END[end]}（卡片：${text[end]}）`);continue;}
  const hosts=new Set(own.map(p=>termKey(byId.get(p.host).name))),list=[];
  for(const b of near){
   const t=termKey(b.name);if(hosts.has(t)||!namesBone(text[end],t,zh(t))||namesBone(text[other[end]],t,zh(t)))continue;
   const {area}=tools.contact(b,muscles);if(area>=MIN_AREA)list.push(`${zh(t)}（${Math.round(area*1e6)} mm²）`);
  }
  if(list.length)uncovered.push(`${c.zh} ${END[end]}：${list.join('、')}`);
 }
}
const section=(title,lines)=>console.log(`\n${title}（${lines.length}）\n${lines.join('\n')||'—'}`);
section('1. 貼片的起止點跟卡片相反？',wrong);
section('2. 卡片寫了、肌肉也碰到，但沒有貼片的骨頭',uncovered);
section('3. 整個起點或止點都沒有貼片',missing);
