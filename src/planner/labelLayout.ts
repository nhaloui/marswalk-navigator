/** Offset labels only; leader anchors remain at their exact projected locations. */
export function layoutRouteLabels(points:{id:string;x:number;y:number}[],width:number,height:number){
 const placed:{id:string;x:number;y:number;anchorX:number;anchorY:number}[]=[]
 for(const point of points){
  const next={...point,anchorX:point.x,anchorY:point.y,x:Math.max(115,Math.min(width-115,point.x)),y:Math.max(100,Math.min(height-70,point.y))}
  for(let i=0;i<8&&placed.some(p=>Math.abs(p.x-next.x)<230&&Math.abs(p.y-next.y)<72);i++){
   if(next.y+76<height-60)next.y+=76
   else next.y=Math.max(100,next.y-76*(i+1))
  }
  placed.push(next)
 }
 return placed
}
