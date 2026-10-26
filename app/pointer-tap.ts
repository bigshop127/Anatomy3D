/** Distinguish a tap from an orbit, pinch, pan, or canceled touch sequence. */
export class PointerTap {
 private active=new Map<number,{x:number;y:number;threshold:number}>();
 private blocked=false;
 down(id:number,x:number,y:number,threshold:number){
  if(this.active.size===0)this.blocked=false;
  this.active.set(id,{x,y,threshold});
  if(this.active.size>1)this.blocked=true;
 }
 move(id:number,x:number,y:number){
  const start=this.active.get(id);
  if(start&&Math.hypot(x-start.x,y-start.y)>start.threshold)this.blocked=true;
 }
 up(id:number,x:number,y:number){
  this.move(id,x,y);
  const tap=this.active.has(id)&&this.active.size===1&&!this.blocked;
  this.active.delete(id);
  return tap;
 }
 cancel(id:number){this.active.delete(id);this.blocked=true}
}
/** A second tap soon after the first and close to it. The pair is used up, so a third tap starts afresh. */
export class DoubleTap {
 private last:{x:number;y:number;time:number}|null=null;
 tap(x:number,y:number,time:number,radius:number){
  const double=!!this.last&&time-this.last.time<=350&&Math.hypot(x-this.last.x,y-this.last.y)<=radius;
  this.last=double?null:{x,y,time};
  return double;
 }
}
