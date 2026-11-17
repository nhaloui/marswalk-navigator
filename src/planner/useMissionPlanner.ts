import {useEffect,useRef,useState} from 'react'
import {apiUrl,waitForPlanner,abortableDelay} from './api'
import {geographicToLocal} from '@/lib/marsCoordinates'
import type {GeographicPoint} from '@/lib/marsCoordinates'
import {knownPoints} from '@/data/mission'
import type {DraftPoint,Endpoint,MissionRoute,Phase} from './types'
const draft=(point:GeographicPoint):DraftPoint=>({latitude:point.latitude.toFixed(5),longitude:point.longitude.toFixed(5)})
const defaults=()=>({start:draft(knownPoints[0].geographic),destination:draft(knownPoints[1].geographic)})
export function validateEndpoint(p:DraftPoint):{point?:GeographicPoint;error?:string}{
 if(!p.latitude.trim()||!p.longitude.trim())return{error:'Enter latitude and longitude.'}
 const point={latitude:Number(p.latitude.replace(',','.')),longitude:Number(p.longitude.replace(',','.'))}
 if(!Number.isFinite(point.latitude)||point.latitude< -90||point.latitude>90)return{error:'Invalid latitude (−90 to 90°).'}
 if(!Number.isFinite(point.longitude)||point.longitude<0||point.longitude>360)return{error:'Invalid east longitude (0 to 360°).'}
 const {x,y}=geographicToLocal(point)
 if(x< -5000||x>=5000||y<= -5000||y>5000)return{error:'Position outside the 10 × 10 km grid.'}
 return{point}
}
export function useMissionPlanner(){
 const [view,setViewState]=useState<'2d'|'3d'|'pov'>('2d'),[activated,setActivated]=useState(false)
 const setView=(value:'2d'|'3d'|'pov')=>{setViewState(value);if(value!=='2d')setActivated(true)}
 const [endpoints,setEndpoints]=useState(defaults),[route,setRoute]=useState<MissionRoute>(),[status,setStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle')
 const [message,setMessage]=useState(''),[picking,setPicking]=useState<Endpoint|null>(null),[highlight,setHighlight]=useState<Phase|null>(null)
 const [fitRequest,setFitRequest]=useState(0),[followRequest,setFollowRequest]=useState(0),[phase,setPhase]=useState<Phase>('rover')
 const request=useRef<{controller:AbortController;job?:string}|null>(null)
 const cancel=()=>{const old=request.current;request.current=null;if(old){old.controller.abort();if(old.job)void fetch(apiUrl(`/missions/${old.job}`),{method:'DELETE'}).catch(()=>{})}setStatus(route?'ready':'idle');setMessage('Calculation cancelled.')}
 useEffect(()=>()=>{const old=request.current;old?.controller.abort();if(old?.job)void fetch(apiUrl(`/missions/${old.job}`),{method:'DELETE'}).catch(()=>{})},[])
 const invalidate=()=>{cancel();setRoute(undefined);setStatus('idle');setMessage('');setHighlight(null);setPhase('rover')}
 const edit=(which:Endpoint,value:DraftPoint)=>{invalidate();setView('2d');setEndpoints(p=>({...p,[which]:value}))}
 const choose=(which:Endpoint,point:GeographicPoint)=>{edit(which,draft(point));setPicking(null)}
 const calculate=async()=>{
  const start=validateEndpoint(endpoints.start),destination=validateEndpoint(endpoints.destination)
  if(!start.point||!destination.point){setStatus('error');setMessage(start.error??destination.error??'Invalid coordinates');return}
  cancel();setView('2d');setPicking(null);setRoute(undefined);setStatus('loading');setMessage('Connecting to the route planner…')
  const active={controller:new AbortController(),job:undefined as string|undefined};request.current=active
  let stage='Connecting to the planner service…'
  try{
   await waitForPlanner(active.controller.signal,()=>setMessage('Waking up the free planner service. This can take about a minute...'))
   const response=await fetch(apiUrl('/missions'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:start.point,destination:destination.point}),signal:active.controller.signal})
   if(response.status===409)throw Error('The planner is busy with another calculation. Please try again shortly.')
   if(!response.ok)throw Error('SERVICE')
   const initial=await response.json();active.job=initial.id
   if(request.current!==active){void fetch(apiUrl(`/missions/${initial.id}`),{method:'DELETE'});return}
   const until=Date.now()+320000
   while(Date.now()<until){
    if(active.controller.signal.aborted)return
    const poll=await fetch(apiUrl(`/missions/${active.job}`),{signal:active.controller.signal})
    if(!poll.ok)throw Error('SERVICE')
    const data=await poll.json()
    if(request.current!==active)return
    if(data.state==='ready'){setRoute(data.route);setPhase('rover');setStatus('ready');setMessage('');setFitRequest(n=>n+1);setView('2d');request.current=null;return}
    if(data.state==='error')throw Error(data.message||'Calculation failed. Try again.')
    if(data.state==='cancelled'){setStatus('idle');request.current=null;return}
    stage=data.state==='loading'?'Validating layers and preparing the model…':'Calculating Rover → parking → EVA…';setMessage(stage)
    await abortableDelay(1000,active.controller.signal)
   }
   throw Error('Calculation timed out. Try different endpoints.')
  }catch(error){if(request.current!==active||active.controller.signal.aborted)return;setStatus('error');setMessage(error instanceof Error&&error.message!=='SERVICE'&&!(error instanceof TypeError)?error.message:'Planner unavailable. Please try again shortly. If this continues, check the API address and service status.');if(active.job)void fetch(apiUrl(`/missions/${active.job}`),{method:'DELETE'}).catch(()=>{});request.current=null}
 }
 return{view,setView,activated,endpoints,route,status,message,picking,highlight,fitRequest,followRequest,phase,setPhase,setHighlight,
  edit,choose,calculate,cancel,clear:()=>{invalidate();setView('2d');setPicking(null)},
  swap:()=>{invalidate();setView('2d');setEndpoints(p=>({start:p.destination,destination:p.start}));setPicking(null)},
  reset:()=>{invalidate();setView('2d');setEndpoints(defaults());setPicking(null)},
  pick:(which:Endpoint|null)=>{setPicking(which);if(which)setView('2d')},fit:()=>{setView('2d');setFitRequest(n=>n+1)},follow:()=>{setView('pov');setFollowRequest(n=>n+1)}}
}
export type MissionPlanner=ReturnType<typeof useMissionPlanner>
