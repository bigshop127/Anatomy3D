import * as T from 'three';
/** Zooming toward a point: OrbitControls in three 0.159 only zooms toward its target (its zoomToCursor follows the mouse
 * wheel but not a pinch), so the scene does its own wheel and pinch zoom with these helpers. */

/** Scales the camera and the orbit target about a point. A perspective view looks the same scaled about any point, so the
 * point stays where it is on screen while everything around it grows. The scale is limited so the distance from the camera
 * to the target stays within [min, max]; returns the scale used. */
export function zoomAbout(position:T.Vector3,target:T.Vector3,anchor:T.Vector3,scale:number,min:number,max:number){
 const distance=position.distanceTo(target);if(!(distance>0)||!(scale>0))return 1;
 const s=T.MathUtils.clamp(scale,min/distance,max/distance);
 position.sub(anchor).multiplyScalar(s).add(anchor);target.sub(anchor).multiplyScalar(s).add(anchor);
 return s;
}
/** Moves the orbit target along the line of sight to the depth of a point, so that turning the view afterwards pivots
 * beside that point instead of somewhere behind it. The view itself does not change. */
export function targetToDepth(position:T.Vector3,target:T.Vector3,point:T.Vector3,min:number){
 const forward=target.clone().sub(position).normalize(),depth=point.clone().sub(position).dot(forward);
 if(depth>min)target.copy(position).addScaledVector(forward,depth);
}
/** The distance scale for one wheel event. Deltas come in pixels, lines or pages depending on the device; a trackpad pinch
 * arrives as a wheel with ctrlKey and small deltas, so it is scaled up. */
export function wheelScale(e:{deltaY:number;deltaMode:number;ctrlKey:boolean}){
 const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?400:1);
 return Math.exp(T.MathUtils.clamp(pixels,-200,200)*(e.ctrlKey?.01:.0015));
}
/** Follows the touches on the canvas: where a two-finger pinch starts, then how far the fingers spread. */
export class Pinch {
 private points=new Map<number,{x:number;y:number}>();
 private spread=0;
 /** Returns the middle of the two fingers when this touch starts a pinch. */
 down(id:number,x:number,y:number){
  this.points.set(id,{x,y});
  if(this.points.size!==2){this.spread=0;return null;}
  const [a,b]=[...this.points.values()];this.spread=Math.hypot(a.x-b.x,a.y-b.y);
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
 }
 /** While pinching, the scale for the camera distance (previous spread over the new one, so spreading zooms in). */
 move(id:number,x:number,y:number){
  if(!this.points.has(id))return null;this.points.set(id,{x,y});
  if(this.points.size!==2)return null;
  const [a,b]=[...this.points.values()],spread=Math.hypot(a.x-b.x,a.y-b.y),previous=this.spread;this.spread=spread;
  // Fingers almost touching give wild ratios; one event never zooms more than twofold.
  return previous>8&&spread>8?T.MathUtils.clamp(previous/spread,.5,2):null;
 }
 up(id:number){this.points.delete(id);this.spread=0;}
}
