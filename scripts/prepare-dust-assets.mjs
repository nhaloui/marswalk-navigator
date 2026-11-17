import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath,pathToFileURL} from 'node:url'
import sharp from 'sharp'

export const dustCsv=fileURLToPath(new URL('../public/data/mars/crater_tes_dust_scored_10km.csv',import.meta.url))
// Fixed visual scale, independent of the current dataset's minimum/maximum.
// Only the display color is interpolated; source scores/cells are never changed.
export const dustPalette=[{score:0,rgb:[42,222,255]},{score:1/3,rgb:[44,254,251]},
 {score:2/3,rgb:[28,247,205]},{score:1,rgb:[39,212,20]}]
export function dustColor(score){
 if(!Number.isFinite(score)||score<0||score>1)throw Error('Dust score outside [0,1]')
 const position=score*3,index=Math.min(Math.floor(position),2),fraction=position-index
 return dustPalette[index].rgb.map((value,k)=>Math.round(value*(1-fraction)+dustPalette[index+1].rgb[k]*fraction))
}
export function parseDustCSV(text,grid){
 const lines=text.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/),headers=lines.shift().split(',')
 const keys=['row','col','x_m','y_m','band_1_red','band_2_green','band_3_blue','dust_score']
 const indexes=keys.map(key=>{const i=headers.indexOf(key);if(i<0)throw Error(`Missing column: ${key}`);return i})
 const {width,height,transform:g}=grid
 if(lines.length!==width*height)throw Error('Dust cell count does not match the DEM')
 const rgba=Buffer.alloc(width*height*4),classes=new Map()
 for(let i=0;i<lines.length;i++){
  const fields=lines[i].split(','),strings=indexes.map(j=>fields[j]?.trim())
  if(strings.some(s=>s===undefined||s===''||!Number.isFinite(Number(s))))throw Error(`Invalid Dust CSV at line ${i+2}`)
  const [row,col,x,y,r,gColor,b,score]=strings.map(Number),er=Math.floor(i/width),ec=i%width
  if(row!==er||col!==ec||Math.abs(x-(g[2]+(ec+.5)*g[0]+(er+.5)*g[1]))>1e-7||Math.abs(y-(g[5]+(ec+.5)*g[3]+(er+.5)*g[4]))>1e-7)throw Error(`Dust is misaligned with the DEM at line ${i+2}`)
  const sourceRGB=[r,gColor,b]
  if(sourceRGB.some(v=>!Number.isInteger(v)||v<0||v>255)||score<0||score>1)throw Error(`Invalid RGB or Dust score at line ${i+2}`)
  // Original RGB is retained in the CSV, but no longer determines map colors.
  const rgb=dustColor(score)
  rgba.set([...rgb,255],i*4)
  const key=score,entry=classes.get(key)
  if(entry)entry.cells++;else classes.set(key,{rgb,score,cells:1})
 }
 const entries=[...classes.values()].sort((a,b)=>a.score-b.score)
 return {rgba,classes:entries,minimum:entries[0].score,maximum:entries.at(-1).score,cells:width*height}
}

export async function prepareDust(){
 const text=await readFile(dustCsv,'utf8'),sha256=createHash('sha256').update(text).digest('hex')
 const grid=JSON.parse(await readFile(new URL('../src/data/terrain.generated.json',import.meta.url),'utf8'))
 const {rgba,...summary}=parseDustCSV(text,grid)
 const image=await sharp(rgba,{raw:{width:grid.width,height:grid.height,channels:4}}).png().toBuffer()
 const imageSha256=createHash('sha256').update(image).digest('hex')
 const metadata={source:'data/mars/crater_tes_dust_scored_10km.csv',sha256,imageSha256,
  url:`data/mars/crater_dust_scored.png?v=${imageSha256.slice(0,16)}`,width:grid.width,height:grid.height,...summary,
  scale:[0,1],palette:dustPalette,
  interpretation:'Couleurs calculees depuis dust_score sur une echelle visuelle fixe 0–1. Scores inchanges, sans renormalisation. Indice experimental non calibre, pas un niveau de danger.'}
 const imagePath=new URL('../public/data/mars/crater_dust_scored.png',import.meta.url)
 let previousImage;try{previousImage=await readFile(imagePath)}catch(e){if(e.code!=='ENOENT')throw e}
 if(!previousImage?.equals(image))await writeFile(imagePath,image)
 const output=new URL('../src/data/dust.generated.json',import.meta.url),serialized=JSON.stringify(metadata,null,2)+'\n'
 let previous='';try{previous=await readFile(output,'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
 if(previous!==serialized)await writeFile(output,serialized)
 return metadata
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const data=await prepareDust();console.log(`Dust : ${data.cells} cellules, scores conserves ${data.minimum}–${data.maximum}.`)
}
