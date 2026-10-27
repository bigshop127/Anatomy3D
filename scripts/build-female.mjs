// Builds the female model (public/models/female/) from the Human Reference Atlas female reference organs (HRA united-female
// v1.5, CC BY 4.0) in the form human-atlas shipped them before it became male-only (git 264faee^: public/models/atlas-female.json
// and female-*.bin, the uncompressed format of that time). scripts/female-parts.json tidies the names (BodyParts3D style, so
// app/names.zh-TW.json translates them), corrects the sides the source has the wrong way round, sets the systems and names the
// search groups; the geometry is centred like the body model and written in the meshopt-1 encoding (scripts/lib/model-pack.mjs).
// Usage: node scripts/build-female.mjs <folder with atlas-female.json and female-*.bin> [--list]   (--list only prints the result)
import {mkdir,readFile,readdir,unlink,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {termKey} from '../app/names.ts';
import {fixSystems} from '../app/system-fixes.ts';
import {root} from './lib/atlas-geometry.mjs';
import {header,chunkList,pack,size} from './lib/model-pack.mjs';

const args=process.argv.slice(2),list=args.includes('--list'),source=args.find(a=>!a.startsWith('--'));
if(!source)throw new Error('Usage: node scripts/build-female.mjs <folder with atlas-female.json and female-*.bin> [--list]');
const folder=pathToFileURL(resolve(source)+'/'),manifest=JSON.parse(await readFile(new URL('scripts/female-parts.json',root),'utf8'));
const old=JSON.parse(await readFile(new URL('atlas-female.json',folder),'utf8'));
const buffers=await Promise.all(old.chunks.map(async c=>{const b=await readFile(new URL(c.url.split('/').pop(),folder));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}));
const out=new URL('public/models/female/',root);

const SYSTEMS=new Set(['skeletal','muscular','arterial','venous','nervous','digestive','respiratory','urinary','reproductive','lymphatic','endocrine','integumentary','connective','fascia','sensory','cardiac','pregnancy']);
const pattern=key=>key.startsWith('/')?new RegExp(key.slice(1,-1)):null;
/** The value for a part id: an exact key first, then the first /pattern/ key that matches. */
const lookup=(table,id)=>{if(id in table)return table[id];for(const [k,v] of Object.entries(table)){const re=pattern(k);if(re?.test(id))return v;}return undefined;};
const swapped=new RegExp(manifest.swapSides),midline=new Set(manifest.midline);
const otherSide={left:'right',right:'left'};
/** The side the source id gives (…_L, …_R_b, left_…, …_left), before any correction. */
const idSide=id=>{const s=id.replace(/^(VH_F_|Allen_|Yao_)/,'');return /(^|_)(L|left)(_[a-z]|_(sup|inf|upper|lower))?$|^left_|_L_|_left_/.test(s)?'left':/(^|_)(R|right)(_[a-z]|_(sup|inf|upper|lower|middle))?$|^right_|_R_|_right_/.test(s)?'right':'';};
const capital=s=>s[0].toUpperCase()+s.slice(1);
const swapWords=s=>s.replace(/\b(left|right)\b/gi,w=>{const to=otherSide[w.toLowerCase()];return w[0]===w[0].toUpperCase()?capital(to):to;});

// The body model's systems, so that a structure both models have is drawn in the same system.
const body=JSON.parse(await readFile(new URL('public/models/atlas.json',root),'utf8'));fixSystems(body);
const bodySystems=new Map();for(const p of body.parts){const k=termKey(p.name);(bodySystems.get(k)??bodySystems.set(k,new Set()).get(k)).add(p.system);}
const bodySystem=name=>{const s=bodySystems.get(termKey(name));return s?.size===1?[...s][0]:undefined;};

/** The tidied name: the manifest's (names: the whole name; baseNames, by id without _L/_R: the name without its side), or the
 * source label with "(left)" moved to the front; the side the id gives is added, swapped where the source has it the wrong way
 * round, and left off for the halves of a midline structure. */
function nameOf(p){
 const swap=swapped.test(p.id);
 if(p.id in manifest.names)return manifest.names[p.id];
 let name=(manifest.baseNames[p.id.replace(/_[LR]$/,'')]??p.name).trim().replace(/\s+/g,' '),side='';
 const tail=name.match(/\s*\((left|right)\)$/i);if(tail){side=tail[1].toLowerCase();name=name.slice(0,tail.index);}
 if(swap)name=swapWords(name);
 const named=name.match(/\b(left|right)\b/i);
 if(!named&&!side&&!midline.has(name.toLowerCase())){side=idSide(p.id);if(side&&swap)side=otherSide[side];}
 else if(side&&swap)side=otherSide[side];
 if(midline.has(name.toLowerCase()))side='';
 return side&&!named?`${capital(side)} ${name.toLowerCase()===name?name:name[0].toLowerCase()+name.slice(1)}`:capital(name);
}
function systemOf(p,name){
 const set=lookup(manifest.systems,p.id)??bodySystem(name)??lookup(manifest.systemRules,p.id)??p.system;
 if(!SYSTEMS.has(set))throw new Error(`${p.id}: unknown system ${set}`);
 return set;
}

// Centre the body like the body model: the spine on x = 0 and the skin's front-to-back middle on z = 0 (the floor stays at y = 0).
const named=id=>{const p=old.parts.find(q=>q.id===id);if(!p)throw new Error(`${id} is not in the source`);return p;};
const mid=(p,a)=>(p.bounds[0][a]+p.bounds[1][a])/2;
const spine=manifest.centre.spine.map(id=>mid(named(id),0)),shift=[-spine.reduce((a,b)=>a+b,0)/spine.length,0,-mid(named(manifest.centre.depth),2)];

const parts=[],geometry=new Map();
for(const p of old.parts){
 const name=nameOf(p),system=systemOf(p,name);
 if(list)continue;
 const position=Float32Array.from(new Float32Array(buffers[p.chunk],p.positions,p.vertexCount*3));
 for(let v=0;v<position.length;v+=3)for(let a=0;a<3;a++)position[v+a]+=shift[a];
 geometry.set(p.id,{position,normal:new Int16Array(buffers[p.chunk],p.normals,p.vertexCount*3),index:new Uint32Array(buffers[p.chunk],p.indices,p.indexCount)});
 parts.push({id:p.id,name,conceptId:p.conceptId,system,source:'hra',vertexCount:p.vertexCount,indexCount:p.indexCount});
}
if(list){
 for(const p of old.parts){const name=nameOf(p);console.log(['P',systemOf(p,name),p.id,name].join('\t'));}
}

// Search: one entry per name (the halves and pieces of a structure come up once), then the source's groups that hold more.
const byName=new Map();
for(const p of list?old.parts.map(p=>({id:p.id,name:nameOf(p),conceptId:p.conceptId})):parts){const k=p.name.toLowerCase();(byName.get(k)??byName.set(k,[]).get(k)).push(p);}
const conceptUse=new Map();for(const group of byName.values())for(const id of new Set(group.map(p=>p.conceptId)))conceptUse.set(id,(conceptUse.get(id)??0)+1);
const concepts=[],seen=new Set(),key=ids=>[...ids].sort().join(' '),groupIds=new Set(old.concepts.filter(c=>c.elements.length>1).map(c=>c.id));
for(const group of byName.values()){
 const ids=group.map(p=>p.id),own=new Set(group.map(p=>p.conceptId)),only=own.size===1?[...own][0]:'';
 // The source's own concept id when only this name uses it and no source group has it, else the first part's id.
 concepts.push({id:only&&conceptUse.get(only)===1&&!groupIds.has(only)?only:ids[0],name:group[0].name,elements:ids});seen.add(key(ids));
}
const cleanGroup=name=>{
 let n=name.trim().replace(/\s+/g,' '),side='';
 const m=n.match(/^(.*) ([LR])$/)??n.match(/^([LR]) (.*)$/);
 if(m){const [s,rest]=m[1].length===1?[m[1],m[2]]:[m[2],m[1]];side=s==='L'?'left':'right';n=rest;}
 return side?`${capital(side)} ${n}`:capital(n);
};
for(const c of old.concepts){
 if(c.elements.length<2)continue;
 const own=c.id in manifest.groups,name=own?manifest.groups[c.id]:cleanGroup(c.name);
 if(name===null||seen.has(key(c.elements)))continue;
 concepts.push({id:c.id,name:!own&&swapped.test(c.id.replace(/^HRA:/,''))?swapWords(name):name,elements:c.elements});seen.add(key(c.elements));
}
for(const g of manifest.extraGroups){
 const re=new RegExp(g.parts),ids=old.parts.filter(p=>re.test(p.id)).map(p=>p.id);
 if(ids.length<2)throw new Error(`Extra group ${g.name} matches ${ids.length} parts`);
 if(!seen.has(key(ids))){concepts.push({id:g.id,name:g.name,elements:ids});seen.add(key(ids));}
}
{const dup=concepts.map(c=>c.id).filter((id,i,all)=>all.indexOf(id)!==i);if(dup.length)throw new Error(`Search entries with the same id: ${dup.join(", ")}`);}
if(list){for(const c of concepts)if(c.elements.length>1)console.log(['G',c.elements.length,c.id,c.name].join('\t'));process.exit(0);}

const {out:chunks}=pack(parts,p=>geometry.get(p.id),[],'/models/female/f-');
const result={version:old.version,sex:'female',source:manifest.source.name,scope:`Female reference organs · ${parts.length} structures; skeleton and muscles in part`,...header,
 sources:{hra:{name:manifest.source.name,license:manifest.source.license,url:manifest.source.url}},parts,concepts,chunks:chunkList(chunks),
 triangles:parts.reduce((n,p)=>n+p.indexCount/3,0),sourceTriangles:old.sourceTriangles,optimized:old.optimized};
await mkdir(out,{recursive:true});
for(const c of chunks){const name=c.url.split('/').pop();await writeFile(new URL(name,out),c.bytes);await writeFile(new URL(name+'.gz',out),c.gzip);}
await writeFile(new URL('atlas.json',out),JSON.stringify(result));
const keep=new Set(chunks.flatMap(c=>{const name=c.url.split('/').pop();return [name,name+'.gz'];}));
let deleted=0;for(const name of await readdir(out))if(/\.bin(\.gz)?$/.test(name)&&!keep.has(name)){await unlink(new URL(name,out));deleted++;}
console.log(`${parts.length} parts, ${concepts.length} search entries, ${result.triangles.toLocaleString()} triangles; ${chunks.length} chunks: ${size(chunks)}; moved by [${shift.map(v=>(v*1000).toFixed(1)).join(', ')}] mm; ${deleted} old files deleted`);
