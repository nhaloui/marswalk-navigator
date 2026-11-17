"""Measure total API + worker RSS during real HTTP routes (no source data writes).

Optional test dependency: python -m pip install psutil
python scripts/check-planner-memory.py
Starts its own API on a free localhost port, then shuts down only that process tree.
On Linux, --require-cgroup enforces the actual container peak instead of RSS alone.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import psutil

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', help='Optional report path, outside scientific data')
    parser.add_argument('--require-cgroup', action='store_true')
    args = parser.parse_args()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    env = {**os.environ, 'CORS_ORIGINS': 'https://odos-test.onrender.com',
           'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1', 'GDAL_CACHEMAX': '16'}
    process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.app:app',
                                '--host', '127.0.0.1', '--port', str(port), '--workers', '1'],
                               cwd=ROOT, env=env, stdout=subprocess.DEVNULL)
    stop = threading.Event()
    samples = []
    def monitor():
        while not stop.wait(.05):
            try:
                parent = psutil.Process(process.pid)
                rss = sum(p.memory_info().rss for p in [parent, *parent.children(recursive=True)] if p.is_running())
                samples.append(rss)
            except psutil.Error:
                pass
    thread = threading.Thread(target=monitor, daemon=True); thread.start()
    def request(path, method='GET', body=None, origin='https://odos-test.onrender.com'):
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(f'http://127.0.0.1:{port}/api{path}', data=data, method=method,
                                     headers={'Content-Type':'application/json', 'Origin':origin})
        with urllib.request.urlopen(req, timeout=10) as response:
            assert response.headers.get('Access-Control-Allow-Origin') == origin
            return json.load(response)
    routes = []
    try:
        until = time.monotonic() + 30
        while True:
            try:
                assert request('/health')['status'] == 'ready'; break
            except (urllib.error.URLError, ConnectionError):
                if time.monotonic() > until: raise
                time.sleep(.2)
        # Real preflight, plus a disallowed origin: CORS must not allow everyone.
        for origin, allowed in [('https://odos-test.onrender.com', True), ('https://untrusted.example', False)]:
            req = urllib.request.Request(f'http://127.0.0.1:{port}/api/missions', method='OPTIONS',
                headers={'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
            try:
                response = urllib.request.urlopen(req, timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                assert (response.status == 200) == allowed
                assert (response.headers.get('Access-Control-Allow-Origin') == origin) == allowed
        # Existing integration covers cancellation, restarts and default route.
        subprocess.run([sys.executable, 'scripts/check-planner-api.py', '--base', f'http://127.0.0.1:{port}'], cwd=ROOT, check=True)
        start = {'latitude':40.79036,'longitude':22.11728}
        # Repeat default and a second valid destination: includes cached context.
        for destination in [{'latitude':40.85630,'longitude':22.03879}, {'latitude':40.847,'longitude':22.045}]:
            job = request('/missions', 'POST', {'start':start,'destination':destination})
            try:
                request('/missions', 'POST', {'start':start,'destination':destination})
                raise AssertionError('Concurrent submission should return 409')
            except urllib.error.HTTPError as error:
                assert error.code == 409
            deadline = time.monotonic() + 310
            while time.monotonic() < deadline:
                result = request('/missions/' + job['id'])
                if result['state'] == 'ready':
                    routes.append({'distance_m':result['route']['distance_m'],'calculation_s':result['route']['calculation_s']}); break
                if result['state'] == 'error': raise AssertionError(result)
                time.sleep(.5)
            else: raise TimeoutError('Route timed out')
        peak = max(samples)
        cgroup = Path('/sys/fs/cgroup/memory.peak')
        cgroup_peak = int(cgroup.read_text()) if sys.platform == 'linux' and cgroup.exists() else None
        report = {'platform':sys.platform,'python':sys.version.split()[0], 'peak_api_and_children_rss_mib':round(peak/1024**2,2),
                  'cgroup_peak_mib':round(cgroup_peak/1024**2,2) if cgroup_peak is not None else None,
                  'budget_mib':512,'routes':routes,
                  'limitations':'Local RSS sampling is not a Render Linux/container guarantee; page cache and OS accounting differ.'}
        print(json.dumps(report, indent=2))
        if args.output:
            output = Path(args.output).resolve()
            assert not output.is_relative_to(ROOT / 'public'), 'Do not write reports into scientific data'
            output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        assert peak < 512*1024**2, 'Process RSS exceeds the free service budget'
        if args.require_cgroup:
            assert cgroup_peak is not None and cgroup_peak < 512*1024**2, 'Container memory budget not verified'
    finally:
        stop.set(); thread.join(timeout=2)
        try:
            parent = psutil.Process(process.pid)
            children = parent.children(recursive=True)
            for child in children:
                try: child.terminate()
                except psutil.Error: pass
            process.terminate()
            process.wait(timeout=5)
            _, alive = psutil.wait_procs(children, timeout=3)
            for child in alive: child.kill()
        except (psutil.Error, subprocess.TimeoutExpired):
            process.kill()


if __name__ == '__main__':
    main()
