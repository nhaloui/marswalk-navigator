import type {TerrainGrid,WalkState} from './coordinates.ts'
import {sampleTerrain,RouteFollower} from './coordinates.ts'
export type Direction='forward'|'backward'|'left'|'right'
export function directionVector(heading:number,direction:Direction){const offset={forward:0,backward:Math.PI,left:-Math.PI/2,right:Math.PI/2}[direction];return{x:Math.sin(heading+offset),y:Math.cos(heading+offset)}}
export class PovMotion {
 simulationRate=1
 mode:'free'|'step'|'route'='free';velocity={x:0,y:0};target:{x:number;y:number}|null=null;message=''
 stop(){this.velocity={x:0,y:0};this.target=null}
 requestStep(walk:WalkState,direction:Direction,distance=6){const v=directionVector(walk.heading,direction);this.message='';this.mode='step';this.target={x:walk.x+v.x*distance,y:walk.y+v.y*distance}}
 update(grid:TerrainGrid,walk:WalkState,seconds:number,speed:number,forward:number,strafe:number,follower:RouteFollower){
  const dt=Math.min(.05,Math.max(0,seconds));if(this.message&&!forward&&!strafe&&!this.target&&Math.hypot(this.velocity.x,this.velocity.y)<.001)return;this.message=''
  if(forward||strafe){this.mode='free';this.target=null;follower.pause()}
  if(this.mode==='route'&&follower.route&&!follower.paused){follower.speed+= (speed-follower.speed)*(1-Math.exp(-dt*3));const p=follower.route.duration_s?follower.advanceTime(Math.max(0,seconds),this.simulationRate):follower.update(dt);if(p){const dx=p.x_m-walk.x,dy=p.y_m-walk.y;if(sampleTerrain(grid,p.x_m,p.y_m)===null){follower.pause();this.message='Elevation unavailable';return}walk.distance+=Math.hypot(dx,dy);walk.x=p.x_m;walk.y=p.y_m;if(Math.hypot(dx,dy)>.0001){const h=Math.atan2(dx,dy);walk.heading+=Math.atan2(Math.sin(h-walk.heading),Math.cos(h-walk.heading))*(1-Math.exp(-dt*4))}}return}
  let vx=0,vy=0,remaining=Infinity
  if(this.mode==='step'&&this.target){const dx=this.target.x-walk.x,dy=this.target.y-walk.y;remaining=Math.hypot(dx,dy);if(remaining<.02){this.stop();return}const v=Math.min(speed,Math.sqrt(2*2*remaining));vx=dx/remaining*v;vy=dy/remaining*v}
  else{const n=Math.max(1,Math.hypot(forward,strafe));vx=(Math.sin(walk.heading)*forward+Math.cos(walk.heading)*strafe)/n*speed;vy=(Math.cos(walk.heading)*forward-Math.sin(walk.heading)*strafe)/n*speed}
  const ease=1-Math.exp(-dt*4);this.velocity.x+=(vx-this.velocity.x)*ease;this.velocity.y+=(vy-this.velocity.y)*ease
  let dx=this.velocity.x*dt,dy=this.velocity.y*dt,d=Math.hypot(dx,dy)
  if(d>remaining){dx=dx/d*remaining;dy=dy/d*remaining;d=remaining}
  const x=walk.x+dx,y=walk.y+dy
  if(x<grid.bounds[0]||x>grid.bounds[2]||y<grid.bounds[1]||y>grid.bounds[3]){this.message='Data boundary reached / movement stopped';this.stop();return}
  if(sampleTerrain(grid,x,y)===null){this.message='Elevation unavailable / movement stopped';this.stop();return}
  walk.x=x;walk.y=y;walk.distance+=d
 }
}

