import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'
import {parseDustCSV,dustCsv,dustColor} from './prepare-dust-assets.mjs'
const text=await readFile(dustCsv,'utf8')
const grid=JSON.parse(await readFile(new URL('../src/data/terrain.generated.json',import.meta.url)))
const metadata=JSON.parse(await readFile(new URL('../src/data/dust.generated.json',import.meta.url)))
const parsed=parseDustCSV(text,grid)
assert.equal(parsed.cells,173889)
assert.deepEqual(parsed.classes,metadata.classes)
assert.equal(metadata.sha256,createHash('sha256').update(text).digest('hex'))
assert.equal(metadata.maximum,.2) // Preserve the dataset range on the fixed 0-1 display scale.
assert.deepEqual(metadata.classes.map(c=>c.score),[0,1/15,2/15,.2])
const image=await readFile(fileURLToPath(new URL('../public/data/mars/crater_dust_scored.png',import.meta.url)))
assert.equal(metadata.imageSha256,createHash('sha256').update(image).digest('hex'))
assert.ok(metadata.url.endsWith(metadata.imageSha256.slice(0,16)))
const png=await sharp(image).ensureAlpha().raw().toBuffer()
assert.deepEqual(png,parsed.rgba) // Every displayed cell matches its score, in the original position.
assert.deepEqual(metadata.scale,[0,1])
assert.deepEqual(dustColor(0),[42,222,255])
assert.deepEqual(dustColor(.2),[43,241,253])
assert.deepEqual(dustColor(1),[39,212,20])
const header='row,col,x_m,y_m,band_1_red,band_2_green,band_3_blue,dust_score\n'
const tiny={width:2,height:1,transform:[1,0,0,0,-1,1]}
const csv=header+'0,0,0.5,0.5,42,222,255,0\n0,1,1.5,0.5,39,212,20,0.2'
assert.equal(parseDustCSV(csv,tiny).maximum,.2)
assert.equal(parseDustCSV(csv.replace(',0.2',',0.1'),tiny).maximum,.1)
assert.deepEqual([...parseDustCSV(csv,tiny).rgba.slice(4,7)],[43,241,253])
// Old display colors must have no influence when the scores are unchanged.
assert.deepEqual(parseDustCSV(csv.replace('39,212,20','255,0,0'),tiny).rgba,parseDustCSV(csv,tiny).rgba)
const equalScores=csv.replace(',0.2',',0')
assert.deepEqual([...parseDustCSV(equalScores,tiny).rgba.slice(0,4)],[...parseDustCSV(equalScores,tiny).rgba.slice(4,8)])
assert.throws(()=>parseDustCSV(csv.replace(',0.2',',1.2'),tiny))
assert.throws(()=>parseDustCSV(csv.replace('0,1,1.5','0,0,1.5'),tiny))
assert.throws(()=>parseDustCSV(csv.replace('1.5,0.5','1.6,0.5'),tiny))
assert.throws(()=>parseDustCSV(csv.replace(',0.2',','),tiny))
console.log('PASS: supplied scores unchanged; low scores use nearby colors on fixed 0–1 scale; original RGB ignored; PNG/cache/legend aligned; invalid data rejected.')
