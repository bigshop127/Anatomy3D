import {flushSync} from 'react-dom';
import {registerAtlasTools} from './agent-tools';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,ArrowUpRight,Bookmark,BookmarkPlus,ChevronRight,EyeOff,FlipHorizontal2,Focus,Ghost,GraduationCap,Info,Layers3,Link,Maximize2,Minimize2,Pause,PersonStanding,Pin,RotateCcw,RotateCw,Search,SquareStack,Undo2,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Combobox,ComboboxInput,ComboboxContent,ComboboxList,ComboboxItem,ComboboxEmpty} from '@/components/ui/combobox';
import AnatomyScene from './scene';
import {asset} from './model-download';
import {createNamer,type NameData} from './names';
import nameData from './names.zh-TW.json';
import {AREAS,REGIONS,areaLook,areaParts,isArea,regionBox,regionLook,type AreaId,type RegionId,type Side} from './regions';
import areaMembers from './area-members.json';
import {fixSystems} from './system-fixes';
import muscleLayers from './muscle-layers.json';
import {decodeSnapshot,encodeSnapshot,loadBookmarks,saveBookmarks,type Bookmark as SavedView,type Snapshot} from './share';
import {DEFAULT_VISIBLE,SYSTEMS,explanation,hasExplanation,visibilityTest,type Atlas,type Concept,type CameraPose,type Part,type SceneState,type SectionAxis,type SystemId,type View} from './anatomy';
import {termKey} from './names';
import {cardOf,loadCards,nerveMuscles,nerveTree,type CardIndex,type MuscleCard} from './muscle-cards';
import {END_NAME,loadAttachments,musclesOn,patchesFor,sideOf,type AttachmentCatalogue,type HostedMuscle} from './attachments';
import {CardView,HostedView,NerveView,useSections,type MarksProps} from './structure-info';
import {QuizCard,QuizSetup,useQuiz,type QuizStep} from './quiz-view';
import type {QuizView,Scope} from './quiz';
const namer=createNamer(nameData as NameData);
const SIDE_ZH:Record<string,string>={left:'左',right:'右'};
const MARKS_KEY='anatomy3d.marks';
/** Showing attachments is a per-device preference, on unless turned off. */
const loadMarks=()=>{try{return localStorage.getItem(MARKS_KEY)!=='0';}catch{return true;}};
const SUGGESTED=['heart','brain','vertebral column','scapula','humerus','pelvis','femur','skull','liver','stomach'];
const VIEWS:{id:View;short:string;name:string}[]=[{id:'three-quarter',short:'斜',name:'斜前方'},{id:'front',short:'前',name:'正面'},{id:'side',short:'側',name:'側面'},{id:'back',short:'後',name:'背面'}];
type Tool='explode'|'xray'|'section'|'peel';
const TOOLS:{id:Tool;name:string}[]=[{id:'explode',name:'拆開'},{id:'xray',name:'透視'},{id:'section',name:'剖面'},{id:'peel',name:'剝層'}];
const LAYERS=muscleLayers.layers as Record<string,number>,DEEPEST=Math.max(...Object.values(LAYERS));
const AREA_DATA=areaMembers as {keys:string[];members:Record<string,number>};
const PEEL_TEXT=['全部肌肉','去掉淺層肌','去掉到第 2 層','去掉到第 3 層','去掉到第 4 層','肌肉全部去掉'];
const AXES:{id:SectionAxis;name:string;ends:[string,string]}[]=[{id:'sagittal',name:'矢狀',ends:['右側','左側']},{id:'coronal',name:'冠狀',ends:['背側','前側']},{id:'transverse',name:'水平',ends:['下方','上方']}];
const XRAY_DEFAULT=.7;
type Panel='layers'|'search'|'regions'|'bookmarks'|'quiz';
const initial:SceneState={explode:0,visible:DEFAULT_VISIBLE,selected:[],isolate:false,view:'three-quarter',rotate:false,reset:0,hidden:[],xray:0,section:null,region:null,peel:0,pins:[]};
const sliderValue=(v:number|readonly number[])=>Array.isArray(v)?v[0]:v as number;
export default function Home(){
 const detailTitle=useRef<HTMLHeadingElement>(null),autoXray=useRef(false),lastXray=useRef(XRAY_DEFAULT),current=useRef(initial);
 const [atlas,setAtlas]=useState<Atlas|null>(null),[state,setState]=useState(initial),[progress,setProgress]=useState(0),[error,setError]=useState(''),[panel,setPanel]=useState<Panel|null>(null),[details,setDetails]=useState(false),[about,setAbout]=useState(false),[query,setQuery]=useState(''),[chosen,setChosen]=useState<Concept|null>(null);
 const [region,setRegion]=useState<{id:RegionId|AreaId;side:Side}|null>(null),[side,setSide]=useState<Side>('right');
 const [tool,setTool]=useState<Tool>('explode'),[multi,setMulti]=useState(false),[undo,setUndo]=useState<string[][]>([]);
 const [bookmarks,setBookmarks]=useState<SavedView[]>(loadBookmarks),[bookmarkName,setBookmarkName]=useState(''),[shareNote,setShareNote]=useState(''),[shareUrl,setShareUrl]=useState('');
 const cameraPose=useRef<CameraPose|null>(null),tapPoint=useRef<{id:string;point?:number[]}|null>(null),cameraN=useRef(0);
 // Muscle cards and attachments load after the model; focus remembers that the selection is a nerve with its muscles.
 const [cards,setCards]=useState<CardIndex|null>(null),[catalogue,setCatalogue]=useState<AttachmentCatalogue|null>(null),[catalogueFailed,setCatalogueFailed]=useState(false),[marksFailed,setMarksFailed]=useState(false);
 const [marksOn,setMarksOn]=useState(loadMarks),[focus,setFocus]=useState<{term:string;side:string;ids:string[]}|null>(null),sections=useSections();
 // On a phone the detail panel can be pulled up to read a long card.
 const [tall,setTall]=useState(false);
 // Right after a tap on the model opens or fills the detail panel, the panel lets touches through for a moment, so the second
 // tap of a double tap reaches the model instead of a button that just appeared under the finger.
 const [settling,setSettling]=useState(false),settleTimer=useRef(0);
 current.current=state;
 // Quiz mode takes over the view while a round runs (enterQuiz and the rest are below); frameN counts camera requests.
 const quizBefore=useRef<Snapshot|null>(null),frameN=useRef(0),quizOn=useRef(false);
 const quiz=useQuiz({atlas,cards,label:term=>namer.zh(term),enter:scope=>enterQuiz(scope),show:(v,step)=>showQuiz(v,step),leave:()=>leaveQuiz()});
 quizOn.current=quiz.running;
 // Panels above the dock follow its real height, which changes with the active tool. The detail sheet lives in a portal, so the value goes on the root element.
 const dock=useRef<HTMLDivElement>(null);
 useEffect(()=>{const d=dock.current;if(!d)return;const observer=new ResizeObserver(()=>document.documentElement.style.setProperty('--dock-h',`${d.offsetHeight}px`));observer.observe(d);return()=>observer.disconnect();},[]);
 useEffect(()=>{const abort=new AbortController();setProgress(0);setError('');setAtlas(null);setChosen(null);setDetails(false);setState({...initial,visible:DEFAULT_VISIBLE});fetch(asset('models/atlas.json'),{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error('人體構造目錄載入失敗。');return r.json();}).then(data=>{const loaded=data as Atlas;fixSystems(loaded);loaded.parts.forEach(p=>{p.label=namer.label(p.name);p.layer=LAYERS[p.id];});loaded.concepts.forEach(c=>{c.label=namer.label(c.name);});setAtlas(loaded);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>abort.abort();},[]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='/'&&!quizOn.current&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLTextAreaElement)){e.preventDefault();setPanel('search');setDetails(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 useEffect(()=>{if(!atlas)return;let live=true;loadCards().then(c=>{if(live)setCards(c);}).catch(()=>{});return()=>{live=false;};},[atlas]);
 // The attachment catalogue comes with the first selection; a failed load (of it or of the patches) is tried again on the next one.
 useEffect(()=>{setMarksFailed(false);},[state.selected]);
 useEffect(()=>{if(!state.selected.length||catalogue||quiz.running)return;let live=true;setCatalogueFailed(false);loadAttachments().then(c=>{if(live)setCatalogue(c);}).catch(()=>{if(live)setCatalogueFailed(true);});return()=>{live=false;};},[state.selected,catalogue,quiz.running]);
 const parts=useMemo(()=>new Map(atlas?.parts.map(p=>[p.id,p])),[atlas]);
 const counts=useMemo(()=>Object.fromEntries(SYSTEMS.map(s=>[s.id,atlas?.parts.filter(p=>p.system===s.id).length??0])),[atlas]);
 const activeSystems=SYSTEMS.filter(s=>counts[s.id]>0);
 const selectedParts=state.selected.map(id=>parts.get(id)).filter(p=>!!p),selected=selectedParts[0],system=SYSTEMS.find(s=>s.id===selected?.system);
 // The card of the selection when every selected part is a muscle on the same card.
 const selectionCards=new Set(selectedParts.map(p=>p.system==='muscular'?cardOf(cards,p.name):undefined)),card=selectionCards.size===1?[...selectionCards][0]:undefined;
 // One side when every selected part is on it; parts from search often come in left and right pairs.
 const selectionSides=new Set(selectedParts.map(p=>sideOf(p.name))),selectionSide=selectionSides.size===1?[...selectionSides][0]:'';
 // A nerve selected with all its muscles would cover the skeleton in patches, so it shows none.
 const marks=useMemo(()=>catalogue&&marksOn&&!quiz.running&&focus?.ids!==state.selected?patchesFor(catalogue,state.selected.map(id=>parts.get(id)).filter((p):p is Part=>!!p),cards):[],[catalogue,marksOn,quiz.running,focus,state.selected,parts,cards]);
 const markIds=useMemo(()=>marks.map(p=>p.id),[marks]);
 // An isolated muscle keeps the bones (and ligaments) its attachments lie on; its own patches show through it. A fascia
 // would wrap the whole view, so it stays hidden.
 const companions=useMemo(()=>state.isolate&&marks.length?[...new Set(marks.map(p=>p.host))].filter(id=>parts.get(id)?.system!=='fascia'):[],[state.isolate,marks,parts]);
 const markThrough=marks.length>0&&selectedParts.some(p=>p.system==='muscular');
 const hosted=useMemo(()=>{const p=state.selected.length===1?parts.get(state.selected[0]):undefined;return catalogue&&p&&p.system!=='muscular'?musclesOn(catalogue,p.id,cards):[];},[catalogue,state.selected,parts,cards]);
 const nerveFocus=focus&&focus.ids===state.selected?focus:null;
 // A selection of nerves (one nerve, or a nerve with its branches from search) lists the muscles of the one supplying most.
 const nerveTerm=useMemo(()=>{
  if(focus?.ids===state.selected)return focus.term;
  const list=state.selected.map(id=>parts.get(id));if(!list.length||list.some(p=>p?.system!=='nervous'))return '';
  const terms=[...new Set(list.map(p=>termKey(p!.name)))];if(!cards)return terms.length===1?terms[0]:'';
  const size=(t:string)=>{const m=nerveMuscles(cards,t);return m.direct.length+m.branches.reduce((n,b)=>n+b.cards.length,0);};
  const best=terms.reduce((a,b)=>size(b)>size(a)?b:a);return size(best)||terms.length===1?best:'';
 },[focus,state.selected,parts,cards]);
 const visibleCount=useMemo(()=>{if(!atlas)return 0;const shown=visibilityTest(state);return atlas.parts.filter(shown).length;},[atlas,state]);
 const results=useMemo(()=>{
  if(!atlas)return[];const term=query.toLowerCase().trim();
  if(!term)return SUGGESTED.map(name=>atlas.concepts.find(c=>c.name.toLowerCase()===name)).filter((x):x is Concept=>!!x);
  // Chinese and English names both match; names that start with the term come first, then shorter names.
  const scored:[number,number,Concept][]=[];
  for(const c of atlas.concepts){const zh=c.label??'',en=c.name.toLowerCase();if(!zh.includes(term)&&!en.includes(term)&&!c.id.toLowerCase().includes(term))continue;scored.push([zh.startsWith(term)||en.startsWith(term)?0:1,(zh||en).length,c]);}
  return scored.sort((a,b)=>a[0]-b[0]||a[1]-b[1]).slice(0,80).map(s=>s[2]);
 },[atlas,query]);
 const setXray=(value:number)=>{autoXray.current=false;if(value>0)lastXray.current=value;setState(s=>({...s,xray:value}));};
 const choose=(c:Concept)=>{
  // Structures picked from search are often buried, so X-ray turns on until the selection is cleared.
  if(!current.current.xray)autoXray.current=true;
  setChosen(c);setState(s=>({...s,selected:c.elements,isolate:false,rotate:false,xray:s.xray||XRAY_DEFAULT}));setDetails(true);setPanel(null);
 };
 useEffect(()=>{if(!atlas)return;return registerAtlasTools(atlas,c=>flushSync(()=>choose(c)));},[atlas]);
 const groupOf=(ids:string[]):Concept=>{const p=parts.get(ids[0]);return ids.length===1&&p?{id:p.conceptId,name:p.name,label:p.label,elements:ids}:{id:'',name:`${ids.length} structures`,label:`已選 ${ids.length} 個構造`,elements:ids};};
 const choosePart=(id:string,point?:number[])=>{
  if(quiz.running){quiz.tap(id,point);return;}
  const p=parts.get(id);if(!p)return;tapPoint.current={id,point};
  setSettling(true);clearTimeout(settleTimer.current);settleTimer.current=window.setTimeout(()=>setSettling(false),400);
  const ids=multi?(state.selected.includes(id)?state.selected.filter(x=>x!==id):[...state.selected,id]):[id];
  if(!ids.length){clearSelection();return;}
  setChosen(groupOf(ids));setState(s=>({...s,selected:ids,isolate:false,rotate:false}));setDetails(true);setPanel(null);
 };
 // X-ray that search switched on goes back off with the selection; read the flag before React runs the updater.
 const dropAutoXray=()=>{const auto=autoXray.current;autoXray.current=false;return (xray:number)=>auto?0:xray;};
 const clearSelection=()=>{const xray=dropAutoXray();setState(s=>({...s,selected:[],isolate:false,xray:xray(s.xray)}));setDetails(false);};
 const hideSelection=()=>{const xray=dropAutoXray();setUndo(u=>[...u,state.hidden]);setState(s=>({...s,hidden:[...new Set([...s.hidden,...s.selected])],selected:[],isolate:false,xray:xray(s.xray)}));setDetails(false);};
 const undoHide=()=>{const previous=undo.at(-1);if(!previous)return;setUndo(u=>u.slice(0,-1));setState(s=>({...s,hidden:previous}));};
 const sideOk=(name:string,side:string)=>!side||!sideOf(name)||sideOf(name)===side;
 const partIds=(test:(p:Part)=>boolean)=>atlas?atlas.parts.filter(test).map(p=>p.id):[];
 const nameOf=(term:string)=>namer.zh(term)??term;
 /** Selects parts as one named group; xray as when choosing from search, since the parts spread over the body. A muscle picked
  * from a bone it attaches to stays isolated if the bone was (keep). */
 const selectGroup=(ids:string[],concept:Concept,xray=false,keep=false)=>{
  if(!ids.length)return;if(xray&&!current.current.xray)autoXray.current=true;
  setChosen(concept);setState(s=>({...s,selected:ids,isolate:keep&&s.isolate,rotate:false,xray:xray?(s.xray||XRAY_DEFAULT):s.xray}));setDetails(true);setPanel(null);
 };
 const cardIds=(c:MuscleCard,side:string)=>partIds(p=>p.system==='muscular'&&c.parts.includes(termKey(p.name))&&sideOk(p.name,side));
 const selectCard=(c:MuscleCard,side:string,keep=false)=>{const ids=cardIds(c,side);selectGroup(ids,{id:`card:${c.id}`,name:c.en,label:(SIDE_ZH[side]??'')+c.zh,elements:ids},false,keep);};
 /** The nerve (with its branches) and every muscle the cards say it supplies, on one side. */
 const selectNerve=(term:string,side:string)=>{
  if(!cards)return;const {direct,branches}=nerveMuscles(cards,term),terms=new Set([...direct,...branches.flatMap(b=>b.cards)].flatMap(c=>c.parts)),tree=nerveTree(term);
  // Nerves first, so the panel reads as the nerve's.
  const ids=partIds(p=>sideOk(p.name,side)&&(p.system==='nervous'?tree.has(termKey(p.name)):p.system==='muscular'&&terms.has(termKey(p.name)))).sort((x,y)=>+(parts.get(y)?.system==='nervous')-+(parts.get(x)?.system==='nervous'));
  if(!ids.length)return;
  selectGroup(ids,{id:'',name:term,label:`${SIDE_ZH[side]??''}${nameOf(term)}與它支配的肌肉`,elements:ids},true);setFocus({term,side,ids});
 };
 const pickHosted=(m:HostedMuscle)=>{const side=m.sides.length===1?m.sides[0]:'';if(m.card){selectCard(m.card,side,true);return;}const ids=partIds(p=>p.system==='muscular'&&termKey(p.name)===m.term&&sideOk(p.name,side));selectGroup(ids,groupOf(ids),false,true);};
 /** A tapped attachment patch selects its muscle; a patch several muscles share (a common tendon) selects them all. */
 const selectPatch=(id:string)=>{
  const patch=catalogue?.patches.find(p=>p.id===id);if(!patch)return;
  const owners=[...new Set(patch.muscles.map(t=>cards?.byTerm.get(t)))];
  if(owners.length===1&&owners[0]){selectCard(owners[0],patch.side,true);return;}
  const ids=partIds(p=>p.system==='muscular'&&patch.muscles.includes(termKey(p.name))&&sideOk(p.name,patch.side));
  selectGroup(ids,{id:'',name:patch.name,label:`${END_NAME[patch.end]}在這裡的 ${ids.length} 條肌肉`,elements:ids},false,true);
 };
 const wholeCard=useMemo(()=>card&&card.parts.length>1?cardIds(card,selectionSide):[],[card,selectionSide,atlas]);
 const marksNote=(()=>{
  if(!marksOn)return '';
  if(catalogueFailed||marksFailed)return '起止點資料載入失敗，連上網路後再選一次。';
  if(!catalogue)return '正在載入起止點…';
  if(!marks.length)return hosted.length?'':'模型上沒有標出這條肌肉的起止點（例如它只接在肌腱或筋膜上）。';
  const ends=new Set(marks.map(p=>p.end)),notes:string[]=[];
  if(ends.size===1&&!hosted.length)notes.push(`模型上只有${END_NAME[marks[0].end]}的位置。`);
  if(marks.some(p=>p.source==='computed'))notes.push('有些位置是電腦依肌肉貼著骨頭的範圍推算，僅供參考。');
  if(!state.xray&&!state.isolate)notes.push('被其他構造擋住時，打開「透視周圍」或「單獨顯示」。');
  return notes.join('');
 })();
 const marksProps:MarksProps={on:marksOn,note:marksNote,onChange:on=>{setMarksOn(on);setMarksFailed(false);try{localStorage.setItem(MARKS_KEY,on?'1':'0');}catch{/* a preference only */}}};
 const showAll=()=>{setUndo(u=>[...u,state.hidden]);setState(s=>({...s,hidden:[]}));};
 const toggle=(id:SystemId)=>{setDetails(false);setState(s=>({...s,selected:[],isolate:false,visible:s.visible.includes(id)?s.visible.filter(x=>x!==id):[...s.visible,id]}));};
 const reset=()=>{setState(s=>({...initial,visible:DEFAULT_VISIBLE,reset:s.reset+1}));setRegion(null);autoXray.current=false;setUndo([]);setChosen(null);setDetails(false);setPanel(null);};
 /** What the scene needs for a region: a joint region cuts along its box, a large area shows its structures whole. */
 const regionView=(id:RegionId|AreaId,regionSide:Side):SceneState['region']=>{
  if(!atlas)return null;
  if(isArea(id)){const area=areaParts(atlas,AREA_DATA,id,regionSide);return area&&{box:area.box,look:areaLook(id,regionSide),parts:area.parts};}
  const box=regionBox(atlas,id,regionSide);return box&&{box,look:regionLook(id,regionSide)};
 };
 const chooseRegion=(id:RegionId|AreaId,regionSide=side)=>{const view=regionView(id,regionSide);if(!view)return;setRegion({id,side:regionSide});setState(s=>({...s,region:view,explode:0,isolate:false,rotate:false}));setPanel(null);};
 const clearRegion=()=>{setRegion(null);setState(s=>({...s,region:null}));setPanel(null);};
 const regionInfo=region?[...REGIONS,...AREAS].find(r=>r.id===region.id):undefined;
 const regionName=region&&regionInfo?`${regionInfo.sided?(region.side==='left'?'左':'右'):''}${regionInfo.name}`:'';
 const openPanel=(next:Panel)=>{setDetails(false);setPanel(p=>p===next?null:next);};
 // A pin sits where the structure was tapped, or at the centre of its bounds when it came from search.
 const pinned=selected?state.pins.find(p=>p.part===selected.id):undefined;
 const togglePin=()=>{if(!selected||!chosen)return;if(pinned){setState(s=>({...s,pins:s.pins.filter(p=>p.id!==pinned.id)}));return;}
  const point=tapPoint.current?.id===selected.id&&tapPoint.current.point?tapPoint.current.point:selected.bounds[0].map((v,i)=>+((v+selected.bounds[1][i])/2).toFixed(4));
  setState(s=>({...s,pins:[...s.pins,{id:`${selected.id}-${Date.now().toString(36)}`,part:selected.id,label:chosen.label??chosen.name,point}]}));};
 const snapshot=():Snapshot=>({v:1,visible:state.visible,selected:state.selected,hidden:state.hidden,isolate:state.isolate,xray:state.xray,section:state.section,region,peel:state.peel,pins:state.pins,view:state.view,camera:cameraPose.current??undefined});
 const applySnapshot=(snap:Snapshot)=>{
  if(!atlas)return;const view=snap.region?regionView(snap.region.id,snap.region.side):null,known=(ids:string[])=>ids.filter(id=>parts.has(id));
  const selection=known(snap.selected),n=++cameraN.current;autoXray.current=false;setUndo([]);setRegion(view?snap.region:null);setPanel(null);
  setState(s=>({...initial,visible:snap.visible.filter(id=>SYSTEMS.some(x=>x.id===id)),selected:selection,hidden:known(snap.hidden),isolate:snap.isolate&&selection.length>0,xray:snap.xray,section:snap.section,region:view,peel:snap.peel,pins:snap.pins.filter(p=>parts.has(p.part)),view:snap.view,reset:s.reset+1,camera:snap.camera?{pose:snap.camera,n}:undefined}));
  if(selection.length){setChosen(groupOf(selection));setDetails(true);}else{setChosen(null);setDetails(false);}
 };
 // A shared link (#s=…) opens the view it describes, then the address goes back to plain.
 // Pasting a link into a tab that already has the app open only changes the hash, so that is watched too.
 useEffect(()=>{if(!atlas)return;const open=()=>{const match=location.hash.match(/^#s=([\w-]+)/);if(!match)return;const snap=decodeSnapshot(match[1]);history.replaceState(null,'',location.pathname+location.search);if(snap)applySnapshot(snap);};open();window.addEventListener('hashchange',open);return()=>window.removeEventListener('hashchange',open);},[atlas]);
 /** Quiz mode: the scope becomes the region, panels close, and the view before the quiz is kept to come back to. */
 const enterQuiz=(scope:Scope)=>{
  if(!quizBefore.current)quizBefore.current=snapshot();
  const view=scope?regionView(scope.id,scope.side):null;
  setRegion(view&&scope?{id:scope.id,side:scope.side}:null);setPanel(null);setDetails(false);setChosen(null);setMulti(false);setFocus(null);setUndo([]);autoXray.current=false;
  setState(s=>({...s,region:view,explode:0,isolate:false,rotate:false,hidden:[],section:null,peel:0,pins:[],selected:[]}));
  return view&&{box:view.box,look:view.look};
 };
 /** A question's view puts the tools back; an answer drops a cut that could hide it; labels without a point go to the part's centre. */
 const showQuiz=(v:QuizView,step:QuizStep)=>{
  const pins=v.pins.map((p,i)=>{const b=parts.get(p.part)?.bounds;return {id:`quiz-${i}-${p.part}`,part:p.part,label:p.label,point:p.point??(b?b[0].map((x,k)=>+((x+b[1][k])/2).toFixed(4)):[0,0,0])};});
  const frame=v.frame?{box:v.frame,look:v.look,n:++frameN.current}:undefined;
  setState(s=>({...s,visible:v.visible,selected:v.selected,xray:v.xray,isolate:false,hidden:[],pins,...(step==='question'?{peel:0,section:null,explode:0}:step==='answer'?{section:null}:{}),frame:frame??s.frame}));
 };
 const leaveQuiz=()=>{const before=quizBefore.current;quizBefore.current=null;if(before)applySnapshot(before);else reset();};
 const shareLink=async()=>{const url=`${location.origin}${location.pathname}#s=${encodeSnapshot(snapshot())}`;try{await navigator.clipboard.writeText(url);setShareUrl('');setShareNote('已複製分享連結');}catch{setShareUrl(url);setShareNote('無法自動複製，請手動複製下面的連結');}};
 const defaultName=()=>regionName||chosen?.label||new Date().toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const saveView=()=>{const list=[{name:bookmarkName.trim()||defaultName(),snapshot:encodeSnapshot(snapshot()),at:Date.now()},...bookmarks];setBookmarks(list);setBookmarkName('');setShareNote(saveBookmarks(list)?'已儲存書籤':'這個瀏覽器不能儲存書籤（可能是無痕模式）');};
 const removeView=(at:number)=>{const list=bookmarks.filter(b=>b.at!==at);setBookmarks(list);saveBookmarks(list);};
 const openView=(b:SavedView)=>{const snap=decodeSnapshot(b.snapshot);if(snap)applySnapshot(snap);};
 const setSection=(axis:SectionAxis|null)=>setState(s=>({...s,explode:0,section:axis?{axis,position:s.section?.axis===axis?s.section.position:.5,flip:s.section?.flip??false}:null}));
 const sectionAxis=AXES.find(a=>a.id===state.section?.axis),cutting=!!state.section||!!state.region;
 const toolValue=tool==='explode'?`${Math.round(state.explode*100)}`:tool==='xray'?(state.xray?`${Math.round(state.xray*100)}`:'關'):tool==='peel'?`${state.peel}/${DEEPEST}`:state.section?`${Math.round(state.section.position*100)}`:'關';
 return <main className="studio">
  {atlas&&<AnatomyScene atlas={atlas} state={{...state,inspectorOpen:details&&selectedParts.length>0&&!quiz.running,marks:markIds,markThrough,companions,hideNames:quiz.asking}} onSelect={choosePart} onSelectPatch={selectPatch} onMarksFailed={()=>setMarksFailed(true)} onCamera={pose=>{cameraPose.current=pose;}} onPinRemove={id=>setState(s=>({...s,pins:s.pins.filter(p=>p.id!==id)}))} onProgress={n=>{setProgress(n);if(n===100)setError('');}} onError={setError}/>}
  <div className="vignette"/>
  <header className="identity"><div className="eyebrow"><span className="status-dot"/> 互動解剖圖譜</div><h1>人體解剖<Badge variant="outline" className="edition">3D</Badge></h1><div className="identity-meta">{atlas?atlas.parts.length.toLocaleString():'3,121'} 個部件 <span>·</span> BodyParts3D＋Z-Anatomy</div></header>
  {!quiz.running&&<nav className="top-actions" aria-label="功能面板"><Button variant="ghost" className={panel==='regions'||region?'active':''} onClick={()=>openPanel('regions')} aria-label="選擇部位"><PersonStanding size={18}/><span>{region?regionName:'部位'}</span></Button><Button variant="ghost" className={panel==='bookmarks'?'active':''} onClick={()=>{setShareNote('');setShareUrl('');openPanel('bookmarks');}} aria-label="書籤與分享"><Bookmark size={18}/><span>書籤</span></Button><Button variant="ghost" className={panel==='search'?'active':''} onClick={()=>openPanel('search')} aria-label="搜尋構造"><Search size={18}/><span>找構造</span><kbd>/</kbd></Button><Button variant="ghost" className={panel==='quiz'?'active':''} onClick={()=>openPanel('quiz')} aria-label="測驗"><GraduationCap size={18}/><span>測驗</span></Button><Button variant="ghost" className="icon-button about-button" aria-label="關於這個 App" onClick={()=>{setDetails(false);setPanel(null);setAbout(true);}}><Info size={18}/></Button></nav>}
  {!quiz.running&&<section className={`layers-panel glass ${panel==='layers'?'mobile-open':''}`} aria-label="解剖系統">
   <div className="panel-heading"><span>系統</span><Button variant="ghost" className="mobile-only icon-button" onClick={()=>setPanel(null)} aria-label="關閉系統面板"><X size={18}/></Button><Badge variant="secondary" className="desktop-only small-number">{activeSystems.length}</Badge></div>
   <div className="layer-presets"><Button variant="ghost" aria-pressed={activeSystems.every(x=>state.visible.includes(x.id))} onClick={()=>setState(s=>({...s,selected:[],isolate:false,visible:activeSystems.map(x=>x.id)}))}>全部</Button><Button variant="ghost" aria-pressed={state.visible.length===1&&state.visible[0]==='skeletal'} onClick={()=>setState(s=>({...s,selected:[],isolate:false,visible:['skeletal']}))}>骨骼</Button><Button variant="ghost" aria-pressed={state.visible.length===6&&['cardiac','respiratory','digestive','urinary','endocrine','reproductive'].every(id=>state.visible.includes(id as SystemId))} onClick={()=>setState(s=>({...s,selected:[],isolate:false,visible:['cardiac','respiratory','digestive','urinary','endocrine','reproductive']}))}>器官</Button></div>
   <div className="system-list">{activeSystems.map(s=><div className={`system-row ${state.visible.includes(s.id)?'enabled':''}`} key={s.id}><Button variant="ghost" className="system-name" title={`只顯示${s.name}`} onClick={()=>setState(v=>({...v,visible:[s.id],isolate:false,selected:[]}))}><span className="system-dot" style={{background:s.color}}/>{s.name}<span className="system-count">{counts[s.id]}</span></Button><Switch checked={state.visible.includes(s.id)} onCheckedChange={()=>toggle(s.id)} aria-label={`顯示${s.name}`} /></div>)}</div>
   <div className="panel-foot"><span>顯示 {visibleCount.toLocaleString()} 個部件</span><Button variant="ghost" onClick={()=>setState(s=>({...s,visible:[],selected:[],isolate:false}))}>全部隱藏</Button></div>
  </section>}
  {panel==='quiz'&&!quiz.running&&<QuizSetup quiz={quiz} onClose={()=>setPanel(null)}/>}
  {panel==='search'&&<section className="search-panel glass" aria-label="搜尋構造"><div className="panel-heading"><span>找構造</span><Button variant="ghost" className="icon-button" onClick={()=>setPanel(null)} aria-label="關閉搜尋"><X size={18}/></Button></div><Combobox<Concept> items={results} value={null} onValueChange={value=>{if(value)choose(value);}} inputValue={query} onInputValueChange={setQuery} itemToStringLabel={c=>c.label??c.name} filter={null} open onOpenChange={open=>{if(!open)setPanel(null);}}><ComboboxInput autoFocus placeholder="中文或英文：心臟、股骨、femur…" aria-label="用中文或英文名稱搜尋構造" showTrigger={false}/><ComboboxContent className="anatomy-search-results"><ComboboxEmpty>找不到符合的構造。</ComboboxEmpty><ComboboxList>{(c:Concept)=><ComboboxItem key={c.id} value={c}><span className="search-result-name">{c.label??c.name}{c.label&&c.label!==c.name&&<small>{c.name}</small>}</span><span className="small-number">{c.elements.length} 件</span></ComboboxItem>}</ComboboxList></ComboboxContent></Combobox><p className="search-note">{query?'最多顯示 80 筆，打得更精確可以找到更小的構造。':'先從常用的構造開始，或輸入任何中英文名稱。'}</p></section>}
  {panel==='regions'&&<section className="search-panel region-panel glass" aria-label="選擇部位"><div className="panel-heading"><span>部位</span><Button variant="ghost" className="icon-button" onClick={()=>setPanel(null)} aria-label="關閉部位"><X size={18}/></Button></div><div className="side-switch" role="group" aria-label="左右側">{(['right','left'] as Side[]).map(v=><button key={v} type="button" aria-pressed={side===v} className={side===v?'active':''} onClick={()=>{setSide(v);if(region&&regionInfo?.sided)chooseRegion(region.id,v);}}>{v==='right'?'右側':'左側'}</button>)}<span>上下肢與肩、肘、腕、髖、膝、踝用</span></div>
   <h3 className="region-group">身體區域<small>跨區的構造整塊顯示</small></h3><div className="region-grid area-grid"><button type="button" aria-pressed={!region} className={!region?'active':''} onClick={clearRegion}>全身</button>{AREAS.map(a=><button key={a.id} type="button" aria-pressed={region?.id===a.id} className={region?.id===a.id?'active':''} onClick={()=>chooseRegion(a.id)}>{a.name}</button>)}</div>
   <h3 className="region-group">關節<small>沿著方框切齊</small></h3><div className="region-grid">{REGIONS.map(r=><button key={r.id} type="button" aria-pressed={region?.id===r.id} className={region?.id===r.id?'active':''} onClick={()=>chooseRegion(r.id)}>{r.name}</button>)}</div></section>}
  {panel==='bookmarks'&&<section className="search-panel bookmark-panel glass" aria-label="書籤與分享"><div className="panel-heading"><span>書籤與分享</span><Button variant="ghost" className="icon-button" onClick={()=>setPanel(null)} aria-label="關閉書籤"><X size={18}/></Button></div>
   <Button variant="ghost" className="share-link" onClick={shareLink}><Link size={16}/>複製目前畫面的分享連結</Button>
   {shareUrl&&<input className="share-url" readOnly value={shareUrl} onFocus={e=>e.currentTarget.select()} aria-label="分享連結"/>}
   <form className="bookmark-save" onSubmit={e=>{e.preventDefault();saveView();}}><input value={bookmarkName} onChange={e=>setBookmarkName(e.target.value)} placeholder={defaultName()} aria-label="書籤名稱" maxLength={40}/><Button type="submit" variant="ghost"><BookmarkPlus size={16}/>儲存</Button></form>
   {shareNote&&<p className="share-note" role="status">{shareNote}</p>}
   {bookmarks.length?<ul className="bookmark-list">{bookmarks.map(b=><li key={b.at}><button type="button" onClick={()=>openView(b)}><span>{b.name}</span><small>{new Date(b.at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></button><button type="button" className="remove" aria-label={`刪除書籤：${b.name}`} onClick={()=>removeView(b.at)}><X size={14}/></button></li>)}</ul>:<p className="search-note">還沒有書籤。書籤存在這台裝置的瀏覽器裡；要在別的裝置打開，用分享連結。</p>}
  </section>}
  <nav className="view-controls glass" aria-label="視角控制">{VIEWS.map(v=><Button variant="ghost" key={v.id} className={state.view===v.id?'active':''} aria-pressed={state.view===v.id} disabled={state.explode>.8&&v.id!=='front'} onClick={()=>setState(s=>({...s,view:v.id,reset:s.reset+1,rotate:false}))} title={`${v.name}視角`} aria-label={`${v.name}視角`}><span>{v.short}</span></Button>)}{!quiz.running&&<><i/><Button variant="ghost" aria-pressed={multi} className={multi?'active':''} title="多選：點一下加入或移除" aria-label={multi?'關閉多選':'開啟多選'} onClick={()=>setMulti(m=>!m)}><SquareStack size={17}/></Button></>}<Button variant="ghost" disabled={state.explode>=.4} aria-label={state.rotate?'暫停旋轉':'自動旋轉'} title="自動旋轉" className={state.rotate?'active':''} onClick={()=>setState(s=>({...s,rotate:!s.rotate}))}>{state.rotate?<Pause size={17}/>:<RotateCw size={18}/>}</Button>{!quiz.running&&<Button variant="ghost" aria-label="全部重設" title="全部重設" onClick={reset}><RotateCcw size={17}/></Button>}</nav>
  {quiz.running?null:state.hidden.length>0||state.pins.length>0?<div className="status-chips">{state.hidden.length>0&&<div className="hidden-chip glass" role="status"><EyeOff size={14}/><span>已隱藏 {state.hidden.length} 個</span><Button variant="ghost" disabled={!undo.length} onClick={undoHide}><Undo2 size={14}/>復原</Button><Button variant="ghost" onClick={showAll}>全部顯示</Button></div>}{state.pins.length>0&&<div className="hidden-chip glass" role="status"><Pin size={14}/><span>標籤 {state.pins.length} 個</span><Button variant="ghost" onClick={()=>setState(s=>({...s,pins:[]}))}>全部清除</Button></div>}</div>
  :<div className="scene-caption"><span className="caption-line"/><span>{state.isolate?(chosen?.label??'已選構造'):region?`部位：${regionName}`:multi?'多選模式':state.section?`${sectionAxis?.name}切面`:state.explode>.95?'全部構造一覽':state.explode>.05?'拆開檢視':'成年男性'}</span><span className="caption-line"/></div>}
  <div className="bottom-dock glass" ref={dock}>
   <div className="dock-row">{!quiz.running&&<Button variant="ghost" className="mobile-only dock-layers" onClick={()=>openPanel('layers')} aria-label="開啟系統面板"><Layers3 size={18}/><span>系統</span></Button>}<div className="tool-tabs" role="tablist" aria-label="工具">{TOOLS.map(t=><button key={t.id} type="button" role="tab" aria-selected={tool===t.id} className={tool===t.id?'active':''} onClick={()=>setTool(t.id)}>{t.name}</button>)}</div><output className="tool-value">{toolValue}{/^[0-9]+$/.test(toolValue)&&<span>%</span>}</output>{!quiz.running&&<Button variant="ghost" className="dock-reset" onClick={reset} aria-label="全部重設"><RotateCcw size={17}/><span>重設</span></Button>}</div>
   <div className="explode-control">
    {tool==='explode'&&<><Slider aria-label="拆開構造" disabled={cutting} min={0} max={100} step={1} value={[state.explode*100]} onValueChange={v=>{const n=sliderValue(v);setState(s=>({...s,explode:n/100,view:n>80?'front':s.view,rotate:false}));}}/><div className="slider-endpoints"><span>{cutting?'剖面或部位模式時不能拆開':'組合'}</span><span>{cutting?'':'全部攤開'}</span></div></>}
    {tool==='xray'&&<><Slider aria-label="周圍透明度" min={0} max={95} step={1} value={[state.xray*100]} onValueChange={v=>setXray(sliderValue(v)/100)}/><div className="slider-endpoints"><span>關</span><span>{state.selected.length?'沒選到的構造變透明':'全部變透明'}</span></div></>}
    {tool==='section'&&<><div className="section-axes" role="group" aria-label="切面方向"><button type="button" aria-pressed={!state.section} className={!state.section?'active':''} onClick={()=>setSection(null)}>關</button>{AXES.map(a=><button key={a.id} type="button" aria-pressed={state.section?.axis===a.id} className={state.section?.axis===a.id?'active':''} onClick={()=>setSection(a.id)}>{a.name}</button>)}<button type="button" className="flip" disabled={!state.section} title="保留另一側" aria-label="保留另一側" onClick={()=>setState(s=>s.section?{...s,section:{...s.section,flip:!s.section.flip}}:s)}><FlipHorizontal2 size={15}/>換邊</button></div>
     {state.section&&sectionAxis&&<><Slider aria-label="切面位置" min={0} max={100} step={1} value={[state.section.position*100]} onValueChange={v=>{const n=sliderValue(v);setState(s=>s.section?{...s,section:{...s.section,position:n/100}}:s);}}/><div className="slider-endpoints"><span>{sectionAxis.ends[0]}</span><span>保留{state.section.flip?sectionAxis.ends[1]:sectionAxis.ends[0]}</span><span>{sectionAxis.ends[1]}</span></div></>}</>}
    {tool==='peel'&&<><Slider aria-label='肌肉剝層' min={0} max={DEEPEST} step={1} value={[state.peel]} onValueChange={v=>setState(s=>({...s,peel:sliderValue(v)}))}/><div className="slider-endpoints"><span>淺層</span><span>{PEEL_TEXT[state.peel]??`去掉到第 ${state.peel} 層`}</span><span>深層</span></div></>}
   </div>
  </div>
  {quiz.running&&<QuizCard quiz={quiz} onSettings={()=>{quiz.exit();setPanel('quiz');}}/>}
  <footer className="studio-footer"><span>{state.explode>.8?'拖曳平移':'拖曳旋轉'} <b>·</b> 滾輪或雙指縮放 <b>·</b> {quiz.asking?'點一下作答':multi?'點一下加入／移除':'點一下查看'} <b>·</b> 點兩下對準</span><Button variant="ghost" onClick={()=>{setDetails(false);setPanel(null);setAbout(true);}}>資料來源與授權 <ArrowUpRight size={12}/></Button></footer>
  {progress<100&&!error&&<div className="loading glass" role="status"><Activity size={18}/><div><strong>正在準備人體模型</strong><span>{progress}% · 載入 {atlas?.parts.length.toLocaleString()??'2,234'} 個部件</span><div className="loading-track"><i style={{width:`${progress}%`}}/></div></div></div>}
  {error&&<div className="loading glass error" role="alert"><p>{error}</p><Button variant="ghost" onClick={()=>location.reload()}>重新載入</Button></div>}
  <Sheet open={details&&selectedParts.length>0&&!quiz.running} modal={false} disablePointerDismissal onOpenChange={open=>{if(!open)clearSelection();}}><SheetContent initialFocus={detailTitle} className={`detail-sheet glass ${state.isolate?'is-isolated':''} ${tall?'is-tall':''} ${settling?'is-settling':''}`} showCloseButton={true}><Button variant="ghost" className="mobile-only sheet-size" onClick={()=>setTall(t=>!t)} aria-label={tall?'縮小面板':'放大面板'} aria-pressed={tall}>{tall?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</Button><div className="detail-header"><div className="detail-accent" style={{background:system?.color}}/><div className="eyebrow">{system?.name??'解剖構造'}</div><SheetTitle ref={detailTitle} tabIndex={-1} className="structure-title">{chosen?.label??chosen?.name}</SheetTitle>{chosen&&chosen.id&&chosen.label!==chosen.name&&<p className="structure-en">{chosen.name}{!chosen.id.startsWith('card:')&&!namer.reviewed(chosen.name)&&<span className="unreviewed" title="中文譯名由程式翻譯，還沒人工校對">未校對</span>}</p>}</div><div className="detail-scroll" key={`${chosen?.id}-${state.isolate}`}>
   {card?<><SheetDescription className="sr-only">肌肉卡：起點、止點、作用、神經支配與出處。</SheetDescription><CardView card={card} sections={sections} marks={marksProps} onNerve={term=>selectNerve(term,selectionSide)} onWhole={wholeCard.some(id=>!state.selected.includes(id))?()=>selectCard(card,selectionSide):undefined}/></>
   :<><SheetDescription className="structure-description">{chosen&&selected?(nerveFocus?'這條神經（含分支）和它支配的肌肉已一起選取，周圍改成透視。':chosen.id?explanation(chosen.name,selected.system):'多選模式：在模型上點一下可以加入或移除構造。'):''}</SheetDescription>{chosen&&chosen.id&&!hasExplanation(chosen.name)&&<span className="context-note">系統概述 · 這個構造目前只有所屬系統的說明</span>}</>}
   {nerveTerm&&cards&&<NerveView cards={cards} term={nerveTerm} nameOf={nameOf} sections={sections} onCard={c=>selectCard(c,nerveFocus?.side??selectionSide)} onNerve={term=>selectNerve(term,nerveFocus?.side??selectionSide)} onSelectAll={nerveFocus?undefined:()=>selectNerve(nerveTerm,selectionSide)}/>}
   {hosted.length>0&&<HostedView muscles={hosted} nameOf={nameOf} sections={sections} marks={marksProps} onPick={pickHosted}/>}
   <div className="structure-meta"><span>圖譜編號<strong>{chosen?.id&&!chosen.id.startsWith('card:')?chosen.id:'—'}</strong></span><span>選取部件<strong>{state.selected.length.toLocaleString()}</strong></span></div>{selectedParts.length>1&&!nerveFocus&&<div className="member-list"><h3>包含的構造</h3>{selectedParts.slice(0,50).map(p=><Button variant="ghost" key={p.id} onClick={()=>{setMulti(false);setChosen(groupOf([p.id]));setState(s=>({...s,selected:[p.id],isolate:false}));}}><span>{p.label??p.name}</span><ChevronRight size={14}/></Button>)}{selectedParts.length>50&&<p>另有 {selectedParts.length-50} 個部件。</p>}</div>}<a className="source-link" href="https://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer">查看原始解剖資料 <ArrowUpRight size={14}/></a></div><div className="detail-actions"><Button className={`primary-action ${state.isolate?'active':''}`} onClick={()=>setState(s=>({...s,isolate:!s.isolate,explode:0}))}><Focus size={18}/><span className="label-full">{state.isolate?'顯示周圍構造':'單獨顯示'}</span><span className="label-short">{state.isolate?'周圍':'單獨'}</span><ChevronRight size={16}/></Button><div className="detail-tools"><Button variant="ghost" aria-pressed={state.xray>0} className={state.xray>0?'active':''} onClick={()=>setXray(state.xray>0?0:lastXray.current)}><Ghost size={16}/><span className="label-full">透視周圍</span><span className="label-short">透視</span></Button><Button variant="ghost" aria-pressed={!!pinned} className={pinned?'active':''} disabled={!chosen?.id} onClick={togglePin}><Pin size={16}/><span className="label-full">{pinned?'取消標籤':'釘選標籤'}</span><span className="label-short">標籤</span></Button><Button variant="ghost" onClick={hideSelection}><EyeOff size={16}/>隱藏</Button><Button variant="ghost" onClick={clearSelection}><span className="label-full">取消選取</span><span className="label-short">取消</span></Button></div></div></SheetContent></Sheet>
  <Sheet open={about} onOpenChange={setAbout}><SheetContent className="about-sheet glass"><div className="eyebrow">資料來源與範圍</div><SheetTitle className="structure-title">人體解剖 3D</SheetTitle><SheetDescription>以 BodyParts3D 成年男性參考模型為基礎、用 Z-Anatomy 補上肌肉、韌帶與周邊神經的互動解剖圖譜。</SheetDescription><div className="about-copy"><p><strong>男性 · BodyParts3D＋Z-Anatomy</strong><br/>{atlas?.parts.length.toLocaleString()??'3,121'} 個獨立網格、{atlas?.concepts.length.toLocaleString()??'4,861'} 個具名構造。骨骼、內臟、血管和大部分肌肉來自 BodyParts3D；它沒有的 {atlas?atlas.parts.filter(p=>p.source==='z-anatomy').length.toLocaleString():'898'} 個構造（闊背肌、腹肌、多裂肌、咀嚼肌、臉部肌、韌帶、關節囊、半月板、滑囊、筋膜、脊髓與周邊神經等）來自 Z-Anatomy，已依這裡的骨頭變形對齊。筋膜預設不顯示，要看請在「系統」打開。</p><p>模型沒有涵蓋所有人體構造或個體差異。一個具名構造可能包含多個部件；每個原始網格只畫一次。</p><p>顏色與系統分類是為了方便瀏覽而設計，幾何已為網頁簡化，說明文字只提供一般學習用的背景。中文譯名由程式翻譯，標示「未校對」的還沒經過人工確認。本 App 為學習用途，不是診斷或手術工具。</p><p><strong>肌肉卡與起止點</strong><br/>{cards?cards.cards.length:147} 條物理治療常用肌肉有卡片（起止點、作用、神經支配、血液供應、觸診提示），是自己整理的中文摘要，主要出處是 Neumann《Kinesiology of the Musculoskeletal System》第 3 版；標「未核對」的還沒經過核對。骨頭上紅色是起點、藍色是止點，位置來自 Z-Anatomy，它沒畫的由電腦依肌肉貼著骨頭的範圍推算。</p><h3>來源</h3><p>BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.</p><a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html" target="_blank" rel="noreferrer">資料授權 <ArrowUpRight size={14}/></a><a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html" target="_blank" rel="noreferrer">原始幾何與中繼資料 <ArrowUpRight size={14}/></a><a href="https://academic.oup.com/nar/article/37/suppl_1/D782/1000752" target="_blank" rel="noreferrer">原始論文 <ArrowUpRight size={14}/></a><p>Z-Anatomy - The libre 3D atlas of anatomy（Gauthier Kervyn 等），CC BY-SA 4.0。其中腦神經取自 University of Dundee, CAHID 的 Cranial Nerves and Foramina（CC BY 4.0）。</p><a href="https://www.z-anatomy.com/" target="_blank" rel="noreferrer">Z-Anatomy <ArrowUpRight size={14}/></a><a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" target="_blank" rel="noreferrer">原始模型 <ArrowUpRight size={14}/></a><p>因為含 Z-Anatomy 的改作，整份模型資料以 CC BY-SA 4.0 公開（BodyParts3D 的部分原為 CC BY 4.0），轉用時要標出處並用同一授權。</p><a href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hant" target="_blank" rel="noreferrer">CC BY-SA 4.0 授權條款 <ArrowUpRight size={14}/></a><a href="https://github.com/bigshop127/Anatomy3D/blob/main/public/ATTRIBUTION.md" target="_blank" rel="noreferrer">完整出處與改動說明 <ArrowUpRight size={14}/></a><h3>程式</h3><p>改自 human-atlas（MIT 授權）。MIT 只適用程式碼，不包含模型資料。</p><a href="https://github.com/bigshop127/Anatomy3D" target="_blank" rel="noreferrer">原始碼 <ArrowUpRight size={14}/></a><p className="app-version">版本 {__APP_VERSION__}</p></div></SheetContent></Sheet>
 </main>;
}
