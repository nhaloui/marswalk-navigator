import {ArrowDownUp,ArrowRight,Check,ChevronDown,CornerDownRight,Crosshair,Flag,LoaderCircle,MapPin,Navigation,RefreshCw,RotateCcw,Route,Trash2,X} from 'lucide-react'
import {knownPoints,waypointLabel} from '@/data/mission'
import type {MissionPlanner} from './useMissionPlanner'
import {validateEndpoint} from './useMissionPlanner'
import {distance,duration,phaseColor} from './types'
import type {Endpoint} from './types'
import './planner.css'
import {RouteRequirements} from './RouteRequirements'
export function RoutePlanner({planner:p}:{planner:MissionPlanner}){
 const ready=p.status==='ready'&&!!p.route,busy=p.status==='loading'
 const form=<div className="planner-fields">{(['start','destination'] as Endpoint[]).map((which,index)=>{
  const point=p.endpoints[which],validation=validateEndpoint(point),name=index?'Destination':'Start'
  const selected=knownPoints.find(k=>Math.abs(k.geographic.latitude-Number(point.latitude.replace(',','.')))<1e-7&&Math.abs(k.geographic.longitude-Number(point.longitude.replace(',','.')))<1e-7)
  return <fieldset key={which} className={p.picking===which?'picking':''}><legend>{index?<Flag size={15}/>:<MapPin size={15}/>} {name}</legend>
   <select aria-label={`${name} reference`} value={selected?.id??''} onChange={e=>{const k=knownPoints.find(k=>k.id===e.target.value);if(k)p.choose(which,k.geographic)}}><option value="">Custom position</option>{knownPoints.map(k=><option key={k.id} value={k.id}>{waypointLabel(k)}</option>)}</select>
   <div className="planner-coordinate-row">{(['latitude','longitude'] as const).map(key=><label key={key} htmlFor={`${which}-${key}`}>{key==='latitude'?'Latitude N':'Longitude E'}<input id={`${which}-${key}`} type="text" inputMode="decimal" spellCheck={false} autoComplete="off" aria-invalid={!!validation.error} aria-describedby={`${which}-error`} value={point[key]} onChange={e=>p.edit(which,{...point,[key]:e.target.value})}/></label>)}</div>
   {validation.error&&<small id={`${which}-error`} className="planner-error">{validation.error}</small>}
   <button type="button" className="planner-map-pick" aria-pressed={p.picking===which} onClick={()=>p.pick(p.picking===which?null:which)}>{p.picking===which?<X size={16}/>:<Crosshair size={16}/>} {p.picking===which?'Cancel selection':'Pick on map'}</button>
  </fieldset>})}
  <div className="planner-secondary"><button onClick={p.swap} title="Swap start and destination"><ArrowDownUp size={16}/> Swap</button><button onClick={p.reset} title="Reset Habitat A to the landform center"><RotateCcw size={16}/> Reset</button></div>
 </div>
 return <section className="route-planner" aria-label="Mission route planner">
  <header><span className="eyebrow"><Route size={15}/> MISSION ROUTE</span><span className="planner-phase-label">ROVER <ArrowRight size={12}/> EVA</span></header>
  {ready?<details className="planner-edit"><summary>Edit endpoints <ChevronDown size={16}/></summary>{form}</details>:form}
  {!busy&&<button className="planner-primary" disabled={!!validateEndpoint(p.endpoints.start).error||!!validateEndpoint(p.endpoints.destination).error} onClick={()=>void p.calculate()}>{ready?<RefreshCw size={17}/>:<Route size={17}/>} {ready?'Recalculate':'Calculate route'}</button>}
  {busy&&<div className="planner-loading" role="status"><LoaderCircle className="planner-spin" size={22}/><strong>{p.message}</strong><small>One continuous itinerary, in two phases.</small><button onClick={p.cancel}><X size={16}/> Cancel calculation</button></div>}
  {p.status==='error'&&<div className="planner-error-box" role="alert"><strong>Route unavailable</strong><p>{p.message}</p><button onClick={()=>void p.calculate()}>Try again</button></div>}
  {ready&&p.route&&<>
   <div className="planner-result"><small>OUTBOUND ROUTE / ESTIMATE</small><div><strong>{distance(p.route.distance_m)}</strong><span>{duration(p.route.duration_s)}</span></div><div className="planner-phase-bar">{p.route.legs.map(leg=><i key={leg.phase} style={{width:`${Math.max(1,leg.distance_m/p.route!.distance_m*100)}%`,background:phaseColor[leg.phase]}}/>)}</div></div>
   <RouteRequirements route={p.route}/>
   {p.route.parking_fallback&&<div className="planner-error-box" role="status"><strong>Rover remains at departure</strong><p>No intermediate parking location was selected. EVA starts at departure; the parking site still requires verification.</p></div>}
   <div className="planner-timeline">{p.route.legs.map((leg,index)=><div key={leg.phase}>
    {index===1&&<button className="planner-transition" onClick={()=>p.setHighlight('eva')}><CornerDownRight size={16}/><span><strong>Parking → EVA</strong><small>{p.route!.transition.latitude.toFixed(5)} N / {p.route!.transition.longitude.toFixed(5)} E</small></span></button>}
    <button className={`planner-leg ${p.highlight===leg.phase?'active':''}`} style={{'--leg-color':phaseColor[leg.phase]} as React.CSSProperties} onMouseEnter={()=>p.setHighlight(leg.phase)} onFocus={()=>p.setHighlight(leg.phase)} aria-pressed={p.highlight===leg.phase} onClick={()=>p.setHighlight(leg.phase)}><span className="planner-leg-dot"/><span><strong>{leg.phase==='rover'?'ROVER':'EVA / ON FOOT'}</strong><small>{distance(leg.distance_m)} · {duration(leg.duration_s)}</small></span><Check size={15}/></button>
   </div>)}</div>
   <button className="planner-primary" onClick={p.follow}><Navigation size={17}/> Follow in Astronaut POV</button>
   <div className="planner-secondary"><button onClick={p.fit}><Crosshair size={16}/> Fit route</button><button onClick={p.clear}><Trash2 size={16}/> Clear</button></div>
  </>}
  {!ready&&!busy&&p.status!=='error'&&<p className="planner-footnote">Choose the endpoints, then calculate the rover approach and EVA walk. Experimental model on real DEM terrain.</p>}
 </section>
}
