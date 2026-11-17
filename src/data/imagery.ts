import source from '@/config/imagery.json'
import metadata from '@/data/imagery.generated.json'
import crater from '@/data/crater.generated.json'

if (source.id !== metadata.id || source.previewUrl !== metadata.preview.url) {
  throw new Error('Imagery configuration changed. Run npm run imagery:prepare before starting the app.')
}
if (!crater.bounds_m.every((value, i) => value === metadata.source.bounds[i]) || metadata.source.width !== metadata.source.height) {
  throw new Error('CTX and hillshade must have the same local extent and orientation.')
}
export const imagery = {
  ...source, ...metadata,
  region:'Deuteronilus Mensae · Deuteronius Landform',
  bounds: crater.bounds_m,
  url: `${import.meta.env.BASE_URL}${metadata.preview.url}`,
  hillshadeUrl: `${import.meta.env.BASE_URL}${crater.hillshade.url}`,
}
