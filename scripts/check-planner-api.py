"""HTTP integration test against a running local service or Vite proxy."""
import argparse
import json
import time
import urllib.request
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:8000')
args = parser.parse_args()


def request(path, method='GET', body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(args.base + '/api' + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)


assert request('/health')['status'] == 'ready'
body = {'start': {'latitude':40.79036,'longitude':22.11728},
        'destination': {'latitude':40.85630,'longitude':22.03879}}
job = request('/missions', 'POST', body)
request('/missions/' + job['id'], 'DELETE')
assert request('/missions/' + job['id'])['state'] == 'cancelled'
job = request('/missions', 'POST', body)
states = set()
deadline = time.monotonic() + 125
while time.monotonic() < deadline:
    result = request('/missions/' + job['id']); states.add(result['state'])
    if result['state'] == 'ready':
        route = result['route']
        assert len(route['legs']) == 2 and not route['parking_fallback']
        assert route['assumptions']['sampling_min'] == 0
        assert route['requirements']['oxygen_kg_per_person'] > 0
        assert route['requirements']['rover_electric_wh'] >= route['requirements']['rover_drive_wh'] >= 0
        assert route['legs'][0]['points'][-1] == route['legs'][1]['points'][0]
        break
    if result['state'] == 'error':
        raise AssertionError(result)
    time.sleep(.5)
else:
    raise TimeoutError('Planner did not finish')
body['destination'] = {'latitude':0,'longitude':0}
job = request('/missions', 'POST', body)
for _ in range(80):
    error = request('/missions/' + job['id'])
    if error['state'] == 'error':
        assert error['code'] == 'OUTSIDE_SITE' and 'Traceback' not in str(error)
        break
    time.sleep(.25)
else:
    raise AssertionError('Missing structured coordinate error')
print('PASS: HTTP health, real cancellation/restart, continuous route and structured errors;',
      round(route['distance_m'], 2), 'm; states:', sorted(states))
