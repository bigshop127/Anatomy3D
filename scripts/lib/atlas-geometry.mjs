// Shared loader for scripts that need the geometry behind public/models/atlas.json.
import {readFile} from 'node:fs/promises';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {decodePart} from '../../app/model-decode.ts';
import {fixSystems} from '../../app/system-fixes.ts';

export const root=new URL('../../',import.meta.url);
/** The atlas exactly as stored (build-atlas.mjs must not bake in the app's system fixes). */
export async function readAtlas(){return JSON.parse(await readFile(new URL('public/models/atlas.json',root),'utf8'));}
/** The atlas as the app sees it, with app/system-fixes.ts applied. */
export async function loadAtlas(){const atlas=await readAtlas();fixSystems(atlas);return atlas;}
export const readChunks=atlas=>Promise.all(atlas.chunks.map(c=>readFile(new URL('public'+c.url,root))));
/** Returns geometryOf(part) → {position: Float32Array, normal, index: Uint32Array}; normals are normalized signed integers
 * (Int8Array for meshopt-1, Int16Array for the uncompressed format used before v0.7.0, which build-atlas.mjs converts once). */
export async function loadGeometry(atlas){
 const chunks=await readChunks(atlas);
 if(atlas.encoding){
  if(atlas.encoding.format!=='meshopt-1')throw new Error(`Unknown model encoding: ${atlas.encoding.format}`);
  await MeshoptDecoder.ready;
  return p=>decodePart(atlas,p,chunks[p.chunk],MeshoptDecoder);
 }
 const buffers=chunks.map(b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
 return p=>({position:new Float32Array(buffers[p.chunk],p.positions,p.vertexCount*3),normal:new Int16Array(buffers[p.chunk],p.normals,p.vertexCount*3),index:new Uint32Array(buffers[p.chunk],p.indices,p.indexCount)});
}
