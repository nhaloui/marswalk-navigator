"""Export every DEM cell and its planar slope; never fill or resample NoData.

Run: .venv-dem\\Scripts\\python.exe calculate_slopes.py
Coordinates are projected pixel centers, not longitude/latitude.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parent
DEM = ROOT / 'public/data/mars/CTX_DEM_40N022E_24mp_B18_016656_2206_B18_016801_2206.tif'
OUTPUT = ROOT / 'public/data/mars/mars_slopes.csv'


def calculate_slope(elevations: np.ndarray, dx: float, dy: float) -> np.ndarray:
    """Central finite differences; first-order one-sided differences at raster edges.

    Missing neighbors propagate NaN. Missing elevations always have missing slopes.
    Do not interpret an unknown slope as zero or as traversable.
    """
    dz_dy, dz_dx = np.gradient(elevations, dy, dx, edge_order=1)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    slope[~np.isfinite(elevations)] = np.nan
    return slope


def export_dem(source: Path, output: Path, block_rows: int = 256, expected_resolution: float = 24.0) -> dict:
    if source.resolve() == output.resolve():
        raise ValueError('Source and output must differ')
    if block_rows < 1:
        raise ValueError('block_rows must be positive')
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.csv.partial')
    stats = {'cells': 0, 'valid_elevations': 0, 'valid_slopes': 0}
    elevation_min, elevation_max = np.inf, -np.inf
    slope_min, slope_max = np.inf, -np.inf
    try:
        with rasterio.open(source) as dataset:
            transform = dataset.transform
            if dataset.count != 1 or min(dataset.width, dataset.height) < 2:
                raise ValueError('Expected a single-band DEM with at least two rows and columns')
            if not dataset.crs or not dataset.crs.is_projected:
                raise ValueError('A projected CRS is required; angular degrees are not meter spacings')
            if dataset.crs.linear_units.lower() not in ('metre', 'meter', 'metres', 'meters'):
                raise ValueError('Projected units must be meters')
            if transform.b != 0 or transform.d != 0 or transform.a <= 0 or transform.e >= 0:
                raise ValueError('Expected a north-up DEM without rotated/skewed pixels')
            dx, dy = abs(transform.a), abs(transform.e)
            if not np.allclose([dx, dy], [expected_resolution, expected_resolution], rtol=0, atol=1e-6):
                raise ValueError(f'Expected {expected_resolution} m cells; found {dx}, {dy}. Review the source.')
            units = dataset.units[0]
            if units and units.lower() not in ('m', 'metre', 'meter', 'metres', 'meters'):
                raise ValueError(f'Unsupported elevation unit: {units}')
            print(json.dumps({'width': dataset.width, 'height': dataset.height,
                              'resolution_m': [dx, dy], 'nodata': dataset.nodata,
                              'elevation_unit_tag': units, 'crs': str(dataset.crs)}, indent=2), flush=True)
            cols = np.arange(dataset.width, dtype=np.int64)
            with temporary.open('w', encoding='utf-8', newline='') as csv:
                csv.write('row,col,x_m,y_m,elevation_m,slope_deg\n')
                for start in range(0, dataset.height, block_rows):
                    end = min(start + block_rows, dataset.height)
                    # One-row halos make derivatives independent of processing blocks.
                    top, bottom = max(0, start - 1), min(dataset.height, end + 1)
                    masked = dataset.read(1, window=Window(0, top, dataset.width, bottom - top), masked=True)
                    elevations = masked.astype(np.float64).filled(np.nan)
                    elevations = elevations * dataset.scales[0] + dataset.offsets[0]
                    elevations[~np.isfinite(elevations)] = np.nan
                    slopes = calculate_slope(elevations, dx, dy)
                    for row in range(start, end):
                        z = elevations[row - top]
                        slope = slopes[row - top]
                        x = transform.c + (cols + .5) * transform.a
                        y = np.full(dataset.width, transform.f + (row + .5) * transform.e)
                        values = np.column_stack((np.full(dataset.width, row), cols, x, y, z, slope))
                        np.savetxt(csv, values, delimiter=',', fmt=['%d', '%d', '%.17g', '%.17g', '%.17g', '%.17g'])
                        valid_z, valid_s = z[np.isfinite(z)], slope[np.isfinite(slope)]
                        stats['cells'] += dataset.width
                        stats['valid_elevations'] += int(valid_z.size)
                        stats['valid_slopes'] += int(valid_s.size)
                        if valid_z.size:
                            elevation_min = min(elevation_min, float(valid_z.min()))
                            elevation_max = max(elevation_max, float(valid_z.max()))
                        if valid_s.size:
                            slope_min = min(slope_min, float(valid_s.min()))
                            slope_max = max(slope_max, float(valid_s.max()))
                    print(f'Rows {end}/{dataset.height}', flush=True)
            metadata = {
                'source': source.name, 'width': dataset.width, 'height': dataset.height,
                'resolution_m': [dx, dy], 'source_nodata': dataset.nodata,
                'source_elevation_unit_tag': units,
                'elevation_units': 'meters (source DEM values, scale and offset applied)',
                'source_scale': dataset.scales[0], 'source_offset': dataset.offsets[0],
                'crs_wkt': dataset.crs.to_wkt(), 'transform': list(transform),
                'coordinates': 'Projected pixel centers; zero-based row and col; row-major order',
                'method': 'degrees(arctan(hypot(dz/dx, dz/dy))); NumPy central differences, first-order raster edges',
                'missing': 'nan; every cell retained; missing neighbors propagate to derivatives; no interpolation',
                'limitations': 'Planar slopes using actual projected pixel spacing; no projection-scale correction, uncertainty or traversability assessment. Unknown slopes must not be treated as zero by A*.',
                **stats,
                'elevation_range_m': [elevation_min, elevation_max] if stats['valid_elevations'] else None,
                'slope_range_deg': [slope_min, slope_max] if stats['valid_slopes'] else None,
            }
        temporary.replace(output)
        output.with_suffix('.metadata.json').write_text(json.dumps(metadata, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        print(json.dumps(stats), flush=True)
        print(f'CSV: {output} ({output.stat().st_size:,} bytes)', flush=True)
        return metadata
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dem', type=Path, default=DEM)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--block-rows', type=int, default=256)
    parser.add_argument('--expected-resolution', type=float, default=24.0)
    args = parser.parse_args()
    export_dem(args.dem, args.output, args.block_rows, args.expected_resolution)
