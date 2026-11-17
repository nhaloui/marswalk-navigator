import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromFile } from 'geotiff'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse((await readFile(path.join(root, 'src/config/imagery.json'), 'utf8')).replace(/^\uFEFF/, ''))
const input = path.resolve(root, config.sourceFile)
const output = path.resolve(root, 'public', config.previewUrl)
const tiff = await fromFile(input)
try {
  const image = await tiff.getImage()
  const directory = image.getFileDirectory()
  const width = image.getWidth(), height = image.getHeight()
  const resolution = image.getResolution()
  const scale = directory.getValue('ModelPixelScale')
  const matrix = directory.getValue('ModelTransformation')
  if (image.getSamplesPerPixel() !== 1) throw new Error('This optical preview processor expects a single band; review the new source before processing.')
  if (!scale || matrix || Math.abs(resolution[0]) !== Math.abs(resolution[1])) throw new Error('Only north-up square-pixel rasters are supported. Reproject other sources with a planetary-aware GIS first.')
  if (directory.getValue('Orientation') && directory.getValue('Orientation') !== 1) throw new Error('Review raster orientation before processing.')
  const ratio = Math.min(1, config.maxPreviewEdge / Math.max(width, height))
  const previewWidth = Math.round(width * ratio), previewHeight = Math.round(height * ratio)
  const nodata = image.getGDALNoData()
  const values = new Float32Array(previewWidth * previewHeight)
  // Decode small source windows: bounded memory, NoData-aware nearest sampling.
  // No reprojection, crop, fill, AI imagery or topographic inference.
  for (let y = 0; y < previewHeight; y += 64) {
    const rows = Math.min(64, previewHeight - y)
    const samples = await image.readRasters({
      samples: [0], interleave: true,
      window: [0, Math.floor(y * height / previewHeight), width, Math.floor((y + rows) * height / previewHeight)],
      width: previewWidth, height: rows, resampleMethod: 'nearest',
    })
    values.set(samples, y * previewWidth)
  }
  const valid = v => Number.isFinite(v) && v !== nodata
  const sample = []
  const step = Math.max(1, Math.floor(values.length / 200000))
  for (let i = 0; i < values.length; i += step) if (valid(values[i])) sample.push(values[i])
  sample.sort((a, b) => a - b)
  if (!sample.length) throw new Error('Source contains no valid preview pixels')
  const low = sample[Math.floor((sample.length - 1) * .02)]
  const high = sample[Math.floor((sample.length - 1) * .98)]
  if (high <= low) throw new Error('Insufficient radiometric range for an optical preview')
  const rgba = Buffer.alloc(values.length * 4)
  let validCount = 0
  for (let i = 0; i < values.length; i++) {
    if (!valid(values[i])) continue
    const gray = Math.round(Math.max(0, Math.min(1, (values[i] - low) / (high - low))) * 255)
    rgba[i * 4] = gray; rgba[i * 4 + 1] = gray; rgba[i * 4 + 2] = gray; rgba[i * 4 + 3] = 255
    validCount++
  }
  await mkdir(path.dirname(output), { recursive: true })
  await sharp(rgba, { raw: { width: previewWidth, height: previewHeight, channels: 4 } }).webp({ quality: config.previewQuality ?? 88, alphaQuality: 100, effort: 5 }).toFile(output)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(input)) hash.update(chunk)
  const metadata = {
    id: config.id,
    source: { filename: path.basename(input), bytes: (await stat(input)).size, sha256: hash.digest('hex'), width, height,
      bands: image.getSamplesPerPixel(), bitsPerSample: Array.from(directory.getValue('BitsPerSample')), sampleFormat: Array.from(directory.getValue('SampleFormat')), compression: directory.getValue('Compression'), nodata,
      origin: image.getOrigin(), resolution, bounds: image.getBoundingBox(), geoKeys: image.getGeoKeys(),
      pixelScale: Array.from(scale), tiepoint: Array.from(directory.getValue('ModelTiepoint') ?? []),
    },
    preview: { url: config.previewUrl, width: previewWidth, height: previewHeight, bytes: (await stat(output)).size, resampling: 'nearest, full extent; no reprojection', stretch: { percentiles: [2, 98], low, high }, validFraction: validCount / values.length, nodata: 'transparent alpha', webpQuality: config.previewQuality ?? 88 },
    display: { coordinates: 'normalized image percentages, x right / y down', projection: 'Source projected image only; no Mars lat/lon transformation in the UI', terrain: 'Optical intensity only; not elevation or slope' },
  }
  await writeFile(path.join(root, 'src/data/imagery.generated.json'), JSON.stringify(metadata, null, 2) + '\n')
  console.log(JSON.stringify(metadata, null, 2))
} finally { await tiff.close() }

