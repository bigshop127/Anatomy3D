// Does a line of a muscle card name a given bone? Used to check that an attachment patch sits on a bone the card names for that
// end, and to choose which bones a computed attachment covers. The card text is Chinese prose, so this is a set of keywords per
// bone plus spinal levels (C3–C6, T1–T12) and rib numbers (第 3–5 肋, 下 4 肋); it can miss, so its results are for review.
const KEYS={
 'hip bone':['髂','坐骨','恥','髖臼','骨盆','髖骨'],sacrum:['薦'],coccyx:['尾骨'],
 scapula:['肩胛','肩峰','喙突','盂','棘上窩','棘下窩'],clavicle:['鎖骨'],
 humerus:['肱骨','結節間溝','上髁','大結節','小結節','三角肌粗隆','髁上嵴'],ulna:['尺骨','鷹嘴','冠狀突'],radius:['橈骨'],
 femur:['股骨','轉子','粗線'],tibia:['脛骨'],fibula:['腓骨'],patella:['髕'],calcaneus:['跟骨'],talus:['距骨'],
 'navicular bone':['舟骨','舟狀'],'cuboid bone':['骰骨'],'medial cuneiform bone':['楔'],'intermediate cuneiform bone':['楔'],'lateral cuneiform bone':['楔'],
 'temporal bone':['顳','乳突','莖突'],'zygomatic bone':['顴'],'occipital bone':['枕'],'parietal bone':['頂骨'],'frontal bone':['額'],
 mandible:['下頷'],maxilla:['上頷'],'sphenoid bone':['蝶','翼突','翼外板','翼內板'],'palatine bone':['顎骨'],'hyoid bone':['舌骨'],
 manubrium:['胸骨'],'body of sternum':['胸骨'],'xiphoid process':['劍突','胸骨'],'thyroid cartilage':['甲狀軟骨'],'cricoid cartilage':['環狀軟骨'],
 scaphoid:['手舟','舟狀'],lunate:['月狀'],triquetral:['三角骨'],pisiform:['豌豆'],trapezium:['大多角'],trapezoid:['小多角'],capitate:['頭狀'],hamate:['鉤'],
};
const ORDINAL=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth'];
const DIGITS={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,十一:11,十二:12};
const LEVEL={C:0,T:100,L:200,S:300};
/** C4 for the fourth cervical vertebra, T12, L1; the atlas and the axis are C1 and C2. */
export function spinalLevel(term){
 if(term==='atlas')return LEVEL.C+1;if(term==='axis')return LEVEL.C+2;
 const m=term.match(/^(\w+) (cervical|thoracic|lumbar) vertebra$/);
 return m?LEVEL[{cervical:'C',thoracic:'T',lumbar:'L'}[m[2]]]+ORDINAL.indexOf(m[1])+1:null;
}
export function ribNumber(term){const m=term.match(/^(\w+) (rib|costal cartilage)$/);return m?ORDINAL.indexOf(m[1])+1:null;}
const number=s=>DIGITS[s]??(+s||null);
/** True when the text names the bone (term: lowercase English without the side; zh: its Chinese name). */
export function namesBone(text,term,zh){
 const level=spinalLevel(term);
 if(level!==null){
  for(const m of text.matchAll(/([CTLS])(\d{1,2})(?:\s*[–-]\s*([CTLS])?(\d{1,2}))?/g)){
   const lo=LEVEL[m[1]]+ +m[2],hi=LEVEL[m[3]??m[1]]+(m[4]?+m[4]:+m[2]);if(lo<=level&&level<=hi)return true;
  }
  if(term==='atlas'&&text.includes('寰椎')||term==='axis'&&text.includes('樞椎'))return true;
  return text.includes({0:'頸椎',100:'胸椎',200:'腰椎'}[Math.floor(level/100)*100]);
 }
 const rib=ribNumber(term);
 if(rib!==null){
  if(/所有肋/.test(text))return true;
  for(const m of text.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*(?:[–-]\s*([一二三四五六七八九十\d]+))?\s*(?:（[^）]*）\s*)?(?:肋|根肋)/g)){
   const lo=number(m[1]),hi=m[2]?number(m[2]):lo;if(lo<=rib&&rib<=hi)return true;
  }
  for(const m of text.matchAll(/([上下])\s*([一二三四五六七八九十\d]+)\s*(?:根)?肋/g)){const n=number(m[2]);if(m[1]==='下'?rib>12-n:rib<=n)return true;}
  return false;
 }
 if(/metatarsal/.test(term))return text.includes('蹠骨');
 if(/metacarpal/.test(term))return text.includes('掌骨');
 if(/phalanx/.test(term))return /toe/.test(term)?/趾骨|節趾/.test(text):/指骨|節指/.test(text);
 return (KEYS[term]??[zh.replace(/（.*）/,'').replace(/^[左右]/,'')]).some(k=>text.includes(k));
}
