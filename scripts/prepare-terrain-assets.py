import json,hashlib,csv
from pathlib import Path
import numpy as np
import rasterio
from rasterio.io import MemoryFile
root=Path.cwd(); d=root/'public/data/mars'
def hashfile(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
protected={p.name:hashfile(p) for p in d.glob('*.tif')}
protected.update({p.name:hashfile(p) for p in d.glob('*.csv')})
def png(path,array):
 with MemoryFile() as m:
  with m.open(driver='PNG',width=array.shape[2],height=array.shape[1],count=array.shape[0],dtype='uint8') as o:o.write(array)
  m.seek(0);path.write_bytes(m.read())
with rasterio.open(d/'crater_dem_10km_local.tif') as dem,rasterio.open(d/'crater_tes_dust_10km_local.tif') as dust:
 assert dem.crs==dust.crs and dem.transform==dust.transform
 z=dem.read(1,masked=True).astype('float32').filled(np.nan)*dem.scales[0]+dem.offsets[0]
 (d/'crater_elevation.f32').write_bytes(z.astype('<f4').tobytes())
 valid=np.isfinite(z);lo=float(z[valid].min());hi=float(z[valid].max())
 # Explicit display gradient only; altitude precision remains in float32 binary.
 stops=np.array([[38,62,70],[100,135,133],[187,166,119],[239,222,185]],dtype=float)
 t=np.clip((z-lo)/(hi-lo),0,1)*3;i=np.minimum(np.nan_to_num(t).astype(int),2);f=np.nan_to_num(t)-i
 rgb=np.round(stops[i]*(1-f[...,None])+stops[i+1]*f[...,None]).clip(0,255).astype('uint8')
 rgba=np.concatenate([rgb,np.where(valid,255,0).astype('uint8')[...,None]],axis=2)
 png(d/'crater_elevation_color.png',rgba.transpose(2,0,1))
 a=dust.read();png(d/'crater_tes_dust.png',np.concatenate([a,dust.dataset_mask()[None,:,:]],axis=0))
 meta={'width':dem.width,'height':dem.height,'bounds':list(dem.bounds),'transform':list(dem.transform),'minimum':lo,'maximum':hi,'units':'m (source convention; no vertical unit tag)','originElevation':float(np.nanmedian(z)),'binary':'data/mars/crater_elevation.f32','dust':'data/mars/crater_tes_dust.png','elevationTexture':'data/mars/crater_elevation_color.png','nodata':'NaN','endianness':'little','crsWkt':dem.crs.to_wkt(),'sourceHashes':protected,'dustExperimental':True,'dustRegistration':'Declared source CRS; source latitude convention needs provenance confirmation.'}
 (root/'src/data/terrain.generated.json').write_text(json.dumps(meta,indent=2)+'\n')
assert protected=={name:hashfile(d/name) for name in protected}
print('Assets generated: float32 elevations, exact RGB dust, display-only elevation gradient. Sources unchanged.')
