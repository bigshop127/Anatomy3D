// Shared loader for scripts that need the geometry behind public/models/atlas.json.
import {readFile} from 'node:fs/promises';
import {fixSystems} from '../../app/system-fixes.ts';

export const root=new URL('../../',import.meta.url);
export async function loadAtlas(){const atlas=JSON.parse(await readFile(new URL('public/models/atlas.json',root),'utf8'));fixSystems(atlas);return atlas;}
/** Returns geometryOf(part) → {position: Float32Array, normal: Int16Array, index: Uint32Array}, views into one copy of each chunk. */
export async function loadGeometry(atlas){
 const chunks=await Promise.all(atlas.chunks.map(async c=>{const b=await readFile(new URL('public'+c.url,root));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}));
 return p=>({position:new Float32Array(chunks[p.chunk],p.positions,p.vertexCount*3),normal:new Int16Array(chunks[p.chunk],p.normals,p.vertexCount*3),index:new Uint32Array(chunks[p.chunk],p.indices,p.indexCount)});
}
