import type {MissionRoute} from './types'

export function RouteRequirements({route}:{route:MissionRoute}){
 const values=route.requirements
 if(!values)return null
 return <section className="route-requirements" aria-label="Estimated outbound route requirements">
  <h3>ESTIMATED REQUIREMENTS · OUTBOUND</h3>
  <dl><div><dt>EVA oxygen / person</dt><dd>{(values.oxygen_kg_per_person*1000).toLocaleString('en-US',{maximumFractionDigits:1})}<span> g</span></dd></div>
   <div><dt>Rover electricity</dt><dd>{values.rover_electric_wh.toLocaleString('en-US',{maximumFractionDigits:1})}<span> Wh</span></dd></div></dl>
  <p>Rover: driving and standby during the outbound EVA.</p>
 </section>
}
