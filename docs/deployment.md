# Render deployment

The application uses a Static Site for React and a Python Web Service for FastAPI. `render.yaml` contains the service definitions. The Node and Python versions are pinned in `.node-version` and `.python-version`.

## Backend

Create a Python Web Service from the repository root and select the Free instance type.

Build command

```bash
pip install --only-binary=:all: -r requirements-planner.txt && python scripts/check-deployment-data.py
```

Start command

```bash
python -m uvicorn backend.app:app --host 0.0.0.0 --port $PORT --workers 1
```

Set the health check path to `/api/health` and configure the environment.

```dotenv
CORS_ORIGINS=https://frontend.example.com
PLANNER_TIMEOUT_SECONDS=300
OPENBLAS_NUM_THREADS=1
OMP_NUM_THREADS=1
GDAL_CACHEMAX=16
PYTHONUNBUFFERED=1
```

Replace `CORS_ORIGINS` with the exact frontend origin. Multiple origins are comma-separated. The API uses one Uvicorn worker because calculation state is kept in memory.

The build validates the four aligned CSVs and cropped DEM against `deploy-data-manifest.json`. These five inputs total approximately 42.60 MiB.

## Frontend

Create a Static Site from the repository root.

| Setting | Value |
| --- | --- |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |
| Rewrite | `/*` to `/index.html` |

Set the backend origin before building.

```dotenv
VITE_API_BASE_URL=https://api.example.com
```

The value must be an HTTP(S) origin with no path. Vite embeds it in the browser bundle, so changing it requires a frontend rebuild.

## Runtime behaviour

The frontend retries health requests during backend startup and displays progress. It allows up to 120 seconds for startup before submitting a mission. The calculation timeout defaults to 300 seconds. One active calculation is accepted, and cancellation stops its worker.

The backend holds temporary results in memory. They are recalculated after a restart. Numerical-library thread counts and the GDAL cache are limited for the small service instance. The optional memory check measures the API and all child processes together.

```bash
python -m pip install psutil==7.2.2
python scripts/check-planner-memory.py
```

## Deployment checks

Confirm that `/api/health` returns `"status":"ready"`, calculate a route from the frontend and follow it in 2D, 3D and POV. Browser API requests must target the configured backend origin. A CORS failure requires checking that the frontend URL matches `CORS_ORIGINS` exactly.

[Render FastAPI deployment](https://render.com/docs/deploy-fastapi) · [Static Sites](https://render.com/docs/static-sites) · [Free service limits](https://render.com/docs/free)
