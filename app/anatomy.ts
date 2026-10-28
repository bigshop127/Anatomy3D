import {termKey} from './names';
export type SystemId = 'skeletal'|'muscular'|'arterial'|'venous'|'nervous'|'digestive'|'respiratory'|'urinary'|'reproductive'|'lymphatic'|'endocrine'|'integumentary'|'connective'|'fascia'|'sensory'|'cardiac'|'pregnancy';
export const SYSTEMS: {id:SystemId;name:string;color:string;description:string}[] = [
 {id:'skeletal',name:'骨骼',color:'#e2d9ba',description:'骨骼構成身體的支架，保護內臟，並提供肌肉附著點。骨內組織也負責儲存礦物質和製造血球。'},
 {id:'muscular',name:'肌肉',color:'#a4483d',description:'骨骼肌收縮時拉動附著點而產生動作。肌肉與肌腱一起帶動關節、維持姿勢，並產生熱量。'},
 {id:'cardiac',name:'心臟',color:'#b96760',description:'心臟是有四個腔室的肌肉幫浦，瓣膜讓血液單向流經肺循環與體循環。'},
 {id:'sensory',name:'感覺器官',color:'#b0c8ce',description:'這些構造負責視覺、聽覺、平衡等特殊感覺，由特化組織接收刺激，再交給神經系統傳遞。'},
 {id:'arterial',name:'動脈',color:'#c05245',description:'心臟推動血液循環。動脈把血液從心臟送往全身組織；肺循環的動脈則把血液送到肺。'},
 {id:'venous',name:'靜脈',color:'#527c9f',description:'靜脈把血液送回心臟。淺層與深層靜脈網收集組織的血液；肺靜脈把充氧的血液從肺帶回心臟。'},
 {id:'nervous',name:'神經',color:'#d8b565',description:'腦、脊髓與周邊神經負責傳遞和處理訊號，支撐感覺、動作、協調，以及身體功能的自動調節。'},
 {id:'respiratory',name:'呼吸',color:'#b98991',description:'呼吸道把空氣送進肺，氧氣和二氧化碳在肺泡與血液之間交換。呼吸靠呼吸肌造成的壓力變化完成。'},
 {id:'digestive',name:'消化',color:'#b8916b',description:'消化道分解食物、吸收養分與水分，並把殘渣往下推送。附屬器官提供膽汁與消化酵素。'},
 {id:'urinary',name:'泌尿',color:'#b47961',description:'腎臟過濾血液，調節水分、電解質與酸鹼平衡。尿液經輸尿管流到膀胱，再由尿道排出。'},
 {id:'lymphatic',name:'淋巴',color:'#879f7c',description:'淋巴管把組織中多出的液體送回血液循環；淋巴結等淋巴器官參與免疫監控與反應。'},
 {id:'endocrine',name:'內分泌',color:'#c5a09a',description:'內分泌器官把荷爾蒙釋放到血液中，協調代謝、生長、壓力反應與生殖等功能。'},
 {id:'reproductive',name:'生殖',color:'#bda098',description:'生殖器官生成並輸送精子或卵子、分泌性荷爾蒙；女性的子宮是胚胎著床與發育的地方，乳房在產後分泌乳汁。'},
 {id:'integumentary',name:'體表',color:'#ba9b7d',description:'體表提供外觀參考。皮膚系統形成保護屏障，也參與感覺與體溫調節。'},
 {id:'connective',name:'結締組織',color:'#aec3bb',description:'韌帶、關節囊、關節盤、滑囊、腱鞘等結締組織負責支撐、連接與分隔各構造，穩定關節並分散力學負荷。'},
 {id:'fascia',name:'筋膜',color:'#d8d0bd',description:'筋膜與腱膜包覆肌肉、分隔肌群，並把肌肉的力量傳到骨頭。打開後會蓋住下面的肌肉，所以預設不顯示。'},
 {id:'pregnancy',name:'懷孕（參考）',color:'#b88380',description:'胎盤、臍帶和羊膜是懷孕時才有的構造，負責母體與胎兒之間的物質交換。女性模型裡的是足月胎盤的參考模型，放在腹部前方、跟身體分開，所以預設不顯示。'},
];
/** streams: byte offset of the part in its chunk, then the encoded sizes of its positions, normals and indices (see model-decode.ts). */
export interface Part {id:string;name:string;label?:string;layer?:number;conceptId:string;system:SystemId;source:string;chunk:number;streams:[number,number,number,number];origin:[number,number,number];vertexCount:number;indexCount:number;bounds:[number[],number[]]}
export interface Concept {id:string;name:string;label?:string;elements:string[]}
export interface ModelSource {name:string;license:string;url:string}
export interface Atlas {version:string;sex?:'male'|'female';source?:string;scope?:string;
 /** A model of one side only (the high-detail knee); mirrored when it was flipped to show the other side. */ side?:'left'|'right';mirrored?:boolean;encoding:{format:'meshopt-1';grid:number};sources:Record<string,ModelSource>;parts:Part[];concepts:Concept[];chunks:{url:string;bytes:number;gzip?:string;gzipBytes?:number}[];triangles:number}
export type View = 'three-quarter'|'front'|'back'|'side';
export type SectionAxis = 'sagittal'|'coronal'|'transverse';
/** position places the cut along the axis (0 = right/back/bottom, 1 = left/front/top); the lower side is kept unless flip. */
export interface Section {axis:SectionAxis;position:number;flip:boolean}
export type Box = [number[],number[]];
export interface Pin {id:string;part:string;label:string;point:number[]}
export interface CameraPose {position:number[];target:number[]}
export interface SceneState {inspectorOpen?:boolean;explode:number;visible:SystemId[];selected:string[];isolate:boolean;view:View;rotate:boolean;reset:number;
 /** Parts the user hid one by one. */ hidden:string[];
 /** Transparency of everything outside the selection, 0 turns X-ray off. */ xray:number;
 section:Section|null;
 /** Body region cut out by a clipping box; look is the camera direction for framing it. A large area (upper body, a limb)
  * lists its parts instead and shows them whole; its box only frames the camera. */ region:{box:Box;look:number[];parts?:ReadonlySet<string>}|null;
 /** Number of muscle layers peeled away from the surface. */ peel:number;
 pins:Pin[];camera?:{pose:CameraPose;n:number};
 /** Dolly the camera to this distance from its target (the zoom slider); n counts requests. */ zoom?:{distance:number;n:number};
 /** Muscle attachment patches to draw (ids from attachments.json); markThrough draws the selected muscles see-through so the
  * patches under them show. */ marks?:string[];markThrough?:boolean;
 /** Parts shown along with an isolated selection: the bones its attachment patches lie on. */ companions?:string[];
 /** A box to fly the camera to, looking from look (or the current direction); n counts requests. */ frame?:{box:Box;look?:number[];n:number};
 /** No names on hover (a quiz question is open). */ hideNames?:boolean}
export const overlaps=(a:Box,b:Box)=>a[0].every((v,i)=>v<=b[1][i]&&a[1][i]>=b[0][i]);
/** One rule for what is drawn, shared by the scene and the counts in the interface. */
export function visibilityTest(s:SceneState){
 const visible=new Set(s.visible),selection=new Set(s.selected),hidden=new Set(s.hidden),companions=new Set(s.companions);
 return (p:Part)=>{
  if(selection.has(p.id))return true;
  if(s.isolate)return companions.has(p.id);
  if(!visible.has(p.system)||hidden.has(p.id))return false;
  if(p.layer&&p.layer<=s.peel)return false;
  return !s.region||(s.region.parts?s.region.parts.has(p.id):overlaps(p.bounds as Box,s.region.box));
 };
}
/** Fascia is left out: it wraps the muscles and would hide them. */
export const DEFAULT_VISIBLE:SystemId[] = ['cardiac','sensory','skeletal','muscular','arterial','venous','nervous','respiratory','digestive','urinary','lymphatic','endocrine','reproductive','connective'];
/** The female model has almost no muscle, so its skin (drawn faint) is on to show the body's outline. */
export const defaultVisible=(model:{id:string}):SystemId[]=>model.id==='female'?[...DEFAULT_VISIBLE,'integumentary']:DEFAULT_VISIBLE;
export const EXPLANATIONS:Record<string,string> = {
 'heart':'位於胸腔的肌肉幫浦。右半邊把血液送到肺，左半邊把血液送往全身。',
 'liver':'位於橫膈右下方的大型器官，負責處理吸收的養分、製造膽汁，並合成許多血液中的蛋白質。',
 'brain':'神經系統的中樞器官，各區域互相連結，支撐知覺、動作、記憶、語言，以及身體功能的調節。',
 'stomach':'位於食道與小腸之間的肌肉囊袋，儲存食物並與胃酸、酵素混合後，再送進十二指腸。',
 'spleen':'位於左上腹的淋巴器官，過濾血液、清除老化的血球，並參與免疫反應。',
 'pancreas':'同時具有消化與內分泌功能的腹部器官，分泌消化酵素到小腸，並釋放胰島素、升糖素等荷爾蒙。',
 'urinary bladder':'位於骨盆的肌肉囊袋，儲存由腎臟經輸尿管送來的尿液。',
 'trachea':'連接喉與支氣管的主要氣道，軟骨環讓氣道在呼吸時保持暢通。',
 'diaphragm':'分隔胸腔與腹腔的寬大肌肉。收縮時胸腔容積變大，幫助吸氣。',
 'uterus':'位於骨盆、膀胱與直腸之間的肌肉性中空器官。內膜隨月經週期變化，懷孕時讓胚胎著床並發育。',
 'ovary':'位於骨盆兩側的生殖腺，含有發育中的卵細胞，並分泌雌激素與黃體素。',
 'uterine tube':'從子宮角伸向卵巢的細管，末端的繖抓取排出的卵子，受精通常發生在壺腹。',
 'vagina':'連接子宮頸與體外的肌肉性管道，是月經排出與產道的一部分。',
 'breast':'乳房由乳腺葉、輸乳管和大量脂肪組成，懸韌帶把它固定在胸壁上；產後乳腺分泌乳汁。',
 'placenta':'懷孕時附著在子宮壁上的器官，經臍帶連接胎兒，負責氧氣、養分與代謝廢物的交換。',
};
export const hasExplanation=(name:string)=>termKey(name) in EXPLANATIONS;
export function explanation(name:string,system:SystemId){return EXPLANATIONS[termKey(name)] ?? SYSTEMS.find(s=>s.id===system)?.description ?? '';}
