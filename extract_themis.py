r"""Windowed extraction of qualitative THEMIS NightIR, aligned to the existing DEM.

No full-image read, no temperature conversion, no overwrite. Run with:
    .venv-dem\Scripts\python.exe extract_themis.py
"""
from pathlib import Path
import csv
import hashlib
from itertools import zip_longest
import json
import math
import os
import subprocess
import tempfile

import numpy as np
import rasterio
from rasterio.enums import MaskFlags, Resampling
from rasterio.warp import reproject, transform, transform_bounds
from rasterio.windows import Window, from_bounds

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'public/data/mars'
SOURCE = DATA / 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018.tif'
DEM = DATA / 'crater_dem_10km_local.tif'
REFERENCE_CSV = DATA / 'crater_altitudes_slopes_10km.csv'
OUTPUT = DATA / 'crater_themis_nightir_10km_local.tif'
CSV = DATA / 'crater_themis_nightir_10km.csv'
REPORT = DATA / 'crater_themis_nightir_10km.metadata.json'
MEMORY_MIB = 16
MEANING = ('Qualitative 8-bit THEMIS controlled nighttime infrared mosaic DN; '
           'not Celsius, kelvin, calibrated brightness temperature or a hazard score.')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def identity(path):
    stat = path.stat()
    return {'bytes': stat.st_size, 'mtime_ns': stat.st_mtime_ns}


def histogram(values):
    bins = np.bincount(values.ravel(), minlength=256)
    return {str(i): int(n) for i, n in enumerate(bins) if n}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def inherit_directory_permissions(path):
    """Keep Windows staging files accessible to the workspace's normal user.

    Python's private TemporaryDirectory ACL otherwise survives os.link(), which
    can leave published files readable only by the sandbox account. Restore
    inheritance on this new staging directory before creating any output file.
    Only the staging directory is changed; no recursive ACL reset is performed.
    """
    if os.name == 'nt':
        subprocess.run(['icacls.exe', str(path), '/inheritance:e'],
                       check=True, capture_output=True)


def main():
    for path in (OUTPUT, CSV, REPORT):
        if path.exists():
            raise FileExistsError(f'Refusing to overwrite {path}')
    source_before = identity(SOURCE)
    # Do not hash/read the 16.44 GB source: only its requested pixel window is read.
    protected = [p for p in DATA.iterdir() if p.is_file() and p != SOURCE]
    protected.extend(p for p in (ROOT / 'src').rglob('*') if p.is_file())
    before = {str(p.relative_to(ROOT)): digest(p) for p in protected}

    with rasterio.Env(GDAL_CACHEMAX=MEMORY_MIB * 1024**2, GDAL_NUM_THREADS='1'):
        with rasterio.open(SOURCE) as src, rasterio.open(DEM) as dem:
            require(src.count == 1 and src.dtypes == ('uint8',) and src.nodata == 0,
                    'Unexpected source band/type/NoData')
            require(src.mask_flag_enums[0] == [MaskFlags.nodata], 'Unexpected source mask')
            require(src.crs is not None and dem.crs is not None, 'Missing CRS')
            require(dem.shape == (417, 417) and tuple(dem.bounds) == (-5000., -5000., 5000., 5000.),
                    'Unexpected reference DEM grid')
            require(src.transform.b == 0 and src.transform.d == 0, 'Source must be north-up')
            require(src.crs.to_dict().get('R') == dem.crs.to_dict().get('R') == 3396190,
                    'Unexpected Mars reference sphere')
            rows, cols = np.indices(dem.shape)
            grid = dem.transform
            x = grid.c + (cols + .5) * grid.a + (rows + .5) * grid.b
            y = grid.f + (cols + .5) * grid.d + (rows + .5) * grid.e
            sx, sy = transform(dem.crs, src.crs, x.ravel().tolist(), y.ravel().tolist())
            inv = ~src.transform
            sx, sy = np.asarray(sx).reshape(dem.shape), np.asarray(sy).reshape(dem.shape)
            # Pixel coordinates are relative to edges: floor selects nearest center.
            source_cols = np.floor(inv.a * sx + inv.b * sy + inv.c).astype(np.int64)
            source_rows = np.floor(inv.d * sx + inv.e * sy + inv.f).astype(np.int64)
            require(bool(((source_cols >= 0) & (source_cols < src.width) &
                          (source_rows >= 0) & (source_rows < src.height)).all()),
                    'Some destination cell centers lie outside the source')

            bounds = transform_bounds(dem.crs, src.crs, *dem.bounds, densify_pts=100)
            needed = from_bounds(*bounds, transform=src.transform)
            # Two-pixel margin protects the reprojection boundary; source index
            # extrema also included explicitly, independent of edge densification.
            left = max(0, min(math.floor(needed.col_off), int(source_cols.min())) - 2)
            top = max(0, min(math.floor(needed.row_off), int(source_rows.min())) - 2)
            right = min(src.width, max(math.ceil(needed.col_off + needed.width), int(source_cols.max()) + 1) + 2)
            bottom = min(src.height, max(math.ceil(needed.row_off + needed.height), int(source_rows.max()) + 1) + 2)
            window = Window(left, top, right - left, bottom - top)
            print(f'Reading only source window {window}, not the full image.', flush=True)
            raw = src.read(1, window=window)
            local_rows, local_cols = source_rows - top, source_cols - left
            expected = raw[local_rows, local_cols]
            destination = np.zeros(dem.shape, dtype=np.uint8)
            reproject(source=raw, destination=destination,
                      src_transform=src.window_transform(window), src_crs=src.crs, src_nodata=0,
                      dst_transform=grid, dst_crs=dem.crs, dst_nodata=0,
                      resampling=Resampling.nearest, num_threads=1,
                      warp_mem_limit=MEMORY_MIB, tolerance=0.0)
            np.testing.assert_array_equal(destination, expected,
                                          err_msg='GDAL nearest differs from inverse-mapped source cell')
            valid = destination != 0
            pairs = np.unique(np.column_stack((source_rows.ravel(), source_cols.ravel())), axis=0)
            contributing_values = raw[pairs[:, 0] - top, pairs[:, 1] - left]
            valid_source = contributing_values[contributing_values != 0]
            valid_output = destination[valid]

            with tempfile.TemporaryDirectory(prefix='.themis-extract-', dir=DATA) as temporary:
                work = Path(temporary)
                inherit_directory_permissions(work)
                out_tif, out_csv, out_report = (work / p.name for p in (OUTPUT, CSV, REPORT))
                profile = dict(driver='GTiff', count=1, dtype='uint8', nodata=0,
                               width=dem.width, height=dem.height, crs=dem.crs, transform=grid,
                               tiled=True, blockxsize=256, blockysize=256, compress='deflate')
                with rasterio.open(out_tif, 'w', **profile) as dst:
                    dst.write(destination, 1)
                    dst.set_band_description(1, 'THEMIS NightIR qualitative mosaic value (DN)')
                    dst.update_tags(SOURCE_FILE=SOURCE.name, VALUE_MEANING=MEANING,
                                    RESAMPLING='nearest', GRID_REFERENCE=DEM.name,
                                    COORDINATE_CONVENTION='Mars planetocentric latitude; east-positive longitude',
                                    NODATA_MEANING='0 is missing data, not a valid measurement',
                                    INDEPENDENCE='Upsampled grid; repeated source values are not independent measurements')
                with REFERENCE_CSV.open(newline='') as reference, out_csv.open('x', newline='') as output:
                    reader, writer = csv.DictReader(reference), csv.writer(output)
                    writer.writerow(['row', 'col', 'x_m', 'y_m', 'thermal_value', 'valid'])
                    count = 0
                    for count, cell in enumerate(reader, start=1):
                        r, c = divmod(count - 1, dem.width)
                        require(r < dem.height and int(cell['row']) == r and int(cell['col']) == c,
                                'Reference CSV cell order differs from DEM')
                        require(float(cell['x_m']) == x[r, c] and float(cell['y_m']) == y[r, c],
                                'Reference CSV coordinates differ from DEM cell center')
                        writer.writerow([cell[k] for k in ('row', 'col', 'x_m', 'y_m')] +
                                        [int(destination[r, c]) if valid[r, c] else '', int(valid[r, c])])
                    require(count == dem.width * dem.height == 173889, 'Wrong reference row count')

                # Read back both saved outputs and independently compare every cell.
                with rasterio.open(out_tif) as check:
                    require(check.crs == dem.crs and check.transform == grid and
                            check.bounds == dem.bounds and check.shape == dem.shape,
                            'Saved raster grid differs from DEM')
                    require(check.nodata == 0 and check.dtypes == ('uint8',), 'Wrong output type/NoData')
                    np.testing.assert_array_equal(check.read(1), expected)
                    np.testing.assert_array_equal(check.read_masks(1) > 0, valid)
                with REFERENCE_CSV.open(newline='') as ref, out_csv.open(newline='') as saved:
                    ref_reader, saved_reader = csv.DictReader(ref), csv.DictReader(saved)
                    count = 0
                    for count, (a, b) in enumerate(zip_longest(ref_reader, saved_reader), start=1):
                        require(a is not None and b is not None, 'CSV lengths differ')
                        require(all(a[k] == b[k] for k in ('row', 'col', 'x_m', 'y_m')),
                                'CSV coordinates or ordering changed')
                        r, c = divmod(count - 1, dem.width)
                        require(int(b['valid']) == int(valid[r, c]), 'CSV validity differs')
                        require(b['thermal_value'] == (str(int(expected[r, c])) if valid[r, c] else ''),
                                'CSV values differ from nearest source pixel')
                    require(count == 173889, 'Wrong saved CSV row count')

                after = {str(p.relative_to(ROOT)): digest(p) for p in protected}
                require(before == after, 'An existing data/frontend file changed during extraction')
                require(source_before == identity(SOURCE), 'Source size or modification time changed')
                minimum = int(valid_output.min()) if valid_output.size else None
                maximum = int(valid_output.max()) if valid_output.size else None
                report = {
                    'source': {'file': SOURCE.name, **source_before, 'dimensions': [src.width, src.height],
                               'crs_wkt': src.crs.to_wkt(), 'transform': list(src.transform),
                               'nodata': src.nodata, 'dtype': src.dtypes[0],
                               'block_shapes': src.block_shapes, 'band_description': src.descriptions[0],
                               'units': src.units[0], 'scale': src.scales[0], 'offset': src.offsets[0],
                               'window': {'col_off': left, 'row_off': top, 'width': int(window.width), 'height': int(window.height)},
                               'window_array_bytes': raw.nbytes,
                               'window_sha256': hashlib.sha256(raw.tobytes()).hexdigest(),
                               'scanline_block_bytes': src.width,
                               'estimated_scanline_bytes_touched': int(window.height) * src.width,
                               'full_source_read': False,
                               'unchanged_check': 'Read-only open; identical byte size and mtime_ns before/after. No full-source hash, to avoid reading 16.44 GB.'},
                    'grid': {'reference': DEM.name, 'width': dem.width, 'height': dem.height,
                             'crs_wkt': dem.crs.to_wkt(), 'transform': list(grid), 'bounds': list(dem.bounds),
                             'resolution_m': list(dem.res), 'resampling': 'nearest',
                             'warp_approximation_tolerance_pixels': 0.0},
                    'memory': {'gdal_cache_mib': MEMORY_MIB, 'warp_memory_limit_mib': MEMORY_MIB,
                               'threads': 1, 'note': 'Cache and warp limits are separate, not a total process RAM limit. Only the small window and destination-sized arrays are allocated.'},
                    'statistics': {'csv_rows': count, 'valid_cells': int(valid.sum()),
                                   'nodata_cells': int((~valid).sum()), 'valid_percent': 100 * float(valid.mean()),
                                   'minimum_valid': minimum, 'maximum_valid': maximum,
                                   'distinct_source_pixels_sampled': len(pairs),
                                   'valid_distinct_source_pixels': int(np.count_nonzero(contributing_values)),
                                   'nodata_distinct_source_pixels': int(np.count_nonzero(contributing_values == 0)),
                                   'distinct_valid_values': len(np.unique(valid_source)),
                                   'histogram_unique_contributing_source_pixels': histogram(valid_source),
                                   'histogram_output_cells_repeated_samples': histogram(valid_output)},
                    'csv_schema': {'columns': ['row', 'col', 'x_m', 'y_m', 'thermal_value', 'valid'],
                                   'indexing': 'Zero-based row-major; x/y at DEM cell centers, copied verbatim from reference CSV',
                                   'missing': 'thermal_value is empty and valid=0 for NoData; otherwise valid=1'},
                    'interpretation': MEANING,
                    'limitations': ['No calibrated temperature or automatic hotter/safer ordering.',
                                    '417x417 output cells are not independent thermal measurements.',
                                    'Reprojection aligns grids; it does not remove source geolocation uncertainty or create finer spatial detail.',
                                    'Source acquisition times and per-pixel temporal provenance are not supplied.'],
                    'verification': {'grid_exact': True, 'csv_every_cell_exact': True,
                                     'raster_every_cell_equals_inverse_nearest': True, 'nodata_mask_exact': True,
                                     'protected_file_hashes': before, 'protected_files_unchanged': True},
                    'files': {OUTPUT.name: {'bytes': out_tif.stat().st_size, 'sha256': digest(out_tif)},
                              CSV.name: {'bytes': out_csv.stat().st_size, 'sha256': digest(out_csv)}},
                    'documentation': 'https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/'
                }
                out_report.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8')
                # Exclusive hard-link publication: fails rather than overwriting any
                # existing final path, including one created since the initial check.
                published = []
                try:
                    for temporary_path, final in ((out_tif, OUTPUT), (out_csv, CSV), (out_report, REPORT)):
                        os.link(temporary_path, final)
                        published.append(final)
                except Exception:
                    for own_file in published:
                        own_file.unlink()
                    raise
                print(json.dumps({'files': {p.name: p.stat().st_size for p in (OUTPUT, CSV, REPORT)},
                                  'statistics': {k: v for k, v in report['statistics'].items()
                                                 if not k.startswith('histogram_')},
                                  'verification': 'PASS: exact grid, all CSV cells, inverse-nearest values, NoData and preserved originals.'}, indent=2))


if __name__ == '__main__':
    main()
