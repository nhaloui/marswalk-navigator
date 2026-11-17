"""Reproject the crater into nested, common-extent Mars-local grids and verify outputs.

Run with .venv-dem/Scripts/python.exe extract_crater.py. Originals are read-only.
"""
from pathlib import Path
import hashlib
import json
import math

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform, transform_bounds

from calculate_slopes import export_dem, calculate_slope

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'public/data/mars'
LAT, LON, RADIUS = 40.8563, 22.03879, 3396190.0
BOUNDS = (-5000.0, -5000.0, 5000.0, 5000.0)
LOCAL = CRS.from_string(f'+proj=aeqd +lat_0={LAT} +lon_0={LON} +R={RADIUS} +x_0=0 +y_0=0 +units=m +no_defs')
GEO = CRS.from_string(f'+proj=longlat +R={RADIUS} +no_defs')
SOURCES = {
    'ctx': DATA / 'CTX_Ortho_40N022E_6mp_B18_016656_2206.tif',
    'dem': DATA / 'CTX_DEM_40N022E_24mp_B18_016656_2206_B18_016801_2206.tif',
}
OUTPUTS = {kind: DATA / f'crater_{kind}_10km_local.tif' for kind in SOURCES}
CSV = DATA / 'crater_altitudes_slopes_10km.csv'


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def statistics(values):
    return {'min': float(values.min()), 'max': float(values.max()), 'mean': float(values.mean())}


def main():
    test_rows, test_cols = np.indices((5, 5))
    spacing = 10000 / 417
    plane = spacing * (.3 * test_cols + .4 * test_rows)
    np.testing.assert_allclose(calculate_slope(plane, spacing, spacing), np.degrees(np.arctan(.5)), atol=1e-12)
    hashes = {kind: sha256(path) for kind, path in SOURCES.items()}
    ui_hashes = {str(p.relative_to(ROOT)): sha256(p) for p in (ROOT / 'src').rglob('*') if p.is_file()}
    x, y = transform(GEO, LOCAL, [LON], [LAT])
    assert abs(x[0]) < 1e-6 and abs(y[0]) < 1e-6
    lon, lat = transform(LOCAL, GEO, [0], [0])
    assert np.allclose([lon[0], lat[0]], [LON, LAT], rtol=0, atol=1e-10)
    report = {
        'center': {'planetocentric_latitude_N': LAT, 'longitude_E': LON, 'local_x_m': x[0], 'local_y_m': y[0]},
        'local_crs_wkt': LOCAL.to_wkt(), 'mars_sphere_radius_m': RADIUS,
        'bounds_m': BOUNDS, 'extent_m': [10000, 10000],
        'geographic_envelope_W_S_E_N': transform_bounds(LOCAL, GEO, *BOUNDS, densify_pts=1001),
        'method': 'Bilinear reprojection; full output grids; float32 values; NoData-aware; no vertical datum transformation.',
        'vertical_unit_assumption': 'Source DEM has no vertical unit tag; elevations interpreted as meters per supplied DEM convention. No independent vertical datum validation.',
        'resampling_effect': 'Interpolation changes sample elevations and gradients. Nearest comparison measures interpolation sensitivity, not accuracy or elevation uncertainty.',
        'projection_limit': 'AEQD preserves radial distances from center on the source Mars sphere, not every distance or topographic surface length. Maximum tangential scale excess in this square is approximately c/sin(c)-1, c=sqrt(2)*5000/R.',
        'max_tangential_scale_excess': (math.sqrt(2)*5000/RADIUS) / math.sin(math.sqrt(2)*5000/RADIUS) - 1,
        'rasters': {},
    }
    for kind, source_path in SOURCES.items():
        size = 1668 if kind == 'ctx' else 417
        grid = from_bounds(*BOUNDS, size, size)
        output = OUTPUTS[kind]
        assert output not in SOURCES.values()
        with rasterio.open(source_path) as src:
            assert src.count == 1 and src.crs.is_projected
            assert 'MARS' in src.crs.to_wkt().upper()
            # Same underlying Mars sphere: prevent an unnoticed Earth/ellipsoid conversion.
            source_geo = src.crs.to_dict()
            assert np.isclose(source_geo.get('R', source_geo.get('a', 0)), RADIUS)
            assert source_geo.get('b', RADIUS) == RADIUS
            assert src.dtypes[0] == 'float32'
            target = np.full((size, size), src.nodata, dtype=np.float32)
            kwargs = dict(src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
                          dst_transform=grid, dst_crs=LOCAL, dst_nodata=src.nodata,
                          num_threads=2, warp_mem_limit=128)
            print(f'Reprojecting {kind}: {size} x {size}', flush=True)
            reproject(rasterio.band(src, 1), target, resampling=Resampling.bilinear, **kwargs)
            profile = dict(driver='GTiff', width=size, height=size, count=1, dtype='float32',
                           crs=LOCAL, transform=grid, nodata=src.nodata, tiled=True,
                           blockxsize=256, blockysize=256, compress='deflate', predictor=3)
            with rasterio.open(output, 'w', **profile) as dst:
                dst.write(target, 1)
                dst.scales = src.scales
                dst.offsets = src.offsets
                if src.units[0]:
                    dst.set_band_unit(1, src.units[0])
                dst.update_tags(SOURCE_FILE=source_path.name, SOURCE_SHA256=hashes[kind],
                                RESAMPLING='bilinear', AREA_OR_POINT='Area',
                                COORDINATE_CONVENTION='Mars planetocentric latitude; east-positive longitude',
                                VERTICAL_REFERENCE='Source DEM reference unchanged; no vertical transformation' if kind == 'dem' else 'Optical intensity, not elevation')
                dst.update_tags(1, **src.tags(1))
            with rasterio.open(output) as check:
                a = check.read(1, masked=True)
                valid = ~np.ma.getmaskarray(a) & np.isfinite(a.data)
                assert check.crs == LOCAL and tuple(check.bounds) == BOUNDS
                assert check.width == check.height == size
                assert valid.all(), f'{kind}: invalid pixels in output'
                assert check.scales == src.scales and check.offsets == src.offsets
                np.testing.assert_array_equal(a.data, target)
                entry = {
                    'source': source_path.name, 'source_sha256': hashes[kind], 'output': output.name,
                    'width': size, 'height': size, 'resolution_m': check.res,
                    'bounds_m': list(check.bounds), 'transform': list(grid), 'valid_cells': int(valid.sum()),
                    'missing_cells': int((~valid).sum()), 'valid_percent': float(valid.mean()*100),
                    'values': statistics(a.data[valid]), 'source_vertical_unit_tag': src.units[0],
                    'source_scale': src.scales[0], 'source_offset': src.offsets[0],
                    'first_pixel_center_m': list(check.xy(0, 0)),
                    'last_pixel_center_m': list(check.xy(size-1, size-1)),
                }
                if kind == 'dem':
                    nearest = np.full_like(target, src.nodata)
                    reproject(rasterio.band(src, 1), nearest, resampling=Resampling.nearest, **kwargs)
                    assert np.all(np.isfinite(nearest) & (nearest != src.nodata))
                    delta = np.abs((target.astype(np.float64) - nearest.astype(np.float64))*src.scales[0])
                    entry['bilinear_vs_nearest_abs_difference_m'] = {
                        **statistics(delta), 'p50': float(np.percentile(delta,50)), 'p95': float(np.percentile(delta,95)),
                    }
                    bilinear_slopes = calculate_slope(target.astype(np.float64)*src.scales[0]+src.offsets[0], *check.res)
                    nearest_slopes = calculate_slope(nearest.astype(np.float64)*src.scales[0]+src.offsets[0], *check.res)
                    slope_delta = np.abs(bilinear_slopes-nearest_slopes)
                    entry['bilinear_vs_nearest_abs_slope_difference_deg'] = {
                        **statistics(slope_delta), 'p95': float(np.percentile(slope_delta,95)),
                    }
                report['rasters'][kind] = entry
    with rasterio.open(OUTPUTS['ctx']) as ctx, rasterio.open(OUTPUTS['dem']) as dem:
        assert ctx.crs == dem.crs and ctx.bounds == dem.bounds
        assert ctx.width == 4*dem.width and ctx.height == 4*dem.height
        assert np.isclose(dem.res[0], 4*ctx.res[0])
        z = dem.read(1).astype(np.float64)*dem.scales[0]+dem.offsets[0]
        expected_slopes = calculate_slope(z, *dem.res)
        dem_grid = dem.transform
    csv_meta = export_dem(OUTPUTS['dem'], CSV, expected_resolution=10000/417)
    table = np.loadtxt(CSV, delimiter=',', skiprows=1)
    rows, cols = np.indices((417,417))
    assert table.shape == (417*417, 6)
    np.testing.assert_array_equal(table[:,0], rows.ravel())
    np.testing.assert_array_equal(table[:,1], cols.ravel())
    np.testing.assert_allclose(table[:,2], (dem_grid.c+(cols+.5)*dem_grid.a).ravel(), rtol=0, atol=1e-9)
    np.testing.assert_allclose(table[:,3], (dem_grid.f+(rows+.5)*dem_grid.e).ravel(), rtol=0, atol=1e-9)
    np.testing.assert_allclose(table[:,4], z.ravel(), rtol=0, atol=1e-10)
    np.testing.assert_allclose(table[:,5], expected_slopes.ravel(), rtol=0, atol=1e-10)
    assert np.isfinite(table).all() and np.all((table[:,5]>=0)&(table[:,5]<90))
    report['csv'] = {'file': CSV.name, 'rows': len(table), 'bytes': CSV.stat().st_size,
                     'altitudes_m': csv_meta['elevation_range_m'], 'slopes_deg': csv_meta['slope_range_deg'],
                     'validation': 'Every row, coordinate, elevation and slope checked against the reprojected DEM.'}
    assert hashes == {kind: sha256(path) for kind, path in SOURCES.items()}
    assert ui_hashes == {str(p.relative_to(ROOT)): sha256(p) for p in (ROOT/'src').rglob('*') if p.is_file()}
    report['originals_and_src_unchanged'] = True
    (DATA/'crater_extraction_report.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
