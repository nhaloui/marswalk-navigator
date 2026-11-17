import {POV_STYLE,routeLineWidth} from '../src/terrain/povStyle.ts'
import assert from 'node:assert/strict'
import {RouteFollower} from '../src/terrain/coordinates.ts'
import {PovMotion} from '../src/terrain/povMotion.ts'
const route={id:'fixture-only',duration_s:20,points:[
 {x_m:0,y_m:0,distance_m:0,time_s:0},
 {x_m:20,y_m:0,distance_m:20,time_s:10},
 {x_m:20,y_m:10,distance_m:30,time_s:20}],
 legs:[{phase:'rover',distance_m:20,points:[],duration_s:10},{phase:'eva',distance_m:10,points:[],duration_s:10}]}
const follower=new RouteFollower();follower.setRoute(route);follower.resume()
follower.advanceTime(5);assert.equal(follower.progress,10);assert.equal(follower.phase,'rover')
assert.ok(follower.nextManeuver.includes('left'))
follower.pause();follower.advanceTime(100);assert.equal(follower.progress,10)
follower.resume();follower.advanceTime(5);assert.equal(follower.phase,'eva');assert.equal(follower.progress,20)
follower.advanceTime(2,2);assert.equal(follower.progress,24);assert.deepEqual(follower.position(),{x_m:20,y_m:4})
follower.advanceTime(100);assert.equal(follower.remaining,0);assert.equal(follower.paused,true)
// The existing POV motion must advance along model time, not the free-camera speed.
const grid={width:5,height:5,bounds:[-100,-100,100,100],values:new Float32Array(25)}
const walk={x:0,y:0,heading:0,pitch:0,distance:0},motion=new PovMotion()
follower.setRoute(route);follower.resume();motion.mode='route';motion.simulationRate=10
motion.update(grid,walk,.05,50,0,0,follower)
assert.ok(Math.abs(walk.x-1)<1e-9);assert.equal(walk.y,0)
const progress=follower.progress;follower.pause();motion.stop();motion.update(grid,walk,.05,50,0,0,follower)
assert.equal(follower.progress,progress)
follower.setRoute(route);follower.resume();walk.x=0;walk.y=0
motion.update(grid,walk,.5,50,0,0,follower)
assert.equal(follower.progress,10) // x10 model time remains correct on a slow frame.
console.log('PASS: metric/time route progression, continuous Rover→EVA handoff, pause/resume, accelerated simulation, arrival and POV uses model timing.')

assert.deepEqual(POV_STYLE,{grade:.6,contrast:1.22,detail:.8,grain:.65,micro:.45})
assert.ok(routeLineWidth('pov',false)>routeLineWidth('3d',false))
assert.equal(routeLineWidth('3d',false),3)
