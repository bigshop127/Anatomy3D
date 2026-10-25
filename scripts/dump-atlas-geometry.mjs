// Plain dump of the atlas geometry for the Blender scripts (they cannot decode the app's compressed model files).
// Usage: node scripts/dump-atlas-geometry.mjs [systems…]  → work/atlas-raw/{parts.json,geometry.bin}
// parts.json lists every dumped part with byte offsets into geometry.bin: float32 positions (app frame: metres, Y up, front +Z,
// patient's left +X) followed by uint32 triangle indices.
import {mkdir,writeFile} from 'node:fs/promises';
import {loadAtlas,loadGeometry,root} from './lib/atlas-geometry.mjs';

const systems=process.argv.slice(2),atlas=await loadAtlas(),geometryOf=await loadGeometry(atlas),out=new URL('work/atlas-raw/',root);
await mkdir(out,{recursive:true});
const parts=[],blobs=[];let offset=0;
for(const p of atlas.parts){
 if(systems.length&&!systems.includes(p.system))continue;
 const g=geometryOf(p),positions=Buffer.from(g.position.buffer,g.position.byteOffset,g.position.byteLength),indices=Buffer.from(g.index.buffer,g.index.byteOffset,g.index.byteLength);
 parts.push({id:p.id,name:p.name,system:p.system,positions:offset,vertexCount:p.vertexCount,indices:offset+positions.length,indexCount:p.indexCount,bounds:p.bounds});
 blobs.push(positions,indices);offset+=positions.length+indices.length;
}
await writeFile(new URL('geometry.bin',out),Buffer.concat(blobs));
await writeFile(new URL('parts.json',out),JSON.stringify({parts}));
console.log(`Dumped ${parts.length} parts (${(offset/1e6).toFixed(1)} MB) to work/atlas-raw/`);
