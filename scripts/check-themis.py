"""Exercise missing-data handling and no-overwrite behavior using a tiny fixture.

Does not read or modify the large production THEMIS file or existing outputs.
"""
from contextlib import redirect_stdout
import csv
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile

import numpy as np
import rasterio
from rasterio.transform import from_bounds

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('extract_themis', ROOT / 'extract_themis.py')
extraction = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extraction)

with tempfile.TemporaryDirectory(prefix='.themis-check-', dir=ROOT) as folder:
    scratch = Path(folder)
    extraction.inherit_directory_permissions(scratch)
    extraction.ROOT = extraction.DATA = scratch
    extraction.SOURCE = scratch / 'fixture.tif'
    extraction.OUTPUT = scratch / 'output.tif'
    extraction.CSV = scratch / 'output.csv'
    extraction.REPORT = scratch / 'report.json'
    # Only these two small, existing references are opened read-only.
    extraction.DEM = ROOT / 'public/data/mars/crater_dem_10km_local.tif'
    extraction.REFERENCE_CSV = ROOT / 'public/data/mars/crater_altitudes_slopes_10km.csv'
    with rasterio.open(extraction.DEM) as dem:
        crs = dem.crs
    values = np.arange(25, dtype='uint8').reshape(5, 5) + 10
    values[0, 0] = values[2, 2] = 0
    with rasterio.open(extraction.SOURCE, 'w', driver='GTiff', width=5, height=5,
                       count=1, dtype='uint8', nodata=0, crs=crs,
                       transform=from_bounds(-5000, -5000, 5000, 5000, 5, 5)) as dst:
        dst.write(values, 1)
    with redirect_stdout(io.StringIO()):
        extraction.main()
    with rasterio.open(extraction.OUTPUT) as output:
        raw = output.read(1)
        assert raw[208, 208] == 0
        assert raw[0, -1] == values[0, -1]
        assert 0 < np.count_nonzero(raw == 0) < raw.size
        np.testing.assert_array_equal(output.read_masks(1) == 0, raw == 0)
    invalid = 0
    with extraction.CSV.open(newline='') as stream:
        for cell in csv.DictReader(stream):
            r, c = int(cell['row']), int(cell['col'])
            if raw[r, c] == 0:
                assert cell['thermal_value'] == '' and cell['valid'] == '0'
                invalid += 1
            else:
                assert int(cell['thermal_value']) == raw[r, c] and cell['valid'] == '1'
    report = json.loads(extraction.REPORT.read_text())
    assert invalid == report['statistics']['nodata_cells'] > 0
    if os.name == 'nt':
        # Published hard links must retain inherited access for the normal
        # workspace owner, not just the private staging-directory owner.
        environment = os.environ.copy()
        environment['MARSWALK_ACL_PARENT'] = str(ROOT)
        for path in (extraction.OUTPUT, extraction.CSV, extraction.REPORT):
            environment['MARSWALK_ACL_FILE'] = str(path)
            result = subprocess.check_output([
                'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                "$parent=Get-Acl -LiteralPath $env:MARSWALK_ACL_PARENT; "
                "$file=Get-Acl -LiteralPath $env:MARSWALK_ACL_FILE; "
                "if ($file.AreAccessRulesProtected) { throw 'Inheritance disabled' }; "
                "$read=[System.Security.AccessControl.FileSystemRights]::ReadData; "
                "$rules=@($file.Access | Where-Object { $_.IdentityReference.Value -eq $parent.Owner "
                "-and $_.AccessControlType -eq 'Allow' -and ($_.FileSystemRights -band $read) -eq $read }); "
                "if ($rules.Count -eq 0) { throw 'Normal workspace owner has no read access' }; 'PASS'"
            ], env=environment)
            assert b'PASS' in result
    before = {p: extraction.digest(p) for p in (extraction.OUTPUT, extraction.CSV, extraction.REPORT)}
    try:
        extraction.main()
    except FileExistsError:
        pass
    else:
        raise AssertionError('Existing outputs were not rejected')
    assert before == {p: extraction.digest(p) for p in before}

print('PASS: NoData TIFF/CSV handling; no overwrite; Windows published outputs inherit read access for workspace owner. Production source/outputs untouched.')
