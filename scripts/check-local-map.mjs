import assert from 'node:assert/strict'
import { coverImage, percentToLocal, localToPercent, screenToLocal, scaleBar, zoomAt } from '../src/lib/localMap.ts'
import { clampPan, imageFrame, screenToImage } from '../src/lib/imageViewport.ts'
const bounds = [-5000,-5000,5000,5000]
assert.deepEqual(percentToLocal({x:0,y:0},bounds),{x:-5000,y:5000})
assert.deepEqual(percentToLocal({x:100,y:100},bounds),{x:5000,y:-5000})
assert.deepEqual(percentToLocal({x:50,y:50},bounds),{x:0,y:0})
for (const view of [{width:800,height:710},{width:360,height:620},{width:1200,height:760}]) {
 const fitted=coverImage(view,{width:1668,height:1668})
 assert.equal(fitted.width,fitted.height)
 assert.ok(fitted.width>=view.width && fitted.height>=view.height)
 for(const zoom of [1,1.8,4,8]) {
  const pan=clampPan({x:100000,y:-100000},view,fitted,zoom)
  const frame=imageFrame(view,fitted,zoom,pan)
  assert.ok(frame.left<=1e-9 && frame.top<=1e-9)
  assert.ok(frame.left+frame.width>=view.width-1e-9 && frame.top+frame.height>=view.height-1e-9)
  for(const point of [{x:-5000,y:5000},{x:0,y:0},{x:5000,y:-5000},{x:-2100,y:-2200}]) {
   const percent=localToPercent(point,bounds)
   const screen={x:frame.left+percent.x/100*frame.width,y:frame.top+percent.y/100*frame.height}
   const result=screenToLocal(screen,frame,bounds)
   assert.ok(result && Math.abs(result.x-point.x)<1e-8 && Math.abs(result.y-point.y)<1e-8)
  }
  const scale=scaleBar(frame.width,bounds)
  assert.ok(scale.pixels<=120+1e-9)
  assert.ok(Math.abs(scale.pixels/frame.width*10000-scale.meters)<1e-9)
 }
 const anchor={x:view.width*.6,y:view.height*.55}
 const before=imageFrame(view,fitted,2,{x:0,y:0})
 const pan=zoomAt(anchor,2,3,{x:0,y:0},view,fitted)
 const after=imageFrame(view,fitted,3,pan)
 const a=screenToImage(anchor.x,anchor.y,before), b=screenToImage(anchor.x,anchor.y,after)
 assert.ok(Math.abs(a.x-b.x)<1e-10 && Math.abs(a.y-b.y)<1e-10)
}
console.log('PASS: local corners/origin, marker transforms, cover proportions, pan containment, cursor-anchored zoom and metric scale across three viewports.')
