import * as T from 'three';
/**
 * The room that lights the model through its reflections: three.js r159's RoomEnvironment as this app has always used it (MIT,
 * three.js authors; after model-viewer's EnvironmentScene). From r16x the add-on lights its room far more strongly, which washed
 * the muscles out, so the app keeps this copy and its look.
 */
const BOXES:[position:number[],rotationY:number,scale:number[]][]=[
 [[-10.906,2.009,1.846],-.195,[2.328,7.905,4.651]],[[-5.607,-.754,-.758],.994,[1.970,1.534,3.955]],[[6.167,.857,7.803],.561,[3.927,6.285,3.687]],
 [[-2.017,.018,6.124],.333,[2.002,4.566,2.064]],[[2.291,-.756,-2.621],-.286,[1.546,1.552,1.496]],[[-2.193,-.369,-5.547],.516,[3.875,3.487,2.986]],
];
/** Glowing panels: intensity, position, scale. */
const PANELS:[intensity:number,position:number[],scale:number[]][]=[
 [50,[-16.116,14.37,8.208],[.1,2.428,2.739]],[50,[-16.109,18.021,-8.207],[.1,2.425,2.751]],[17,[14.904,12.198,-1.832],[.15,4.265,6.331]],
 [43,[-.462,8.89,14.520],[4.38,5.441,.088]],[20,[3.235,11.486,-12.541],[2.5,2,.1]],[100,[0,20,0],[1,.1,1]],
];
export function roomEnvironment(){
 const scene=new T.Scene(),geometry=new T.BoxGeometry();geometry.deleteAttribute('uv');
 const boxMaterial=new T.MeshStandardMaterial(),materials:T.Material[]=[boxMaterial];
 const light=new T.PointLight(0xffffff,5,28,2);light.position.set(.418,16.199,.3);scene.add(light);
 const room=new T.Mesh(geometry,new T.MeshStandardMaterial({side:T.BackSide}));room.position.set(-.757,13.219,.717);room.scale.set(31.713,28.305,28.591);scene.add(room);materials.push(room.material);
 for(const [position,rotationY,scale] of BOXES){const box=new T.Mesh(geometry,boxMaterial);box.position.fromArray(position);box.rotation.set(0,rotationY,0);box.scale.fromArray(scale);scene.add(box);}
 for(const [intensity,position,scale] of PANELS){const material=new T.MeshBasicMaterial();material.color.setScalar(intensity);materials.push(material);const panel=new T.Mesh(geometry,material);panel.position.fromArray(position);panel.scale.fromArray(scale);scene.add(panel);}
 return {scene,dispose:()=>{geometry.dispose();materials.forEach(m=>m.dispose());}};
}
