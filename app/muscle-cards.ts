/** Muscle cards checked by the owner. The master copy is one Markdown page per region in the owner's notes;
 * scripts/muscle-cards.mjs apply copies the checked cards into app/muscle-cards.json (batch 06 shows them).
 * Text fields keep the page's lines in order; a nested bullet such as "上束：…" is its own line. */
export type CardRegion='neck'|'shoulder'|'elbow'|'wrist'|'trunk'|'hip'|'knee'|'ankle'|'tmj';
/** One nerve of the 神經支配 line. term is the atlas nerve term when the Chinese name matches one, so the app can
 * select the nerve and every muscle it supplies; roots are the main spinal roots, minorRoots the lesser ones. */
export interface Innervation {nerve:string;term?:string;roots?:string;minorRoots?:string;note?:string}
export interface MuscleCard {
 id:string;zh:string;en:string;region:CardRegion;
 /** Atlas muscle terms (lowercase English without left/right) this card describes. */
 parts:string[];
 origin:string[];insertion:string[];primary:string[];secondary:string[];
 innervation:Innervation[];innervationText:string[];
 blood:string[];palpation:string[];sources:string[];notes:string[];
 /** Planned fields (decided 2026-10-25), absent until a later batch fills them. */
 mmt?:string[];stretch?:string[];triggerPoints?:string[];injuries?:string[];
}
export interface MuscleCardData {version:1;cards:MuscleCard[]}
