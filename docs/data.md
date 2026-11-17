# Data

## Coordinate system

The site is centred at 40.85630° N, 22.03879° E in Deuteronilus Mensae. The local projection uses planetocentric latitude, east-positive longitude and a Martian sphere with radius 3,396,190 m.

```text
+proj=aeqd +lat_0=40.8563 +lon_0=22.03879 +R=3396190 +x_0=0 +y_0=0 +units=m +no_defs
```

Bounds are −5,000 to +5,000 m on each axis. X increases eastward and Y northward. Raster rows increase southward. CSV coordinates refer to cell centres.

The CTX crop has 1,668 × 1,668 pixels and the DEM 417 × 417 cells. Their exact pixel sizes are 5.995203836930456 m and 23.980815347721823 m. This gives a 4-to-1 grid ratio within an exact 10,000 m square.

Habitat A is at 40.79036° N, 22.11728° E. Its direct distance to the site centre is approximately 5.26 km. Route distances are computed separately by the planner.

## CTX and DEM

The CTX background is optical imagery from MRO. Its browser representation is `crater_ctx_10km.webp`. The terrain uses `crater_dem_10km_local.tif` and a prepared Float32 elevation grid.

The local CTX and DEM crops were reprojected with bilinear resampling. This interpolation can smooth variation and affect elevation extrema and slopes. The source DEM has no explicit vertical unit tag. Elevations follow the source's metre convention, with its scale and offset applied during export.

The cropped DEM ranges from approximately −3,669.41 to −3,324.69 m. Slopes are computed as `degrees(arctan(hypot(dz/dx, dz/dy)))`, using the exact grid spacing. Unknown elevations propagate into the relevant derivatives.

Hillshade comes from DEM finite-difference normals. It provides terrain illumination for display.

## TES Dust

`TES_Dust.tif` contains three RGB bands. Its metadata provides no calibrated physical dust variable or units. Its native pixels span several kilometres at the study latitude.

The source declares an ellipsoidal Mars 2000 CRS with planetographic latitude. Extraction converts from the DEM's planetocentric latitude to that declared convention. The source's latitude convention still requires confirmation from product provenance.

The current `crater_tes_dust_scored_10km.csv` contains four experimental scores.

| Source RGB | Current dust_score | Cells |
| --- | --- | --- |
| 42, 222, 255 | 0 | 99,215 |
| 44, 254, 251 | 0.06666666666666667 | 48,030 |
| 28, 247, 205 | 0.13333333333333333 | 8,682 |
| 39, 212, 20 | 0.2 | 17,962 |

The renderer uses these values on a fixed 0–1 colour scale. The planner smooths the score for its experimental cost model. The direction and magnitude of the index require scientific calibration.

`score_tes_dust.py` implements the earlier ordinal experiment with scores 0, 1/3, 2/3 and 1. Its metadata describes that earlier experiment. Current display classes and the CSV fingerprint are recorded in `src/data/dust.generated.json`. Regenerating the earlier experiment would change the current scores.

## THEMIS day/night infrared

The controlled mosaics contain qualitative 8-bit values. CSV fields retain the name `thermal_value`. A value of zero is NoData and validity is recorded separately.

Nearest-neighbour reprojection aligns the thermal products to the 417 × 417 DEM grid. The approximately 100 m native resolution is retained in the information content, even though values repeat across the finer output grid.

The night crop has 173,889 valid cells using 13,423 distinct source pixels. Valid night values range from 86 to 250. The day CSV is aligned to the same grid. The repository includes the day CSV, while its local source raster and extraction report remain outside the published data bundle.

EVAPlanner derives a relative hardness proxy from standardised day/night differences, smoothing and local percentiles. Calibration is required before interpreting the proxy as a physical terrain property.

## Included files

`deploy-data-manifest.json` records the hashes and sizes of the four planner CSVs and the small local DEM. `.gitattributes` preserves their original bytes across platforms. The deployment check verifies these inputs and their alignment.

Large original rasters and full-area exports are excluded from Git. Prepared WebP, PNG and Float32 assets support browser rendering. The static build publishes six map assets.

## Sources

- [NASA Mars Reconnaissance Orbiter](https://science.nasa.gov/mission/mars-reconnaissance-orbiter/)
- [USGS THEMIS controlled mosaics](https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/)
- [PROJ azimuthal equidistant projection](https://proj.org/en/stable/operations/projections/aeqd.html)
- [PROJ geocentric latitude conversion](https://proj.org/en/stable/operations/conversions/geoc.html)
