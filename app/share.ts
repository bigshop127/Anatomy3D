import type {CameraPose,Pin,Section,SystemId,View} from './anatomy';
import {AREAS,REGIONS,type AreaId,type RegionId,type Side} from './regions.ts';
/** Everything needed to rebuild a view: used for share links (#s=…) and saved bookmarks. region is a joint region or a large area. */
export interface Snapshot {v:1;visible:SystemId[];selected:string[];hidden:string[];isolate:boolean;xray:number;section:Section|null;region:{id:RegionId|AreaId;side:Side}|null;peel:number;pins:Pin[];view:View;camera?:CameraPose}
const REGION_IDS=new Set<string>([...REGIONS,...AREAS].map(r=>r.id));
export interface Bookmark {name:string;snapshot:string;at:number}
export function encodeSnapshot(snapshot:Snapshot){
 let binary='';for(const byte of new TextEncoder().encode(JSON.stringify(snapshot)))binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
const strings=(v:unknown)=>Array.isArray(v)&&v.every(x=>typeof x==='string')?v as string[]:[];
const numbers=(v:unknown,n:number)=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x))?v as number[]:null;
/** Links can be edited by hand, so every field is checked and anything malformed falls back to a default. */
export function decodeSnapshot(text:string):Snapshot|null{
 try{
  const binary=atob(text.replace(/-/g,'+').replace(/_/g,'/'));const raw=JSON.parse(new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));
  if(raw?.v!==1)return null;
  const section=raw.section&&['sagittal','coronal','transverse'].includes(raw.section.axis)&&typeof raw.section.position==='number'?{axis:raw.section.axis,position:Math.min(1,Math.max(0,raw.section.position)),flip:!!raw.section.flip}:null;
  const region=raw.region&&REGION_IDS.has(raw.region.id)&&(raw.region.side==='left'||raw.region.side==='right')?{id:raw.region.id as RegionId|AreaId,side:raw.region.side as Side}:null;
  const pins=Array.isArray(raw.pins)?raw.pins.filter((p:Pin)=>p&&typeof p.id==='string'&&typeof p.part==='string'&&typeof p.label==='string'&&numbers(p.point,3)).map((p:Pin)=>({id:p.id,part:p.part,label:p.label.slice(0,80),point:p.point})):[];
  const position=numbers(raw.camera?.position,3),target=numbers(raw.camera?.target,3);
  return {v:1,visible:strings(raw.visible) as SystemId[],selected:strings(raw.selected),hidden:strings(raw.hidden),isolate:!!raw.isolate,xray:typeof raw.xray==='number'?Math.min(.95,Math.max(0,raw.xray)):0,section,region,peel:Number.isInteger(raw.peel)?Math.min(5,Math.max(0,raw.peel)):0,pins,view:['three-quarter','front','side','back'].includes(raw.view)?raw.view:'three-quarter',camera:position&&target?{position,target}:undefined};
 }catch{return null;}
}
const KEY='anatomy3d.bookmarks';
/** Bookmarks are a per-device convenience, so storage failures (private mode, blocked storage) just mean an empty list. */
export function loadBookmarks():Bookmark[]{try{const list=JSON.parse(localStorage.getItem(KEY)??'[]');return Array.isArray(list)?list.filter(b=>typeof b?.name==='string'&&typeof b?.snapshot==='string'):[];}catch{return [];}}
export function saveBookmarks(list:Bookmark[]){try{localStorage.setItem(KEY,JSON.stringify(list));return true;}catch{return false;}}
