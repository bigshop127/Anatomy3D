import {asset} from './model-download.ts';
import {termKey} from './names.ts';
import type {Part} from './anatomy';
import type {CardIndex,MuscleCard} from './muscle-cards';
/** Where muscles attach (public/models/attachments.json, built by scripts/build-atlas.mjs): Z-Anatomy's origin and insertion
 * patches, plus ones worked out from where a muscle touches the bone for ends Z-Anatomy leaves out (source 'computed').
 * muscles are atlas muscle terms, host the part the patch lies on. Geometry is in the same meshopt-1 encoding as the model. */
export type End='origin'|'insertion';
export interface AttachmentPatch {id:string;source:'z-anatomy'|'computed';muscles:string[];name:string;end:End;side:'left'|'right';host:string;
 vertexCount:number;indexCount:number;bounds:[number[],number[]];chunk:number;streams:[number,number,number,number];origin:[number,number,number]}
export interface AttachmentCatalogue {encoding:{format:'meshopt-1';grid:number};patches:AttachmentPatch[];chunks:{url:string;bytes:number;gzip?:string;gzipBytes?:number}[]}
export const END_COLOR:Record<End,string>={origin:'#d1453b',insertion:'#2f6bd3'};
export const END_NAME:Record<End,string>={origin:'起點',insertion:'止點'};

let request:Promise<AttachmentCatalogue>|null=null;
/** Fetched once, the first time something needs it; a failure lets the next call try again. */
export function loadAttachments(){
 return request??=fetch(asset('models/attachments.json')).then(r=>{if(!r.ok)throw new Error('起止點資料載入失敗。');return r.json() as Promise<AttachmentCatalogue>;}).catch(e=>{request=null;throw e;});
}
export const sideOf=(name:string)=>/\bleft\b/i.test(name)?'left':/\bright\b/i.test(name)?'right':'';

const indexes=new WeakMap<AttachmentCatalogue,{byTerm:Map<string,AttachmentPatch[]>;byHost:Map<string,AttachmentPatch[]>}>();
function indexOf(catalogue:AttachmentCatalogue){
 let index=indexes.get(catalogue);if(index)return index;
 index={byTerm:new Map(),byHost:new Map()};
 for(const p of catalogue.patches){
  for(const t of p.muscles){const list=index.byTerm.get(t)??[];list.push(p);index.byTerm.set(t,list);}
  const list=index.byHost.get(p.host)??[];list.push(p);index.byHost.set(p.host,list);
 }
 indexes.set(catalogue,index);return index;
}
/** Patches for a selection: a muscle shows those of its whole card on its own side; a bone or ligament shows every patch on it. */
export function patchesFor(catalogue:AttachmentCatalogue,selected:Part[],cards:CardIndex|null){
 const {byTerm,byHost}=indexOf(catalogue),out=new Set<AttachmentPatch>();
 for(const part of selected){
  if(part.system==='muscular'){
   const term=termKey(part.name),side=sideOf(part.name),terms=cards?.byTerm.get(term)?.parts??[term];
   for(const t of terms)for(const p of byTerm.get(t)??[])if(!side||p.side===side)out.add(p);
  }else for(const p of byHost.get(part.id)??[])out.add(p);
 }
 return [...out];
}
export interface HostedMuscle {key:string;card?:MuscleCard;term:string;ends:End[];sides:('left'|'right')[]}
/** The muscles attached to a part, one entry per card (or per muscle without a card), origins first. */
export function musclesOn(catalogue:AttachmentCatalogue,hostId:string,cards:CardIndex|null):HostedMuscle[]{
 const map=new Map<string,HostedMuscle>();
 for(const p of indexOf(catalogue).byHost.get(hostId)??[])for(const t of p.muscles){
  const card=cards?.byTerm.get(t),key=card?.id??t,entry=map.get(key)??{key,card,term:t,ends:[],sides:[]};
  if(!entry.ends.includes(p.end))entry.ends.push(p.end);if(!entry.sides.includes(p.side))entry.sides.push(p.side);map.set(key,entry);
 }
 return [...map.values()].sort((a,b)=>+a.ends.includes('insertion')-+b.ends.includes('insertion')||(a.card?.zh??a.term).localeCompare(b.card?.zh??b.term,'zh-Hant'));
}
