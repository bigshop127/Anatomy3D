import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createExplosionLayout} from '../app/explosion-layout.ts';
import * as T from 'three';
import {DoubleTap,PointerTap} from '../app/pointer-tap.ts';
import {Pinch,targetToDepth,wheelScale,zoomAbout} from '../app/camera-zoom.ts';
import {decodeSnapshot,encodeSnapshot} from '../app/share.ts';
import {atlasTools} from '../app/agent-tools.ts';

for (const file of ['atlas.json']) {
  const atlas=JSON.parse(await readFile(new URL(`../public/models/${file}`,import.meta.url)));
  const groups=[atlas.parts,...[...new Set(atlas.parts.map(p=>p.system))].map(system=>atlas.parts.filter(p=>p.system===system))];
  for(const group of groups) for(const aspect of [.46,1,1.7]) {
    const layout=createExplosionLayout(group,aspect),cells=[...layout.cells.values()];
    assert.equal(cells.length,group.length);
    for(let i=0;i<cells.length;i++) {
      const a=cells[i];
      assert.ok(Math.abs(a.x)+a.width/2<=layout.width/2+1e-8);
      assert.ok(Math.abs(a.y)+a.height/2<=layout.height/2+1e-8);
      for(let j=i+1;j<cells.length;j++) {
        const b=cells[j];
        assert.ok(Math.abs(a.x-b.x)>=(a.width+b.width)/2-1e-8 || Math.abs(a.y-b.y)>=(a.height+b.height)/2-1e-8,'Exploded pieces overlap');
      }
    }
  }
  let selected=null;
  const [find,inspect]=atlasTools(atlas,c=>{selected=c;});
  const results=find.execute({query:'femur'});
  assert.ok(results.length>0);
  inspect.execute({id:results[0].id});
  const previous=selected;
  assert.throws(()=>inspect.execute({id:'nonexistent-structure'}));
  assert.equal(selected,previous);
  assert.throws(()=>find.execute({query:' '}));
  console.log(`${file}: packing at desktop/mobile aspect ratios and search/inspection contracts passed.`);
}
const tap=new PointerTap();
tap.down(1,10,10,5);assert.equal(tap.up(1,12,11),true);
tap.down(1,10,10,5);tap.move(1,40,10);assert.equal(tap.up(1,10,10),false);
tap.down(1,10,10,12);tap.down(2,20,20,12);assert.equal(tap.up(2,20,20),false);assert.equal(tap.up(1,10,10),false);
tap.down(1,10,10,5);tap.cancel(1);assert.equal(tap.up(1,10,10),false);
tap.down(1,10,10,5);assert.equal(tap.up(1,10,10),true);
assert.equal(createExplosionLayout([]).cells.size,0);
console.log('Tap, drag, multitouch, cancellation, and empty-view checks passed.');

// Zoom toward a point (app/camera-zoom.ts): the point stays where it is on screen, the target ends up level with it, and the
// distance limits hold.
const camera=new T.PerspectiveCamera(34,.5,.005,100),position=new T.Vector3(1.4,1.05,3.6),target=new T.Vector3(0,.85,0),hand=new T.Vector3(-.28,.74,.02);
// Screen position only: the depth (z) of course changes as the camera comes closer.
const onScreen=p=>{camera.position.copy(position);camera.lookAt(target);camera.updateMatrixWorld();const v=p.clone().project(camera);return new T.Vector2(v.x,v.y);};
const before=onScreen(hand);targetToDepth(position,target,hand,.025);const levelled=onScreen(hand);
assert.ok(before.distanceTo(levelled)<1e-6,'Moving the target to the point depth changed the view');
const forward=target.clone().sub(position).normalize();assert.ok(Math.abs(hand.clone().sub(position).dot(forward)-target.distanceTo(position))<1e-9,'Target is not level with the point');
for(let k=0;k<30;k++)zoomAbout(position,target,hand,.7,.025,40);
assert.ok(onScreen(hand).distanceTo(before)<1e-6,'The zoom point moved on screen');
assert.ok(Math.abs(position.distanceTo(target)-.025)<1e-9,`Zooming in stops at the closest distance (${position.distanceTo(target)})`);
assert.ok(Math.abs(zoomAbout(position,target,hand,.5,.025,40)-1)<1e-9,'Zooming in further than the closest distance');
assert.ok(wheelScale({deltaY:100,deltaMode:0,ctrlKey:false})>1&&wheelScale({deltaY:-100,deltaMode:0,ctrlKey:false})<1,'Wheel down zooms out, up zooms in');
assert.ok(Math.abs(wheelScale({deltaY:3,deltaMode:1,ctrlKey:false})-wheelScale({deltaY:48,deltaMode:0,ctrlKey:false}))<1e-12,'Line deltas count as 16 pixels');
const pinch=new Pinch();
assert.equal(pinch.down(1,100,100),null);assert.deepEqual(pinch.down(2,200,100),{x:150,y:100});
assert.ok(Math.abs(pinch.move(2,300,100)-.5)<1e-12,'Spreading the fingers twice as far halves the distance');
assert.equal(pinch.move(3,0,0),null,'An untracked touch is not part of the pinch');
pinch.up(2);assert.equal(pinch.move(1,120,100),null,'One finger left is not a pinch');
assert.equal(pinch.down(3,0,0)!==null,true,'A new second finger starts a new pinch');assert.equal(pinch.down(4,50,50),null,'Three fingers are not a pinch');
const double=new DoubleTap();
assert.equal(double.tap(10,10,0,30),false);assert.equal(double.tap(20,15,300,30),true,'Second tap close by is a double tap');
assert.equal(double.tap(20,15,400,30),false,'A third tap starts afresh');assert.equal(double.tap(200,15,500,30),false,'A tap far away is not a double tap');
assert.equal(double.tap(200,15,900,30),false,'A tap after a pause is not a double tap');
console.log('Zoom toward a point, pinch, wheel and double-tap checks passed.');

// Share links: large areas survive the round trip, unknown regions are dropped instead of breaking the page.
const snap={v:1,visible:['skeletal'],selected:[],hidden:[],isolate:false,xray:0,section:null,region:{id:'lower-limb',side:'left'},peel:2,pins:[],view:'front'};
assert.deepEqual(decodeSnapshot(encodeSnapshot(snap)).region,{id:'lower-limb',side:'left'});
assert.equal(decodeSnapshot(encodeSnapshot({...snap,region:{id:'elbow',side:'right'}})).region.id,'elbow');
assert.equal(decodeSnapshot(encodeSnapshot({...snap,region:{id:'tail',side:'left'}})).region,null,'Unknown region ids are dropped');
console.log('Share link region checks passed.');
