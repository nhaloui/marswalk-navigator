"""Create display-only hillshade from the existing local DEM, without changing it."""
import hashlib
import json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.io import MemoryFile

root = Path(__file__).resolve().parents[1]
data = root / 'public/data/mars'
files = [data/'crater_ctx_10km_local.tif', data/'crater_dem_10km_local.tif', data/'crater_altitudes_slopes_10km.csv']
def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
before = {p.name: digest(p) for p in files}
with rasterio.open(files[0]) as ctx, rasterio.open(files[1]) as dem:
    assert ctx.crs == dem.crs and ctx.bounds == dem.bounds
    assert tuple(dem.bounds) == (-5000., -5000., 5000., 5000.)
    elevation = dem.read(1, masked=True).astype(np.float64).filled(np.nan)
    elevation = elevation*dem.scales[0]+dem.offsets[0]
    assert np.isfinite(elevation).all()
    # Derivative signs follow north-up projected axes: array rows increase southward.
    south_gradient, east_gradient = np.gradient(elevation, dem.res[1], dem.res[0])
    north_gradient = -south_gradient
    azimuth, altitude = np.radians(315.), np.radians(45.)
    light_east = np.sin(azimuth)*np.cos(altitude)
    light_north = np.cos(azimuth)*np.cos(altitude)
    light_up = np.sin(altitude)
    intensity = (-east_gradient*light_east-north_gradient*light_north+light_up)/np.sqrt(1+east_gradient**2+north_gradient**2)
    shade = np.round(np.clip(intensity,0,1)*255).astype('uint8')
    # Test lighting independently: flat surface intensity is sin(45 degrees).
    assert np.isclose(light_up, np.sqrt(.5))
    with MemoryFile() as memory:
        with memory.open(driver='PNG',width=dem.width,height=dem.height,count=1,dtype='uint8') as png:
            png.write(shade,1)
        memory.seek(0)
        (data/'crater_hillshade.png').write_bytes(memory.read())
    metadata = {'bounds_m':list(dem.bounds),'center':{'latitude_N':40.8563,'longitude_E':22.03879},
                'crs_wkt':dem.crs.to_wkt(),'hillshade':{'url':'data/mars/crater_hillshade.png','width':dem.width,'height':dem.height,'azimuth_deg':315,'altitude_deg':45,'vertical_exaggeration':1,'method':'Lambertian illumination from DEM finite-difference normals; no cast-shadow simulation'},
                'source_hashes':before}
assert before == {p.name: digest(p) for p in files}
(root/'src/data/crater.generated.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
print('DEM hillshade generated; CTX, DEM and crater CSV hashes unchanged.')
