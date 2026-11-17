# Offline data processing

Processing scripts run from the repository root with the dependencies in `requirements-dem.txt`. Large source rasters must be obtained separately and placed in `public/data/mars/`. Existing cropped inputs and browser assets are already included for running the application.

| Script | Purpose |
| --- | --- |
| `calculate_slopes.py` | Export elevation and slope cells from a DEM |
| `extract_crater.py` | Reproject CTX and DEM to the local 10 km square |
| `extract_tes_dust.py` | Align TES RGB bands with the DEM grid |
| `score_tes_dust.py` | Reproduce the initial ordinal RGB scoring experiment |
| `extract_themis.py` | Windowed extraction of the night IR mosaic |
| `crop_themis_day.py` | Standalone day IR extraction utility |
| `scripts/prepare-mars-imagery.mjs` | Prepare the browser CTX image |
| `scripts/prepare-crater-hillshade.py` | Generate DEM hillshade |
| `scripts/prepare-terrain-assets.py` | Export Float32 elevations and display textures |
| `scripts/prepare-dust-assets.mjs` | Generate the current score texture and legend metadata |

## DEM export

`calculate_slopes.py` reads the DEM in blocks with a halo for derivatives. It retains every cell and supports `--dem`, `--output` and `--expected-resolution`. The CSV schema is `row,col,x_m,y_m,elevation_m,slope_deg`.

The local extraction uses an exact pixel size of `10000 / 417` m. The elevation CSV records projected cell centres and source elevation precision.

## Thermal extraction

`extract_themis.py` opens the large night mosaic with a bounded GDAL cache and reads only the source window required for the target area. It handles scanline storage, reprojects with nearest-neighbour resampling and checks each output cell against an independent inverse transformation.

Outputs use the DEM's CRS, affine transform, bounds and dimensions. The CSV schema is `row,col,x_m,y_m,thermal_value,valid`. Extraction validates temporary outputs before publishing them and refuses to overwrite existing outputs.

The standalone day utility accepts its source through `--source`. Run `python crop_themis_day.py --help` for input and output options.

## Browser assets

Dust preparation runs during Vite startup and build. Replacing the current CSV triggers validation and updates the texture and metadata. Display colours use a fixed 0–1 scale. A production change requires a new frontend build.

CTX and terrain asset preparation are separate offline steps. Source grid definitions, generated metadata and asset URLs must agree before loading a new region.

## Checks

```bash
python scripts/check-deployment-data.py
python scripts/check-themis.py
node scripts/check-dust-scores.mjs
node scripts/check-local-map.mjs
```

`check_dem_export.py` also validates the full-area DEM export when the original raster and its full CSV are available locally.
