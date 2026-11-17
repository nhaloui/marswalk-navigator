/** Spherical Mars AEQD, matching the cropped GeoTIFFs exactly (not WGS84). */
export const MARS_RADIUS_M = 3396190
export const CRATER_CENTER = { latitude: 40.85630, longitude: 22.03879 }
export interface GeographicPoint { latitude: number; longitude: number }
const radians = Math.PI / 180
const lat0 = CRATER_CENTER.latitude * radians
const lon0 = CRATER_CENTER.longitude * radians

export function geographicToLocal(point: GeographicPoint) {
  const lat = point.latitude * radians
  const lon = point.longitude * radians
  const deltaLon = Math.atan2(Math.sin(lon-lon0), Math.cos(lon-lon0))
  const east = Math.cos(lat)*Math.sin(deltaLon)
  const north = Math.cos(lat0)*Math.sin(lat)-Math.sin(lat0)*Math.cos(lat)*Math.cos(deltaLon)
  const sinC = Math.hypot(east,north)
  const cosC = Math.sin(lat0)*Math.sin(lat)+Math.cos(lat0)*Math.cos(lat)*Math.cos(deltaLon)
  const c = Math.atan2(sinC,cosC)
  if (c < 1e-14) return {x:0,y:0}
  if (sinC < 1e-14) throw new Error('AEQD is undefined at the antipode')
  const k = MARS_RADIUS_M*c/sinC
  return {x:k*east,y:k*north}
}
export function localToGeographic(point: {x:number;y:number}): GeographicPoint {
  const rho = Math.hypot(point.x,point.y)
  if (rho < 1e-9) return {...CRATER_CENTER}
  const c = rho/MARS_RADIUS_M
  const latitude = Math.asin(Math.max(-1,Math.min(1,Math.cos(c)*Math.sin(lat0)+point.y*Math.sin(c)*Math.cos(lat0)/rho)))
  const longitude = lon0+Math.atan2(point.x*Math.sin(c),rho*Math.cos(lat0)*Math.cos(c)-point.y*Math.sin(lat0)*Math.sin(c))
  return {latitude:latitude/radians,longitude:((longitude/radians)%360+360)%360}
}
/** Great-circle distance on the raster's Mars sphere, not a terrain route. */
export function directDistance(a:GeographicPoint,b:GeographicPoint) {
  const latA=a.latitude*radians, latB=b.latitude*radians
  const h=Math.sin((latB-latA)/2)**2+Math.cos(latA)*Math.cos(latB)*Math.sin((b.longitude-a.longitude)*radians/2)**2
  return 2*MARS_RADIUS_M*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))))
}
