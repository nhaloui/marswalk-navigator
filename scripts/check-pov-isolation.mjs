import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from 'three'
import {createOrbitMaterial,restoreOrbitLighting,ORBIT_STYLE} from '../src/terrain/orbitAppearance.ts'
import {createPovMaterial} from '../src/terrain/marsAppearance.ts'
import {waypointLabel,knownPoints} from '../src/data/mission.ts'
const texture=new THREE.Texture(),orbit=createOrbitMaterial(texture,texture,texture),pov=createPovMaterial(texture,texture,texture)
const shader=()=>({uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader})
const a=shader(),b=shader();orbit.material.onBeforeCompile(a,{});pov.material.onBeforeCompile(b,{})
for(const term of ['povNoise','povGrain','ctxLogit','vec3 graded','grainHeight']){assert.ok(!a.fragmentShader.includes(term));assert.ok(b.fragmentShader.includes(term))}
assert.equal(orbit.material.bumpMap,null);assert.equal(orbit.material.roughness,1)
const before=a.fragmentShader
for(const grain of [0,.6,1])for(const grade of [0,1])pov.update({terrain:true,dust:true,elevation:true},.4,.5,grade,1.3,1.2,1,grain)
assert.equal(a.fragmentShader,before);assert.equal(orbit.material.bumpMap,null);assert.equal(orbit.material.roughness,1)
assert.ok(b.vertexShader.includes('vPovWorld=(modelMatrix*vec4(transformed,1.)).xyz'))
assert.ok(b.fragmentShader.includes('fineFade'));assert.ok(b.fragmentShader.includes('coarseFade'));assert.ok(b.fragmentShader.includes('grainMix=grain*ctxOn'))
pov.update({terrain:true,dust:false,elevation:false},.4,.5,.8,1.12,.85,.35,0);assert.equal(b.uniforms.grain.value,0)
const renderer={toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:.95,shadowMap:{enabled:true}},scene=new THREE.Scene(),hemi=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight()
for(let i=0;i<3;i++){restoreOrbitLighting(renderer,scene,hemi,sun);assert.equal(renderer.toneMapping,THREE.NoToneMapping);assert.equal(renderer.shadowMap.enabled,false);assert.equal(hemi.intensity,2);assert.equal(sun.intensity,1.2);assert.deepEqual(sun.position.toArray(),[-3000,5000,-2000]);assert.equal(scene.background.getHex(),ORBIT_STYLE.background)}
assert.equal(waypointLabel(knownPoints[1]),'Deuteronius Landform Center')
const source=fs.readFileSync('src/terrain/MarsTerrain3D.tsx','utf8')
assert.ok(source.includes('mesh.material=orbitAppearance.material;restoreOrbitLighting'))
assert.ok(source.includes('orbitAppearance.update(p.layers,p.dustOpacity,p.elevationOpacity)'))
orbit.material.dispose();pov.material.dispose();texture.dispose()
console.log('PASS: restored 3D baseline isolated from POV knobs/grain; world-locked grain with distance filtering and disable control; correct relief label.')
