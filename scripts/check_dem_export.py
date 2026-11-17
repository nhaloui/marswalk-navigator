"""Numerical and full CSV checks for the offline DEM export."""
import csv
import json
from pathlib import Path
import sys
import tempfile

import numpy as np
import rasterio
from rasterio.transform import from_origin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from calculate_slopes import DEM, OUTPUT, calculate_slope, export_dem


def check():
    rows, cols = np.indices((7, 8))
    plane = cols * 24 * .3 + rows * 24 * .4
    expected = np.degrees(np.arctan(.5))
    np.testing.assert_allclose(calculate_slope(plane, 24, 24), expected, atol=1e-12)
    np.testing.assert_allclose(calculate_slope(np.zeros((7, 8)), 24, 24), 0)
    plane[3, 4] = np.nan
    slopes = calculate_slope(plane, 24, 24)
    assert np.isnan(slopes[3, 4]) and np.isnan(slopes[3, 3]) and np.isnan(slopes[2, 4])
    with rasterio.open(DEM) as source:
        crs = source.crs
        width, height, transform = source.width, source.height, source.transform
    with tempfile.TemporaryDirectory() as folder:
        dem = Path(folder) / 'test.tif'
        out = Path(folder) / 'test.csv'
        with rasterio.open(dem, 'w', driver='GTiff', height=7, width=8, count=1,
                           dtype='float64', crs=crs, transform=from_origin(100, 500, 24, 24), nodata=-32767) as dst:
            dst.write(np.where(np.isfinite(plane), plane, -32767), 1)
        export_dem(dem, out, block_rows=2)
        values = np.loadtxt(out, delimiter=',', skiprows=1)
        np.testing.assert_allclose(values[:, 4].reshape(7, 8), plane, equal_nan=True)
        np.testing.assert_allclose(values[:, 5].reshape(7, 8), slopes, equal_nan=True)
        np.testing.assert_allclose(values[0, 2:4], [112, 488])
        np.testing.assert_allclose(values[-1, 2:4], [280, 344])
    metadata = json.loads(OUTPUT.with_suffix('.metadata.json').read_text())
    counts = [0, 0]
    with OUTPUT.open(newline='', encoding='utf-8') as stream:
        reader = csv.reader(stream)
        assert next(reader) == ['row', 'col', 'x_m', 'y_m', 'elevation_m', 'slope_deg']
        count = 0
        for count, record in enumerate(reader, 1):
            row, col = divmod(count - 1, width)
            assert int(record[0]) == row and int(record[1]) == col
            assert float(record[2]) == transform.c + (col + .5) * transform.a
            assert float(record[3]) == transform.f + (row + .5) * transform.e
            z, slope = float(record[4]), float(record[5])
            counts[0] += int(np.isfinite(z))
            counts[1] += int(np.isfinite(slope))
            if not np.isfinite(z):
                assert np.isnan(slope)
            if np.isfinite(slope):
                assert 0 <= slope < 90
    assert count == width * height == metadata['cells']
    assert counts == [metadata['valid_elevations'], metadata['valid_slopes']]
    print(f'PASS: known plane, flat plane, NoData, block seams and all {count:,} CSV cells/coordinates checked.')


if __name__ == '__main__':
    check()
