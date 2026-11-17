export interface TerrainGrid { width:number; height:number; bounds:number[]; values:Float32Array }
export interface LocalPoint {x_m:number;y_m:number;elevation_m?:number;distance_m?:number;time_s?:number;metadata?:Record<string,unknown>}
export function localToWorld(x:number,y:number,elevation:number,origin:number) { return {x,y:elevation-origin,z:-y} }
export function worldToLocal(x:number,z:number) { return {x_m:x,y_m:-z} }
export function terrainUV(x:number,y:number,bounds:number[]) {return {u:(x-bounds[0])/(bounds[2]-bounds[0]),v:(y-bounds[1])/(bounds[3]-bounds[1])}}
export function sampleTerrain(grid:TerrainGrid,x:number,y:number):number|null {
 const [west,south,east,north]=grid.bounds
 if(x<west||x>east||y<south||y>north)return null
 const col=Math.max(0,Math.min(grid.width-1,(x-west)/(east-west)*grid.width-.5))
 const row=Math.max(0,Math.min(grid.height-1,(north-y)/(north-south)*grid.height-.5))
 const c=Math.min(grid.width-2,Math.floor(col)),r=Math.min(grid.height-2,Math.floor(row))
 const a=grid.values[r*grid.width+c],b=grid.values[r*grid.width+c+1],d=grid.values[(r+1)*grid.width+c],e=grid.values[(r+1)*grid.width+c+1]
 if(![a,b,d,e].every(Number.isFinite))return null
 const u=col-c,v=row-r
 return (a*(1-u)+b*u)*(1-v)+(d*(1-u)+e*u)*v
}
export interface LocalRoute {id:string;points:LocalPoint[];duration_s?:number;legs?:{phase:'rover'|'eva';points:LocalPoint[];distance_m:number;duration_s:number}[];metadata?:Record<string,unknown>}
/** Metric progress independent of A*, view rendering, and wall-clock animation. */
export class RouteFollower {
 route:LocalRoute|null=null; progress=0; elapsed=0; paused=true; speed=1.2
 setRoute(route:LocalRoute){if(route.points.length<2||route.points.some(p=>!Number.isFinite(p.x_m)||!Number.isFinite(p.y_m)))throw Error('Invalid ordered local route');this.route=route;this.progress=0;this.elapsed=0;this.paused=true}
 get phase(){return this.route?.legs&&this.progress>=this.route.legs[0].distance_m?'eva':'rover'}
 get nextManeuver(){
  if(!this.route)return 'No route'
  if(this.remaining<1)return 'Destination reached'
  const points=this.route.points
  let index=0;while(index<points.length-2&&(points[index+1].distance_m??Infinity)<=this.progress)index++
  for(let i=index+1;i<Math.min(points.length-1,index+8);i++){
   const a=points[i-1],b=points[i],c=points[i+1],h1=Math.atan2(b.x_m-a.x_m,b.y_m-a.y_m),h2=Math.atan2(c.x_m-b.x_m,c.y_m-b.y_m),angle=Math.atan2(Math.sin(h2-h1),Math.cos(h2-h1))
   if(Math.abs(angle)>.45)return `${angle>0?'Turn right':'Turn left'} in ${Math.max(0,Math.round((b.distance_m??0)-this.progress))} m`
  }
  return this.phase==='rover'?`Parking in ${Math.max(0,Math.round((this.route.legs?.[0].distance_m??this.length)-this.progress))} m`:'Continue to the destination'
 }
 advanceTime(seconds:number,multiplier=1):LocalPoint|null{
  if(!this.route||this.paused)return this.position()
  const points=this.route.points,total=this.route.duration_s??points.at(-1)?.time_s
  if(!total)return this.update(seconds)
  this.elapsed=Math.min(total,this.elapsed+Math.max(0,seconds)*Math.max(0,multiplier))
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],ta=a.time_s??0,tb=b.time_s??0
   if(this.elapsed<=tb&&tb>ta){const fraction=(this.elapsed-ta)/(tb-ta);this.progress=(a.distance_m??0)+fraction*((b.distance_m??0)-(a.distance_m??0));break}
  }
  if(this.elapsed>=total){this.progress=this.length;this.paused=true}
  return this.position()
 }
 get length(){return this.route?.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x_m-this.route!.points[i].x_m,p.y_m-this.route!.points[i].y_m),0)??0}
 get remaining(){return Math.max(0,this.length-this.progress)}
 resumeAtRest(){this.speed=0;this.resume()}
 resume(){if(this.route&&this.remaining>0)this.paused=false}
 pause(){this.paused=true}
 update(seconds:number){if(!this.paused)this.progress=Math.min(this.length,this.progress+Math.max(0,seconds)*Math.max(0,this.speed));if(this.remaining===0)this.paused=true;return this.position()}
 position():LocalPoint|null {if(!this.route)return null;let remaining=this.progress;const p=this.route.points;for(let i=1;i<p.length;i++){const length=Math.hypot(p[i].x_m-p[i-1].x_m,p[i].y_m-p[i-1].y_m);if(length>0&&remaining<=length){const t=remaining/length;return{x_m:p[i-1].x_m+(p[i].x_m-p[i-1].x_m)*t,y_m:p[i-1].y_m+(p[i].y_m-p[i-1].y_m)*t}}remaining-=length}return p.at(-1)!}
}
export function sampleTriangle(grid:TerrainGrid,x:number,y:number){
 const [west,south,east,north]=grid.bounds
 if(x<west||x>east||y<south||y>north)return null
 const col=Math.max(0,Math.min(grid.width-1,(x-west)/(east-west)*grid.width-.5)),row=Math.max(0,Math.min(grid.height-1,(north-y)/(north-south)*grid.height-.5))
 const c=Math.min(grid.width-2,Math.floor(col)),r=Math.min(grid.height-2,Math.floor(row)),u=col-c,v=row-r
 const a=grid.values[r*grid.width+c],b=grid.values[r*grid.width+c+1],d=grid.values[(r+1)*grid.width+c],e=grid.values[(r+1)*grid.width+c+1]
 if(![a,b,d,e].every(Number.isFinite))return null
 return u+v<=1?a+u*(b-a)+v*(d-a):e+(1-u)*(d-e)+(1-v)*(b-e)
}
export interface WalkState {x:number;y:number;heading:number;pitch:number;distance:number}
export function stepWalk(grid:TerrainGrid,state:WalkState,forward:number,strafe:number,speed:number,seconds:number){
 const magnitude=Math.max(1,Math.hypot(forward,strafe)),step=Math.max(0,speed)*Math.max(0,Math.min(.1,seconds))
 const x=state.x+(Math.sin(state.heading)*forward+Math.cos(state.heading)*strafe)/magnitude*step
 const y=state.y+(Math.cos(state.heading)*forward-Math.sin(state.heading)*strafe)/magnitude*step
 if(x<grid.bounds[0]||x>grid.bounds[2]||y<grid.bounds[1]||y>grid.bounds[3])return 'Terrain boundary reached'
 if(sampleTerrain(grid,x,y)===null)return 'Elevation unavailable'
 state.distance+=Math.hypot(x-state.x,y-state.y);state.x=x;state.y=y;return ''
}
export class TerrainSession {
 originVersion=0; walk:WalkState; follower=new RouteFollower(); orbit?:{position:number[];target:number[]}
 constructor(x:number,y:number){this.walk={x,y,heading:0,pitch:-.12,distance:0}}
 clearRoute(){this.follower.pause();this.follower.route=null}
 orientNorth(){this.walk.heading=0;this.walk.pitch=0}
 setOrigin(x:number,y:number){this.originVersion++;this.walk.x=x;this.walk.y=y;this.walk.distance=0;this.follower.pause()}
}
/** Future route rendering uses this same ground sampler, never screen pixels. */
export function drapeRoute(grid:TerrainGrid,route:LocalRoute,spacing=10):LocalPoint[]{
 const result:LocalPoint[]=[]
 for(let i=1;i<route.points.length;i++){
  const a=route.points[i-1],b=route.points[i],length=Math.hypot(b.x_m-a.x_m,b.y_m-a.y_m),steps=Math.max(1,Math.ceil(length/Math.max(1,spacing)))
  for(let j=i===1?0:1;j<=steps;j++){const t=j/steps,x_m=a.x_m+(b.x_m-a.x_m)*t,y_m=a.y_m+(b.y_m-a.y_m)*t,elevation=sampleTerrain(grid,x_m,y_m),meshElevation=sampleTriangle(grid,x_m,y_m);if(elevation===null||meshElevation===null)throw Error('Route outside valid DEM');result.push({x_m,y_m,elevation_m:Math.max(elevation,meshElevation)})}
 }
 return result
}
/** Absolute eye elevation, bilinear ground following with triangulated-mesh clearance. */
export function followEyeHeight(grid:TerrainGrid,x:number,y:number,previous:number|undefined,seconds:number){
 const bilinear=sampleTerrain(grid,x,y),triangle=sampleTriangle(grid,x,y)
 if(bilinear===null||triangle===null)return null
 const minimum=Math.max(bilinear,triangle)+1.7
 return previous===undefined?minimum:Math.max(minimum,previous+(minimum-previous)*(1-Math.exp(-Math.max(0,seconds)*10)))
}
