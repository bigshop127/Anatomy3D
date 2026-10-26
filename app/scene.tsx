import {useEffect,useRef} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {createExplosionLayout} from './explosion-layout';
import {asset,decodeModelResponse} from './model-download';
import {decodePart} from './model-decode';
import {DoubleTap,PointerTap} from './pointer-tap';
import {Pinch,targetToDepth,wheelScale,zoomAbout} from './camera-zoom';
import {END_COLOR,loadAttachments} from './attachments';
import {SYSTEMS,visibilityTest,type Atlas,type Box,type CameraPose,type Pin,type SceneState,type Section} from './anatomy';
interface Props {atlas:Atlas;state:SceneState;onSelect:(id:string,point?:number[])=>void;onProgress:(n:number)=>void;onError:(s:string)=>void;onCamera?:(pose:CameraPose)=>void;onPinRemove?:(id:string)=>void;
 /** A tap on a muscle attachment patch; onMarksFailed reports that the patches could not be loaded. */ onSelectPatch?:(id:string)=>void;onMarksFailed?:()=>void}
const AXES={sagittal:0,transverse:1,coronal:2} as const;
/** Body extent of the atlas, used to place section planes. */
export function atlasBounds(atlas:Atlas):Box{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of atlas.parts)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p.bounds[0][i]);max[i]=Math.max(max[i],p.bounds[1][i]);}return [min,max];}
/** Clipping planes keep the side where normal·p + constant ≥ 0. */
export function clippingPlanes(section:Section|null,region:Box|null,body:Box){
 const planes:T.Plane[]=[],axis=(i:number,sign:number)=>new T.Vector3().setComponent(i,sign);
 if(section){const i=AXES[section.axis],c=body[0][i]+section.position*(body[1][i]-body[0][i]);
  planes.push(section.flip?new T.Plane(axis(i,1),-c):new T.Plane(axis(i,-1),c));}
 if(region)for(let i=0;i<3;i++){planes.push(new T.Plane(axis(i,1),-region[0][i]),new T.Plane(axis(i,-1),region[1][i]));}
 return planes;
}
export default function AnatomyScene({atlas,state,onSelect,onProgress,onError,onCamera,onPinRemove,onSelectPatch,onMarksFailed}:Props){
 const host=useRef<HTMLDivElement>(null),latest=useRef(state),select=useRef(onSelect),camera=useRef(onCamera),removePin=useRef(onPinRemove),selectPatch=useRef(onSelectPatch),marksFailed=useRef(onMarksFailed);
 latest.current=state;select.current=onSelect;camera.current=onCamera;removePin.current=onPinRemove;selectPatch.current=onSelectPatch;marksFailed.current=onMarksFailed;
 useEffect(()=>{
  const el=host.current!;let disposed=false,frame=0,dirty=true,ready=false,lastView='',lastReset=-1,lastFocus='',layoutKey='',amount=0,lastCameraN=-1,lastFrameN=-1;
  let lastState:SceneState|null=null;
  const abort=new AbortController();
  let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch{onError('這個瀏覽器無法啟動 3D 檢視器，請改用支援 WebGL 的瀏覽器。');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<768?1.5:2));renderer.setClearColor('#f2f3f3');renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.localClippingEnabled=true;el.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','互動人體解剖模型。拖曳旋轉；雙指或滾輪縮放，會對準手指或游標所在處；點兩下對準那一點；點一下構造可以查看。');
  const scene=new T.Scene(),cam=new T.PerspectiveCamera(34,1,.005,100),controls=new OrbitControls(cam,renderer.domElement);
  let cameraTimer=0;const reportCamera=()=>{clearTimeout(cameraTimer);cameraTimer=window.setTimeout(()=>camera.current?.({position:cam.position.toArray().map(v=>+v.toFixed(4)),target:controls.target.toArray().map(v=>+v.toFixed(4))}),300);};
  cam.position.set(1.4,1.05,3.6);controls.target.set(0,.85,0);controls.enableDamping=true;controls.dampingFactor=.085;controls.minDistance=.025;controls.maxDistance=40;
  // Wheel and pinch zoom are done below, toward the point under the cursor or fingers; the controls still rotate and pan.
  controls.enableZoom=false;controls.maxPolarAngle=Math.PI*.96;controls.addEventListener('change',()=>{dirty=true;reportCamera();});
  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose();
  scene.add(new T.HemisphereLight(0xffffff,0xa7acb2,1.05));
  const key=new T.DirectionalLight(0xfffaf4,2.3);key.position.set(-2,4,3);scene.add(key);
  const rim=new T.DirectionalLight(0xe9f0ff,1.8);rim.position.set(2,2,-3);scene.add(rim);
  const ground=new T.Mesh(new T.CircleGeometry(30,96),new T.MeshStandardMaterial({color:0xd5d9dc,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.019;scene.add(ground);
  const platform=new T.Mesh(new T.CylinderGeometry(.68,.7,.028,100),new T.MeshStandardMaterial({color:0xeeeeec,metalness:.12,roughness:.67}));platform.position.y=-.016;scene.add(platform);
  const ring=new T.Mesh(new T.RingGeometry(.63,.632,128),new T.MeshBasicMaterial({color:0x8c969f,transparent:true,opacity:.4,side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.001;scene.add(ring);
  const innerRing=new T.Mesh(new T.RingGeometry(.55,.551,128),new T.MeshBasicMaterial({color:0xa4aeb8,transparent:true,opacity:.16,side:T.DoubleSide}));innerRing.rotation.x=-Math.PI/2;innerRing.position.y=.001;scene.add(innerRing);
  const width=T.MathUtils.ceilPowerOfTwo(atlas.parts.length),data=new Float32Array(width*4),partTexture=new T.DataTexture(data,width,1,T.RGBAFormat,T.FloatType);partTexture.needsUpdate=true;
  const selectedData=new Uint8Array(width*4),selectionTexture=new T.DataTexture(selectedData,width,1);selectionTexture.needsUpdate=true;
  const materials:T.Material[]=[],partMaterials:T.Material[]=[],ghostMeshes:T.Mesh[]=[],geometries:T.BufferGeometry[]=[],pickers:(T.Mesh|undefined)[]=[],centers=atlas.parts.map(p=>new T.Vector3().fromArray(p.bounds[0]).add(new T.Vector3().fromArray(p.bounds[1])).multiplyScalar(.5));
  const offsets:T.Vector3[]=[],bounds=atlas.parts.map(p=>new T.Box3(new T.Vector3().fromArray(p.bounds[0]),new T.Vector3().fromArray(p.bounds[1])));
  const body=atlasBounds(atlas),indexOf=new Map(atlas.parts.map((p,i)=>[p.id,i]));
  let packingWidth=1,packingHeight=1,planes:T.Plane[]=[];
  const markerPositions=new Float32Array(atlas.parts.length*3),markerGeometry=new T.BufferGeometry();markerGeometry.setAttribute('position',new T.BufferAttribute(markerPositions,3));
  const markerMaterial=new T.PointsMaterial({color:0x64748b,size:5,sizeAttenuation:false,transparent:true,opacity:.72,depthTest:false});
  markerMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;');};
  const markers=new T.Points(markerGeometry,markerMaterial);markers.frustumCulled=false;markers.renderOrder=10;markers.visible=false;scene.add(markers);
  // Outline of the section plane so the cut position is readable while dragging.
  const outlineGeometry=new T.BufferGeometry();outlineGeometry.setAttribute('position',new T.BufferAttribute(new Float32Array(12),3));
  const outline=new T.LineLoop(outlineGeometry,new T.LineBasicMaterial({color:0x458a85,transparent:true,opacity:.55}));outline.visible=false;outline.frustumCulled=false;scene.add(outline);
  const hover=document.createElement('div');hover.className='part-hover';hover.setAttribute('role','tooltip');hover.hidden=true;el.appendChild(hover);
  const pinLayer=document.createElement('div');pinLayer.className='pin-layer';pinLayer.innerHTML='<svg class="pin-lines"></svg>';el.appendChild(pinLayer);
  const pinLines=pinLayer.firstElementChild as SVGSVGElement,pinNodes=new Map<string,{label:HTMLDivElement;line:SVGLineElement;dot:SVGCircleElement}>();
  type Target={index:number;x:number;y:number;left:number;right:number;top:number;bottom:number};let targets:Target[]=[];
  const projected=new T.Vector3();
  const findTarget=(x:number,y:number,radius:number)=>{
   let best=-1,score=Infinity;
   for(const t of targets){const dx=Math.max(t.left-x,0,x-t.right),dy=Math.max(t.top-y,0,y-t.bottom),distance=Math.hypot(dx,dy);if(distance>radius)continue;const candidate=distance+Math.hypot(t.x-x,t.y-y)*.025;if(candidate<score){score=candidate;best=t.index;}}
   return best;
  };
  // marksOn: attachment patches of the selected muscles are showing, so those muscles move to the see-through pass.
  const xrayOn={value:0},ghostOpacity={value:.3},marksOn={value:0};
  const partShader=(shader:T.Shader)=>{
   shader.uniforms.partState={value:partTexture};shader.uniforms.selectionState={value:selectionTexture};shader.uniforms.stateWidth={value:width};shader.uniforms.xrayOn=xrayOn;shader.uniforms.ghostOpacity=ghostOpacity;shader.uniforms.marksOn=marksOn;
   shader.vertexShader='attribute float partIndex; uniform sampler2D partState; uniform sampler2D selectionState; uniform float stateWidth; varying float partVisible; varying float partSelected;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec2 stateUv = vec2((partIndex + 0.5) / stateWidth, 0.5); vec4 state = texture2D(partState, stateUv); transformed += state.xyz; partVisible = state.w; partSelected = texture2D(selectionState, stateUv).r;');
   shader.fragmentShader='uniform float xrayOn; uniform float ghostOpacity; uniform float marksOn; varying float partVisible; varying float partSelected;\n'+shader.fragmentShader;
  };
  const materialFor=(system:string)=>{
   const m=new T.MeshStandardMaterial({color:SYSTEMS.find(s=>s.id===system)?.color??'#aebbb8',metalness:.08,roughness:.53,side:T.DoubleSide,transparent:system==='integumentary',opacity:system==='integumentary'?.1:1,depthWrite:system!=='integumentary'});
   const through=system==='muscular'?' || (marksOn > 0.5 && partSelected > 0.5)':'';
   m.onBeforeCompile=shader=>{
    partShader(shader);
    // In X-ray mode only the selection is drawn solid; everything else goes to the ghost pass.
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>\nif (partVisible < 0.5 || (xrayOn > 0.5 && partSelected < 0.5)${through}) discard;`);
    // Back faces only show through a cut, so shading them darker reads as a cross-section.
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.85, 0.78), partSelected * 0.75);\nif (!gl_FrontFacing) diffuseColor.rgb *= 0.62;');
   };
   // The shader text differs for muscles, so they need their own compiled program.
   m.customProgramCacheKey=()=>'part:'+(through?'muscular':'other');
   materials.push(m);partMaterials.push(m);return m;
  };
  const ghostFor=(system:string)=>{
   const m=new T.MeshStandardMaterial({color:SYSTEMS.find(s=>s.id===system)?.color??'#aebbb8',metalness:0,roughness:.7,side:T.DoubleSide,transparent:true,depthWrite:false});
   // Selected muscles come here, tinted and half see-through, while their attachment patches show.
   const muscular=system==='muscular',drawn=muscular?'(partSelected > 0.5 ? marksOn < 0.5 : xrayOn < 0.5)':'partSelected > 0.5';
   m.onBeforeCompile=shader=>{
    partShader(shader);
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>\nif (partVisible < 0.5 || ${drawn}) discard;`);
    if(muscular)shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.85, 0.78), partSelected * 0.75);');
    // Edges stay more opaque than faces seen head-on, so outlines remain readable through the body.
    shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>\nfloat facing = abs(dot(normalize(normal), normalize(vViewPosition)));\ngl_FragColor.a = ${muscular?'partSelected > 0.5 ? 0.5 + 0.35 * pow(1.0 - facing, 2.0) : ':''}ghostOpacity * (0.22 + 0.78 * pow(1.0 - facing, 2.0));`);
   };
   m.customProgramCacheKey=()=>'ghost:'+(muscular?'muscular':'other');
   materials.push(m);partMaterials.push(m);return m;
  };
  const mats=new Map(SYSTEMS.map(s=>[s.id,materialFor(s.id)])),ghosts=new Map(SYSTEMS.map(s=>[s.id,ghostFor(s.id)]));
  const ghostVisible=(system:string)=>xrayOn.value>.5||(marksOn.value>.5&&system==='muscular');
  const pickMaterial=new T.MeshBasicMaterial({side:T.DoubleSide});materials.push(pickMaterial);
  // Muscle attachment patches: loaded the first time the page asks for some, drawn just above the bone they lie on and moved
  // with it when the model is pulled apart.
  const patchMaterial=(color:string)=>{const m=new T.MeshStandardMaterial({color,roughness:.6,metalness:0,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});materials.push(m);partMaterials.push(m);return m;};
  const patchMaterials={origin:patchMaterial(END_COLOR.origin),insertion:patchMaterial(END_COLOR.insertion)};
  // After a failed load, the next try waits for another selection rather than repeating every frame.
  let patches:Map<string,{mesh:T.Mesh;host:number}>|null=null,patchesRequested=false,patchesStale=false,shownPatches:T.Mesh[]=[],failedFor:string[]|undefined;
  const requestPatches=()=>{
   patchesRequested=true;
   (async()=>{
    const catalogue=await loadAttachments();await MeshoptDecoder.ready;
    const chunks=await Promise.all(catalogue.chunks.map(async c=>{const compressed=!!c.gzip&&typeof DecompressionStream!=='undefined';return new Uint8Array(await decodeModelResponse(await fetch(asset(compressed?c.gzip!:c.url),{signal:abort.signal}),c.bytes,compressed));}));
    if(disposed)return;
    const map=new Map<string,{mesh:T.Mesh;host:number}>();
    for(const p of catalogue.patches){
     const host=indexOf.get(p.host);if(host===undefined)continue;
     const {position,normal,index}=decodePart(catalogue,p,chunks[p.chunk],MeshoptDecoder),g=new T.BufferGeometry();
     g.setAttribute('position',new T.BufferAttribute(position,3));g.setAttribute('normal',new T.BufferAttribute(normal,3,true));g.setIndex(new T.BufferAttribute(index,1));g.computeBoundingSphere();geometries.push(g);
     const mesh=new T.Mesh(g,patchMaterials[p.end]);mesh.visible=false;mesh.matrixAutoUpdate=false;mesh.userData.patch=p.id;scene.add(mesh);map.set(p.id,{mesh,host});
    }
    patches=map;patchesStale=true;dirty=true;
   })().catch(e=>{if(!disposed&&e?.name!=='AbortError'){patchesRequested=false;failedFor=latest.current.marks;marksFailed.current?.();}});
  };
  const updatePatches=(s:SceneState)=>{
   shownPatches.forEach(m=>{m.visible=false;});shownPatches=[];
   for(const id of s.marks??[]){
    const entry=patches?.get(id);if(!entry)continue;const i=entry.host;
    if(data[i*4+3]<.5)continue;
    entry.mesh.position.set(data[i*4],data[i*4+1],data[i*4+2]);entry.mesh.updateMatrix();entry.mesh.visible=true;shownPatches.push(entry.mesh);
   }
   dirty=true;
  };
  let loaded=0;
  const loadChunk=async(ci:number)=>{
   const chunk=atlas.chunks[ci],compressed=!!chunk.gzip&&typeof DecompressionStream!=='undefined';const response=await fetch(asset(compressed?chunk.gzip!:chunk.url),{signal:abort.signal});const bytes=new Uint8Array(await decodeModelResponse(response,chunk.bytes,compressed));if(disposed)return;
   const groups=new Map<string,T.BufferGeometry[]>();
   atlas.parts.forEach((p,i)=>{
    if(p.chunk!==ci)return;
    const {position,normal,index}=decodePart(atlas,p,bytes,MeshoptDecoder),g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(position,3));
    // GPU normalized signed-byte normals keep the complete atlas compact in memory.
    g.setAttribute('normal',new T.BufferAttribute(normal,3,true));g.setIndex(new T.BufferAttribute(index,1));
    g.boundingBox=bounds[i].clone();g.computeBoundingSphere();const pick=new T.Mesh(g,pickMaterial);pick.matrixAutoUpdate=false;pickers[i]=pick;geometries.push(g);
    g.setAttribute('partIndex',new T.BufferAttribute(new Float32Array(p.vertexCount).fill(i),1));
    const list=groups.get(p.system)??[];list.push(g);groups.set(p.system,list);
   });
   groups.forEach((gs,system)=>{const geometry=mergeGeometries(gs,false);if(!geometry)throw new Error('人體模型組合失敗。');geometries.push(geometry);
    const mesh=new T.Mesh(geometry,mats.get(system as never));mesh.frustumCulled=false;scene.add(mesh);
    const ghost=new T.Mesh(geometry,ghosts.get(system as never));ghost.frustumCulled=false;ghost.renderOrder=1;ghost.userData.system=system;ghost.visible=ghostVisible(system);ghostMeshes.push(ghost);scene.add(ghost);});
   lastState=null;loaded++;onProgress(Math.round(loaded/atlas.chunks.length*100));dirty=true;
  };
  (async()=>{try{if(!MeshoptDecoder.supported)throw new Error('這個瀏覽器無法解開人體模型，請改用較新的瀏覽器。');await MeshoptDecoder.ready;let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<atlas.chunks.length){const i=cursor++;await loadChunk(i);}}));if(!disposed){ready=true;dirty=true;}}catch(e){if(!disposed)onError(e instanceof Error?e.message:'人體模型載入失敗。');}})();
  const fit=(view:string,extent=0)=>{
   const mobile=el.clientWidth<768,normalDistance=mobile?Math.max(4.5,1.8*el.clientHeight/Math.max(160,el.clientHeight-350)/(2*Math.tan(T.MathUtils.degToRad(cam.fov/2)))):4;
   const reservedHeight=mobile?350:270;const availableAspect=Math.max(.35,(el.clientWidth-(mobile?40:340))/Math.max(160,el.clientHeight-reservedHeight));const atlasDistance=Math.max(packingHeight,packingWidth/availableAspect)/(2*Math.tan(T.MathUtils.degToRad(cam.fov/2)))*(el.clientHeight/Math.max(160,el.clientHeight-reservedHeight))*1.08;
   const distance=T.MathUtils.lerp(normalDistance,Math.max(.2,atlasDistance),extent);if(extent>.8)view='front';
   const direction=view==='front'?new T.Vector3(0,.02,1):view==='back'?new T.Vector3(0,.02,-1):view==='side'?new T.Vector3(1,.02,0):new T.Vector3(.35,.06,1).normalize();
   controls.target.set(extent>.1&&el.clientWidth>767?-packingWidth*.12:0,extent>.1||mobile?.85:.68,0);cam.position.copy(controls.target).addScaledVector(direction,distance);controls.update();dirty=true;
  };
  /** Frame a box in the space left free by the panels, looking from the given direction. */
  /** The part of the canvas the panels leave free, and the view offset that centres the picture in it. */
  const freeArea=(inspectorOpen:boolean)=>{
   const w=el.clientWidth,h=el.clientHeight,mobile=w<768,landscape=w>h&&h<=600;let left=20,right=w-20,top=mobile?175:110,bottom=h-170;
   if(inspectorOpen){if(landscape){right=w-335;top=100;bottom=h-125;}else if(mobile){const sheet=document.querySelector('.detail-sheet')?.getBoundingClientRect(),header=document.querySelector('.identity')?.getBoundingClientRect();top=(header?.bottom??94)+16;bottom=(sheet?.top??h*.58-139)-16;}else{right=w-370;left=w>1100?285:25;}}
   // The quiz card sits above the dock (beside the model on a landscape phone); the top is free below whatever header still shows.
   const quiz=document.querySelector('.quiz-card')?.getBoundingClientRect();
   if(quiz?.height){
    const box=el.getBoundingClientRect(),shown=['.identity','.top-actions','.view-controls'].map(q=>document.querySelector(q)?.getBoundingClientRect()).filter(r=>r&&r.height&&r.top<120);
    top=Math.max(20,...shown.map(r=>r!.bottom-box.top+12));if(landscape)right=Math.min(right,quiz.left-box.left-16);else bottom=Math.min(bottom,quiz.top-box.top-16);
   }
   return {left,right,top,bottom,offset:[w/2-(left+right)/2,h/2-(top+bottom)/2]};
  };
  /** Where the camera goes to frame a box: position, target and the view offset that centres it in the free space. */
  const boxPose=(box:T.Box3,inspectorOpen:boolean,direction:T.Vector3)=>{
   const center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());const w=el.clientWidth,h=el.clientHeight,{left,right,top,bottom,offset}=freeArea(inspectorOpen);
   const availableWidth=Math.max(150,right-left),availableHeight=Math.max(40,bottom-top);
   const distance=Math.max(.07,Math.max(size.y*h/availableHeight,size.x*w/availableWidth/cam.aspect,size.z)/(2*Math.tan(T.MathUtils.degToRad(cam.fov/2)))*1.35);
   controls.maxDistance=Math.max(40,distance*2);return {target:center,position:center.clone().add(direction.clone().normalize().multiplyScalar(distance)),offset};
  };
  const frameBox=(box:T.Box3,inspectorOpen:boolean,direction:T.Vector3)=>{
   const pose=boxPose(box,inspectorOpen,direction);cam.setViewOffset(el.clientWidth,el.clientHeight,pose.offset[0],pose.offset[1],el.clientWidth,el.clientHeight);
   controls.target.copy(pose.target);cam.position.copy(pose.position);controls.update();dirty=true;
  };
  const resize=()=>{layoutKey='';lastState=null;lastFocus='';renderer.setPixelRatio(Math.min(devicePixelRatio,el.clientWidth<768||el.clientHeight<600?1.5:2));cam.aspect=el.clientWidth/el.clientHeight;cam.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight);if(!latest.current.isolate&&!latest.current.region)fit(latest.current.view,amount);};const observer=new ResizeObserver(resize);observer.observe(el);
  const raycaster=new T.Raycaster(),pointer=new T.Vector2(),tap=new PointerTap(),doubleTap=new DoubleTap(),pinch=new Pinch(),worldBox=new T.Box3(),hitPoint=new T.Vector3();
  const kept=(point:T.Vector3)=>planes.every(plane=>plane.distanceToPoint(point)>=-1e-4);
  /** Points the raycaster through a position on the screen. */
  const aim=(clientX:number,clientY:number)=>{const rect=renderer.domElement.getBoundingClientRect();pointer.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,cam);};
  const solidShown=()=>atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);
  type Hit={i:number;distance:number;point:T.Vector3};
  /** The nearest visible part along the ray (the skin only counts when nothing solid is shown); point is in world space. */
  const cast=(hasSolid:boolean,only?:(i:number)=>boolean):Hit|null=>{let best:Hit|null=null;
   for(let i=0;i<pickers.length;i++){const mesh=pickers[i];if(!mesh||data[i*4+3]<.5||(hasSolid&&atlas.parts[i].system==='integumentary')||(only&&!only(i)))continue;worldBox.copy(bounds[i]).translate(mesh.position);if(!raycaster.ray.intersectBox(worldBox,hitPoint))continue;
    // Hits on geometry the section or region cut away do not count.
    const hit=raycaster.intersectObject(mesh,false).find(h=>kept(h.point));if(hit&&(!best||hit.distance<best.distance))best={i,distance:hit.distance,point:hit.point.clone()};}
   return best;};
  // A double tap flies to the tapped point and turns about it from then on. The point ends up in the middle of the space the
  // panels leave free (above the detail panel on a phone), so the picture's offset moves along with the camera.
  let flight:{position:[T.Vector3,T.Vector3];target:[T.Vector3,T.Vector3];offset:[number[],number[]];start:number}|null=null;
  const flyTo=(point:T.Vector3)=>{
   const distance=cam.position.distanceTo(point),next=Math.max(Math.min(distance,.12),distance*.45),back=cam.position.clone().sub(controls.target).normalize();
   const from=cam.view?.enabled?[cam.view.offsetX,cam.view.offsetY]:[0,0];
   flight={position:[cam.position.clone(),point.clone().addScaledVector(back,next)],target:[controls.target.clone(),point.clone()],offset:[from,freeArea(!!latest.current.inspectorOpen).offset],start:performance.now()};dirty=true;
  };
  /** Flies to frame a box, the way a double tap flies to a point. */
  const flyToBox=(box:T.Box3,direction:T.Vector3)=>{
   const pose=boxPose(box,!!latest.current.inspectorOpen,direction),from=cam.view?.enabled?[cam.view.offsetX,cam.view.offsetY]:[0,0];
   flight={position:[cam.position.clone(),pose.position],target:[controls.target.clone(),pose.target],offset:[from,pose.offset],start:performance.now()};dirty=true;
  };
  /** Frames the whole view again: the isolated structure, the region, or the body. */
  const frameAgain=()=>{flight=null;const s=latest.current;if(s.isolate||s.region)lastFocus='';else{cam.clearViewOffset();fit(amount>.5?'front':s.view,Math.max(0,(amount-.3)/.7));}};
  // Wheel and pinch zoom toward a point: the visible surface under the cursor or between the fingers, or the point at the
  // orbit target's depth when nothing is there. The target moves to that point's depth first, so turning the view
  // afterwards keeps the point on screen.
  const anchor=new T.Vector3(),forward=new T.Vector3(),viewPlane=new T.Plane();
  const startZoom=(clientX:number,clientY:number)=>{
   flight=null;aim(clientX,clientY);const hit=ready?cast(solidShown()):null;
   if(hit)anchor.copy(hit.point);
   else{cam.getWorldDirection(forward);viewPlane.setFromNormalAndCoplanarPoint(forward,controls.target);if(!raycaster.ray.intersectPlane(viewPlane,anchor))anchor.copy(controls.target);}
   targetToDepth(cam.position,controls.target,anchor,controls.minDistance);
  };
  const zoomBy=(scale:number)=>{zoomAbout(cam.position,controls.target,anchor,scale,controls.minDistance,controls.maxDistance);dirty=true;};
  // One wheel gesture keeps its point; a new one starts when the cursor moves or after a pause.
  let wheelAt={x:0,y:0,time:-Infinity};
  const wheel=(e:WheelEvent)=>{e.preventDefault();const now=performance.now();if(now-wheelAt.time>350||Math.hypot(e.clientX-wheelAt.x,e.clientY-wheelAt.y)>6)startZoom(e.clientX,e.clientY);wheelAt={x:e.clientX,y:e.clientY,time:now};zoomBy(wheelScale(e));};
  const down=(e:PointerEvent)=>{hover.hidden=true;flight=null;tap.down(e.pointerId,e.clientX,e.clientY,e.pointerType==='touch'?12:5);if(e.pointerType==='touch'){const middle=pinch.down(e.pointerId,e.clientX,e.clientY);if(middle)startZoom(middle.x,middle.y);}};
  const move=(e:PointerEvent)=>{tap.move(e.pointerId,e.clientX,e.clientY);if(e.pointerType==='touch'){const scale=pinch.move(e.pointerId,e.clientX,e.clientY);if(scale)zoomBy(scale);}if(e.buttons||amount<.5||e.pointerType==='touch'||latest.current.hideNames){hover.hidden=true;return;}const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,index=findTarget(x,y,12);hover.hidden=index<0;renderer.domElement.style.cursor=index<0?'grab':'pointer';if(index>=0){hover.textContent=atlas.parts[index].label??atlas.parts[index].name;hover.style.left=`${Math.max(8,Math.min(x+14,el.clientWidth-260))}px`;hover.style.top=`${Math.max(8,Math.min(y+18,el.clientHeight-55))}px`;}};
  const cancel=(e:PointerEvent)=>{tap.cancel(e.pointerId);pinch.up(e.pointerId);};
  const up=(e:PointerEvent)=>{
   pinch.up(e.pointerId);
   const validTap=tap.up(e.pointerId,e.clientX,e.clientY);if(!validTap||!ready)return;
   const rect=renderer.domElement.getBoundingClientRect(),hasSolid=solidShown(),double=doubleTap.tap(e.clientX,e.clientY,e.timeStamp,e.pointerType==='touch'?30:8);
   let nearest=Infinity,found=-1,point:number[]|undefined;
   aim(e.clientX,e.clientY);const centre=cast(hasSolid);
   // The first tap of a double tap already selected; the second only moves the view (on empty space it frames it again).
   if(double){
    const near=!centre&&amount>.45?findTarget(e.clientX-rect.left,e.clientY-rect.top,e.pointerType==='touch'?24:16):-1;
    if(centre)flyTo(centre.point);else if(near>=0)flyTo(centers[near].clone().add(new T.Vector3(data[near*4],data[near*4+1],data[near*4+2])));else frameAgain();
    return;
   }
   // Pins keep the point relative to the part, so they follow it when the model is pulled apart.
   const local=(h:Hit)=>h.point.clone().sub(pickers[h.i]!.position).toArray().map(v=>+v.toFixed(4));
   if(centre){nearest=centre.distance;found=centre.i;point=local(centre);}
   // A tap on an attachment patch picks its muscle. Patches lie a fraction of a millimetre above the bone, so one hit within
   // a few millimetres of the nearest surface counts.
   if(shownPatches.length){
    const hit=raycaster.intersectObjects(shownPatches,false).find(h=>kept(h.point));
    if(hit&&hit.distance<=nearest+.003){hover.hidden=true;selectPatch.current?.(hit.object.userData.patch);return;}
   }
   // Nerves are only millimetres thick: a tap just beside one that lies in front of what the tap hit picks the nerve.
   if(found<0||atlas.parts[found].system!=='nervous'){
    const reach=e.pointerType==='touch'?10:5,nerve=(i:number)=>atlas.parts[i].system==='nervous';
    let nerveHit:Hit|null=null;
    for(let k=0;k<16;k++){
     const r=k<8?reach/2:reach,a=k*Math.PI/4+(k<8?0:Math.PI/8);
     aim(e.clientX+r*Math.cos(a),e.clientY+r*Math.sin(a));
     const hit=cast(hasSolid,nerve);if(hit&&hit.distance<=nearest+.002&&(!nerveHit||hit.distance<nerveHit.distance))nerveHit=hit;
    }
    if(nerveHit){found=nerveHit.i;point=local(nerveHit);}
   }
   if(found<0&&amount>.45){found=findTarget(e.clientX-rect.left,e.clientY-rect.top,e.pointerType==='touch'?24:16);point=undefined;}if(found>=0){hover.hidden=true;select.current(atlas.parts[found].id,point);}
  };
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',cancel);renderer.domElement.addEventListener('wheel',wheel,{passive:false});
  const updateClipping=(s:SceneState)=>{
   // A large area keeps its structures whole, so only a joint region cuts along its box.
   const next=clippingPlanes(s.section,s.region&&!s.region.parts?s.region.box:null,body),recompile=next.length!==planes.length;planes=next;
   partMaterials.forEach(m=>{m.clippingPlanes=planes.length?planes:null;if(recompile)m.needsUpdate=true;});
   outline.visible=!!s.section;
   if(s.section){const i=AXES[s.section.axis],plane=planes[0],c=-plane.constant*plane.normal.getComponent(i),[a,b]=[0,1,2].filter(k=>k!==i),pos=outlineGeometry.attributes.position as T.BufferAttribute;
    [[body[0][a],body[0][b]],[body[1][a],body[0][b]],[body[1][a],body[1][b]],[body[0][a],body[1][b]]].forEach(([u,v],n)=>{const corner=[0,0,0];corner[i]=c;corner[a]=u;corner[b]=v;pos.setXYZ(n,corner[0],corner[1],corner[2]);});pos.needsUpdate=true;}
   dirty=true;
  };
  const renderPins=(pins:Pin[])=>{
   for(const [id,node] of pinNodes)if(!pins.some(p=>p.id===id)){node.label.remove();node.line.remove();node.dot.remove();pinNodes.delete(id);}
   const w=el.clientWidth,h=el.clientHeight,placed:{node:{label:HTMLDivElement;line:SVGLineElement;dot:SVGCircleElement};x:number;y:number;side:number}[]=[];
   for(const pin of pins){
    let node=pinNodes.get(pin.id);
    if(!node){const label=document.createElement('div');label.className='pin-label';const text=document.createElement('span');text.textContent=pin.label;const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label',`移除標籤：${pin.label}`);close.addEventListener('click',()=>removePin.current?.(pin.id));label.append(text,close);pinLayer.append(label);
     const line=document.createElementNS('http://www.w3.org/2000/svg','line'),dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('r','3.5');pinLines.append(line,dot);node={label,line,dot};pinNodes.set(pin.id,node);}
    const i=indexOf.get(pin.part),visible=i!==undefined&&data[i*4+3]>.5;
    if(visible){projected.fromArray(pin.point).add(new T.Vector3(data[i!*4],data[i!*4+1],data[i!*4+2]));}
    let inside=visible&&kept(projected);if(inside){projected.project(cam);inside=projected.z>-1&&projected.z<1;}
    node.label.hidden=!inside;node.line.style.display=node.dot.style.display=inside?'':'none';if(!inside)continue;
    const x=(projected.x+1)*w/2,y=(1-projected.y)*h/2;placed.push({node,x,y,side:x<w/2?-1:1});
   }
   // Labels sit to the outside of their anchor; on each side they are pushed apart vertically so they never overlap.
   for(const side of [-1,1]){let floor=-Infinity;placed.filter(p=>p.side===side).sort((a,b)=>a.y-b.y).forEach(p=>{const label=p.node.label,lw=label.offsetWidth,ly=Math.max(p.y,floor+30);floor=ly;const lx=side<0?Math.max(8,p.x-70-lw):Math.min(w-8-lw,p.x+70);label.style.transform=`translate(${lx}px,${ly-13}px)`;const ex=side<0?lx+lw:lx;p.node.line.setAttribute('x1',`${p.x}`);p.node.line.setAttribute('y1',`${p.y}`);p.node.line.setAttribute('x2',`${ex}`);p.node.line.setAttribute('y2',`${ly}`);p.node.dot.setAttribute('cx',`${p.x}`);p.node.dot.setAttribute('cy',`${p.y}`);});}
  };
  const clock=new T.Clock();let lastExtent=-1;
  const animate=()=>{
   if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05),s=latest.current;
   const changed=lastState?.visible!==s.visible||lastState?.selected!==s.selected||lastState?.isolate!==s.isolate||lastState?.hidden!==s.hidden||lastState?.peel!==s.peel||lastState?.region!==s.region||lastState?.companions!==s.companions;
   const moving=Math.abs(amount-s.explode)>.0001;
   if(moving){amount=T.MathUtils.damp(amount,s.explode,8,dt);dirty=true;}
   if(lastState?.section!==s.section||lastState?.region!==s.region)updateClipping(s);
   if(s.marks?.length&&!patchesRequested&&s.marks!==failedFor)requestPatches();
   // The selected muscles only turn see-through once their patches are there to be seen.
   const through=s.markThrough&&patches?1:0;
   if(lastState?.xray!==s.xray||through!==marksOn.value){xrayOn.value=s.xray>0?1:0;ghostOpacity.value=1-s.xray;marksOn.value=through;ghostMeshes.forEach(g=>{g.visible=ghostVisible(g.userData.system);});dirty=true;}
   if(lastState?.pins!==s.pins)dirty=true;
   if(changed||moving||lastExtent<0){
    const selection=new Set(s.selected),shown=visibilityTest(s);
    const visibleParts=atlas.parts.filter(shown);
    const nextLayoutKey=visibleParts.map(p=>p.id).join(',')+':'+cam.aspect.toFixed(3);
    if(nextLayoutKey!==layoutKey){const layout=createExplosionLayout(visibleParts,cam.aspect);packingWidth=layout.width;packingHeight=layout.height;atlas.parts.forEach((p,i)=>{const cell=layout.cells.get(p.id);offsets[i]=cell?new T.Vector3(cell.x,cell.y+.85,0):centers[i].clone();});layoutKey=nextLayoutKey;if(amount>.05&&!s.isolate)fit(s.view,Math.max(0,(amount-.3)/.7));}
    atlas.parts.forEach((p,i)=>{
     const c=centers[i],destination=offsets[i];let dx=0,dy=0,dz=0;
     if(amount<=.45){const t=amount/.45;const group=SYSTEMS.findIndex(sys=>sys.id===p.system);const angle=group/SYSTEMS.length*Math.PI*2;dx=Math.sin(angle)*t*.48;dy=(c.y-.85)*t*.28;dz=Math.cos(angle)*t*.48;}
     else {const t=(amount-.45)/.55,group=SYSTEMS.findIndex(sys=>sys.id===p.system),angle=group/SYSTEMS.length*Math.PI*2;dx=T.MathUtils.lerp(Math.sin(angle)*.48,destination.x-c.x,t);dy=T.MathUtils.lerp((c.y-.85)*.28,destination.y-c.y,t);dz=T.MathUtils.lerp(Math.cos(angle)*.48,-c.z,t);}
     const selected=selection.has(p.id);data.set([dx,dy,dz,shown(p)?1:0],i*4);selectedData[i*4]=selected?255:0;
     markerPositions.set(data[i*4+3]>.5?[c.x+dx,c.y+dy,c.z+dz]:[10000,10000,10000],i*3);const mesh=pickers[i];if(mesh){mesh.position.set(dx,dy,dz);mesh.updateMatrix();mesh.updateMatrixWorld(true);}
    });partTexture.needsUpdate=true;selectionTexture.needsUpdate=true;markerGeometry.attributes.position.needsUpdate=true;lastExtent=amount;dirty=true;
   }
   if(patches&&(patchesStale||changed||moving||lastState?.marks!==s.marks)){updatePatches(s);patchesStale=false;}
   lastState=s;
   if(s.view!==lastView||s.reset!==lastReset){flight=null;cam.clearViewOffset();lastFocus='';if(!s.region)fit(s.view,amount);lastView=s.view;lastReset=s.reset;}
   if(moving&&!s.isolate&&!s.region)fit(amount>.5?'front':s.view,Math.max(0,(amount-.3)/.7));
   // Isolating a structure or choosing a body region frames the camera on it.
   const focusKey=s.isolate?'i:'+s.selected.join(',')+':'+s.reset+':'+s.inspectorOpen+':'+cam.aspect:s.region?'r:'+s.region.box.flat().join(',')+':'+s.reset+':'+cam.aspect:'';
   if(focusKey!==lastFocus||(s.isolate&&moving)){
    flight=null;
    if(s.isolate){const box=new T.Box3();atlas.parts.forEach((p,i)=>{if(s.selected.includes(p.id))box.union(bounds[i].clone().translate(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])));});if(!box.isEmpty())frameBox(box,!!s.inspectorOpen,new T.Vector3(.2,.1,1));}
    else if(s.region){const box=new T.Box3(new T.Vector3().fromArray(s.region.box[0]),new T.Vector3().fromArray(s.region.box[1]));frameBox(box,false,new T.Vector3().fromArray(s.region.look));}
    else if(lastFocus){cam.clearViewOffset();fit(s.view,amount);}
    lastFocus=focusKey;
   }
   if(s.camera&&s.camera.n!==lastCameraN){lastCameraN=s.camera.n;flight=null;cam.clearViewOffset();cam.position.fromArray(s.camera.pose.position);controls.target.fromArray(s.camera.pose.target);controls.update();dirty=true;}
   if(s.frame&&s.frame.n!==lastFrameN){lastFrameN=s.frame.n;flyToBox(new T.Box3(new T.Vector3().fromArray(s.frame.box[0]),new T.Vector3().fromArray(s.frame.box[1])),s.frame.look?new T.Vector3().fromArray(s.frame.look):cam.position.clone().sub(controls.target));}
   if(flight){
    const t=Math.min(1,(performance.now()-flight.start)/450),k=1-(1-t)**3,[[x0,y0],[x1,y1]]=flight.offset;
    cam.position.lerpVectors(flight.position[0],flight.position[1],k);controls.target.lerpVectors(flight.target[0],flight.target[1],k);
    cam.setViewOffset(el.clientWidth,el.clientHeight,x0+(x1-x0)*k,y0+(y1-y0)*k,el.clientWidth,el.clientHeight);dirty=true;if(t>=1)flight=null;
   }
   controls.enableRotate=amount<.8;controls.mouseButtons.LEFT=amount<.8?T.MOUSE.ROTATE:T.MOUSE.PAN;controls.touches.ONE=amount<.8?T.TOUCH.ROTATE:T.TOUCH.PAN;ground.visible=platform.visible=ring.visible=innerRing.visible=amount<.5&&!s.isolate&&!s.region;markers.visible=amount>.75;controls.autoRotate=s.rotate&&!s.isolate&&amount<.4;controls.autoRotateSpeed=.65;controls.update();if(controls.autoRotate)dirty=true;
   if(dirty){renderer.render(scene,cam);renderPins(s.pins);targets=[];if(amount>.45){const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);atlas.parts.forEach((p,i)=>{if(data[i*4+3]<.5||(hasSolid&&p.system==='integumentary'))return;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;for(let corner=0;corner<8;corner++){projected.set(p.bounds[(corner&1)?1:0][0]+data[i*4],p.bounds[(corner&2)?1:0][1]+data[i*4+1],p.bounds[(corner&4)?1:0][2]+data[i*4+2]).project(cam);const x=(projected.x+1)*el.clientWidth/2,y=(1-projected.y)*el.clientHeight/2;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}projected.copy(centers[i]).add(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])).project(cam);if(projected.z< -1||projected.z>1)return;targets.push({index:i,x:(projected.x+1)*el.clientWidth/2,y:(1-projected.y)*el.clientHeight/2,left,right,top,bottom});});}dirty=false;}
  };animate();
  const contextLost=(e:Event)=>{e.preventDefault();onError('裝置暫停了 3D 畫面，請重新載入。');};renderer.domElement.addEventListener('webglcontextlost',contextLost);
  return()=>{disposed=true;clearTimeout(cameraTimer);abort.abort();cancelAnimationFrame(frame);observer.disconnect();controls.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());scene.traverse(o=>{if((o instanceof T.Mesh||o instanceof T.Line)&&!geometries.includes(o.geometry)){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});env.dispose();partTexture.dispose();selectionTexture.dispose();markerGeometry.dispose();markerMaterial.dispose();hover.remove();pinLayer.remove();renderer.dispose();renderer.domElement.remove();};
 },[atlas]);
 return <div className="scene" ref={host}/>;
}
