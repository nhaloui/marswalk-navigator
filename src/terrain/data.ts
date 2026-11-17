import metadata from '@/data/terrain.generated.json'
import dust from '@/data/dust.generated.json'
import type { TerrainGrid } from './coordinates'
export const terrainMetadata={...metadata,dust:dust.url}
export {dust as dustMetadata}
let pending:Promise<TerrainGrid>|undefined
export function loadTerrain(){
 return pending??=fetch(`${import.meta.env.BASE_URL}${metadata.binary}`).then(async response=>{
  if(!response.ok)throw Error('DEM unavailable')
  const buffer=await response.arrayBuffer()
  if(buffer.byteLength!==metadata.width*metadata.height*4)throw Error('Incomplete DEM grid')
  const view=new DataView(buffer),values=new Float32Array(metadata.width*metadata.height)
  for(let i=0;i<values.length;i++)values[i]=view.getFloat32(i*4,true)
  if(!values.some(Number.isFinite))throw Error('No valid DEM elevation data')
  return {width:metadata.width,height:metadata.height,bounds:metadata.bounds,values}
 }).catch(error=>{pending=undefined;throw error})
}
