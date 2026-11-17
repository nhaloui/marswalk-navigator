# Architecture

## Frontend

`src/App.tsx` composes the layer panel, central terrain workspace and mission planner. Shared state keeps the same endpoints and route across the 2D map, 3D terrain and Astronaut POV.

The map uses a prepared CTX image. The terrain renderer loads a Float32 elevation grid and constructs the Three.js mesh. Both use the local Martian coordinate system defined by the DEM. Screen coordinates, map positions and geographic coordinates are converted through the shared utilities in `src/lib/`.

`src/planner/useMissionPlanner.ts` handles endpoint validation, request cancellation, status polling and route selection. The API origin is configured with `VITE_API_BASE_URL`. An empty value uses the local Vite proxy.

## Rendering and navigation

The terrain mesh retains the DEM's metric scale. CTX, dust scores and elevation colours share the same extent and orientation. Visual grading and surface shading are display effects.

POV movement samples elevation under the camera and stops at the dataset boundary or invalid terrain. Ground controls move in 6 m steps. Route following uses cumulative model time and distance, with adjustable playback speed, pause/resume and an automatic stop at arrival. Losing window focus pauses playback.

## Backend

FastAPI exposes four endpoints.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | HTTP service readiness |
| POST | `/api/missions` | Submit start and destination coordinates |
| GET | `/api/missions/{id}` | Read job status and results |
| DELETE | `/api/missions/{id}` | Cancel a calculation |

`backend/app.py` manages a single persistent calculation process. The worker imports the scientific libraries, loads the validated grids and caches the prepared context. The API accepts one active calculation and returns HTTP 409 when busy. Cancellation terminates the worker. The next request creates a new worker.

The default calculation timeout is 300 seconds, configurable through `PLANNER_TIMEOUT_SECONDS`. The five most recent results are held in memory. Restarting the service clears this history.

## Planner

`backend/adapter.py` validates all 173,889 records of each CSV in row-major order, including cell indices, projected coordinates and valid values. The DEM supplies the CRS, affine transform and exact cell size of `10000 / 417` metres. Source fingerprints identify the input data used for each route.

EVAPlanner computes a rover approach, selects a parking location and calculates the remaining EVA walk. The rover has a 500 m exclusion zone around the destination. The parking search uses the model's terrain thresholds. This sequential procedure evaluates a particular Rover/EVA strategy.

The result includes ordered metric points, rover and EVA segments, the transition position, cumulative distance and time, and estimated resource use. Display geometry is draped over the DEM while route metrics retain the calculated values.

The main resource summary covers the outbound journey. EVA oxygen is calculated per astronaut. Rover electricity includes outbound driving and standby during the outbound EVA segment. Detailed budgets include the return along the same paths. Sampling time is configured to zero.

## Validation

The JavaScript checks cover map proportions, geographic transformations, marker alignment, terrain sampling, movement and route playback. Python checks validate source alignment, default and alternative routes, resource calculations, cancellation and API errors.

```bash
python scripts/check-planner.py
python scripts/check-planner-api.py
node scripts/check-mission-navigation.mjs
node scripts/check-terrain.mjs
node scripts/check-pov-v2.mjs
node scripts/check-pov-isolation.mjs
```

The API check expects a running service at port 8000 and accepts `--base` for another address.
