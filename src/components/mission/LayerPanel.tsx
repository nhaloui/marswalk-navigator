import {DustLegend} from './DustLegend'
import {waypointLabel} from '@/data/mission'
import {terrainMetadata} from '@/terrain/data'
import { Check, ChevronDown, Layers3, Target } from 'lucide-react'
import type { Layers, LayerId, Waypoint } from '@/data/mission'
import { layerDefinitions, knownPoints } from '@/data/mission'
import { useState } from 'react'
interface Props { dustOpacity:number;onDustOpacity:(v:number)=>void;elevationOpacity:number;onElevationOpacity:(v:number)=>void;layers:Layers; onToggle:(id:LayerId)=>void; onSelect:(point:Waypoint)=>void }
export function LayerPanel({ layers,onToggle,onSelect,dustOpacity,onDustOpacity,elevationOpacity,onElevationOpacity }:Props) {
 const [selectedLayer,setSelectedLayer]=useState<LayerId|null>(null)
 const [selectedPoint,setSelectedPoint]=useState<string|null>(null)
 return <aside className="side-panel left-panel panels-v1" aria-label="Layers and geographic points">
  <section className="v1-exploration-section"><h2 className="v1-section-label"><span className="v1-label-icon"><Layers3 size={17}/> LAYERS</span><span>{Object.values(layers).filter(Boolean).length} ACTIVE</span></h2>
   <div className="v1-layers">{layerDefinitions.map(layer=><div key={layer.id}><div className="v1-layer-row"><button className="v1-layer-select" aria-expanded={selectedLayer===layer.id} aria-controls={`layer-detail-${layer.id}`} onClick={()=>setSelectedLayer(selectedLayer===layer.id?null:layer.id)}><span className="v1-layer-swatch" style={{backgroundColor:layer.color}}/><strong>{layer.name}{!layer.available&&<small className="unavailable-layer">Unavailable</small>}</strong><ChevronDown size={15}/></button><button className="v1-layer-toggle" role="switch" disabled={!layer.available} aria-checked={layers[layer.id]} aria-label={layer.name} onClick={()=>onToggle(layer.id)}><span className={`toggle ${layers[layer.id]?'on':''}`}><span/></span></button></div>{selectedLayer===layer.id&&<div className="v1-detail" id={`layer-detail-${layer.id}`}><p>{layer.source}</p></div>}{layer.id==='dust'&&layers.dust&&<div className="layer-settings"><label>Opacity <input aria-label="TES Dust opacity" type="range" min="0" max="1" step=".05" value={dustOpacity} onChange={e=>onDustOpacity(Number(e.target.value))}/>{Math.round(dustOpacity*100)}%</label><DustLegend/></div>}{layer.id==='elevation'&&layers.elevation&&<div className="layer-settings"><label>Opacity <input aria-label="Elevation opacity" type="range" min="0" max="1" step=".05" value={elevationOpacity} onChange={e=>onElevationOpacity(Number(e.target.value))}/>{Math.round(elevationOpacity*100)}%</label><div className="elevation-legend"/><div className="legend-limits"><span>{terrainMetadata.minimum.toFixed(1)} m</span><span>{terrainMetadata.maximum.toFixed(1)} m</span></div><p>Source elevations. DEM geometry remains active in 3D at 1:1 scale.</p></div>}</div>)}</div>
  </section>
  <section className="v1-exploration-section"><h2 className="v1-section-label"><span className="v1-label-icon"><Target size={17}/> REFERENCE POINTS</span><span>02</span></h2>
   {knownPoints.map(point=><div className="v1-objective" key={point.id}><button className="v1-objective-select" aria-expanded={selectedPoint===point.id} aria-controls={`point-detail-${point.id}`} onClick={()=>{setSelectedPoint(selectedPoint===point.id?null:point.id);onSelect(point)}}><Check size={15}/><strong>{waypointLabel(point)}</strong><ChevronDown size={15}/></button>{selectedPoint===point.id&&<div className="v1-detail" id={`point-detail-${point.id}`}><p>{point.geographic.latitude.toFixed(5)} N / {point.geographic.longitude.toFixed(5)} E</p><p>X {point.x.toFixed(3)} m / Y {point.y.toFixed(3)} m</p><p>{point.detail}</p></div>}</div>)}
  </section><div className="v1-panel-note">SUPPLIED COORDINATES / MARTIAN FRAME</div>
 </aside>
}
