import type { ImagePan, ImageViewport } from './imageViewport.ts'
import { clampPan, imageFrame, screenToImage } from './imageViewport.ts'

export interface Point { x: number; y: number }
export function coverImage(view: ImageViewport, image: ImageViewport) {
  const ratio = Math.max(view.width / image.width, view.height / image.height)
  return { width: image.width * ratio, height: image.height * ratio }
}
export function percentToLocal(point: Point, bounds: readonly number[]) {
  return { x: bounds[0] + point.x / 100 * (bounds[2] - bounds[0]), y: bounds[3] - point.y / 100 * (bounds[3] - bounds[1]) }
}
export function localToPercent(point: Point, bounds: readonly number[]) {
  return { x: (point.x - bounds[0]) / (bounds[2] - bounds[0]) * 100, y: (bounds[3] - point.y) / (bounds[3] - bounds[1]) * 100 }
}
export function screenToLocal(point: Point, frame: ReturnType<typeof imageFrame>, bounds: readonly number[]) {
  const percent = screenToImage(point.x, point.y, frame)
  return percent ? percentToLocal(percent, bounds) : null
}
export function zoomAt(anchor: Point, zoom: number, nextZoom: number, pan: ImagePan, view: ImageViewport, fitted: ImageViewport) {
  const ratio = nextZoom / zoom
  return clampPan({ x: (anchor.x - view.width / 2) * (1-ratio) + pan.x * ratio, y: (anchor.y - view.height / 2) * (1-ratio) + pan.y * ratio }, view, fitted, nextZoom)
}
export function scaleBar(frameWidth: number, bounds: readonly number[], maxPixels = 120) {
  const metersPerPixel = (bounds[2]-bounds[0])/frameWidth
  const maximum = maxPixels*metersPerPixel
  const power = 10 ** Math.floor(Math.log10(maximum))
  const meters = [5,2,1].map(n => n*power).find(n => n <= maximum) ?? power/2
  return { meters, pixels: meters/metersPerPixel, label: meters >= 1000 ? `${meters/1000} km` : `${meters} m` }
}

