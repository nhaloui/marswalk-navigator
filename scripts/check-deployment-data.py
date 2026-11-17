"""Fail the backend build if its exact, small scientific inputs are missing or invalid.

Reads only the four cropped CSVs and small DEM; no original large raster is used.
Run from the repository root: python scripts/check-deployment-data.py
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from backend.adapter import DATA, FILES, fingerprint, prepare_context
    manifest = json.loads((ROOT / 'deploy-data-manifest.json').read_text(encoding='utf-8'))
    assert set(manifest['files']) == set([*FILES, 'crater_dem_10km_local.tif'])
    for name, expected in manifest['files'].items():
        path = DATA / name
        if not path.is_file():
            raise RuntimeError(f'Missing deployment input: {path}. Commit the five allowlisted data files.')
        with path.open('rb') as stream:
            if stream.read(80).startswith(b'version https://git-lfs.github.com/spec'):
                raise RuntimeError(f'{name} is an unresolved Git LFS pointer.')
            stream.seek(0)
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if path.stat().st_size != expected['bytes'] or digest != expected['sha256']:
            raise RuntimeError(f'{name} differs from the reviewed data manifest. Review data changes before updating the manifest.')
    _, grid = prepare_context()
    assert grid['width'] == grid['height'] == 417
    assert fingerprint() == {name: info['sha256'] for name, info in manifest['files'].items()}
    print(f'PASS: 5 verified inputs, 4 x 173889 aligned CSV cells; {sum(f["bytes"] for f in manifest["files"].values()) / 1024**2:.2f} MiB total.')


if __name__ == '__main__':
    main()
