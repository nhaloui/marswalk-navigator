import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { clampPan, imageFrame, screenToImage } from '@/lib/imageViewport'
import { coverImage, zoomAt } from '@/lib/localMap'
import type { Point } from '@/lib/localMap'

export function useMapNavigation(image: {width: number; height: number}, adding: boolean, focusPoint?: Point) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({width: 1, height: 1})
  const [navigation, setNavigation] = useState({zoom: 1, pan: {x: 0, y: 0}})
  const [cursor, setCursor] = useState<Point | null>(null)
  const drag = useRef<{id: number; x: number; y: number; pan: Point; moved: boolean} | null>(null)
  const suppressClick = useRef(false)
  const animation = useRef(0)
  const fitted = coverImage(viewport, image)
  const pan = clampPan(navigation.pan, viewport, fitted, navigation.zoom)
  const frame = imageFrame(viewport, fitted, navigation.zoom, pan)
  const live = useRef({viewport, fitted, zoom: navigation.zoom, pan})
  useLayoutEffect(() => {
    live.current = {viewport, fitted, zoom: navigation.zoom, pan}
  }, [viewport, fitted, navigation.zoom, pan])

  const commit = useCallback((zoom: number, nextPan: Point) => {
    const current = live.current
    const bounded = clampPan(nextPan, current.viewport, current.fitted, zoom)
    live.current = {...current, zoom, pan: bounded}
    setNavigation({zoom, pan: bounded})
  }, [])
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(animation.current)
      setViewport({width: entry.contentRect.width, height: entry.contentRect.height})
    })
    observer.observe(element)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      cancelAnimationFrame(animation.current)
      drag.current = null
      const current = live.current
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? current.viewport.height : 1
      if (event.shiftKey || (Math.abs(event.deltaX) > 0 && !event.ctrlKey)) {
        commit(current.zoom, {x: current.pan.x-(event.deltaX || event.deltaY)*factor, y: current.pan.y-(event.deltaX ? event.deltaY*factor : 0)})
        return
      }
      const bounds = element.getBoundingClientRect()
      const anchor = {x: event.clientX-bounds.left, y: event.clientY-bounds.top}
      const zoom = Math.max(.5, Math.min(8, current.zoom*Math.exp(-event.deltaY*factor*(event.ctrlKey ? .008 : .0018))))
      commit(zoom, zoomAt(anchor, current.zoom, zoom, current.pan, current.viewport, current.fitted))
    }
    element.addEventListener('wheel', wheel, {passive: false})
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); cancelAnimationFrame(animation.current) }
  }, [commit])

  useEffect(() => {
    if (!focusPoint) return
    cancelAnimationFrame(animation.current)
    const current = live.current
    const zoom = Math.max(2, current.zoom)
    commit(zoom, {x:(.5-focusPoint.x/100)*current.fitted.width*zoom, y:(.5-focusPoint.y/100)*current.fitted.height*zoom})
  }, [focusPoint, commit])

  const changeZoom = (next: number) => {
    cancelAnimationFrame(animation.current)
    const initial = live.current
    const target = Math.max(.5, Math.min(8, next))
    const anchor = {x: initial.viewport.width/2, y: initial.viewport.height/2}
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    const start = performance.now()
    const tick = (now: number) => {
      const t = duration ? Math.min(1, (now-start)/duration) : 1
      const zoom = initial.zoom+(target-initial.zoom)*(1-(1-t)**3)
      commit(zoom, zoomAt(anchor, initial.zoom, zoom, initial.pan, initial.viewport, initial.fitted))
      if (t < 1) animation.current = requestAnimationFrame(tick)
    }
    animation.current = requestAnimationFrame(tick)
  }
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    cancelAnimationFrame(animation.current)
    suppressClick.current = false
    if (adding) return
    drag.current = {id: event.pointerId, x: event.clientX, y: event.clientY, pan: live.current.pan, moved: false}
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    setCursor({x: event.clientX-bounds.left, y: event.clientY-bounds.top})
    const start = drag.current
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX-start.x, dy = event.clientY-start.y
    if (Math.hypot(dx,dy)>4) start.moved = true
    if (start.moved) commit(live.current.zoom, {x: start.pan.x+dx,y:start.pan.y+dy})
  }
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return
    suppressClick.current = drag.current.moved
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return {viewportRef, viewport, fitted, frame, pan, zoom: navigation.zoom, cursor,
    fitPoints:(points:Point[])=>{
      if(!points.length)return
      cancelAnimationFrame(animation.current)
      const current=live.current,minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y))
      const top=150,bottom=130,side=110
      const zoom=Math.max(.5,Math.min(8,(current.viewport.width-side*2)/(Math.max(8,maxX-minX)/100*current.fitted.width),(current.viewport.height-top-bottom)/(Math.max(8,maxY-minY)/100*current.fitted.height)))
      commit(zoom,{x:(.5-(minX+maxX)/200)*current.fitted.width*zoom,y:(top-bottom)/2+(.5-(minY+maxY)/200)*current.fitted.height*zoom})
    },
    changeZoom, pointerDown, pointerMove, pointerUp,
    pointerCancel: () => {drag.current = null; suppressClick.current = true},
    pointerLeave: () => setCursor(null),
    lostCapture: () => {drag.current = null},
    reset: () => {cancelAnimationFrame(animation.current); commit(1,{x:0,y:0})},
    move: (x: number,y: number) => {cancelAnimationFrame(animation.current); commit(live.current.zoom,{x:live.current.pan.x+x,y:live.current.pan.y+y})},
    placement: (x: number, y: number) => {
      if (suppressClick.current) {suppressClick.current = false; return null}
      const current = live.current
      return screenToImage(x,y,imageFrame(current.viewport,current.fitted,current.zoom,current.pan))
    },
  }
}




