import * as THREE from 'three'
import type {Layers} from '@/data/mission'
/** Luminance-preserving warm chroma; applied to CTX alone before scientific overlays. */
export function warmRGB(luminance:number,strength:number){const amount=Math.min(luminance,1-luminance)*strength;return[luminance+.65*amount,luminance-.12*amount,luminance-(.2126*.65-.7152*.12)/.0722*amount]}
/** Bounded contrast reference used in tests; GPU uses the same log-odds curve. */
export function detailLuminance(center:number,neighbors:number[],contrast:number,detail:number){
 const logit=(v:number)=>Math.log((v+1e-6)/(1-v+1e-6))
 const base=logit(center),surround=neighbors.reduce((sum,v)=>sum+logit(v),0)/neighbors.length
 const enhanced=Math.max(-14,Math.min(14,contrast*base+detail*(base-surround)))
 return 1/(1+Math.exp(-enhanced))
}
export function createPovMaterial(ctx:THREE.Texture,dust:THREE.Texture,elevation:THREE.Texture){
 const uniforms={grain:{value:.6},grade:{value:.8},contrast:{value:1.12},detail:{value:.85},texel:{value:new THREE.Vector2(1/1668,1/1668)},ctxOn:{value:1},dustOn:{value:0},elevationOn:{value:0},dustOpacity:{value:.45},elevationOpacity:{value:.45},dustMap:{value:dust},elevationMap:{value:elevation}}
 const material=new THREE.MeshStandardMaterial({map:ctx,color:0xffffff,roughness:.97,bumpMap:ctx,bumpScale:.14,metalness:0,side:THREE.FrontSide})
 material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,uniforms);shader.vertexShader='varying vec3 vPovWorld;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvPovWorld=(modelMatrix*vec4(transformed,1.)).xyz;');shader.fragmentShader=`
 varying vec3 vPovWorld;
 uniform float grain;
 float povHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float povNoise(vec2 p){vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(povHash(cell),povHash(cell+vec2(1.,0.)),f.x),mix(povHash(cell+vec2(0.,1.)),povHash(cell+vec2(1.)),f.x),f.y);}
 uniform vec2 texel; uniform float grade,contrast,detail,ctxOn,dustOn,elevationOn,dustOpacity,elevationOpacity;uniform sampler2D dustMap,elevationMap;\n`+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
 float ctxCenter=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
 float ctxWest=dot(texture2D(map,vMapUv-vec2(texel.x,0.)).rgb,vec3(.2126,.7152,.0722));
 float ctxEast=dot(texture2D(map,vMapUv+vec2(texel.x,0.)).rgb,vec3(.2126,.7152,.0722));
 float ctxNorth=dot(texture2D(map,vMapUv+vec2(0.,texel.y)).rgb,vec3(.2126,.7152,.0722));
 float ctxSouth=dot(texture2D(map,vMapUv-vec2(0.,texel.y)).rgb,vec3(.2126,.7152,.0722));
 float ctxLogit=log((ctxCenter+1e-6)/(1.-ctxCenter+1e-6));
 vec4 ctxNear=vec4(ctxWest,ctxEast,ctxNorth,ctxSouth);
 float ctxSurround=dot(log((ctxNear+1e-6)/(1.-ctxNear+1e-6)),vec4(.25));
 float footprint=max(length(dFdx(vMapUv)/texel),length(dFdy(vMapUv)/texel));
 float detailFade=1./(1.+.25*max(0.,footprint-2.));
 float lum=1./(1.+exp(-clamp(contrast*ctxLogit+detail*detailFade*(ctxLogit-ctxSurround),-14.,14.)));
 // World-locked, display-only soil grain; never sampled as terrain or a cost.
 float grainMix=grain*ctxOn*(1.-elevationOn*elevationOpacity)*(1.-dustOn*dustOpacity);
 float povGrain=0.;
 if(grainMix>.001){
  float fineFootprint=max(length(dFdx(vPovWorld.xz)),length(dFdy(vPovWorld.xz)));
  float fineFade=1.-smoothstep(.015,.075,fineFootprint);
  float coarseFade=1.-smoothstep(.06,.24,fineFootprint);
  if(fineFade>.001)povGrain+=(povNoise(vPovWorld.xz*12.5)-.5)*fineFade;
  if(coarseFade>.001)povGrain+=(povNoise(vPovWorld.xz*4.)-.5)*.5*coarseFade;
 }
 lum=1./(1.+exp(-clamp(log((lum+1e-6)/(1.-lum+1e-6))+povGrain*grainMix*.9,-14.,14.)));
 float chroma=min(lum,1.-lum)*grade;
 vec3 graded=vec3(lum)+chroma*vec3(.65,-.12,-.7252908587);
 diffuseColor.rgb=mix(vec3(.15),graded,ctxOn);
 vec4 elev=texture2D(elevationMap,vMapUv);
 diffuseColor.rgb=mix(diffuseColor.rgb,elev.rgb,elevationOn*elevationOpacity*elev.a);
 vec4 dust=texture2D(dustMap,vMapUv);
 diffuseColor.rgb=mix(diffuseColor.rgb,dust.rgb,dustOn*dustOpacity*dust.a);
 `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
 roughnessFactor=mix(.97,clamp(.97-.04*ctxCenter+.06*povGrain*grainMix,.9,1.),ctxOn);
 `).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
 // Tiny apparent normal variation only: does not displace a DEM vertex.
 float grainHeight=povGrain*grainMix*.006;
 normal=perturbNormalArb(-vViewPosition,normal,vec2(dFdx(grainHeight),dFdy(grainHeight)),faceDirection);
 `)}
 return{material,update(layers:Layers,dustOpacity:number,elevationOpacity:number,grade:number,contrast:number,detail=.85,micro=.35,grain=.6){uniforms.grain.value=grain;material.bumpScale=layers.terrain?micro*.4:0;uniforms.detail.value=detail;uniforms.ctxOn.value=Number(layers.terrain);uniforms.dustOn.value=Number(layers.dust);uniforms.elevationOn.value=Number(layers.elevation);uniforms.dustOpacity.value=dustOpacity;uniforms.elevationOpacity.value=elevationOpacity;uniforms.grade.value=grade;uniforms.contrast.value=contrast}}
}
export function createMarsSky(){
 const geometry=new THREE.SphereGeometry(30000,24,16)
 const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,vertexShader:'varying vec3 direction;void main(){direction=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 direction;void main(){float h=normalize(direction).y;vec3 horizon=vec3(.43,.27,.16);vec3 zenith=vec3(.14,.105,.085);vec3 ground=vec3(.13,.085,.055);gl_FragColor=vec4(h>=0.?mix(horizon,zenith,smoothstep(0.,.85,h)):mix(horizon,ground,smoothstep(0.,.6,-h)),1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>}',fog:false})
 // Shader preprocessor directives must start on a new line.
 material.fragmentShader=material.fragmentShader.replace(';#include',';\n#include').replace('<colorspace_fragment>}', '<colorspace_fragment>\n}')
 const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=-10;return{mesh,dispose(){geometry.dispose();material.dispose()}}
}

// Compatibility for shader tests; the orbit renderer never uses this material.
export const createMarsMaterial=createPovMaterial
