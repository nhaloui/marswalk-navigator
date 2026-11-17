export interface ImageViewport { width: number; height: number }
export interface ImagePan { x: number; y: number }

/** Fit the full raster without cropping or stretching, independent of viewport shape. */
export function fitImage(view: ImageViewport, image: ImageViewport) {
  const ratio = Math.min(view.width / image.width, view.height / image.height)
  return { width: image.width * ratio, height: image.height * ratio }
}

export function clampPan(pan: ImagePan, view: ImageViewport, fitted: ImageViewport, zoom: number): ImagePan {
  const maxX = Math.max(0, (fitted.width * zoom - view.width) / 2)
  const maxY = Math.max(0, (fitted.height * zoom - view.height) / 2)
  return { x: maxX === 0 ? 0 : Math.max(-maxX, Math.min(maxX, pan.x)), y: maxY === 0 ? 0 : Math.max(-maxY, Math.min(maxY, pan.y)) }
}

export function imageFrame(view: ImageViewport, fitted: ImageViewport, zoom: number, pan: ImagePan) {
  const width = fitted.width * zoom, height = fitted.height * zoom
  return { width, height, left: (view.width - width) / 2 + pan.x, top: (view.height - height) / 2 + pan.y }
}

/** Inverse of the shared image/overlay transform; null means a letterbox margin. */
export function screenToImage(x: number, y: number, frame: ReturnType<typeof imageFrame>) {
  const point = { x: (x - frame.left) / frame.width * 100, y: (y - frame.top) / frame.height * 100 }
  // Accept numerical round-off at the image border, while rejecting letterbox clicks.
  const epsilon = 1e-9
  if (point.x < -epsilon || point.x > 100 + epsilon || point.y < -epsilon || point.y > 100 + epsilon) return null
  return { x: Math.max(0, Math.min(100, point.x)), y: Math.max(0, Math.min(100, point.y)) }
}
