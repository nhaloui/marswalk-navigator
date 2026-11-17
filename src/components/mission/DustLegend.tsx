import {dustMetadata} from '@/terrain/data'
const format=(score:number)=>score.toLocaleString('en-US',{maximumFractionDigits:4})
export function DustLegend(){
 return <>
  <p>Fixed display scale: 0 to 1</p>
  <div role="img" aria-label="Fixed Dust gradient from 0 to 1" style={{height:12,borderRadius:3,background:`linear-gradient(90deg,${dustMetadata.palette.map(({score,rgb})=>`rgb(${rgb.join(',')}) ${score*100}%`).join(',')})`}}/>
  <div className="legend-limits"><span>0</span><span>1</span></div>
  <div className="dust-legend" aria-label="Dust scores from CSV">{dustMetadata.classes.map(({rgb,score})=><span key={`${rgb.join(',')}:${score}`} title={`dust_score = ${score}`}><i style={{background:`rgb(${rgb.join(',')})`}}/>{format(score)}</span>)}</div>
  <p>Supplied scores: {format(dustMetadata.minimum)} to {format(dustMetadata.maximum)}. No renormalization or contrast stretching.</p>
  <p>Uncalibrated experimental index, not a hazard level. Coarse source data; latitude convention requires confirmation.</p>
 </>
}
