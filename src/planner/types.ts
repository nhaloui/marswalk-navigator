import type {LocalPoint,LocalRoute} from '@/terrain/coordinates'
import type {GeographicPoint} from '@/lib/marsCoordinates'
export type Phase='rover'|'eva'
export interface RoutePoint extends LocalPoint {row:number;col:number;distance_m:number;time_s:number;elevation_m:number}
export interface RouteLeg {phase:Phase;points:RoutePoint[];distance_m:number;duration_s:number;energy_j:number}
export interface MissionRoute extends LocalRoute {
 points:RoutePoint[];legs:RouteLeg[];distance_m:number;duration_s:number;gain_m:number;loss_m:number
 start:{requested:GeographicPoint;row:number;col:number;x_m:number;y_m:number;snap_m:number}
 destination:MissionRoute['start']
 transition:{x_m:number;y_m:number;row:number;col:number;latitude:number;longitude:number;distance_m:number}
 mission:{mission_s:number;eva_s:number;battery_wh:number;o2_kg:number;h2o_kg:number;dust_mean:number;dust_max:number;dust_effect_wh:number}
 requirements?:{oxygen_kg_per_person:number;rover_drive_wh:number;rover_wait_wh:number;rover_electric_wh:number}
 warnings:string[];parking_fallback:boolean;calculation_s:number;assumptions:{pixel_m:number;exclusion_m:number;sampling_min:number;thermal_proxy:string}
}
export interface DraftPoint {latitude:string;longitude:string}
export type Endpoint='start'|'destination'
export const phaseColor={rover:'#57d9ee',eva:'#efb675'}
export const distance=(meters:number)=>meters>=1000?`${(meters/1000).toFixed(2)} km`:`${Math.round(meters)} m`
export const duration=(seconds:number)=>{const minutes=Math.round(seconds/60);return seconds<=0?'0 min':minutes===0?'< 1 min':minutes>=60?`${Math.floor(minutes/60)} h ${minutes%60} min`:`${minutes} min`}
