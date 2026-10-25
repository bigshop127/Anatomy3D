import type {Atlas,Part} from './anatomy';
/** The part of meshoptimizer's decoder this needs (MeshoptDecoder from 'meshoptimizer/decoder'). */
export interface MeshDecoder {
 decodeVertexBuffer:(target:Uint8Array,count:number,size:number,source:Uint8Array,filter?:string)=>void;
 decodeIndexBuffer:(target:Uint8Array,count:number,size:number,source:Uint8Array)=>void;
}
export interface PartGeometry {position:Float32Array;normal:Int8Array;index:Uint32Array}
/** Model chunks hold, per part and back to back, three meshopt streams: positions as 16-bit steps of atlas.encoding.grid
 * from part.origin (8-byte vertices), octahedral 8-bit normals (4-byte vertices) and triangle indices. */
export function decodePart(atlas:Atlas,part:Part,chunk:Uint8Array,decoder:MeshDecoder):PartGeometry{
 const n=part.vertexCount,[offset,positionBytes,normalBytes,indexBytes]=part.streams,grid=atlas.encoding.grid,origin=part.origin;
 const steps=new Uint16Array(n*4);
 decoder.decodeVertexBuffer(new Uint8Array(steps.buffer),n,8,chunk.subarray(offset,offset+positionBytes));
 const position=new Float32Array(n*3);
 for(let v=0;v<n;v++)for(let a=0;a<3;a++)position[v*3+a]=origin[a]+steps[v*4+a]*grid;
 const packed=new Int8Array(n*4);
 decoder.decodeVertexBuffer(new Uint8Array(packed.buffer),n,4,chunk.subarray(offset+positionBytes,offset+positionBytes+normalBytes),'OCTAHEDRAL');
 // The GPU reads three signed bytes per normal; the fourth byte of each decoded vertex is padding.
 const normal=new Int8Array(n*3);
 for(let v=0;v<n;v++){normal[v*3]=packed[v*4];normal[v*3+1]=packed[v*4+1];normal[v*3+2]=packed[v*4+2];}
 const index=new Uint32Array(part.indexCount),start=offset+positionBytes+normalBytes;
 decoder.decodeIndexBuffer(new Uint8Array(index.buffer),part.indexCount,4,chunk.subarray(start,start+indexBytes));
 return {position,normal,index};
}
