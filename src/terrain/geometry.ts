import * as THREE from 'three'
import type {TerrainGrid} from './coordinates.ts'
import {sampleTerrain,terrainUV,localToWorld} from './coordinates.ts'
/** Pixel centers plus clamped half-cell borders; no triangles across missing samples. */
export function terrainGeometry(grid:TerrainGrid,origin:number){
 const w=grid.width+2,h=grid.height+2,positions=new Float32Array(w*h*3),uv=new Float32Array(w*h*2),valid=new Uint8Array(w*h)
 const [west,south,east,north]=grid.bounds
 for(let r=0;r<h;r++)for(let c=0;c<w;c++){
  const x=c===0?west:c===w-1?east:west+(c-.5)*(east-west)/grid.width
  const y=r===0?north:r===h-1?south:north-(r-.5)*(north-south)/grid.height
  const elevation=sampleTerrain(grid,x,y),i=r*w+c,p=localToWorld(x,y,elevation??origin,origin),t=terrainUV(x,y,grid.bounds)
  positions.set([p.x,p.y,p.z],i*3);uv.set([t.u,t.v],i*2);valid[i]=elevation===null?0:1
 }
 const indices:number[]=[]
 for(let r=0;r<h-1;r++)for(let c=0;c<w-1;c++){const a=r*w+c,b=a+1,d=a+w,e=d+1;if(valid[a]&&valid[d]&&valid[b])indices.push(a,d,b);if(valid[b]&&valid[d]&&valid[e])indices.push(b,d,e)}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();return g
}
