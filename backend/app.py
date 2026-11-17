"""Local job API. Run: python -m uvicorn backend.app:app --port 8000"""
from contextlib import asynccontextmanager
import multiprocessing as mp
import os
import threading
import time
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


def run_worker(connection):
    # Keep NumPy/SciPy/GDAL out of the HTTP process (512 MB shared budget).
    from .adapter import worker
    worker(connection)


class Point(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=0, le=360, allow_inf_nan=False)


class MissionRequest(BaseModel):
    start: Point
    destination: Point


class Jobs:
    def __init__(self):
        self.lock = threading.RLock(); self.process = None; self.pipe = None
        self.active = None; self.results = {}

    def stop(self):
        if self.process:
            self.process.terminate(); self.process.join(timeout=2)
            if self.process.is_alive():
                self.process.kill(); self.process.join(timeout=1)
            self.process = None
        if self.pipe:
            self.pipe.close(); self.pipe = None

    def receive(self, pipe):
        try:
            while True:
                message = pipe.recv()
                with self.lock:
                    if message['id'] in self.results and self.results[message['id']]['state'] not in ('cancelled', 'error', 'ready'):
                        self.results[message['id']] = message
        except (EOFError, OSError, ValueError):
            return

    def start(self, body):
        with self.lock:
            if self.active and self.results[self.active]['state'] not in ('ready', 'error', 'cancelled'):
                raise HTTPException(409, 'The planner is busy with another calculation. Please try again shortly.')
            if not self.process or not self.process.is_alive():
                self.stop()
                context = mp.get_context('spawn')
                self.pipe, child = context.Pipe()
                self.process = context.Process(target=run_worker, args=(child,), daemon=True)
                self.process.start(); child.close()
                threading.Thread(target=self.receive, args=(self.pipe,), daemon=True).start()
            job_id = str(uuid.uuid4()); self.active = job_id
            self.results[job_id] = {'id': job_id, 'state': 'loading', 'message': 'Initializing route planner…'}
            # Keep bounded history; never retain unbounded route data.
            for old in list(self.results)[:-5]:
                del self.results[old]
            self.pipe.send({'id': job_id, **body})
            threading.Thread(target=self.timeout, args=(job_id,), daemon=True).start()
            return self.results[job_id]

    def timeout(self, job_id):
        time.sleep(int(os.environ.get('PLANNER_TIMEOUT_SECONDS', '300')))
        with self.lock:
            entry = self.results.get(job_id)
            if entry and entry['state'] not in ('ready', 'error', 'cancelled'):
                self.stop()
                self.results[job_id] = {'id': job_id, 'state': 'error', 'code': 'TIMEOUT', 'message': 'Calculation timed out. Try different endpoints.'}

    def cancel(self, job_id):
        with self.lock:
            entry = self.results.get(job_id)
            if entry and entry['state'] not in ('ready', 'error', 'cancelled'):
                self.stop(); self.results[job_id] = {'id': job_id, 'state': 'cancelled'}


jobs = Jobs()


@asynccontextmanager
async def lifespan(_app):
    yield
    with jobs.lock:
        jobs.stop()


app = FastAPI(title='Odos local EVAPlanner', lifespan=lifespan)
origins = [origin.strip().rstrip('/') for origin in os.environ.get(
    'CORS_ORIGINS', 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173'
).split(',') if origin.strip()]
if '*' in origins:
    raise RuntimeError('CORS_ORIGINS must list exact frontend origins, not a wildcard.')
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=['GET', 'POST', 'DELETE'], allow_headers=['Content-Type'])


@app.get('/api/health')
def health():
    return {'status': 'ready', 'model': 'experimental-rover-eva'}


@app.post('/api/missions', status_code=202)
def create_mission(body: MissionRequest):
    return jobs.start(body.model_dump())


@app.get('/api/missions/{job_id}')
def get_mission(job_id: str):
    with jobs.lock:
        if job_id not in jobs.results:
            raise HTTPException(404, 'Calculation not found. Calculate the route again.')
        return jobs.results[job_id]


@app.delete('/api/missions/{job_id}')
def cancel_mission(job_id: str):
    jobs.cancel(job_id)
    return {'state': 'cancelled'}
