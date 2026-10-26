import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowRight,Check,CircleCheck,CircleX,Play,RotateCcw,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {AREAS,REGIONS,type AreaId,type RegionId,type Side} from './regions';
import areaMembers from './area-members.json';
import type {Atlas,Box} from './anatomy';
import type {CardIndex} from './muscle-cards';
import {COUNTS,DEPTHS,QUESTION_TYPES,SYSTEM_GROUPS,answerView,isRight,loadLog,lookAt,makeRound,questionCounts,questionView,quizItems,recordAnswer,saveLog,union,weakRecords,
 type Answer,type Membership,type Option,type Pools,type Question,type QuizLog,type QuizSettings,type QuizView,type Scope} from './quiz';
// Quiz mode on screen: the setup panel, the card over the dock while a round runs, and the state behind them.

const TYPE_NAME=Object.fromEntries(QUESTION_TYPES.map(t=>[t.id,t.name]));
const ALL_SYSTEMS=SYSTEM_GROUPS.map(g=>g.id);
export const scopeName=(scope:Scope)=>{const r=scope&&[...AREAS,...REGIONS].find(x=>x.id===scope.id);return r?`${r.sided?(scope!.side==='left'?'左':'右'):''}${r.name}`:'全身';};
const bodyBox=(atlas:Atlas)=>{let box:Box|undefined;for(const p of atlas.parts)if(p.system==='skeletal')box=union(box,p.bounds as Box);return box!;};
/** How the page shows a step: a new question puts the tools back (no peel, cut or spread), an answer only drops the cut so the
 * right structure is in view, and a tap only adds to what is there. */
export type QuizStep='question'|'answer'|'tap';
export interface QuizHost {atlas:Atlas|null;cards:CardIndex|null;label:(term:string)=>string|undefined;
 /** Turns the app to quiz mode for a scope (the first call remembers the view to come back to) and returns the scope's frame,
  * or null for the whole body. */ enter:(scope:Scope)=>{box:Box;look:number[]}|null;
 show:(view:QuizView,step:QuizStep)=>void;leave:()=>void}
interface Round {settings:QuizSettings;pools:Pools;questions:Question[];answers:(Answer|null)[];index:number;frame:{box:Box;look:number[]};done:boolean;
 /** The questions a round of wrong answers was limited to, so another round asks them again. */ only?:Set<string>;
 /** The question of the results shown on the model. */ viewing:number|null}

export function useQuiz(host:QuizHost){
 const [log,setLog]=useState(loadLog),[membership,setMembership]=useState<Membership|null>(null),[round,setRound]=useState<Round|null>(null);
 const [candidate,setCandidate]=useState<{id:string;point?:number[]}|null>(null),[note,setNote]=useState('');
 // The view of the current step; a tap (the structure picked, or a name asked for) is drawn over it and replaced by the next.
 const base=useRef<QuizView|null>(null);
 const store=(change:(l:QuizLog)=>QuizLog)=>setLog(l=>{const next=change(l);saveLog(next);return next;});
 const settings=log.settings;
 const setSettings=(s:Partial<QuizSettings>)=>{setNote('');store(l=>({...l,settings:{...l.settings,...s}}));};
 /** Region membership is only needed by the quiz, so it loads when the setup panel opens. */
 const load=()=>{if(!membership)import('./region-members.json').then(m=>setMembership({regions:m.default.members as Record<string,string[]>,areas:areaMembers as Membership['areas']})).catch(()=>setNote('部位資料載入失敗，連上網路後再試一次。'));};
 const poolsFor=(s:Pick<QuizSettings,'systems'|'scope'|'depth'>):Pools|null=>host.atlas&&membership?{items:quizItems(host.atlas,host.cards,s,membership,host.label),cards:host.cards}:null;
 const preview=useMemo(()=>{const p=poolsFor(settings);return p&&questionCounts(p);},[host.atlas,host.cards,membership,settings.systems,settings.scope,settings.depth]);
 const present=(v:QuizView,step:QuizStep)=>{base.current=v;host.show(v,step);};
 const showQuestion=(r:Round)=>{setCandidate(null);present(questionView(host.atlas!,r.questions[r.index],r.frame),'question');};
 const start=(s:QuizSettings,only?:Set<string>,pools?:Pools)=>{
  const p=pools??poolsFor(s);if(!p||!host.atlas)return;
  const questions=makeRound(p,s.types,only?Math.min(20,only.size):s.count,Math.random,only);
  if(!questions.length){setNote(only?'這些題目現在出不了（資料可能改過了）。':'這個範圍出不了題目，換個部位或多選幾個系統。');return;}
  const frame=host.enter(s.scope)??{box:bodyBox(host.atlas),look:[.35,.06,1]};
  const r:Round={settings:s,pools:p,questions,answers:questions.map(()=>null),index:0,frame,done:false,viewing:null,only};
  setNote('');setRound(r);showQuestion(r);
 };
 const current=round&&!round.done?round.questions[round.index]:null,answered=round&&!round.done?round.answers[round.index]:null;
 const answer=(a:Answer)=>{
  if(!round||!current||answered)return;
  store(l=>recordAnswer(l,current,a.correct));
  const answers=round.answers.slice();answers[round.index]=a;setRound({...round,answers});setCandidate(null);
  present(answerView(host.atlas!,current,a,round.frame.box),'answer');
 };
 const partLabel=(id:string)=>{const p=host.atlas?.parts.find(x=>x.id===id);return p?.label??p?.name??'';};
 /** A tap on the model: during a find question it picks the answer; after an answer, or after the round, it shows the name. */
 const tap=(id:string,point?:number[])=>{
  if(!round||!base.current)return;
  if(current&&!answered){if(current.type==='find'){setCandidate({id,point});host.show({...base.current,selected:[id],frame:null},'tap');}return;}
  host.show({...base.current,pins:[...base.current.pins,{part:id,label:partLabel(id),point}],frame:null},'tap');
 };
 const confirm=()=>{if(current&&candidate)answer({correct:isRight(current,candidate.id,host.atlas,host.cards,host.label),tapped:{...candidate,label:partLabel(candidate.id)}});};
 const choose=(o:Option)=>answer({correct:o.correct,picked:o.label});
 const skip=()=>answer({correct:false});
 const next=()=>{
  if(!round)return;
  if(round.index+1<round.questions.length){const r={...round,index:round.index+1};setRound(r);showQuestion(r);return;}
  // The round goes in the record, and the model goes back to the whole scope.
  const right=round.answers.filter(a=>a?.correct).length;
  store(l=>({...l,rounds:[{at:Date.now(),right,total:round.questions.length,scope:scopeName(round.settings.scope)},...l.rounds].slice(0,30)}));
  setRound({...round,done:true,viewing:null});
  present({visible:[...new Set(['skeletal' as const,...SYSTEM_GROUPS.filter(g=>round.settings.systems.includes(g.id)).flatMap(g=>g.systems)])],selected:[],xray:0,pins:[],frame:round.frame.box,look:round.frame.look},'question');
 };
 const viewResult=(i:number)=>{
  if(!round||!host.atlas)return;const q=round.questions[i],v=answerView(host.atlas,q,round.answers[i]??{correct:false},round.frame.box),box=q.item.boxes[q.side];
  setRound({...round,viewing:i});present({...v,frame:v.frame??box,look:v.look??lookAt(box)},'answer');
 };
 const wrongKeys=round?new Set(round.questions.filter((_,i)=>!round.answers[i]?.correct).map(q=>q.key)):new Set<string>();
 const weak=weakRecords(log);
 return {log,settings,setSettings,preview,note,load,ready:!!membership&&!!host.atlas,cardsReady:!!host.cards,weak,round,candidate,current,answered,
  running:!!round,asking:!!current&&!answered,tap,confirm,choose,skip,next,viewResult,
  begin:()=>start(settings),again:()=>round&&start(round.settings,round.only,round.pools),retryWrong:()=>round&&start(round.settings,wrongKeys,round.pools),
  /** A round of the questions most often answered wrong, from anywhere in the body. */
  practiceWeak:()=>start({...settings,types:[...new Set(weak.map(([,r])=>r.type))],systems:ALL_SYSTEMS,scope:null,depth:'all'},new Set(weak.map(([k])=>k))),
  clearLog:()=>store(l=>({...l,records:{},rounds:[]})),
  exit:()=>{setRound(null);setCandidate(null);base.current=null;host.leave();}};
}
export type Quiz=ReturnType<typeof useQuiz>;

const when=(at:number)=>new Date(at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
export function QuizSetup({quiz,onClose}:{quiz:Quiz;onClose:()=>void}){
 const s=quiz.settings,counts=quiz.preview,[side,setSide]=useState<Side>(s.scope?.side??'right'),[clearing,setClearing]=useState(false);
 useEffect(()=>{quiz.load();},[]);
 const toggle=<T,>(list:T[],v:T)=>list.includes(v)?list.filter(x=>x!==v):[...list,v];
 const sided=(id:string)=>[...AREAS,...REGIONS].some(r=>r.id===id&&r.sided);
 const scopeButton=(id:RegionId|AreaId,name:string)=><button key={id} type="button" aria-pressed={s.scope?.id===id} className={s.scope?.id===id?'active':''} onClick={()=>quiz.setSettings({scope:{id,side}})}>{name}</button>;
 const total=counts?s.types.reduce((n,t)=>n+counts[t],0):0;
 return <section className="search-panel quiz-panel glass" aria-label="測驗設定">
  <div className="panel-heading"><span>測驗</span><Button variant="ghost" className="icon-button" onClick={onClose} aria-label="關閉測驗設定"><X size={18}/></Button></div>
  <h3 className="region-group">題型<small>可複選</small></h3>
  <div className="quiz-chips">{QUESTION_TYPES.map(t=>{const on=s.types.includes(t.id),n=counts?.[t.id]??0;
   return <button type="button" key={t.id} aria-pressed={on} className={on?'active':''} onClick={()=>quiz.setSettings({types:toggle(s.types,t.id)})}><span>{t.name}</span><small>{t.cards&&!quiz.cardsReady?'肌肉卡載入中':!counts?t.note:n?`${n} 題`:t.cards&&!s.systems.includes('muscular')?'要選「肌肉」系統':'這個範圍沒有'}</small></button>;})}</div>
  <h3 className="region-group">範圍<small>跟「部位」一樣</small></h3>
  <div className="side-switch" role="group" aria-label="左右側">{(['right','left'] as Side[]).map(v=><button key={v} type="button" aria-pressed={side===v} className={side===v?'active':''} onClick={()=>{setSide(v);if(s.scope&&sided(s.scope.id))quiz.setSettings({scope:{...s.scope,side:v}});}}>{v==='right'?'右側':'左側'}</button>)}<span>上下肢與肩、肘、腕、髖、膝、踝用</span></div>
  <div className="region-grid area-grid"><button type="button" aria-pressed={!s.scope} className={!s.scope?'active':''} onClick={()=>quiz.setSettings({scope:null})}>全身</button>{AREAS.map(a=>scopeButton(a.id,a.name))}</div>
  <div className="region-grid">{REGIONS.map(r=>scopeButton(r.id,r.name))}</div>
  <h3 className="region-group">系統<small>可複選</small></h3>
  <div className="quiz-chips">{SYSTEM_GROUPS.map(g=><button type="button" key={g.id} aria-pressed={s.systems.includes(g.id)} className={s.systems.includes(g.id)?'active':''} onClick={()=>quiz.setSettings({systems:toggle(s.systems,g.id)})}>{g.name}</button>)}</div>
  <h3 className="region-group">肌肉深度<small>依剝層的分層</small></h3>
  <div className="side-switch" role="group" aria-label="肌肉深度">{DEPTHS.map(d=><button key={d.id} type="button" aria-pressed={s.depth===d.id} className={s.depth===d.id?'active':''} onClick={()=>quiz.setSettings({depth:d.id})}>{d.name}</button>)}</div>
  <h3 className="region-group">每輪題數<small>不計時</small></h3>
  <div className="side-switch" role="group" aria-label="每輪題數">{COUNTS.map(n=><button key={n} type="button" aria-pressed={s.count===n} className={s.count===n?'active':''} onClick={()=>quiz.setSettings({count:n})}>{n} 題</button>)}</div>
  <Button className="quiz-start" disabled={!quiz.ready||!total} onClick={quiz.begin}><Play size={16}/>開始測驗</Button>
  {quiz.note?<p className="share-note" role="status">{quiz.note}</p>:<p className="search-note">{!quiz.ready?'正在準備題庫…':total?`這個範圍可以出 ${total} 題，每輪隨機抽 ${Math.min(s.count,total)} 題。太小、手機上不好點的構造不會考。`:'這個範圍出不了題目，換個部位、多選幾個系統或題型。'}</p>}
  <h3 className="region-group">常錯的<small>記在這台裝置</small></h3>
  {quiz.weak.length?<><ul className="quiz-list">{quiz.weak.slice(0,8).map(([k,r])=><li key={k}><span>{r.title}</span><small>{TYPE_NAME[r.type]} · 錯 {r.wrong}／{r.right+r.wrong}</small></li>)}</ul>
   <Button variant="ghost" className="quiz-secondary" disabled={!quiz.ready} onClick={quiz.practiceWeak}><RotateCcw size={15}/>考常錯的（{Math.min(20,quiz.weak.length)} 題）</Button></>
   :<p className="search-note">還沒有。答錯的題目會記在這裡，可以挑出來重考。</p>}
  {quiz.log.rounds.length>0&&<><h3 className="region-group">最近成績</h3><ul className="quiz-list">{quiz.log.rounds.slice(0,5).map(r=><li key={r.at}><span>{when(r.at)} · {r.scope}</span><small>答對 {r.right}／{r.total}</small></li>)}</ul></>}
  {(quiz.weak.length>0||quiz.log.rounds.length>0)&&(clearing?<div className="quiz-actions"><span className="quiz-hint">清除所有答題紀錄？</span><Button variant="ghost" onClick={()=>setClearing(false)}>取消</Button><Button variant="ghost" className="quiz-danger" onClick={()=>{quiz.clearLog();setClearing(false);}}>清除</Button></div>
   :<Button variant="ghost" className="quiz-secondary" onClick={()=>setClearing(true)}>清除紀錄</Button>)}
 </section>;
}

function feedback(q:Question,a:Answer){
 if(a.correct)return q.type==='find'?`答對了：${q.item.label}`:'答對了';
 if(q.type==='find')return a.tapped?`你點的是${a.tapped.label}，正確的「${q.item.label}」已標在模型上。`:`「${q.item.label}」已標在模型上。`;
 return a.picked?`正確答案是「${q.answer}」`:`答案是「${q.answer}」`;
}
/** What the muscle card says, after a card question. */
function fact(q:Question){const c=q.item.card;if(!c)return '';return q.type==='action'?`${c.zh}的主要作用：${c.primary.join('；')}`:`${c.zh}的神經支配：${c.innervationText.join('；')}`;}

export function QuizCard({quiz,onSettings}:{quiz:Quiz;onSettings:()=>void}){
 const [leaving,setLeaving]=useState(false),r=quiz.round!;
 const right=r.answers.filter(a=>a?.correct).length;
 if(r.done){
  const wrong=r.questions.map((q,i)=>({q,i})).filter(({i})=>!r.answers[i]?.correct);
  return <section className="quiz-card quiz-results glass" aria-label="測驗結果">
   <div className="quiz-head"><span className="quiz-type">這一輪結束</span><span className="quiz-count">{scopeName(r.settings.scope)}</span><button type="button" className="quiz-close" aria-label="結束測驗" onClick={quiz.exit}><X size={16}/></button></div>
   <p className="quiz-score"><b>{right}</b>／{r.questions.length}<span>答對 {Math.round(right/r.questions.length*100)}%</span></p>
   {wrong.length?<><h3>答錯的<small>點一下在模型上看</small></h3><ul className="quiz-wrong">{wrong.map(({q,i})=><li key={i}><button type="button" className={r.viewing===i?'active':''} onClick={()=>quiz.viewResult(i)}><span>{q.title}</span><small>{TYPE_NAME[q.type]}</small></button></li>)}</ul></>
    :<p className="quiz-hint">全部答對！</p>}
   <div className="quiz-actions">{wrong.length>0&&<Button className="quiz-primary" onClick={quiz.retryWrong}><RotateCcw size={15}/>重考答錯的 {wrong.length} 題</Button>}<Button variant="ghost" onClick={quiz.again}>再一輪</Button><Button variant="ghost" onClick={onSettings}>改設定</Button><Button variant="ghost" onClick={quiz.exit}>結束</Button></div>
  </section>;
 }
 const q=quiz.current!,a=quiz.answered;
 return <section className="quiz-card glass" aria-label="測驗">
  <div className="quiz-progress" aria-hidden="true"><i style={{width:`${(r.index+(a?1:0))/r.questions.length*100}%`}}/></div>
  <div className="quiz-head"><span className="quiz-type">{TYPE_NAME[q.type]}</span><span className="quiz-count">第 {r.index+1}／{r.questions.length} 題 · 答對 {right}</span><button type="button" className="quiz-close" aria-label="結束測驗" onClick={()=>setLeaving(true)}><X size={16}/></button></div>
  {leaving?<div className="quiz-leave"><p>結束這一輪？已作答的題目會留在紀錄裡。</p><div className="quiz-actions"><Button variant="ghost" onClick={()=>setLeaving(false)}>繼續作答</Button><Button className="quiz-primary" onClick={quiz.exit}>結束測驗</Button></div></div>:<>
   <p className="quiz-prompt">{q.prompt}</p>{q.subject&&<p className="quiz-subject">{q.subject}</p>}
   {q.options&&<div className="quiz-options" role="group" aria-label="選項">{q.options.map(o=><button type="button" key={o.label} disabled={!!a} className={a?(o.correct?'right':o.label===a.picked?'wrong':''):''} onClick={()=>quiz.choose(o)}><span>{o.label}</span>{a&&o.correct&&<Check size={15}/>}</button>)}</div>}
   {!a&&q.type==='find'&&<p className="quiz-hint">{quiz.candidate?'已點選（模型上亮起來的那個），按「確定」作答；點別的可以換。':'點模型選一個構造。被擋住時用下方的透視、剖面、剝層，或兩指放大。'}</p>}
   {a&&<p className={`quiz-feedback ${a.correct?'right':'wrong'}`} role="status">{a.correct?<CircleCheck size={16}/>:<CircleX size={16}/>}<span>{feedback(q,a)}</span></p>}
   {a&&(q.type==='nerve'||q.type==='action')&&<p className="quiz-fact">{fact(q)}</p>}
   <div className="quiz-actions">{!a?<><Button variant="ghost" onClick={quiz.skip}>不知道</Button>{q.type==='find'&&<Button className="quiz-primary" disabled={!quiz.candidate} onClick={quiz.confirm}><Check size={16}/>確定</Button>}</>
    :<><span className="quiz-hint">點模型上的構造可以看名稱</span><Button className="quiz-primary" onClick={quiz.next}>{r.index+1<r.questions.length?'下一題':'看結果'}<ArrowRight size={16}/></Button></>}</div>
  </>}
 </section>;
}
