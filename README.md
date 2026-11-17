# Odos

Odos is a Mars exploration and route-planning prototype developed by a student team during a 48-hour NASA Space Apps Challenge hackathon in Montréal.

The project explores how an astronaut could prepare a surface mission from a tablet interface. It combines orbital imagery, terrain elevations and an experimental Rover-to-EVA planner, with three views of the same study area.

[Open the demo](https://odos-vzyz.onrender.com)

## Features

- **2D map** with CTX imagery, pan and zoom, local coordinates, reference points and optional scientific layers.
- **3D terrain** reconstructed from the DEM, with the planned route positioned on the surface.
- **Astronaut POV** with terrain-following movement, route guidance, pause and resume, and adjustable playback speed.
- **Mission planning** from geographic coordinates or points selected on the map. The planner computes a rover approach, a parking position and an EVA segment.
- **Resource estimates** for travel time, EVA oxygen per astronaut and rover electricity, with a detailed mission budget.

## Study area and data

The study area covers **10 × 10 km** in Deuteronilus Mensae, centred at **40.85630° N, 22.03879° E**. A local Martian azimuthal equidistant projection provides metric coordinates from −5,000 to +5,000 m on each axis.

| Dataset | Role | Resolution |
| --- | --- | --- |
| MRO CTX imagery | Optical map background | Approximately 6 m/pixel |
| CTX DEM | Elevation, terrain mesh and slope calculations | Approximately 24 m/cell |
| TES Dust RGB product | Experimental dust index and display layer | Coarse source pixels spanning several kilometres |
| THEMIS day/night IR mosaics | Relative thermal proxy used by the planner | Approximately 100 m/pixel |

The computational grid contains **417 × 417 cells**. The current dust scores range from 0 to 0.2 and use a fixed 0–1 display scale. THEMIS values are qualitative 8-bit mosaic values. Route costs and resource budgets rely on experimental assumptions and require further validation for operational use.

Dataset preparation, coordinate conventions and interpretation are documented in [Data](docs/data.md).

## Stack

- **Frontend** — React, TypeScript, Vite, Tailwind CSS, shadcn/ui and Lucide React.
- **3D rendering** — Three.js.
- **Backend** — Python and FastAPI.
- **Geospatial processing** — Rasterio, NumPy and SciPy.
- **Route planning** — EVAPlanner with A* search.

## Run locally

Use the Node and Python versions recorded in `.node-version` and `.python-version`.

```bash
git clone https://github.com/nhaloui/marswalk-navigator.git
cd marswalk-navigator
python -m venv .venv-dem
```

On macOS or Linux, activate the environment and install the dependencies.

```bash
source .venv-dem/bin/activate
python -m pip install -r requirements-planner.txt
npm ci
npm run dev
```

On Windows PowerShell, the environment's Python executable can be used directly.

```powershell
.venv-dem\Scripts\python.exe -m pip install -r requirements-planner.txt
npm.cmd ci
npm.cmd run dev
```

The development command starts FastAPI on port 8000 and Vite on the first available frontend port, usually 5173. Open the address printed by Vite.

The cropped data required by the application is included in the repository. Original large rasters are downloaded separately for offline preprocessing.

## Project structure

```text
src/
  components/mission/   Map and side panels
  planner/              Route form, API client and mission results
  terrain/              3D terrain, POV controls and rendering
  data/                 Reference points and prepared asset metadata
  lib/                  Coordinate and viewport transformations
backend/
  app.py                FastAPI endpoints and job lifecycle
  adapter.py            Grid validation and planner integration
  evaplanner/           Route search and resource models
public/data/mars/       Cropped data and browser assets
scripts/                Asset preparation and validation
docs/                  Technical documentation
```

## Checks

```bash
npm run build
npm run lint
node scripts/check-geographic-points.mjs
node scripts/check-terrain.mjs
node scripts/check-mission-navigation.mjs
node scripts/check-dust-scores.mjs
node scripts/check-render-client.mjs
python scripts/check-deployment-data.py
python scripts/check-planner.py
```

Run the Python checks from an environment with `requirements-planner.txt` installed. Under Windows, use `.venv-dem\Scripts\python.exe` when the environment is not activated.

## Documentation

- [Architecture and planner](docs/architecture.md)
- [Data and scientific assumptions](docs/data.md)
- [Offline processing](docs/processing.md)
- [Render deployment](docs/deployment.md)
