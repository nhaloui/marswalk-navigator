import {POV_STYLE,routeLineWidth} from './povStyle'
import {layoutRouteLabels} from '@/planner/labelLayout'
import {waypointLabel,knownPoints} from '@/data/mission'
import {PovVisor} from './PovVisor'
import {PovMotion} from './povMotion'
import {createGroundArrows} from './groundArrows'
import {createPovMaterial,createMarsSky} from './marsAppearance'
import {createOrbitMaterial,restoreOrbitLighting} from './orbitAppearance'
import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import * as THREE from 'three'
import {Line2} from 'three/addons/lines/Line2.js'
import {LineGeometry} from 'three/addons/lines/LineGeometry.js'
import {LineMaterial} from 'three/addons/lines/LineMaterial.js'
import {phaseColor} from '@/planner/types'
import type {Phase} from '@/planner/types'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import type {TerrainGrid,TerrainSession} from './coordinates'
import {sampleTerrain,followEyeHeight,localToWorld,drapeRoute} from './coordinates'
import {terrainGeometry} from './geometry'
import {terrainMetadata as meta} from './data'
import {imagery} from '@/data/imagery'
import type {Layers,Waypoint} from '@/data/mission'

interface Props {followRequest:number;highlight:Phase|null;onPhase:(phase:Phase)=>void;transportMode?:string;grid:TerrainGrid;mode:'2d'|'3d'|'pov';layers:Layers;dustOpacity:number;elevationOpacity:number;session:TerrainSession;points:Waypoint[];onSelect:(p:Waypoint)=>void;selected:Waypoint|null;onExit:()=>void}
const asset=(path:string)=>`${import.meta.env.BASE_URL}${path}`
export function MarsTerrain3D(props:Props){
 const host=useRef<HTMLDivElement>(null)
 const [playback,setPlayback]=useState(1)
 const [paused,setPaused]=useState(true),[speed,setSpeed]=useState(1.2),[error,setError]=useState(''),[ready,setReady]=useState(false)
 const {grade,contrast,detail,micro,grain}=POV_STYLE
 const [navigation,setNavigation]=useState<'free'|'step'|'route'>('free')
 const [hud,setHud]=useState({x:0,y:0,elevation:0,heading:0,distance:0,message:''})
 const [labels,setLabels]=useState<{id:string;x:number;y:number;anchorX:number;anchorY:number}[]>([])
 const motion=useRef(new PovMotion())
 const touch=useRef(new Set<string>()),look=useRef<{x:number;y:number}|null>(null)
 const live=useRef({...props,paused,speed,grade,contrast,detail,micro,grain,navigation,playback})
 useLayoutEffect(()=>{live.current={...props,paused,speed,grade,contrast,detail,micro,grain,navigation,playback}},[props,paused,speed,grade,contrast,detail,micro,grain,navigation,playback])
 useEffect(()=>{
  const element=host.current;if(!element)return
  let renderer:THREE.WebGLRenderer
  try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'})}catch{queueMicrotask(()=>setError('WebGL unavailable. The 2D map is still available.'));return}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.debug.onShaderError=(gl,_program,_vertex,fragment)=>setError('WebGL shader error: '+(gl.getShaderInfoLog(fragment)??'unknown'));element.appendChild(renderer.domElement)
  const scene=new THREE.Scene();scene.fog=new THREE.FogExp2('#7d5136',.000012);const sky=createMarsSky();scene.add(sky.mesh)
  const hemisphere=new THREE.HemisphereLight(0xd4bda5,0x35241b,.42);scene.add(hemisphere)
  const sun=new THREE.DirectionalLight(0xffe1bd,2);sun.position.set(-8500,6500,6000);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-6500,right:6500,top:6500,bottom:-6500,near:100,far:24000});sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.00003;sun.shadow.normalBias=.3;scene.add(sun)
  const camera=new THREE.PerspectiveCamera(65,1,.1,40000);camera.rotation.order='YXZ'
  const geometry=terrainGeometry(props.grid,meta.originElevation)
  const texture=new THREE.Texture();texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=true
  const dustTexture=new THREE.Texture();dustTexture.colorSpace=THREE.SRGBColorSpace;dustTexture.minFilter=THREE.NearestFilter;dustTexture.magFilter=THREE.NearestFilter;dustTexture.generateMipmaps=false
  const elevationTexture=new THREE.Texture();elevationTexture.colorSpace=THREE.SRGBColorSpace
  const appearance=createPovMaterial(texture,dustTexture,elevationTexture),orbitAppearance=createOrbitMaterial(texture,dustTexture,elevationTexture),material=appearance.material
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh)
  const arrows=createGroundArrows(props.grid,meta.originElevation);scene.add(arrows.group)
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2()
  let arrowDown:THREE.Mesh|undefined,down={x:0,y:0},dragged=false
  const arrowHit=(e:PointerEvent)=>{const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2);ray.setFromCamera(pointer,camera);return arrows.pick(ray)}
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=15;controls.maxDistance=28000;controls.maxPolarAngle=Math.PI/2-.015
  const saved=props.session.orbit
  if(saved){camera.position.fromArray(saved.position);controls.target.fromArray(saved.target)}else{camera.position.set(8500,7500,8500);controls.target.set(0,0,0)}
  let routeLine:THREE.Group|undefined,lastRoute:unknown,lastFollow=0,lastPhase=''
  const disposeRoute=()=>{if(!routeLine)return;scene.remove(routeLine);routeLine.traverse(object=>{if(object instanceof Line2){object.geometry.dispose();object.material.dispose()}});routeLine=undefined}
  let images:HTMLImageElement[]|undefined,disposed=false,lastMode='',lastSelected='',lastOriginVersion=-1,frame=0,lastTime=performance.now(),lastHud=0,eye:number|undefined,renderDirty=true,lastRenderKey=''
  const loadImage=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('Texture unavailable: '+src));i.src=src})
  Promise.all([loadImage(imagery.url),loadImage(asset(meta.dust)),loadImage(asset(meta.elevationTexture))]).then(loaded=>{if(!disposed){images=loaded;texture.image=loaded[0];dustTexture.image=loaded[1];elevationTexture.image=loaded[2];texture.needsUpdate=true;dustTexture.needsUpdate=true;elevationTexture.needsUpdate=true;setReady(true)}}).catch(e=>{if(!disposed)setError(String(e))})
  const keys=new Set<string>()
  const keyDown=(e:KeyboardEvent)=>{if((e.target as HTMLElement).closest('input,select,button'))return;if(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){keys.add(e.key);e.preventDefault()}if(e.key==='Escape'){arrowDown=undefined;keys.clear();touch.current.clear();setPaused(true);live.current.session.follower.pause();motion.current.stop()}}
  const keyUp=(e:KeyboardEvent)=>keys.delete(e.key)
  const clear=()=>{arrowDown=undefined;keys.clear();touch.current.clear();look.current=null;setPaused(true);live.current.session.follower.pause();motion.current.stop()}
  const pointerDown=(e:PointerEvent)=>{if(live.current.mode!=='pov')return;down={x:e.clientX,y:e.clientY};dragged=false;arrowDown=arrowHit(e);look.current={x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId)}
  const pointerMove=(e:PointerEvent)=>{if(live.current.mode!=='pov')return;renderDirty=true;arrows.hover(arrowHit(e));const p=look.current;if(!p)return;if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)dragged=true;if(arrowDown&&!dragged)return;const walk=live.current.session.walk;walk.heading+=(e.clientX-p.x)*.003;walk.pitch=THREE.MathUtils.clamp(walk.pitch-(e.clientY-p.y)*.003,-1.2,1.2);look.current={x:e.clientX,y:e.clientY}}
  const pointerUp=()=>{if(arrowDown&&!dragged&&images){live.current.session.follower.pause();motion.current.requestStep(live.current.session.walk,arrowDown.userData.direction);setNavigation('step');setPaused(false)}look.current=null;arrowDown=undefined}
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointermove',pointerMove);renderer.domElement.addEventListener('pointerup',pointerUp);renderer.domElement.addEventListener('pointercancel',clear)
  element.addEventListener('keydown',keyDown);element.addEventListener('keyup',keyUp);window.addEventListener('blur',clear)
  const visibility=()=>{if(document.hidden)clear()};document.addEventListener('visibilitychange',visibility)
  const onFocus=()=>element.focus();renderer.domElement.addEventListener('pointerdown',onFocus)
  const resize=new ResizeObserver(([entry])=>{if(entry.contentRect.width>0&&entry.contentRect.height>0){renderDirty=true;renderer.setSize(entry.contentRect.width,entry.contentRect.height);camera.aspect=entry.contentRect.width/entry.contentRect.height;camera.updateProjectionMatrix()}});resize.observe(element)
  const draw=(now:number)=>{
   frame=requestAnimationFrame(draw);const elapsed=Math.max(0,(now-lastTime)/1000),dt=Math.min(.05,elapsed);lastTime=now
   const p=live.current;if(p.mode==='2d'){if(lastMode!=='2d')clear();lastMode='2d';return}
   if(p.mode!==lastMode){
    if(lastMode==='3d')p.session.orbit={position:camera.position.toArray(),target:controls.target.toArray()}
    if(p.mode==='3d'){const orbit=p.session.orbit;camera.position.fromArray(orbit?.position??[8500,7500,8500]);controls.target.fromArray(orbit?.target??[0,0,0]);camera.up.set(0,1,0)}
    eye=undefined;clear();lastMode=p.mode
   }
   controls.enabled=p.mode==='3d'
   if(p.mode==='3d'){
    if(mesh.material!==orbitAppearance.material){mesh.material=orbitAppearance.material;restoreOrbitLighting(renderer,scene,hemisphere,sun);sky.mesh.visible=false;mesh.receiveShadow=false;mesh.castShadow=false}
    orbitAppearance.update(p.layers,p.dustOpacity,p.elevationOpacity)
   }else{
    if(mesh.material!==material||!sky.mesh.visible){mesh.material=material;sky.mesh.visible=true;scene.background=null;scene.fog=new THREE.FogExp2('#7d5136',.000012);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.shadowMap.enabled=true;renderer.shadowMap.needsUpdate=true;hemisphere.color.setHex(0xd4bda5);hemisphere.groundColor.setHex(0x35241b);hemisphere.intensity=.42;sun.color.setHex(0xffe1bd);sun.intensity=2;sun.position.set(-8500,6500,6000);mesh.receiveShadow=true;mesh.castShadow=true}
    appearance.update(p.layers,p.dustOpacity,p.elevationOpacity,p.grade,p.contrast,p.detail,p.micro,p.grain)
   }
   if(p.session.follower.route!==lastRoute){
    lastRoute=p.session.follower.route;setPaused(true);motion.current.stop()
    disposeRoute()
    if(p.session.follower.route){
     try{
      routeLine=new THREE.Group()
      const route=p.session.follower.route,legs=route.legs??[{phase:'eva' as const,points:route.points,distance_m:0,duration_s:0}]
      for(const leg of legs){if(leg.points.length<2)continue;const samples=drapeRoute(p.grid,{id:route.id,points:leg.points})
       const g=new LineGeometry();g.setPositions(samples.flatMap(point=>[point.x_m,point.elevation_m!+.5-meta.originElevation,-point.y_m]))
       const material=new LineMaterial({color:phaseColor[leg.phase],linewidth:3,transparent:true,opacity:1,dashed:leg.phase==='eva',dashSize:18,gapSize:10})
       material.resolution.set(element.clientWidth,element.clientHeight)
       const line=new Line2(g,material);line.computeLineDistances();line.userData.phase=leg.phase;routeLine.add(line)
      }
      scene.add(routeLine)
     }catch(e){p.session.follower.pause();setError(String(e))}
    }
   }
   routeLine?.traverse(object=>{if(object instanceof Line2){const active=!p.highlight||p.highlight===object.userData.phase;object.material.opacity=active?1:.35;object.material.linewidth=routeLineWidth(p.mode,p.highlight===object.userData.phase);object.material.resolution.set(element.clientWidth,element.clientHeight)}})
   if(p.mode==='pov'&&p.followRequest!==lastFollow&&p.session.follower.route){lastFollow=p.followRequest;setNavigation('route');motion.current.mode='route';motion.current.stop();if(p.session.follower.remaining===0){const route=p.session.follower.route;p.session.follower.setRoute(route);p.session.setOrigin(route.points[0].x_m,route.points[0].y_m)}p.session.follower.resume();setPaused(false)}
   let message='' 
   if(p.mode==='pov'){
    const walk=p.session.walk
    if(lastOriginVersion!==p.session.originVersion){eye=undefined;motion.current.stop();lastOriginVersion=p.session.originVersion}
    if(!p.paused&&images){
     const held=(k:string)=>keys.has(k)||touch.current.has(k)
     if(held('ArrowLeft'))walk.heading-=dt*1.2;if(held('ArrowRight'))walk.heading+=dt*1.2
     if((held('w')||held('s')||held('a')||held('d')||held('ArrowUp')||held('ArrowDown'))&&p.navigation!=='free')setNavigation('free')
     motion.current.mode=p.navigation;motion.current.simulationRate=p.playback
      motion.current.update(p.grid,walk,p.navigation==='route'?elapsed:dt,p.speed,Number(held('w')||held('ArrowUp'))-Number(held('s')||held('ArrowDown')),Number(held('d'))-Number(held('a')),p.session.follower)
     message=motion.current.message
      if(p.navigation==='route'&&p.session.follower.remaining<.1){message='Destination reached';setPaused(true)}

    }
    const eyeAbsolute=followEyeHeight(p.grid,walk.x,walk.y,eye===undefined?undefined:eye+meta.originElevation,dt)
    if(eyeAbsolute===null){message='Elevation unavailable';setPaused(true)}else{
     eye=eyeAbsolute-meta.originElevation
     camera.position.set(walk.x,eye,-walk.y);camera.rotation.set(walk.pitch,-walk.heading,0,'YXZ')
    }
   }else{
    if(p.selected?.id!==lastSelected){lastSelected=p.selected?.id??'';if(p.selected){const h=sampleTerrain(p.grid,p.selected.x,p.selected.y);if(h!==null)controls.target.set(p.selected.x,h-meta.originElevation,-p.selected.y)}}
    controls.update();controls.target.x=THREE.MathUtils.clamp(controls.target.x,-5000,5000);controls.target.z=THREE.MathUtils.clamp(controls.target.z,-5000,5000);p.session.orbit={position:camera.position.toArray(),target:controls.target.toArray()}
   }
   arrows.update(p.session.walk,p.mode==='pov'&&!!images&&p.navigation!=='route');sky.mesh.position.copy(camera.position)
   const renderKey=[p.mode,p.paused,...camera.position.toArray().map(v=>v.toFixed(3)),camera.rotation.x.toFixed(6),camera.rotation.y.toFixed(6),camera.rotation.z.toFixed(6),p.layers.terrain,p.layers.dust,p.layers.elevation,p.dustOpacity,p.elevationOpacity,p.grade,p.contrast,p.detail,p.micro,p.grain,p.highlight,p.session.follower.route?.id,!!images].join('|')
   if(p.mode==='3d'||!p.paused||renderDirty||renderKey!==lastRenderKey){renderer.render(scene,camera);lastRenderKey=renderKey;renderDirty=false}
   if(now-lastHud>100){if(p.session.follower.route&&p.navigation==='route'){const phase=p.session.follower.phase;if(phase!==lastPhase){lastPhase=phase;p.onPhase(phase)}message=message||(phase==='eva'?'EVA / Rover parked':'ROVER APPROACH')}lastHud=now;const walk=p.session.walk,h=sampleTerrain(p.grid,walk.x,walk.y);setHud({x:walk.x,y:walk.y,elevation:h??NaN,heading:((walk.heading*180/Math.PI)%360+360)%360,distance:walk.distance,message});
    const bounds=element.getBoundingClientRect();setLabels(layoutRouteLabels(p.points.flatMap(point=>{const h=sampleTerrain(p.grid,point.x,point.y);if(h===null||(p.mode==='pov'&&Math.hypot(point.x-walk.x,point.y-walk.y)>1500))return[];const v=localToWorld(point.x,point.y,h+3,meta.originElevation),projected=new THREE.Vector3(v.x,v.y,v.z).project(camera);if(projected.z>1||projected.z< -1||Math.abs(projected.x)>.95||Math.abs(projected.y)>.9)return[];return[{id:point.id,x:(projected.x+1)/2*bounds.width,y:(1-projected.y)/2*bounds.height}]}),bounds.width,bounds.height))
   }
  }
  frame=requestAnimationFrame(draw)
  return()=>{disposed=true;cancelAnimationFrame(frame);resize.disconnect();controls.dispose();geometry.dispose();material.dispose();orbitAppearance.material.dispose();texture.dispose();dustTexture.dispose();elevationTexture.dispose();arrows.dispose();sky.dispose();sun.shadow.map?.dispose();disposeRoute();renderer.dispose();renderer.domElement.remove();element.removeEventListener('keydown',keyDown);element.removeEventListener('keyup',keyUp);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',visibility);renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerdown',onFocus);renderer.domElement.removeEventListener('pointermove',pointerMove);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('pointercancel',clear)}
 },[props.grid,props.session])

 return <div className={`terrain-3d ${props.mode==='pov'?'visor-pov':''}`}><div className="webgl-host" ref={host} tabIndex={0} aria-label="3D Martian terrain. Drag to look, use WASD to walk, and arrow keys to move and turn."/>
  {!ready&&!error&&<div className="terrain-loading" role="status">Loading DEM and surface textures…</div>}
  {error&&<div className="terrain-loading" role="alert">{error}<button onClick={props.onExit}>Back to 2D map</button></div>}
  <svg className="route-label-leaders" aria-hidden="true">{labels.map(label=><g key={label.id}><circle cx={label.anchorX} cy={label.anchorY} r="3" fill="#e7bc80"/>{Math.hypot(label.x-label.anchorX,label.y-label.anchorY)>10&&<line x1={label.anchorX} y1={label.anchorY} x2={label.x} y2={label.y-36} stroke="#e7bc80" strokeWidth="1" opacity=".65"/>}</g>)}</svg>
  {labels.flatMap(label=>{const point=props.points.find(p=>p.id===label.id);if(!point)return[];return <button key={point.id} className="world-label" style={{left:label.x,top:label.y}} onClick={()=>props.onSelect(point)}>{waypointLabel(point)}</button>})}

  {props.selected&&props.mode!=='pov'&&<div className="terrain-point-info"><strong>{waypointLabel(props.selected)}</strong><span>{props.selected.geographic.latitude.toFixed(5)} N / {props.selected.geographic.longitude.toFixed(5)} E</span><span>DEM elevation: {sampleTerrain(props.grid,props.selected.x,props.selected.y)?.toFixed(2)??'unavailable'} m</span></div>}
  {props.mode==='pov'?<PovVisor playback={playback} onPlayback={setPlayback} onFollow={()=>{motion.current.stop();motion.current.mode='route';setNavigation('route');if(props.session.follower.remaining===0&&props.session.follower.route){const route=props.session.follower.route;props.session.follower.setRoute(route);props.session.setOrigin(route.points[0].x_m,route.points[0].y_m)}props.session.follower.resume();setPaused(false);host.current?.focus()}} transportMode={props.transportMode} hud={hud} paused={paused} speed={speed} navigation={navigation} points={[...props.points.filter(p=>p.type!=='custom'),...knownPoints.filter(k=>!props.points.some(p=>p.id===k.id))]} selected={props.selected} route={props.session.follower.route?{total:props.session.follower.length,progress:props.session.follower.progress,remaining:props.session.follower.remaining,phase:props.session.follower.phase,guidance:props.session.follower.nextManeuver}:undefined} onPause={()=>{setPaused(v=>!v);motion.current.stop();touch.current.clear();if(!paused)props.session.follower.pause();else if(navigation==='route')props.session.follower.resume();host.current?.focus()}} onNorth={()=>props.session.orientNorth()} onSpeed={setSpeed} onNavigation={mode=>{setNavigation(mode);motion.current.mode=mode;motion.current.stop();props.session.follower.pause();setPaused(true)}} onOrigin={id=>{const point=props.points.find(p=>p.id===id)??knownPoints.find(p=>p.id===id);if(point){props.session.setOrigin(point.x,point.y);motion.current.stop();setPaused(true)}}} onExit={props.onExit}/>:<div className="orbit-help">Drag to orbit · Scroll to zoom · Right-drag or two fingers to pan</div>}
 </div>
}


