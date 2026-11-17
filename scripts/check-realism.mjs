import assert from 'node:assert/strict'
import * as THREE from 'three'
import {detailLuminance,createMarsMaterial} from '../src/terrain/marsAppearance.ts'
import {waypointLabel,RELIEF_LABEL,knownPoints} from '../src/data/mission.ts'
import fs from 'node:fs'
for(const x of [.001,.01,.03,.06,.2,.5,.8,.98]){
 const n=[x,x,x,x],a=detailLuminance(x,n,1.12,.85),b=detailLuminance(x+.0001,n,1.12,.85)
 assert.ok(a>0&&a<1&&b>a,'Dark CTX differences must not be crushed into the same black value')
 const plain=detailLuminance(x,n,1.12,0)
 assert.ok(Math.abs(a-plain)<1e-12,'Uniform CTX regions must not gain synthetic texture')
}
const crest=detailLuminance(.3,[.2,.2,.2,.2],1.12,.85),plain=detailLuminance(.3,[.2,.2,.2,.2],1.12,0)
assert.ok(crest>plain)
const texture=new THREE.Texture(),appearance=createMarsMaterial(texture,texture,texture),shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}
appearance.material.onBeforeCompile(shader,{})
assert.equal(appearance.material.bumpMap,texture)
appearance.update({terrain:true,dust:false,elevation:false},.4,.5,.8,1.12,.85,.35)
assert.ok(Math.abs(appearance.material.bumpScale-.14)<1e-12)
appearance.update({terrain:false,dust:true,elevation:true},.4,.5,.8,1.12,0,0)
assert.equal(appearance.material.bumpScale,0)
assert.ok(shader.fragmentShader.includes('detailFade'))
assert.ok(shader.fragmentShader.indexOf('vec3 graded')<shader.fragmentShader.indexOf('vec4 elev='))
assert.ok(shader.fragmentShader.includes('clamp(.97-.04*ctxCenter+.06*povGrain*grainMix,.9,1.)'))
appearance.material.dispose();texture.dispose()
for(const name of ['Centre du crat\u00e8re','Centre du cratere','Crater Center'])assert.equal(waypointLabel({id:'crater',name}),RELIEF_LABEL)
assert.equal(waypointLabel(knownPoints[1]),'Deuteronius Landform Center')
const source=fs.readFileSync('src/terrain/MarsTerrain3D.tsx','utf8')
assert.ok(source.includes('p.grade,p.contrast,p.detail,p.micro'))
assert.ok(!source.includes("p.mode==='pov'?p.grade:0"))
console.log('PASS: shadow-detail preservation, source-only local contrast, no synthetic pattern on uniform inputs, bounded optional image bump, matte roughness, POV material appearance and canonical labels.')
