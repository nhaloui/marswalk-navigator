import {waypointLabel} from '@/data/mission'
import {terrainMetadata} from '@/terrain/data'
import {sampleTerrain} from '@/terrain/coordinates'
import type {TerrainGrid,LocalRoute} from '@/terrain/coordinates'
import { Crosshair, Home, Layers3, LocateFixed, MapPin, Minus, Navigation2, Plus, X } from 'lucide-react'
import { useEffect,useMemo,useRef,useState,type CSSProperties } from 'react'
import type {MissionPlanner} from '@/planner/useMissionPlanner'
import {phaseColor} from '@/planner/types'
import type { Layers, Waypoint } from '@/data/mission'
import { imagery } from '@/data/imagery'
import { useMapNavigation } from './useMapNavigation'
import { percentToLocal, localToPercent, screenToLocal, scaleBar } from '@/lib/localMap'
import { localToGeographic } from '@/lib/marsCoordinates'
import { Button } from '@/components/ui/button'
import './imagery-map.css'

interface Props { planner?:MissionPlanner;route?:LocalRoute;grid?:TerrainGrid;dustOpacity:number;elevationOpacity:number;layers: Layers; waypoints: Waypoint[]; selected: Waypoint | null; onSelect: (p: Waypoint | null) => void; onAdd: (p: Waypoint) => void }

export function TerrainMap({ layers, waypoints, selected, onSelect, onAdd,grid,dustOpacity,elevationOpacity,route,planner }: Props) {
  const [adding, setAdding] = useState(false)
  const [imageStatus, setImageStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [hillshadeEnabled, setHillshadeEnabled] = useState(false)
  const [hillshadeOpacity, setHillshadeOpacity] = useState(.25)
  const [hillshadeError, setHillshadeError] = useState(false)
  const focusPoint = useMemo(() => selected ? localToPercent(selected, imagery.bounds) : undefined, [selected])
  const nav = useMapNavigation(imagery.source, adding||!!planner?.picking, focusPoint)
  const { viewportRef, viewport, fitted, frame, pan, zoom } = nav
  const cursorLocal = nav.cursor ? screenToLocal(nav.cursor, frame, imagery.bounds) : null
  const scale = scaleBar(frame.width, imagery.bounds)
  const fittedRoute=useRef('')
  const requestedFit=useRef(0)
  const fittedSize=useRef('')
  useEffect(()=>{
    if(!route){fittedRoute.current='';return}
    if(viewport.width<10||viewport.height<10)return
    const size=`${viewport.width}x${viewport.height}`
    if(fittedRoute.current===route.id&&requestedFit.current===(planner?.fitRequest??0)&&fittedSize.current===size)return
    fittedRoute.current=route.id;requestedFit.current=planner?.fitRequest??0
    fittedSize.current=size
    nav.fitPoints(route.points.map(p=>localToPercent({x:p.x_m,y:p.y_m},imagery.bounds)))
  },[route,planner?.fitRequest,viewport.width,viewport.height,nav])
  const selectedLocal = selected
  const altitude=selected&&grid?sampleTerrain(grid,selected.x,selected.y):null

  const addPoint = (point: {x: number; y: number}) => {
    const local = percentToLocal(point, imagery.bounds)
    onAdd({ id: `custom-${Date.now()}`, name: `Manual marker ${waypoints.filter(p => p.type === 'custom').length + 1}`, ...local, geographic: localToGeographic(local), type: 'custom', detail: 'Manually placed planning marker. Coordinates are derived from the map, not a NASA observation or a measured ground position.' })
    setAdding(false)
  }

  return <section className={`map-area ctx-map ${adding||planner?.picking ? 'adding-waypoint' : ''}`} aria-label="Odos navigation map">
    <div className="terrain-viewport" ref={viewportRef} tabIndex={0} role="region" aria-label="Mars local map. Scroll or trackpad pinch to zoom. Drag, Shift-scroll or arrow keys to pan. Local coordinates are in meters."
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        const directions: Record<string, [number, number]> = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] }
        const direction = directions[event.key]
        if (direction) { event.preventDefault(); nav.move(...direction) }
        if (event.key === 'Escape') setAdding(false)
      }}
      onPointerDown={nav.pointerDown} onPointerMove={nav.pointerMove} onPointerUp={nav.pointerUp}
      onPointerLeave={nav.pointerLeave} onPointerCancel={nav.pointerCancel} onLostPointerCapture={nav.lostCapture}
      onClick={event => {
        if ((!adding&&!planner?.picking) || imageStatus !== 'ready') return
        const bounds = event.currentTarget.getBoundingClientRect()
        const point = nav.placement(event.clientX - bounds.left, event.clientY - bounds.top)
        if(point){if(planner?.picking){planner.choose(planner.picking,localToGeographic(percentToLocal(point,imagery.bounds)))}else addPoint(point)}
      }}>
      <div className="terrain-world" style={{ width: fitted.width, height: fitted.height, left: (viewport.width - fitted.width) / 2 + pan.x, top: (viewport.height - fitted.height) / 2 + pan.y, transform: `scale(${zoom})`, '--map-marker-scale': 1 / zoom } as CSSProperties}>
        <img className={`ctx-image ${layers.terrain ? '' : 'ctx-image-hidden'}`} src={imagery.url} alt={`${imagery.region}: real NASA CTX optical image; no elevation data`} draggable={false} onLoad={() => setImageStatus('ready')} onError={() => setImageStatus('error')} />
        {hillshadeEnabled && !hillshadeError && <img className="dem-hillshade" src={imagery.hillshadeUrl} alt="" aria-hidden="true" draggable={false} style={{ opacity: hillshadeOpacity }} onError={() => { setHillshadeError(true); setHillshadeEnabled(false) }} />}
        {layers.elevation&&<img className="science-overlay" src={`${import.meta.env.BASE_URL}${terrainMetadata.elevationTexture}`} style={{opacity:elevationOpacity}} alt="DEM elevation gradient" draggable={false}/>}
        {layers.dust&&<img className="science-overlay" src={`${import.meta.env.BASE_URL}${terrainMetadata.dust}`} style={{opacity:dustOpacity}} alt="TES Dust scores; experimental classes" draggable={false}/>}
        <svg className="terrain-svg" viewBox="0 0 1000 800" preserveAspectRatio="none" role="group" aria-label="Coordinate grid and mission route">
          <defs>
            <pattern id="map-grid" width="100" height="80" patternUnits="userSpaceOnUse"><path d="M100 0H0V80" fill="none" stroke="#dacbb4" strokeOpacity=".16" strokeWidth=".7" /></pattern>
          </defs>
          <rect width="1000" height="800" fill="url(#map-grid)" />
          {planner?.route?.legs.map(leg=>{const coords=leg.points.map(p=>{const uv=localToPercent({x:p.x_m,y:p.y_m},imagery.bounds);return `${uv.x*10},${uv.y*8}`}).join(' ');return <g key={leg.phase}><polyline points={coords} fill="none" stroke="#07100e" strokeWidth={planner.highlight===leg.phase?10:7} vectorEffect="non-scaling-stroke"/><polyline className="planner-route-leg" role="button" tabIndex={0} aria-label={leg.phase==='rover'?'Rover segment':'EVA segment'} aria-pressed={planner.highlight===leg.phase} onClick={e=>{if(!planner.picking){e.stopPropagation();planner.setHighlight(planner.highlight===leg.phase?null:leg.phase)}}} onFocus={()=>planner.setHighlight(leg.phase)} onBlur={()=>planner.setHighlight(null)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();planner.setHighlight(planner.highlight===leg.phase?null:leg.phase)}}} points={coords} fill="none" stroke={phaseColor[leg.phase]} strokeWidth={planner.highlight===leg.phase?6:4} strokeDasharray={leg.phase==='eva'?'9 5':undefined} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/></g>})}
          {route&&!planner?.route&&<polyline points={route.points.map(p=>{const uv=localToPercent({x:p.x_m,y:p.y_m},imagery.bounds);return `${uv.x*10},${uv.y*8}`}).join(' ')} fill="none" stroke="#e8b785" strokeWidth="3" vectorEffect="non-scaling-stroke"/>}
        </svg>
        {waypoints.map(p => {
          const position = localToPercent(p, imagery.bounds)
          return <button key={p.id} className={`map-point ${p.type} ${(p.type === 'base'||p.id==='route-start') ? 'label-above-left' : (p.type === 'reference'||p.id==='route-destination') ? 'label-below-left' : 'label-above-right'} ${selected?.id === p.id ? 'selected' : ''} ${p.id.startsWith('route-')?'route-map-point '+(p.id==='route-start'?'rover':'eva'):''}`} style={{ left: `${position.x}%`, top: `${position.y}%` }} onClick={e => { e.stopPropagation(); if(planner?.picking)planner.choose(planner.picking,p.geographic);else{onSelect(p);if(p.id==='route-transition')planner?.setHighlight('eva')} }} aria-label={`Inspect ${waypointLabel(p)}`}><span className="point-symbol">{(p.type === 'base'||p.id==='route-start') ? <Home size={23} /> : (p.type === 'reference'||p.id==='route-destination') ? <Crosshair size={23}/> : <MapPin size={22}/>}</span><span className="point-label">{waypointLabel(p)}<small>{p.id==='route-transition'?'ROVER → EVA':p.id.startsWith('route-')?(route?'ROUTE CELL':'MISSION POSITION'):p.type==='custom'?'MANUAL MARKER':'SUPPLIED COORDINATES'}</small></span></button>
        })}
      </div>
    </div>
    {planner?.picking&&<div className="planner-selection-banner" role="status"><Crosshair size={18}/> Choose {planner.picking==='start'?'the start':'the destination'} on the map<button aria-label="Cancel selection" onClick={()=>planner.pick(null)}><X size={20}/></button></div>}
    <div className="map-compass"><Navigation2 size={23} /><span>N</span><small>LOCAL NORTH</small></div>
    <div className="map-controls" aria-label="Map controls"><button aria-label="Zoom in" disabled={zoom >= 8} onClick={() => nav.changeZoom(zoom * 1.4)}><Plus size={20} /></button><button aria-label="Zoom out" disabled={zoom <= .5} onClick={() => nav.changeZoom(zoom / 1.4)}><Minus size={20} /></button><span /><button aria-label="Reset map view" onClick={() => { nav.reset(); onSelect(null) }}><LocateFixed size={19} /></button></div>
    {selected && <div className="point-popover"><button className="popover-close" aria-label="Close coordinates" onClick={() => onSelect(null)}><X size={21}/></button><span className="eyebrow">{selected.id.startsWith('route-')?(route?'ROUTE POSITION / DEM CELL':'MISSION POSITION'):selected.type==='custom'?'MANUAL MARKER':'SUPPLIED GEOGRAPHIC POSITION'}</span><h3>{waypointLabel(selected)}</h3><dl className="geographic-details"><div><dt>Latitude</dt><dd>{selected.geographic.latitude.toFixed(5)} &deg; N</dd></div><div><dt>Longitude</dt><dd>{selected.geographic.longitude.toFixed(5)} &deg; E</dd></div><div><dt>Local X</dt><dd>{selectedLocal?.x.toFixed(3)} m</dd></div><div><dt>Local Y</dt><dd>{selectedLocal?.y.toFixed(3)} m</dd></div></dl><p>DEM elevation: {altitude===null?'unavailable':`${altitude.toFixed(2)} m`}</p><p>{selected.detail}</p></div>}
    <div className="map-bottom"><div className="map-scale"><span style={{ width: scale.pixels }} /><strong>{scale.label}</strong><small>Local horizontal distance</small></div><Button className={`add-waypoint ${adding ? 'active' : ''}`} disabled={imageStatus !== 'ready'} onClick={() => setAdding(!adding)} aria-pressed={adding}>{adding ? <X size={17} /> : <Plus size={18} />}{adding ? 'Cancel' : 'Add marker'}</Button></div>
    {adding && <div className="placement-tip"><Crosshair size={16} /> Place a manual marker <button onClick={() => addPoint({ x: 50, y: 50 })}>Place at center</button></div>}
    {imageStatus!=='ready'&&<div className="ctx-provenance" role={imageStatus==='error'?'alert':'status'}>{imageStatus==='error'?'CTX image unavailable.':'Loading map…'}</div>}
    <div className="map-grid-coords"><span>MARS AEQD / 1 km GRID</span><span>{route?'EXPERIMENTAL ROUTE / ROVER → EVA':'NO ROUTE CALCULATED'}</span></div>
    <div className="local-position"><Crosshair size={13} /><span>{cursorLocal ? 'CURSOR' : 'VIEW CENTER'}</span><output>{(() => { const p = cursorLocal ?? screenToLocal({x:viewport.width/2,y:viewport.height/2},frame,imagery.bounds); return p ? `X ${p.x.toFixed(0)} / Y ${p.y.toFixed(0)} m` : '-' })()}</output></div>
    <div className="terrain-style-control"><button aria-pressed={hillshadeEnabled} disabled={hillshadeError} onClick={() => setHillshadeEnabled(v => !v)}><Layers3 size={15} /> DEM hillshade <span>{hillshadeError ? 'Unavailable' : hillshadeEnabled ? 'ON' : 'OFF'}</span></button>{hillshadeEnabled && <label>Opacity <input aria-label="Hillshade opacity" type="range" min="0" max="0.6" step="0.05" value={hillshadeOpacity} onChange={event => setHillshadeOpacity(Number(event.target.value))} /><output>{Math.round(hillshadeOpacity*100)}%</output></label>}</div>

  </section>
}

