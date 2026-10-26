// Muscle cards, one Markdown page per body region in the owner's notes (outside the repo); the pages are the master copy.
//   node scripts/muscle-cards.mjs check <dir>   parse every page: format problems, open questions, nerves not in the model, muscles without a card
//   node scripts/muscle-cards.mjs apply <dir>   copy every card into app/muscle-cards.json; reviewed marks the checked ones
//                                               (page 狀態: 已核對, or ✔ after a card's title)
// A card is "## 中文名 english name" followed by "- **欄位**：內容" lines; nested bullets add lines to the field above.
// A card whose 你的意見 is not empty is waiting for an answer, so it counts as not reviewed even on a checked page.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {termKey} from '../app/names.ts';
import {loadAtlas,root} from './lib/atlas-geometry.mjs';

const [command,dir]=process.argv.slice(2);
if(!['check','apply'].includes(command)||!dir)throw new Error('Usage: node scripts/muscle-cards.mjs check|apply <directory>');
const PAGES=[['neck','頸部'],['shoulder','肩'],['elbow','肘與前臂'],['wrist','腕與手'],['trunk','胸腰與軀幹'],['hip','髖'],['knee','膝'],['ankle','踝與足'],['tmj','顳顎與舌骨']];
const FIELDS={'3D 模型':'parts','起點':'origin','止點':'insertion','主要作用':'primary','次要作用':'secondary','神經支配':'innervation','血液供應':'blood','觸診提示':'palpation','出處':'sources','備註':'notes',
 '徒手肌力測試':'mmt','伸展':'stretch','激痛點與轉移痛':'triggerPoints','常見損傷':'injuries','你的意見':'question','Claude 回覆':'reply'};
const REQUIRED=['parts','origin','insertion','primary','innervation','sources'];
const PLANNED=['mmt','stretch','triggerPoints','injuries'];
const DONE='已核對',NONE=/^(無|—|-)$/;
// Spinal roots such as C5–C6, L4–S1 or C5、C7; cranial nerves as CN XI or CN V3.
const SEGMENT='[CTLS]\\d{1,2}(?:–[CTLS]?\\d{1,2})?';
const ROOTS=new RegExp(`^(?:${SEGMENT}(?:、${SEGMENT})*|CN [IVX]+\\d?)$`);

const atlas=await loadAtlas(),names=JSON.parse(await readFile(new URL('app/names.zh-TW.json',root),'utf8'));
// The English Wikipedia article each card was checked against, which the app links as a source.
const wiki=JSON.parse(await readFile(new URL('scripts/muscle-card-wiki.json',root),'utf8')).titles;
const muscleTerms=new Set(atlas.parts.filter(p=>p.system==='muscular').map(p=>termKey(p.name)));
const nerveByZh=new Map();
for(const p of atlas.parts)if(p.system==='nervous'){const key=termKey(p.name),zh=names.terms[key];if(zh)nerveByZh.set(zh,key);}
const cardId=en=>en.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

/** Splits on a separator outside （）. */
function splitTop(text,sep){
 const out=[];let depth=0,cur='';
 for(const ch of text){if(ch==='（')depth++;if(ch==='）')depth--;if(ch===sep&&depth===0){out.push(cur);cur='';}else cur+=ch;}
 out.push(cur);return out.map(s=>s.trim()).filter(Boolean);
}
/** 神經支配 items: 名稱（主要根，次要 根，說明）; returns the parsed nerves and any format problems. */
function parseInnervation(lines){
 const nerves=[],problems=[];
 for(let item of lines.flatMap(l=>splitTop(l,'；'))){
  // A nested line may start with the part it applies to, e.g. 內側半：尺神經（C8–T1）.
  const colon=splitTop(item,'：'),label=colon.length>1?[null,colon[0],colon.slice(1).join('：')]:null;if(label)item=label[2];
  const m=item.match(/^([^（]+)(?:（(.*)）)?(.*)$/);
  const n={nerve:m[1].trim()},notes=label?[label[1].trim()]:[];
  for(const token of splitTop(m[2]??'','，')){
   if(ROOTS.test(token)&&!n.roots)n.roots=token;
   else if(/^次要\s*(?:[CTLS]\d|CN )/.test(token)){const r=token.replace(/^次要\s*/,'');if(!ROOTS.test(r))problems.push(`次要神經根寫法看不懂：${token}`);n.minorRoots=r;}
   else notes.push(token);
  }
  if(m[3].trim())notes.push(m[3].trim());
  if(notes.length)n.note=notes.join('，');
  const term=nerveByZh.get(n.nerve);if(term)n.term=term;
  nerves.push(n);
 }
 return {nerves,problems};
}

function parsePage(name,text){
 const meta=Object.fromEntries((text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]??'').split(/\r?\n/).map(l=>l.split(/:\s*/)).filter(p=>p.length>1).map(([k,...v])=>[k.trim(),v.join(':').trim()]));
 const page=PAGES.find(([,zh])=>name.replace(/^\d\d /,'').replace(/\.md$/,'')===zh);
 const problems=[],cards=[];
 if(!page)return {problems:[`${name}: 檔名不在部位清單裡`],cards};
 let card=null,field=null;
 const body=text.replace(/^---\r?\n[\s\S]*?\r?\n---/,'');
 for(const [i,raw] of body.split(/\r?\n/).entries()){
  const line=raw.replace(/\s+$/,'');
  const at=`${name}:${i+1}`;
  const head=line.match(/^##\s+(✔\s*)?([^\x00-\x7F]+?)\s+([\x00-\x7F]+?)(\s*✔)?$/);
  if(line.startsWith('## ')){
   if(!head){problems.push(`${at} 卡片標題要寫成「## 中文名 english name」：${line}`);card=null;continue;}
   card={zh:head[2].trim(),en:head[3].trim(),checked:!!(head[1]||head[4]),fields:{},line:at};cards.push(card);field=null;continue;
  }
  if(/^#{1,6} /.test(line)){card=null;continue;}
  if(!card||!line.trim())continue;
  const f=line.match(/^- \*\*(.+?)\*\*[：:]\s*(.*)$/);
  if(f){
   field=FIELDS[f[1].trim()];
   if(!field){problems.push(`${at} 不認得的欄位「${f[1]}」`);continue;}
   if(card.fields[field])problems.push(`${at} 「${f[1]}」寫了兩次`);
   card.fields[field]=f[2].trim()?[f[2].trim()]:[];continue;
  }
  const nested=line.match(/^\s+[-*]\s+(.*)$/);
  if(nested&&field){card.fields[field].push(nested[1].trim());continue;}
  if(/^\s+\S/.test(line)&&field&&card.fields[field].length){card.fields[field][card.fields[field].length-1]+=line.trim();continue;}
  if(/^>/.test(line))continue;
  problems.push(`${at} 看不懂這一行（欄位要寫成「- **欄位**：內容」）：${line}`);
 }
 const out=[];
 for(const c of cards){
  const f=c.fields,where=`${c.line} ${c.zh}`;
  for(const k of REQUIRED)if(!f[k]?.length)problems.push(`${where}：缺「${Object.keys(FIELDS).find(l=>FIELDS[l]===k)}」`);
  const parts=(f.parts??[]).join(' ').match(/`[^`]+`/g)?.map(s=>s.slice(1,-1).trim().toLowerCase())??[];
  for(const p of parts)if(!muscleTerms.has(p))problems.push(`${where}：3D 模型裡沒有肌肉「${p}」`);
  const {nerves,problems:nerveProblems}=parseInnervation(f.innervation??[]);
  for(const p of nerveProblems)problems.push(`${where}：${p}`);
  const list=k=>(f[k]??[]).filter(s=>!NONE.test(s));
  const card={id:cardId(c.en),zh:c.zh,en:c.en,region:page[0],parts,origin:list('origin'),insertion:list('insertion'),primary:list('primary'),secondary:list('secondary'),
   innervation:nerves,innervationText:list('innervation'),blood:list('blood'),palpation:list('palpation'),sources:list('sources'),notes:list('notes')};
  for(const k of PLANNED)if(list(k).length)card[k]=list(k);
  const question=list('question').join(' ');card.reviewed=(c.checked||meta['狀態']===DONE)&&!question;
  if(wiki[card.id])card.wiki=wiki[card.id];
  out.push({card,question,where});
 }
 return {problems,cards:out,status:meta['狀態']??'',file:name};
}

const files=(await readdir(dir)).filter(n=>/^\d\d .+\.md$/.test(n)).sort();
const pages=[];for(const name of files)pages.push(parsePage(name,await readFile(join(dir,name),'utf8')));
const all=pages.flatMap(p=>p.cards),problems=pages.flatMap(p=>p.problems);
const seenId=new Map(),seenPart=new Map();
for(const {card,where} of all){
 if(seenId.has(card.id))problems.push(`${where}：英文名跟 ${seenId.get(card.id)} 重複`);seenId.set(card.id,where);
 for(const p of card.parts){if(seenPart.has(p))problems.push(`${where}：「${p}」也在 ${seenPart.get(p)}`);seenPart.set(p,where);}
}
const questions=all.filter(c=>c.question);
const unmatched=[...new Set(all.flatMap(c=>c.card.innervation.filter(n=>!n.term).map(n=>n.nerve)))];
const uncovered=[...muscleTerms].filter(t=>!seenPart.has(t)).sort();

console.log(pages.map(p=>`${p.file}: ${p.cards.length} 張（${p.status||'沒有狀態'}）`).join('\n'));
if(questions.length)console.log(`\n待回答（${questions.length}）：\n${questions.map(q=>`${q.where}：${q.question}`).join('\n')}`);
if(command==='check'){
 console.log(`\n共 ${all.length} 張卡，${all.filter(c=>c.card.reviewed).length} 張已核對。`);
 if(unmatched.length)console.log(`\n3D 模型裡沒有的神經（卡片照樣顯示，只是點了不會選到）：\n${unmatched.join('、')}`);
 if(uncovered.length)console.log(`\n還沒有卡片的肌肉（${uncovered.length}）：\n${uncovered.join(', ')}`);
}
if(problems.length){console.error(`\n格式問題（${problems.length}）：\n${problems.join('\n')}`);process.exit(1);}
if(command==='apply'){
 const cards=all.map(c=>c.card),reviewed=cards.filter(c=>c.reviewed).length;
 await writeFile(new URL('app/muscle-cards.json',root),JSON.stringify({version:1,cards},null,1)+'\n');
 console.log(`\n已寫入 app/muscle-cards.json：${cards.length} 張卡，${reviewed} 張已核對、${cards.length-reviewed} 張在 App 標「未核對」（其中有意見待回答的 ${questions.length} 張）。`);
}
