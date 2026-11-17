import assert from 'node:assert/strict'
import * as THREE from 'three'
import {PovMotion,directionVector} from '../src/terrain/povMotion.ts'
import {createGroundArrows} from '../src/terrain/groundArrows.ts'
import {warmRGB,createMarsSky,createMarsMaterial} from '../src/terrain/marsAppearance.ts'
import {sampleTerrain,RouteFollower,followEyeHeight,worldToLocal} from '../src/terrain/coordinates.ts'
const grid={width:9,height:9,bounds:[-45,-45,45,45],values:Float32Array.from({length:81},(_,i)=>-3500+(i%9)*.1-Math.floor(i/9)*.2)}
const initial=()=>({x:0,y:0,heading:0,pitch:-.12,distance:0})
for(const [direction,expected] of [['forward',[0,6]],['backward',[0,-6]],['left',[-6,0]],['right',[6,0]]]){
 const state=initial(),motion=new PovMotion();motion.requestStep(state,direction);const follower=new RouteFollower()
 for(let i=0;i<1000;i++)motion.update(grid,state,.016,1.2,0,0,follower)
 assert.ok(Math.hypot(state.x-expected[0],state.y-expected[1])<.021)
 assert.ok(Math.abs(state.distance-6)<.021)
 assert.equal(state.heading,0)
}
assert.ok(directionVector(Math.PI/2,'forward').x>.999)
const state=initial(),motion=new PovMotion(),follower=new RouteFollower()
motion.update(grid,state,.016,2,1,0,follower);const first=Math.hypot(motion.velocity.x,motion.velocity.y);assert.ok(first>0&&first<2)
for(let i=0;i<60;i++)motion.update(grid,state,.016,2,1,0,follower)
const fast=Math.hypot(motion.velocity.x,motion.velocity.y);motion.update(grid,state,.016,2,0,0,follower);assert.ok(Math.hypot(motion.velocity.x,motion.velocity.y)<fast)
motion.stop();assert.equal(Math.hypot(motion.velocity.x,motion.velocity.y),0)
const edge=initial();edge.y=44.99;motion.requestStep(edge,'forward');for(let i=0;i<100;i++)motion.update(grid,edge,.05,10,0,0,follower);assert.ok(edge.y<=45);assert.match(motion.message,/boundary/)
const missing={...grid,values:grid.values.slice()};missing.values[40]=NaN;assert.equal(sampleTerrain(missing,0,0),null)
const arrows=createGroundArrows(grid,-3500);arrows.update(initial(),true)
for(const arrow of arrows.meshes){assert.ok(arrow.visible);const a=arrow.geometry.attributes.position;for(let i=0;i<a.count;i++){const local=worldToLocal(a.getX(i),a.getZ(i)),h=sampleTerrain(grid,local.x_m,local.y_m);assert.ok(Math.abs(a.getY(i)- (h+3500+.07))<.0001)}}
arrows.group.updateMatrixWorld(true)
const camera=new THREE.PerspectiveCamera(65,1,.1,100),target=new THREE.Vector3(),positions=arrows.meshes[0].geometry.attributes.position
for(const i of [0,1,2])target.add(new THREE.Vector3(positions.getX(i),positions.getY(i),positions.getZ(i)))
target.divideScalar(3);camera.position.set(0,1.7,0);camera.lookAt(target);camera.updateMatrixWorld();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),camera);assert.ok(arrows.pick(ray));arrows.dispose()
for(const luminance of [.001,.05,.2,.5,.8,.99])for(const strength of [0,.5,1]){const rgb=warmRGB(luminance,strength);assert.ok(rgb.every(v=>v>=0&&v<=1));assert.ok(Math.abs(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722-luminance)<1e-12)}
const texture=new THREE.Texture(),appearance=createMarsMaterial(texture,texture,texture);const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};appearance.material.onBeforeCompile(shader,{});assert.ok(shader.fragmentShader.indexOf('vec3 graded')<shader.fragmentShader.indexOf('vec4 dust='));assert.ok(shader.fragmentShader.includes('vMapUv'));appearance.material.dispose();texture.dispose()
const sky=createMarsSky();assert.ok(!sky.mesh.material.fragmentShader.includes('<colorspace_fragment>}'));sky.dispose()
const eye=followEyeHeight(grid,0,0,undefined,.016);assert.ok(eye>=sampleTerrain(grid,0,0)+1.7)
console.log('PASS: 6 m forward/back/strafe steps, heading independence, acceleration/deceleration, stopping/bounds, ground-arrow DEM heights and raycasting, CTX luminance grading, layer shader order and sky syntax.')
