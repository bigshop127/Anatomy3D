/** Traditional Chinese (Taiwan) names for BodyParts3D structures.
 * Terms are keyed by the lowercase English name with "left"/"right" removed; the side is added back as 左/右.
 * Overrides map a complete lowercase name when that rule would read badly.
 */
export interface NameData {terms:Record<string,string>;overrides:Record<string,string>;reviewed:string[]}
const normalize=(name:string)=>name.toLowerCase().replace(/\s+/g,' ').trim();
export const termKey=(name:string)=>normalize(name).replace(/\b(left|right) /g,'').replace(/\s+/g,' ').trim();
export function createNamer(data:NameData){
 const reviewed=new Set(data.reviewed);
 const zh=(name:string):string|undefined=>{
  const full=normalize(name);if(data.overrides[full])return data.overrides[full];
  const term=data.terms[termKey(name)];if(!term)return undefined;
  const sides=new Set(full.match(/\b(left|right)\b/g)??[]);
  return sides.size===1?(sides.has('left')?'左':'右')+term:term;
 };
 return {zh,label:(name:string)=>zh(name)??name,reviewed:(name:string)=>reviewed.has(termKey(name))||reviewed.has(normalize(name))};
}
