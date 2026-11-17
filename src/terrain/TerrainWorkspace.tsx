import {lazy,Suspense,useEffect,useState} from 'react'
import type {Layers,Waypoint} from '@/data/mission'
import {knownPoints} from '@/data/mission'
import {TerrainMap} from '@/components/mission/TerrainMap'
import {loadTerrain} from './data'
import {TerrainSession} from './coordinates'
import type {TerrainGrid,LocalRoute} from './coordinates'
import type {MissionPlanner} from '@/planner/useMissionPlanner'
import './terrain.css'
const Terrain3D=lazy(()=>import('./MarsTerrain3D').then(m=>({default:m.MarsTerrain3D})))
interface Props {planner:MissionPlanner;transportMode?:string;route?:LocalRoute;layers:Layers;dustOpacity:number;elevationOpacity:number;waypoints:Waypoint[];selected:Waypoint|null;onSelect:(p:Waypoint|null)=>void;onAdd:(p:Waypoint)=>void}
export function TerrainWorkspace(props:Props){
 const {view:mode,setView:setMode,activated}=props.planner
 const [grid,setGrid]=useState<TerrainGrid>(),[error,setError]=useState('')
 const [session]=useState(()=>new TerrainSession(knownPoints[0].x,knownPoints[0].y))
 useEffect(()=>{let active=true;loadTerrain().then(g=>{if(active)setGrid(g)}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[])
 useEffect(()=>{if(props.route){session.follower.setRoute(props.route);const origin=props.route.points[0];session.setOrigin(origin.x_m,origin.y_m)}else{session.clearRoute()}},[props.route,session])
 return <div className="workspace-map"><div className="view-selector" role="group" aria-label="View mode">{(['2d','3d','pov'] as const).map((m,i)=><button key={m} aria-pressed={mode===m} onClick={()=>setMode(m)}>{['2D MAP','3D TERRAIN','ASTRONAUT POV'][i]}</button>)}</div><div className="map-stage"><div className="map-2d-view" style={{visibility:mode==='2d'?'visible':'hidden',pointerEvents:mode==='2d'?'auto':'none'}} aria-hidden={mode!=='2d'} inert={mode!=='2d'}><TerrainMap {...props} grid={grid}/></div>{activated&&<div className="map-3d-view" style={{visibility:mode!=='2d'?'visible':'hidden',pointerEvents:mode!=='2d'?'auto':'none'}} aria-hidden={mode==='2d'} inert={mode==='2d'}>{error?<div className="terrain-loading">{error}<button onClick={()=>setMode('2d')}>Back to 2D</button></div>:grid?<Suspense fallback={<div className="terrain-loading">Loading 3D engine…</div>}><Terrain3D followRequest={props.planner.followRequest} highlight={props.planner.highlight} onPhase={props.planner.setPhase} transportMode={props.transportMode} grid={grid} mode={mode} layers={props.layers} dustOpacity={props.dustOpacity} elevationOpacity={props.elevationOpacity} session={session} points={props.waypoints} selected={props.selected} onSelect={props.onSelect} onExit={()=>setMode('2d')}/></Suspense>:<div className="terrain-loading">Loading elevation data…</div>}</div>}</div></div>
}
