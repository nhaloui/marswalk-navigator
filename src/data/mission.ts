import { geographicToLocal, directDistance, CRATER_CENTER } from '../lib/marsCoordinates.ts'
import type { GeographicPoint } from '../lib/marsCoordinates.ts'

export interface Waypoint {
  id: string
  name: string
  /** Authoritative local AEQD coordinates in meters, X east / Y north. */
  x: number
  y: number
  type: 'base' | 'reference' | 'custom'
  geographic: GeographicPoint
  detail: string
}
export const RELIEF_LABEL = 'Deuteronius Landform Center'
/** Keep legacy point identifiers compatible while correcting every display surface. */
export function waypointLabel(point:Pick<Waypoint,'id'|'name'>){
 const legacy=point.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 return point.id==='crater'||legacy==='crater center'||legacy==='centre du cratere'||legacy==='centre du relief deuteronius'?RELIEF_LABEL:point.name
}
const habitatGeographic = {latitude:40.79036,longitude:22.11728}
export const knownPoints: Waypoint[] = [
  {id:'hab', name:'HABITAT A', ...geographicToLocal(habitatGeographic), type:'base', geographic:habitatGeographic, detail:'Base position supplied by the team. A fixed reference, not a live astronaut position.'},
  {id:'crater', name:RELIEF_LABEL, ...geographicToLocal(CRATER_CENTER), type:'reference', geographic:{...CRATER_CENTER}, detail:'Supplied geographic center of the Deuteronius landform and origin of the local Martian frame (0, 0).'},
]
export const initialWaypoints = knownPoints
export const habitatCraterDistanceM = directDistance(habitatGeographic, CRATER_CENTER)
export const layerDefinitions = [
 {id:'terrain',name:'NASA CTX imagery',source:'Real orbital optical imagery.',color:'#cba786',available:true},
 {id:'dust',name:'TES Dust',source:'Source RGB imagery; normalized CSV scores used without rescaling. Uncalibrated; source coordinate convention requires confirmation.',color:'#2adeff',available:true},
 {id:'elevation',name:'Elevation',source:'Real DEM elevations. This control changes the display colors, never the 3D geometry.',color:'#bba677',available:true},
] as const
export type LayerId = typeof layerDefinitions[number]['id']
export type Layers = Record<LayerId,boolean>
