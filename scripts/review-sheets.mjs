// Chinese-name proofreading sheets, one Markdown page per body region (kept in the owner's notes, outside the repo).
//   node scripts/review-sheets.mjs export <dir>   write or refresh the pages; edits already typed into a page are kept
//   node scripts/review-sheets.mjs apply <dir>    copy corrections into app/names.zh-TW.json; pages marked 已校對 become reviewed
// Each row is one term (English name without left/right). A correction replaces the term; "?" starts a question, not a correction.
// Regions come from app/region-members.json (scripts/compute-region-members.mjs); a term can be listed on several pages.
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {REGIONS} from '../app/regions.ts';
import {termKey} from '../app/names.ts';
import {loadAtlas,root} from './lib/atlas-geometry.mjs';

const [command,dir]=process.argv.slice(2);
if(!['export','apply'].includes(command)||!dir)throw new Error('Usage: node scripts/review-sheets.mjs export|apply <directory>');
const namesFile=new URL('app/names.zh-TW.json',root);
const atlas=await loadAtlas(),names=JSON.parse(await readFile(namesFile,'utf8'));
const {members}=JSON.parse(await readFile(new URL('app/region-members.json',root),'utf8'));

// Physical therapy order first, then the remaining regions; structures in no region go on the last page.
const ORDER=['neck','shoulder','lumbar','hip','knee','ankle','tmj','thoracic','elbow','wrist','other'];
const TITLE=id=>REGIONS.find(r=>r.id===id)?.name??'其他';
const SECTIONS=[['skeletal','骨骼'],['muscular','肌肉'],['connective','韌帶、軟骨與筋膜'],['nervous','神經']];
const DONE='已校對',TODO='待校對';
const file=id=>`${String(ORDER.indexOf(id)+1).padStart(2,'0')} ${TITLE(id)}.md`;
// Brain structures are not proofread here; nerves, ganglia and the cord are.
const included=p=>SECTIONS.some(([s])=>s===p.system)&&(p.system!=='nervous'||/nerve|ganglion|plexus|spinal cord|cauda equina|ramus|root of/i.test(p.name));
const center=b=>b[0].map((v,i)=>(v+b[1][i])/2);

/** Terms of the proofread systems with the regions of their left, right and midline parts. */
function assign(){
 const terms=new Map();
 for(const p of atlas.parts){
  if(!included(p))continue;const key=termKey(p.name);
  const t=terms.get(key)??{key,system:p.system,regions:new Set(),y:center(p.bounds)[1]};
  for(const id of members[p.id]??[])t.regions.add(id);terms.set(key,t);
 }
 for(const t of terms.values())if(!t.regions.size)t.regions.add('other');
 return [...terms.values()];
}
const cell=s=>s.replace(/\|/g,'／').trim();
/** Rows already in a page: English key → [correction, note]. */
function parseRows(text){
 const rows=new Map();
 for(const line of text.split(/\r?\n/)){
  if(!line.startsWith('|')||/^\|\s*-/.test(line)||line.includes('英文名'))continue;
  const cells=line.split('|').slice(1,-1).map(s=>s.trim());if(cells.length<3)continue;
  rows.set(cells[0].toLowerCase(),[cells[2]??'',cells[3]??'']);
 }
 return rows;
}
const status=text=>text.match(/^狀態:\s*(.+)$/m)?.[1].trim()??TODO;
async function existing(){
 const pages=new Map();
 try{for(const name of await readdir(dir))if(/^\d\d .+\.md$/.test(name))pages.set(name,await readFile(join(dir,name),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 return pages;
}

if(command==='export'){
 await mkdir(dir,{recursive:true});
 const pages=await existing(),terms=assign(),today=new Date().toISOString().slice(0,10),reviewed=new Set(names.reviewed),summary=[];
 for(const id of ORDER){
  const name=file(id),old=pages.get(name)??'',kept=parseRows(old),list=terms.filter(t=>t.regions.has(id));if(!list.length)continue;
  const out=['---',`部位: ${TITLE(id)}`,`狀態: ${old?status(old):TODO}`,`構造數: ${list.length}`,`更新: ${today}`,'---',`# 中文名校對：${TITLE(id)}`,'',
   '> [!info] 怎麼校對',
   '> - 只看「目前中文」是不是台灣臨床常用的說法。**對的不用動**；不對的在「你的修改」填正確名稱（不用加左右，App 會自動加「左／右」）。',
   '> - 不確定的在「你的修改」寫 `?` 加一句話，我查了再回你；「備註」是我標的疑點。',
   '> - 整頁看完把上面的「狀態」改成 `已校對`，跟我說「同步校對」，App 裡這些名稱的「未校對」就會拿掉。',
   '> - 一個構造可能出現在好幾頁（例如跨兩個關節的肌肉），改一次就好。順序由頭側往腳側；打 ✔ 的已經校對過。',''];
  for(const [system,title] of SECTIONS){
   const rows=list.filter(t=>t.system===system).sort((a,b)=>b.y-a.y||a.key.localeCompare(b.key));if(!rows.length)continue;
   out.push(`## ${title}（${rows.length}）`,'','| 英文名 | 目前中文 | 你的修改 | 備註 |','|---|---|---|---|');
   for(const t of rows){
    const zh=names.terms[t.key]??'';let [fix,note]=kept.get(t.key)??['',''];
    if(fix===zh)fix='';// already applied
    out.push(`| ${t.key} | ${zh}${reviewed.has(t.key)?' ✔':''} | ${cell(fix)} | ${cell(note)} |`);
   }
   out.push('');
  }
  await writeFile(join(dir,name),out.join('\n'));summary.push(`${name}: ${list.length}`);
 }
 console.log(`Review sheets written to ${dir}\n${summary.join('\n')}`);
}else{
 const pages=await existing(),rows=[],questions=new Map(),unknown=[];
 for(const [name,text] of pages){const done=status(text)===DONE;for(const [key,[fix]] of parseRows(text))rows.push({name,key,fix,done});}
 for(const r of rows)if(/^[?？]/.test(r.fix))questions.set(r.key,`${r.name}: ${r.key} — ${r.fix}`);
 const reviewed=new Set(names.reviewed),corrections=new Map();let confirmed=0;
 for(const r of rows){
  if(!(r.key in names.terms)){unknown.push(`${r.name}: ${r.key}`);continue;}
  if(questions.has(r.key))continue;
  if(r.fix&&r.fix!==names.terms[r.key]){
   if(corrections.has(r.key)&&corrections.get(r.key)!==r.fix)console.warn(`Different corrections for ${r.key}: ${corrections.get(r.key)} / ${r.fix} (keeping the second)`);
   if(/^[左右]/.test(r.fix))console.warn(`Correction starts with a side, check it: ${r.key} → ${r.fix}`);
   corrections.set(r.key,r.fix);
  }
  if(r.done&&!reviewed.has(r.key)){reviewed.add(r.key);confirmed++;}
 }
 for(const [key,fix] of corrections)names.terms[key]=fix;
 names.reviewed=[...reviewed].sort();
 await writeFile(namesFile,JSON.stringify(names,null,2)+'\n');
 console.log(`Applied ${corrections.size} corrections; ${confirmed} terms newly reviewed (${names.reviewed.length} total).`);
 if(questions.size)console.log(`Questions to answer:\n${[...questions.values()].join('\n')}`);
 if(unknown.length)console.log(`Rows whose English name is not a term (left unchanged):\n${unknown.join('\n')}`);
}
