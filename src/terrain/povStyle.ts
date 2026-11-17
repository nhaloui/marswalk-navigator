/** Final display preset. Visual shading only; does not change DEM geometry. */
export const POV_STYLE=Object.freeze({grade:.60,contrast:1.22,detail:.80,grain:.65,micro:.45})
export const routeLineWidth=(mode:string,highlighted:boolean)=>mode==='pov'?(highlighted?12:9):(highlighted?5:3)
