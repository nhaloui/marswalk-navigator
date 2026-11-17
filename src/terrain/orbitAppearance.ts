import * as THREE from 'three'
import type {Layers} from '@/data/mission'
/** Frozen pre-POV visual baseline. No POV knobs or procedural shading here. */
export const ORBIT_STYLE=Object.freeze({hemisphere:2,sun:1.2,exposure:1,roughness:1,background:0x252622,fog:0x33302a,fogDensity:.000035})
export function createOrbitMaterial(ctx:THREE.Texture,dust:THREE.Texture,elevation:THREE.Texture){
 const uniforms={ctxOn:{value:1},dustOn:{value:0},elevationOn:{value:0},dustOpacity:{value:.45},elevationOpacity:{value:.45},dustMap:{value:dust},elevationMap:{value:elevation}}
 const material=new THREE.MeshStandardMaterial({map:ctx,color:0xffffff,roughness:ORBIT_STYLE.roughness,metalness:0,side:THREE.DoubleSide})
 material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,uniforms);shader.fragmentShader='uniform float ctxOn,dustOn,elevationOn,dustOpacity,elevationOpacity;uniform sampler2D dustMap,elevationMap;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
 diffuseColor.rgb=mix(vec3(.15),diffuseColor.rgb,ctxOn);
 vec4 elev=texture2D(elevationMap,vMapUv);
 diffuseColor.rgb=mix(diffuseColor.rgb,elev.rgb,elevationOn*elevationOpacity*elev.a);
 vec4 dust=texture2D(dustMap,vMapUv);
 diffuseColor.rgb=mix(diffuseColor.rgb,dust.rgb,dustOn*dustOpacity*dust.a);
 `)}
 return{material,update(layers:Layers,dustOpacity:number,elevationOpacity:number){uniforms.ctxOn.value=Number(layers.terrain);uniforms.dustOn.value=Number(layers.dust);uniforms.elevationOn.value=Number(layers.elevation);uniforms.dustOpacity.value=dustOpacity;uniforms.elevationOpacity.value=elevationOpacity}}
}
export function restoreOrbitLighting(renderer:THREE.WebGLRenderer,scene:THREE.Scene,hemisphere:THREE.HemisphereLight,sun:THREE.DirectionalLight){
 renderer.toneMapping=THREE.NoToneMapping;renderer.toneMappingExposure=ORBIT_STYLE.exposure;renderer.shadowMap.enabled=false
 scene.background=new THREE.Color(ORBIT_STYLE.background);scene.fog=new THREE.FogExp2(ORBIT_STYLE.fog,ORBIT_STYLE.fogDensity)
 hemisphere.color.setHex(0xe0ddd0);hemisphere.groundColor.setHex(0x51483c);hemisphere.intensity=ORBIT_STYLE.hemisphere
 sun.color.setHex(0xffe3bc);sun.intensity=ORBIT_STYLE.sun;sun.position.set(-3000,5000,-2000)
}
