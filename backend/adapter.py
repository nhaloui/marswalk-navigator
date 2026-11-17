"""Strict read-only data adapter around the original two-phase A* implementation."""
import csv
import hashlib
import math
from pathlib import Path
import time
import uuid

import numpy as np
import rasterio
from rasterio.warp import transform
from .evaplanner import eva_planner as core

DATA = Path(__file__).resolve().parents[1] / 'public/data/mars'
FILES = ['crater_altitudes_slopes_10km.csv', 'crater_tes_dust_scored_10km.csv',
         'crater_themis_dayir_10km.csv', 'crater_themis_nightir_10km.csv']
WARNINGS = [
    'Experimental itinerary based on mobility assumptions, not a safety certification.',
    'Hardness: an uncalibrated relative thermal proxy derived from qualitative 8-bit mosaics.',
    'Dust: the experimental score is retained without renormalization and smoothed only for the model.',
    'Mission budget: return along the same paths; model estimates.',
]


class PlannerError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)


def fingerprint():
    result = {}
    for name in [*FILES, 'crater_dem_10km_local.tif']:
        path = DATA / name
        if not path.is_file():
            raise PlannerError('DATA_MISSING', f'Required data file is missing: {name}.')
        with path.open('rb') as stream:
            result[name] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return result


def prepare_context():
    with rasterio.open(DATA / 'crater_dem_10km_local.tif') as dem:
        grid = dict(crs=dem.crs, transform=dem.transform, width=dem.width, height=dem.height,
                    bounds=tuple(dem.bounds), resolution=dem.res[0])
    if grid['width'] != 417 or grid['height'] != 417 or grid['bounds'] != (-5000., -5000., 5000., 5000.):
        raise PlannerError('GRID_MISMATCH', 'The expected DEM grid is 417 × 417 cells over 10 × 10 km.')
    spec = grid['crs'].to_dict() if grid['crs'] else {}
    if spec.get('proj') != 'aeqd' or spec.get('R') != 3396190:
        raise PlannerError('GRID_MISMATCH', 'The DEM must use AEQD on the Martian sphere with R=3396190 m.')
    g = grid['transform']
    # Validate one record at a time: materializing DictReader used hundreds of MB.
    for index, name in enumerate(FILES):
        column = 'elevation_m' if index == 0 else 'dust_score' if index == 1 else 'thermal_value'
        count, minimum, maximum = 0, math.inf, -math.inf
        try:
            with (DATA / name).open(newline='', encoding='utf-8-sig') as stream:
                for count, record in enumerate(csv.DictReader(stream), 1):
                    row, col = divmod(count - 1, 417)
                    x, y, value = float(record['x_m']), float(record['y_m']), float(record[column])
                    expected_x, expected_y = g * (col + .5, row + .5)
                    if (count > 173889 or int(record['row']) != row or int(record['col']) != col
                            or not math.isfinite(x) or not math.isfinite(y)
                            or abs(x - expected_x) > 1e-7 or abs(y - expected_y) > 1e-7):
                        raise PlannerError('GRID_MISMATCH', f'Misaligned cells or coordinates: {name}.')
                    if not math.isfinite(value) or (index >= 2 and float(record['valid']) != 1):
                        raise PlannerError('DATA_INVALID', f'Missing data in {name}; automatic gap filling is disabled.')
                    if index == 0 and value == -32767:
                        raise PlannerError('DATA_INVALID', 'The DEM contains cells without elevation data.')
                    if index == 1 and not 0 <= value <= 1:
                        raise PlannerError('DATA_INVALID', 'dust_score must remain between 0 and 1 without renormalization.')
                    if index >= 2 and not 1 <= value <= 255:
                        raise PlannerError('DATA_INVALID', f'Invalid thermal mosaic: {name}.')
                    minimum, maximum = min(minimum, value), max(maximum, value)
        except (ValueError, KeyError, TypeError):
            raise PlannerError('DATA_INVALID', f'Missing columns or values in {name}.') from None
        if count != 173889:
            raise PlannerError('GRID_MISMATCH', f'Misaligned cells or coordinates: {name}.')
        if index >= 2 and minimum == maximum:
            raise PlannerError('DATA_INVALID', f'Constant or invalid thermal mosaic: {name}.')
    core.CSV_PATH, core.DUST_CSV_PATH, core.DAY_CSV_PATH, core.NIGHT_CSV_PATH = [str(DATA / p) for p in FILES]
    core.DX = grid['resolution']  # Coordinate compatibility correction, not an A* change.
    core.T_SAMPLE_MIN = 0.0  # Final mission configuration: no sampling stop.
    ctx = core.build_context()
    if any(not np.isfinite(ctx[k]).all() for k in ('altitude', 'hardness', 'dust_smooth', 'eta', 'c_rr')):
        raise PlannerError('DATA_INVALID', 'A prepared layer contains non-finite values.')
    return ctx, grid


def point_cell(point, grid):
    lat, lon = point['latitude'], point['longitude']
    if not all(math.isfinite(v) for v in (lat, lon)) or not -90 <= lat <= 90 or not 0 <= lon <= 360:
        raise PlannerError('COORDINATES_INVALID', 'Invalid Martian latitude or east longitude.')
    geographic = rasterio.crs.CRS.from_string('+proj=longlat +R=3396190 +no_defs')
    xs, ys = transform(geographic, grid['crs'], [lon], [lat])
    x, y = xs[0], ys[0]
    west, south, east, north = grid['bounds']
    if not (west <= x < east and south < y <= north):
        raise PlannerError('OUTSIDE_SITE', 'The position is outside the 10 × 10 km Martian grid.')
    col_float, row_float = (~grid['transform']) * (x, y)
    cell = (int(math.floor(row_float)), int(math.floor(col_float)))
    cx, cy = grid['transform'] * (cell[1] + .5, cell[0] + .5)
    return cell, {'requested': point, 'row': cell[0], 'col': cell[1], 'x_m': cx, 'y_m': cy,
                  'snap_m': math.hypot(x - cx, y - cy)}


def calculate(ctx, grid, start, destination):
    begin = time.perf_counter()
    s, start_info = point_cell(start, grid)
    t, destination_info = point_cell(destination, grid)
    if s == t:
        raise PlannerError('SAME_CELL', 'Start and destination are in the same DEM cell.')
    if core.DX * math.dist(s, t) < core.R_EXCLUDE_M:
        raise PlannerError('START_EXCLUDED', 'The start is inside the 500 m rover exclusion zone around the destination. Choose a more distant start.')
    try:
        result = core.plan_mission(ctx, s, t, 'rover')
    except ValueError:
        raise PlannerError('ROVER_BLOCKED', 'The start is blocked for the rover by the model’s slope or ground thresholds. Choose another start.') from None
    except RuntimeError:
        raise PlannerError('EVA_UNREACHABLE', 'No EVA access was found from the parking location. Change the destination or start.') from None
    legs, points, offset_d, offset_t = [], [], 0., 0.
    for phase, _, path, fn in result['segments']:
        ce, ct, cd = core.cumulatives(path, fn)
        leg_points = []
        for i, (row, col) in enumerate(path):
            x, y = grid['transform'] * (col + .5, row + .5)
            p = {'x_m': x, 'y_m': y, 'elevation_m': float(ctx['altitude'][row, col]),
                 'row': row, 'col': col, 'distance_m': offset_d + float(cd[i]),
                 'time_s': offset_t + float(ct[i])}
            leg_points.append(p)
        points.extend(leg_points if not points else leg_points[1:])
        legs.append({'phase': 'rover' if phase == 'rover' else 'eva', 'points': leg_points,
                     'distance_m': float(cd[-1]), 'duration_s': float(ct[-1]), 'energy_j': float(ce[-1])})
        offset_d += float(cd[-1]); offset_t += float(ct[-1])
    park = result['park']
    px, py = grid['transform'] * (park[1] + .5, park[0] + .5)
    geographic = rasterio.crs.CRS.from_string('+proj=longlat +R=3396190 +no_defs')
    lon, lat = transform(grid['crs'], geographic, [px], [py])
    changes = np.diff([p['elevation_m'] for p in points])
    warnings = WARNINGS.copy()
    parking_fallback = result['no_flat_found'] or legs[0]['distance_m'] == 0
    if parking_fallback:
        warnings.append('No intermediate parking location selected: the rover stays at departure. Verify the parking site before use.')
    oxygen_out_kg, _ = core.life_support(result['walk_out'][1])
    drive_wh = result['rover_out'][1] / 3600.0
    wait_out_wh = core.P_PARKED_W * result['walk_out'][0] / 3600.0
    return {'id': str(uuid.uuid4()), 'points': points, 'legs': legs, 'start': start_info, 'destination': destination_info,
            'transition': {'x_m': px, 'y_m': py, 'row': park[0], 'col': park[1],
                           'latitude': lat[0], 'longitude': lon[0], 'distance_m': legs[0]['distance_m']},
            'distance_m': offset_d, 'duration_s': offset_t,
            'gain_m': float(np.maximum(changes, 0).sum()), 'loss_m': float(-np.minimum(changes, 0).sum()),
            'mission': {k: float(result[k]) for k in ('mission_s', 'eva_s', 'battery_wh', 'o2_kg', 'h2o_kg', 'dust_mean', 'dust_max', 'dust_effect_wh')},
            'requirements': {'oxygen_kg_per_person': float(oxygen_out_kg), 'rover_drive_wh': float(drive_wh),
                             'rover_wait_wh': float(wait_out_wh), 'rover_electric_wh': float(drive_wh + wait_out_wh)},
            'warnings': warnings, 'parking_fallback': bool(parking_fallback), 'calculation_s': time.perf_counter() - begin,
            'assumptions': {'pixel_m': core.DX, 'exclusion_m': core.R_EXCLUDE_M, 'sampling_min': core.T_SAMPLE_MIN,
                            'thermal_proxy': 'zscore day/night; relative percentiles 2–98; not calibrated hardness'}}


def worker(connection):
    """One persistent process; cancel/timeout terminates it without blocking React."""
    ctx = grid = signature = None
    while True:
        try:
            request = connection.recv()
        except EOFError:
            return
        job_id = request['id']
        try:
            connection.send({'id': job_id, 'state': 'loading', 'message': 'Checking scientific layers…'})
            current = fingerprint()
            if current != signature:
                ctx, grid = prepare_context()
                if fingerprint() != current:
                    ctx = grid = signature = None
                    raise PlannerError('DATA_CHANGED', 'The data changed while loading. Calculate the route again.')
                signature = current
            connection.send({'id': job_id, 'state': 'calculating', 'message': 'Planning rover approach, parking and EVA access…'})
            route = calculate(ctx, grid, request['start'], request['destination'])
            route['source_hashes'] = signature
            connection.send({'id': job_id, 'state': 'ready', 'route': route})
        except PlannerError as error:
            connection.send({'id': job_id, 'state': 'error', 'code': error.code, 'message': error.message})
        except Exception:
            import traceback
            traceback.print_exc()
            connection.send({'id': job_id, 'state': 'error', 'code': 'CALCULATION_FAILED', 'message': 'Route calculation failed. Check the data and try again.'})
