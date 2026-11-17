"""Read-only scientific integration checks; run from project root."""
import json
import math
from pathlib import Path
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from rasterio.warp import transform
import rasterio
from backend.adapter import prepare_context, calculate, point_cell, PlannerError, fingerprint

before = fingerprint()
started = time.perf_counter()
ctx, grid = prepare_context()
start = {'latitude': 40.79036, 'longitude': 22.11728}
target = {'latitude': 40.85630, 'longitude': 22.03879}
assert point_cell(start, grid)[0] == (371, 355)
assert point_cell(target, grid)[0] == (208, 208)
route = calculate(ctx, grid, start, target)
assert [leg['phase'] for leg in route['legs']] == ['rover', 'eva']
assert route['legs'][0]['points'][-1] == route['legs'][1]['points'][0]
assert route['points'][0]['row'] == 371 and route['points'][-1]['row'] == 208
assert len(route['points']) == sum(len(leg['points']) for leg in route['legs']) - 1
assert math.isclose(route['distance_m'], sum(leg['distance_m'] for leg in route['legs']))
assert math.isclose(route['duration_s'], sum(leg['duration_s'] for leg in route['legs']))
assert route['mission']['mission_s'] > route['duration_s']
assert route['assumptions']['sampling_min'] == 0
from backend.evaplanner import eva_planner as core
assert math.isclose(route['requirements']['oxygen_kg_per_person'],core.life_support(route['legs'][1]['energy_j'])[0])
assert math.isclose(route['requirements']['rover_drive_wh'],route['legs'][0]['energy_j']/3600)
assert math.isclose(route['requirements']['rover_wait_wh'],core.P_PARKED_W*route['legs'][1]['duration_s']/3600)
assert math.isclose(route['requirements']['rover_electric_wh'],route['requirements']['rover_drive_wh']+route['requirements']['rover_wait_wh'])
assert route['assumptions']['pixel_m'] == 10000/417
for p in route['points']:
    x, y = grid['transform'] * (p['col']+.5, p['row']+.5)
    assert (p['x_m'], p['y_m']) == (x, y)
    assert p['elevation_m'] == float(ctx['altitude'][p['row'], p['col']])
    assert math.isfinite(p['time_s'])
assert all(b['time_s'] > a['time_s'] for a,b in zip(route['points'], route['points'][1:]))
json.dumps(route, allow_nan=False)
for a,b,code in [(start,start,'SAME_CELL'), (target,start,None),
                  ({'latitude':0,'longitude':0},target,'OUTSIDE_SITE'),
                  ({'latitude':40.857,'longitude':22.039},target,'START_EXCLUDED')]:
    if code is None:
        continue
    try:
        calculate(ctx,grid,a,b)
    except PlannerError as error:
        assert error.code == code, (error.code,code)
    else:
        raise AssertionError(f'Missing {code}')
# A different valid geographic pair, chosen from an accessible rover cell.
row,col=371,355
geo=rasterio.crs.CRS.from_string('+proj=longlat +R=3396190 +no_defs')
x,y=grid['transform']*(235.5,230.5)
lon,lat=transform(grid['crs'],geo,[x],[y])
alternative=calculate(ctx,grid,start,{'latitude':lat[0],'longitude':lon[0]})
assert alternative['destination']['row']==230 and alternative['destination']['col']==235
assert alternative['id']!=route['id'] and alternative['points'][-1]!=route['points'][-1]
assert before == fingerprint()
Path('.venv-dem/validated-mission.json').write_text(json.dumps(route,allow_nan=False),encoding='utf-8')
print(json.dumps({'checks':'PASS: two continuous phases, exact grid/units, real default and alternative routes, error cases, serializable DTO and unchanged CSVs',
                  'outbound_m':route['distance_m'],'outbound_min':route['duration_s']/60,
                  'rover_m':route['legs'][0]['distance_m'],'eva_m':route['legs'][1]['distance_m'],
                  'seconds':time.perf_counter()-started},indent=2))
