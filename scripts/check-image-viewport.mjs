import assert from 'node:assert/strict'
import { fitImage, clampPan, imageFrame, screenToImage } from '../src/lib/imageViewport.ts'

const raster = { width: 9394, height: 20851 }
for (const view of [{width: 800, height: 710}, {width: 360, height: 620}, {width: 1200, height: 760}]) {
  const fitted = fitImage(view, raster)
  assert.ok(Math.abs(fitted.width / fitted.height - raster.width / raster.height) < 1e-12)
  assert.ok(fitted.width <= view.width + 1e-9 && fitted.height <= view.height + 1e-9)
  for (const zoom of [1, 1.8, 4, 8]) {
    const pan = clampPan({x: 90, y: -110}, view, fitted, zoom)
    const frame = imageFrame(view, fitted, zoom, pan)
    for (const point of [{x: 0, y: 0}, {x: 29, y: 72}, {x: 65, y: 36}, {x: 100, y: 100}]) {
      const screenX = frame.left + point.x / 100 * frame.width
      const screenY = frame.top + point.y / 100 * frame.height
      const result = screenToImage(screenX, screenY, frame)
      assert.ok(result)
      assert.ok(Math.abs(result.x - point.x) < 1e-10 && Math.abs(result.y - point.y) < 1e-10)
    }
    assert.equal(screenToImage(frame.left - 10, frame.top, frame), null)
    assert.equal(screenToImage(frame.left, frame.top - 10, frame), null)
  }
  assert.deepEqual(clampPan({x: 900, y: -900}, view, fitted, 1), {x: 0, y: 0})
}
console.log('Image proportions, pan bounds, letterbox rejection and waypoint inverse transforms pass across three viewports and four zoom levels.')
