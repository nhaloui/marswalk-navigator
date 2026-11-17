import { ArrowUpRight, CircleHelp, Code2, Compass, Maximize2, X } from 'lucide-react'
import { useMemo,useState } from 'react'
import {useMissionPlanner,validateEndpoint} from '@/planner/useMissionPlanner'
import {geographicToLocal,localToGeographic} from '@/lib/marsCoordinates'
import { LayerPanel } from '@/components/mission/LayerPanel'
import { MissionPanel } from '@/components/mission/MissionPanel'
import { TerrainWorkspace } from '@/terrain/TerrainWorkspace'
import { initialWaypoints, layerDefinitions } from '@/data/mission'
import type { Layers, Waypoint } from '@/data/mission'
import '@/components/mission/panels.css'

function App() {
  const [layers, setLayers] = useState<Layers>({ terrain: true, dust: false, elevation: false })
  const [waypoints, setWaypoints] = useState<Waypoint[]>(initialWaypoints)
  const [selected, setSelected] = useState<Waypoint | null>(null)
  const planner=useMissionPlanner()
  const [dustOpacity,setDustOpacity]=useState(.45)
  const [elevationOpacity,setElevationOpacity]=useState(.45)
  const mode=planner.phase==='rover'?'ROVER':'EVA'
  const [help, setHelp] = useState(false)
  const [notice, setNotice] = useState('')
  const selectPoint = (point: Waypoint | null) => { setSelected(point);if(point?.id==='route-transition')planner.setHighlight('eva') }
  const addPoint = (point: Waypoint) => { setWaypoints(points => points.some(p => p.id === point.id) ? points : [...points, point]); selectPoint(point) }
  const displayedPoints=useMemo(()=>{
    const endpoints=(['start','destination'] as const).flatMap((which,index)=>{
      const input=validateEndpoint(planner.endpoints[which]).point;if(!input)return[]
      const snapped=planner.route?.[which],local=snapped?{x:snapped.x_m,y:snapped.y_m}:geographicToLocal(input)
      const geographic=snapped?localToGeographic(local):input
      return [{id:`route-${which}`,name:initialWaypoints.find(k=>Math.abs(k.geographic.latitude-input.latitude)<1e-7&&Math.abs(k.geographic.longitude-input.longitude)<1e-7)?.name??(index?'DESTINATION':'START'),...local,geographic,type:'custom' as const,
        detail:snapped?`DEM cell used by A*. Offset from the entered position: ${snapped.snap_m.toFixed(2)} m. Requested position: ${input.latitude.toFixed(5)} N, ${input.longitude.toFixed(5)} E.`:'Selected mission position; no route calculated yet.'}]
    })
    const transition=planner.route?.transition
    const parking:Waypoint[]=transition?[{id:'route-transition',name:'PARKING / EVA',x:transition.x_m,y:transition.y_m,geographic:{latitude:transition.latitude,longitude:transition.longitude},type:'custom',detail:'Calculated transition: the rover segment ends and the EVA walk begins. Parking is selected by the experimental model.'}]:[]
    return [...waypoints.filter(p=>!endpoints.some(e=>Math.hypot(e.x-p.x,e.y-p.y)<30)),...endpoints,...parking]
  },[waypoints,planner.endpoints,planner.route])
  const shownSelection=selected?.id.startsWith('route-')?displayedPoints.find(p=>p.id===selected.id)??null:selected
  return <div className="mission-app">
    <header className="topbar">
      <a className="brand odos-brand" href="#main" aria-label="Odos">
        <span className="brand-mark"><Compass size={23} strokeWidth={1.4} /></span>
        <span>Odos</span>
      </a>
      <a
        className="repository-link"
        href="https://github.com/nhaloui/marswalk-navigator"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View Odos on GitHub (opens in a new tab)"
        title="View source on GitHub"
      >
        <Code2 size={19} aria-hidden="true" />
        <span>GitHub</span>
      </a>
      <div className="topbar-right">
        <span className="simulation-tag">FINAL SIMULATION</span>
        <button className="icon-button" onClick={() => setHelp(true)} aria-label="Odos help"><CircleHelp size={19} /></button>
        <button className="icon-button fullscreen-button" onClick={async () => {
          try {
            if (document.fullscreenElement) await document.exitFullscreen()
            else await document.documentElement.requestFullscreen()
          } catch {
            setNotice('Fullscreen is unavailable in this browser window.')
          }
        }} aria-label="Toggle fullscreen"><Maximize2 size={18} /></button>
      </div>
    </header>
    <div className="workspace" id="main"><LayerPanel dustOpacity={dustOpacity} onDustOpacity={setDustOpacity} elevationOpacity={elevationOpacity} onElevationOpacity={setElevationOpacity} layers={layers} onToggle={id => { if (layerDefinitions.find(l => l.id === id)?.available) setLayers(l => ({ ...l, [id]: !l[id] })) }} onSelect={selectPoint} /><TerrainWorkspace planner={planner} transportMode={mode} route={planner.route} dustOpacity={dustOpacity} elevationOpacity={elevationOpacity} layers={layers} waypoints={displayedPoints} selected={shownSelection} onSelect={selectPoint} onAdd={addPoint} /><MissionPanel planner={planner} /></div>

    {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {help && (
      <div className="modal-backdrop" onClick={() => setHelp(false)}>
        <section
          className="guide-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guide-title"
          onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Escape') setHelp(false) }}
        >
          <button className="popover-close" autoFocus aria-label="Close navigation guide" onClick={() => setHelp(false)}><X size={20} /></button>
          <h2 id="guide-title">How to use Odos</h2>
          <ol>
            <li>Drag to move the map and scroll or pinch to zoom. Use the layers panel to explore the terrain.</li>
            <li>Choose a start and destination in the mission panel, or pick them directly on the map.</li>
            <li>Select Calculate route to plan the rover approach and the EVA walk.</li>
            <li>Switch between 2D Map, 3D Terrain and Astronaut POV. In POV, follow the route, adjust playback speed or pause at any time.</li>
          </ol>
          <button className="guide-done" onClick={() => setHelp(false)}>Start exploring <ArrowUpRight size={16} /></button>
        </section>
      </div>
    )}
  </div>
}
export default App




