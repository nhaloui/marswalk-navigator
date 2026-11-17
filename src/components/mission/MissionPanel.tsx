import {RoutePlanner} from '@/planner/RoutePlanner'
import type {MissionPlanner} from '@/planner/useMissionPlanner'

export function MissionPanel({planner}:{planner:MissionPlanner}) {
 return <aside className="side-panel right-panel panels-v1" aria-label="Route planning"><RoutePlanner planner={planner}/></aside>
}
