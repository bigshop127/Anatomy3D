// Rebuilds public/models from the current atlas: applies scripts/source-fixes.json, merges the Z-Anatomy structures listed in
// scripts/zanatomy-parts.json and writes the meshopt-1 encoding that app/model-decode.ts reads (scripts/lib/model-pack.mjs). Parts
// already in meshopt-1 are copied byte for byte, so rebuilding never degrades them; parts still in the older uncompressed format
// (or new ones) are encoded.
// With --zanatomy <dir> (written by scripts/blender/export.py) the Z-Anatomy structures and their muscle attachment patches take
// their geometry from that export, simplified the way the BodyParts3D meshes were; without it the ones built before are kept.
// Their names, systems and search concepts always follow the manifest. The attachment patches go in a catalogue of their own,
// public/models/attachments.json, which the app only needs for muscle cards.
// public/sw.js gets a model cache name that follows the content, so installed apps replace their offline copy when the model
// changes.
// Usage: node scripts/build-atlas.mjs [--zanatomy work/zanatomy/export]
import {createHash} from 'node:crypto';
import {readFile,readdir,unlink,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {MeshoptSimplifier} from 'meshoptimizer/simplifier';
import {decodePart} from '../app/model-decode.ts';
import {contactPatches} from './lib/attachment-contacts.mjs';
import {attachmentHosts} from './lib/attachment-hosts.mjs';
import {loadGeometry,readAtlas,readChunks,root} from './lib/atlas-geometry.mjs';
import {FORMAT,chunkList,header,pack,size,vertexNormals} from './lib/model-pack.mjs';

const SOURCES={
 bp3d:{name:'BodyParts3D 4.0',license:'CC BY 4.0',url:'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/'},
 'z-anatomy':{name:'Z-Anatomy',license:'CC BY-SA 4.0',url:'https://www.z-anatomy.com/'},
};
// Z-Anatomy meshes are simplified like the BodyParts3D ones (0.2% of the structure's size), but by no more than MAX_ERROR metres,
// so that nerves a few millimetres thick keep a round section.
const RELATIVE_ERROR=.002,MAX_ERROR={nervous:1e-4,other:2.5e-4};
const models=new URL('public/models/',root);
await Promise.all([MeshoptDecoder.ready,MeshoptSimplifier.ready]);

const atlas=await readAtlas(),encoded=atlas.encoding?.format===FORMAT;
if(atlas.encoding&&!encoded)throw new Error(`Unknown model encoding: ${atlas.encoding.format}`);
const chunks=encoded?await readChunks(atlas):null,geometryOf=encoded?null:await loadGeometry(atlas);
const fixes=JSON.parse(await readFile(new URL('scripts/source-fixes.json',root),'utf8'));
const manifest=JSON.parse(await readFile(new URL('scripts/zanatomy-parts.json',root),'utf8'));
const zAt=process.argv.indexOf('--zanatomy'),exportDir=zAt>0?pathToFileURL(resolve(process.argv[zAt+1]??'')+'/'):null;
const log=[];

// --- Source fixes. Each one checks the current state first, so applying it again changes nothing.
const byId=new Map(atlas.parts.map(p=>[p.id,p]));
const part=id=>{const p=byId.get(id);if(!p)throw new Error(`source-fixes.json names a part that is not in the atlas: ${id}`);return p;};
if(fixes.remove.length){
 const gone=new Set(fixes.remove.map(r=>r.id).filter(id=>byId.has(id)));
 atlas.parts=atlas.parts.filter(p=>!gone.has(p.id));
 for(const c of atlas.concepts)c.elements=c.elements.filter(id=>!gone.has(id));
 atlas.concepts=atlas.concepts.filter(c=>c.elements.length);
 if(gone.size)log.push(`removed ${gone.size} parts`);
}
// The patient's left is +X.
const wrongSide=p=>{const left=/\bleft\b/i.test(p.name),right=/\bright\b/i.test(p.name),x=(p.bounds[0][0]+p.bounds[1][0])/2;return left!==right&&(left?x<0:x>0);};
for(const [a,b] of fixes.swapSides){
 const pa=part(a),pb=part(b);if(!wrongSide(pa))continue;
 [pa.name,pb.name]=[pb.name,pa.name];[pa.conceptId,pb.conceptId]=[pb.conceptId,pa.conceptId];
 for(const c of atlas.concepts){const ia=c.elements.indexOf(a),ib=c.elements.indexOf(b);if(ia>=0&&ib<0)c.elements[ia]=b;else if(ib>=0&&ia<0)c.elements[ib]=a;}
 log.push(`swapped sides of ${a} and ${b}`);
}
for(const fix of fixes.rename){
 const p=part(fix.id);
 if(p.name!==fix.name){log.push(`renamed ${fix.id} "${p.name}" → "${fix.name}"`);p.name=fix.name;}
 if(fix.concept&&!atlas.concepts.some(c=>c.id===fix.concept)){atlas.concepts.push({id:fix.concept,name:fix.name.toLowerCase(),elements:[fix.id]});log.push(`added concept ${fix.concept}`);}
 if(fix.like){
  const twin=part(fix.like);p.conceptId=twin.conceptId;
  for(const c of atlas.concepts){const should=c.elements.includes(twin.id),has=c.elements.includes(p.id);if(should&&!has)c.elements.push(p.id);else if(has&&!should)c.elements=c.elements.filter(id=>id!==p.id);}
 }
}
atlas.concepts=atlas.concepts.filter(c=>c.elements.length);

// --- Z-Anatomy structures.
async function readExport(dir){
 const {parts}=JSON.parse(await readFile(new URL('parts.json',dir),'utf8')),blob=await readFile(new URL('geometry.bin',dir));
 const slice=(offset,bytes)=>blob.buffer.slice(blob.byteOffset+offset,blob.byteOffset+offset+bytes);
 return new Map(parts.map(e=>[e.z,{position:new Float32Array(slice(e.positions,e.vertexCount*12)),index:new Uint32Array(slice(e.indices,e.indexCount*4))}]));
}
const exported=exportDir?await readExport(exportDir):null;
/** Exported geometry of a Z-Anatomy object, with coincident vertices welded and simplified. */
function simplified(z,system){
 const g=exported.get(z);if(!g)throw new Error(`${z} is not in the Z-Anatomy export (run scripts/blender/export.py again)`);
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let v=0;v<g.position.length;v+=3)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],g.position[v+a]);hi[a]=Math.max(hi[a],g.position[v+a]);}
 const error=Math.min(RELATIVE_ERROR*Math.max(...hi.map((h,a)=>h-lo[a])),MAX_ERROR[system]??MAX_ERROR.other);
 const remap=MeshoptSimplifier.generatePositionRemap(g.position,3),welded=g.index.map(i=>remap[i]);
 // Attachment patches are open surfaces; their outline is the attachment, so it stays put.
 let [index]=MeshoptSimplifier.simplify(welded,g.position,3,0,error,system==='attachment'?['ErrorAbsolute','LockBorder']:['ErrorAbsolute']);
 if(!index.length)index=welded;
 return {position:g.position,normal:vertexNormals(g.position,index),index};
}
const zIds=new Set([...manifest.parts.map(m=>m.id),...atlas.parts.filter(p=>p.source==='z-anatomy').map(p=>p.id)]);
const built=new Map(atlas.parts.filter(p=>p.source==='z-anatomy').map(p=>[p.id,p])),fresh=new Map();
atlas.parts=atlas.parts.filter(p=>p.source!=='z-anatomy');
for(const m of manifest.parts){
 const p=exported?{id:m.id}:built.get(m.id);
 if(!p)throw new Error(`${m.id} (${m.z}) has not been built yet: run node scripts/build-atlas.mjs --zanatomy work/zanatomy/export`);
 Object.assign(p,{name:m.name,conceptId:m.concept,system:m.system,source:'z-anatomy'});
 if(exported){const g=simplified(m.z,m.system);fresh.set(m.id,g);p.vertexCount=g.position.length/3;p.indexCount=g.index.length;}
 atlas.parts.push(p);
}
const dropped=[...built.keys()].filter(id=>!manifest.parts.some(m=>m.id===id));
if(dropped.length)log.push(`dropped ${dropped.length} Z-Anatomy parts the manifest no longer lists`);
// Search concepts: the Z-Anatomy parts leave every concept and the Z-Anatomy concepts go, then the manifest's come back; one whose
// name the atlas already has (spinal cord, cranial nerve) adds its parts to that concept.
for(const c of atlas.concepts)c.elements=c.elements.filter(id=>!zIds.has(id));
atlas.concepts=atlas.concepts.filter(c=>c.elements.length&&!c.id.startsWith('Z:'));
const conceptNamed=new Map(atlas.concepts.map(c=>[c.name,c])),mergedInto=new Map();
for(const c of manifest.concepts){
 const same=conceptNamed.get(c.name);
 if(same){same.elements.push(...c.elements);mergedInto.set(c.id,same.id);}else atlas.concepts.push({id:c.id,name:c.name,elements:[...c.elements]});
}
for(const p of atlas.parts)if(mergedInto.has(p.conceptId))p.conceptId=mergedInto.get(p.conceptId);

// --- Encoding.
for(const p of atlas.parts)p.source??='bp3d';
const {out,converted}=pack(atlas.parts,p=>fresh.get(p.id)??(encoded?null:geometryOf(p)),chunks);

// --- Muscle attachment patches.
const attachmentsFile=new URL('attachments.json',models);
let previous=null;try{previous=JSON.parse(await readFile(attachmentsFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const oldPatches=new Map(previous?.patches.map(p=>[p.id,p])),patchGeometry=new Map();
const patches=manifest.attachments.map(a=>{
 const old=oldPatches.get(a.id),p={id:a.id,source:'z-anatomy',muscles:a.terms,name:a.muscle,end:a.end,side:a.side};
 if(exported){const g=simplified(a.z,'attachment');patchGeometry.set(a.id,g);p.vertexCount=g.position.length/3;p.indexCount=g.index.length;}
 else if(old){const {vertexCount,indexCount,bounds,chunk,streams,origin}=old;Object.assign(p,{vertexCount,indexCount,bounds,chunk,streams,origin});}
 else throw new Error(`Attachment ${a.z} has not been built yet: run with --zanatomy`);
 return p;
});
// Ends Z-Anatomy has no patch for, worked out from where the muscle touches the parts scripts/attachment-contacts.json names.
const decoder=list=>q=>decodePart(header,q,list[q.chunk].bytes,MeshoptDecoder);
const contactTable=JSON.parse(await readFile(new URL('scripts/attachment-contacts.json',root),'utf8')).contacts;
const idOf=key=>'ZC'+createHash('sha256').update(key).digest('hex').slice(0,8);
for(const c of contactPatches(atlas.parts,decoder(out),contactTable,idOf)){
 const g=c.geometry;patchGeometry.set(c.id,g);
 patches.push({id:c.id,source:'computed',muscles:c.muscles,name:c.name,end:c.end,side:c.side,host:c.host,vertexCount:g.position.length/3,indexCount:g.index.length});
}
const patchPack=pack(patches,p=>patchGeometry.get(p.id)??null,previous?await readChunks(previous):[]);
// About fifty Z-Anatomy patches carry the wrong side; one that lies wholly on one side takes that side (the patient's left is +x).
for(const p of patches){const x=(p.bounds[0][0]+p.bounds[1][0])/2;if(Math.abs(x)>.005)p.side=x>0?'left':'right';}
const zPatches=patches.filter(p=>p.source==='z-anatomy'),hosts=attachmentHosts(atlas.parts,decoder(out),zPatches,decoder(patchPack.out));
for(const p of zPatches)p.host=hosts.get(p.id);

// --- Write the model files, the catalogues and the cache name; then delete model files nothing references.
const used=Object.fromEntries(Object.entries(SOURCES).filter(([id])=>atlas.parts.some(p=>p.source===id)));
const unknown=[...new Set(atlas.parts.map(p=>p.source))].filter(id=>!used[id]);
if(unknown.length)throw new Error(`Parts from undeclared sources: ${unknown.join(', ')}`);
const {version,sex,source,parts,concepts,sourceTriangles,optimized}=atlas,bp3d=parts.filter(p=>p.source==='bp3d').length;
const scope=`Adult male reference anatomy · ${bp3d.toLocaleString('en')} BodyParts3D meshes + ${(parts.length-bp3d).toLocaleString('en')} Z-Anatomy structures`;
const result={version,sex,source,scope,...header,sources:used,parts,concepts,chunks:chunkList(out),
 triangles:parts.reduce((n,p)=>n+p.indexCount/3,0),sourceTriangles,
 optimized:{...optimized,zAnatomy:{maximumRelativeError:RELATIVE_ERROR,maximumAbsoluteError:MAX_ERROR}}};
const attachments={note:'Origin and insertion patches of the muscles (Z-Anatomy, CC BY-SA 4.0), warped onto the atlas bones. muscles are the atlas muscle terms (lowercase, without the side) the patch belongs to, name is the Z-Anatomy name, host the atlas part it lies on.',
 ...header,source:'z-anatomy',patches,chunks:chunkList(patchPack.out)};
for(const c of [...out,...patchPack.out]){const name=c.url.split('/').pop();await writeFile(new URL(name,models),c.bytes);await writeFile(new URL(name+'.gz',models),c.gzip);}
await writeFile(new URL('atlas.json',models),JSON.stringify(result));
await writeFile(attachmentsFile,JSON.stringify(attachments));
// The cache name follows the model chunks only: the attachment chunk is small and named by its content, so changing the patches
// adds one file to the offline copy instead of replacing all of it.
const cacheName='anatomy3d-models-'+createHash('sha256').update(out.map(c=>c.url).join()).digest('hex').slice(0,12);
const swFile=new URL('public/sw.js',root),sw=await readFile(swFile,'utf8'),nextSw=sw.replace(/MODELS='[^']*'/,`MODELS='${cacheName}'`);
if(nextSw===sw&&!sw.includes(`MODELS='${cacheName}'`))throw new Error('public/sw.js has no MODELS cache name to update');
await writeFile(swFile,nextSw);
const keep=new Set([...out,...patchPack.out].flatMap(c=>{const name=c.url.split('/').pop();return [name,name+'.gz'];}));
let deleted=0;for(const name of await readdir(models))if(/\.bin(\.gz)?$/.test(name)&&!keep.has(name)){await unlink(new URL(name,models));deleted++;}

for(const line of log)console.log('fix: '+line);
console.log(`${parts.length} parts (${bp3d} BodyParts3D, ${parts.length-bp3d} Z-Anatomy; ${converted} encoded, ${parts.length-converted} copied), ${concepts.length} concepts, ${result.triangles.toLocaleString()} triangles`);
console.log(`${out.length} chunks: ${size(out)}; attachments: ${patches.length} patches in ${patchPack.out.length} chunks, ${size(patchPack.out)}; ${deleted} old model files deleted; cache ${cacheName}`);
