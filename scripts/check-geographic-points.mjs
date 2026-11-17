import assert from 'node:assert/strict'
import { geographicToLocal, localToGeographic, directDistance, CRATER_CENTER } from '../src/lib/marsCoordinates.ts'
import { knownPoints, habitatCraterDistanceM } from '../src/data/mission.ts'
import { localToPercent, coverImage, screenToLocal } from '../src/lib/localMap.ts'
import { imageFrame, clampPan } from '../src/lib/imageViewport.ts'
// Independent reference: Rasterio / PROJ, using the actual GeoTIFF CRS.
const habitat={latitude:40.79036,longitude:22.11728}
const expected={x:3522.4092896091493,y:-3906.9959592640603}
const actual=geographicToLocal(habitat)
assert.ok(Math.abs(actual.x-expected.x)<1e-6 && Math.abs(actual.y-expected.y)<1e-6)
assert.deepEqual(geographicToLocal(CRATER_CENTER),{x:0,y:0})
assert.ok(Math.abs(habitatCraterDistanceM-5260.416773339402)<1e-6)
assert.ok(Math.abs(Math.hypot(actual.x,actual.y)-directDistance(habitat,CRATER_CENTER))<1e-6)
assert.equal(knownPoints.length,2)
assert.ok(knownPoints.some(p=>p.id==='hab')&&knownPoints.some(p=>p.id==='crater'))
for (const view of [{width:640,height:850},{width:360,height:620},{width:1200,height:710}]) {
 const fitted=coverImage(view,{width:1668,height:1668})
 for(const zoom of [1,2,4,8]) {
  const pan=clampPan({x:-270,y:180},view,fitted,zoom)
  const frame=imageFrame(view,fitted,zoom,pan)
  for(const point of knownPoints) {
   const position=localToPercent(point,[-5000,-5000,5000,5000])
   assert.ok(position.x>=0&&position.x<=100&&position.y>=0&&position.y<=100)
   const screen={x:frame.left+position.x/100*frame.width,y:frame.top+position.y/100*frame.height}
   const result=screenToLocal(screen,frame,[-5000,-5000,5000,5000])
   assert.ok(Math.abs(result.x-point.x)<1e-8 && Math.abs(result.y-point.y)<1e-8)
   const inverse=localToGeographic(point)
   assert.ok(Math.abs(inverse.latitude-point.geographic.latitude)<1e-10&&Math.abs(inverse.longitude-point.geographic.longitude)<1e-10)
  }
 }
}
console.log('PASS: Habitat projection matches Rasterio/PROJ; crater is (0,0); direct Mars distance is 5260.416773 m; geographic and screen transforms round-trip across zoom/pan/tablet sizes.')
