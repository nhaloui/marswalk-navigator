import assert from 'node:assert/strict'
import fs from 'node:fs'
import {sampleTerrain,localToWorld,worldToLocal,terrainUV,stepWalk,followEyeHeight,RouteFollower,drapeRoute,TerrainSession} from '../src/terrain/coordinates.ts'
import {terrainGeometry} from '../src/terrain/geometry.ts'
const meta=JSON.parse(fs.readFileSync('src/data/terrain.generated.json','utf8'))
const bytes=fs.readFileSync('public/'+meta.binary), values=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))
const grid={width:meta.width,height:meta.height,bounds:meta.bounds,values}
assert.equal(values.length,417*417)
assert.ok(Math.abs(values.reduce((a,b)=>Math.min(a,b),Infinity)-meta.minimum)<1e-5)
assert.ok(Math.abs(values.reduce((a,b)=>Math.max(a,b),-Infinity)-meta.maximum)<1e-5)
assert.deepEqual(terrainUV(-5000,5000,meta.bounds),{u:0,v:1})
assert.deepEqual(terrainUV(5000,-5000,meta.bounds),{u:1,v:0})
for(const [x,y] of [[0,0],[3522.409289609,-3906.995959264],[-4999,4999]]){
 const z=sampleTerrain(grid,x,y);assert.ok(Number.isFinite(z))
 const world=localToWorld(x,y,z,meta.originElevation)
 assert.deepEqual(worldToLocal(world.x,world.z),{x_m:x,y_m:y})
 const eye=followEyeHeight(grid,x,y,undefined,.016);assert.ok(eye>=z+1.7-1e-10)
 assert.ok(followEyeHeight(grid,x,y,eye+20,.016)>eye)
}
const geometry=terrainGeometry(grid,meta.originElevation)
assert.equal(geometry.attributes.position.count,419*419)
assert.ok(geometry.index.count>0)
const normal=geometry.attributes.normal
assert.ok(normal.getY(10000)>0)
geometry.dispose()
const plane={width:3,height:3,bounds:[-15,-15,15,15],values:Float32Array.from([30,40,50,20,30,40,10,20,30])}
assert.equal(sampleTerrain(plane,0,0),30)
assert.equal(sampleTerrain(plane,5,5),40)
assert.equal(followEyeHeight(plane,0,0,undefined,.1),31.7)
const invalid={...plane,values:plane.values.slice()};invalid.values[4]=NaN
assert.equal(sampleTerrain(invalid,0,0),null)
assert.equal(followEyeHeight(invalid,0,0,undefined,.1),null)
const missingGeometry=terrainGeometry(invalid,30);assert.ok(missingGeometry.index.count<96);missingGeometry.dispose()
const walk={x:0,y:0,heading:0,pitch:0,distance:0}
assert.equal(stepWalk(plane,walk,1,0,10,.1),'');assert.equal(walk.y,1);assert.equal(walk.distance,1)
walk.y=15;assert.equal(stepWalk(plane,walk,1,0,10,.1),'Terrain boundary reached');assert.equal(walk.y,15)
assert.equal(stepWalk(invalid,{...walk,x:0,y:0},1,0,1,.1),'Elevation unavailable')
const follower=new RouteFollower();follower.setRoute({id:'development-unit-test-only',points:[{x_m:0,y_m:0},{x_m:10,y_m:0},{x_m:10,y_m:10}]});follower.speed=2;follower.resume();follower.update(3);assert.equal(follower.progress,6);assert.equal(follower.remaining,14);follower.pause();follower.update(5);assert.equal(follower.progress,6);follower.resume();follower.update(100);assert.equal(follower.progress,20);assert.equal(follower.paused,true)
assert.ok(drapeRoute(plane,{id:'test-only',points:[{x_m:0,y_m:0},{x_m:5,y_m:5}]}).every(p=>Number.isFinite(p.elevation_m)))
assert.throws(()=>drapeRoute(invalid,{id:'test-only',points:[{x_m:0,y_m:0},{x_m:5,y_m:5}]}))
const session=new TerrainSession(0,0);session.walk.distance=42;session.follower=follower;assert.equal(session.walk.distance,42);assert.equal(session.follower.progress,20)
console.log('PASS: real DEM float32, mesh orientation/UV, 2D/3D axis round trips, altitude interpolation, eye clearance, NoData holes, movement bounds, metric route pause/resume and draping. Synthetic fixtures are isolated to this test.')

