/** The long direction of a part (its principal axis) and how far its vertices reach along it; muscle fibres are drawn along this. */
export function principalAxis(position:Float32Array):{axis:[number,number,number];min:number;max:number}{
 const n=position.length/3,step=Math.max(1,Math.floor(n/4000));
 let mx=0,my=0,mz=0,count=0;
 for(let i=0;i<n;i+=step){mx+=position[i*3];my+=position[i*3+1];mz+=position[i*3+2];count++;}
 mx/=count;my/=count;mz/=count;
 let xx=0,xy=0,xz=0,yy=0,yz=0,zz=0;
 for(let i=0;i<n;i+=step){const x=position[i*3]-mx,y=position[i*3+1]-my,z=position[i*3+2]-mz;xx+=x*x;xy+=x*y;xz+=x*z;yy+=y*y;yz+=y*z;zz+=z*z;}
 // Power iteration finds the direction with the most spread.
 let a=[1,1,1],length=1;
 for(let k=0;k<24;k++){
  const x=xx*a[0]+xy*a[1]+xz*a[2],y=xy*a[0]+yy*a[1]+yz*a[2],z=xz*a[0]+yz*a[1]+zz*a[2];
  length=Math.hypot(x,y,z);if(length<1e-12)break;a=[x/length,y/length,z/length];
 }
 if(length<1e-12)return {axis:[0,0,0],min:0,max:0};
 let min=Infinity,max=-Infinity;
 for(let i=0;i<n;i++){const d=position[i*3]*a[0]+position[i*3+1]*a[1]+position[i*3+2]*a[2];if(d<min)min=d;if(d>max)max=d;}
 return {axis:[a[0],a[1],a[2]],min,max};
}
