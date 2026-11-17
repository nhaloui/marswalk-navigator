"""Append the user-approved experimental RGB rank to an unchanged CSV grid.

Default: blue-cyan -> green, 0 -> 1. Use --invert to reverse the rank later.
This score is not calibrated dust abundance, opacity, hazard or a validated cost.
"""
import argparse
import csv
import hashlib
import itertools
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'public/data/mars'
SOURCE = DATA / 'crater_tes_dust_10km.csv'
DEM = DATA / 'crater_altitudes_slopes_10km.csv'
OUTPUT = DATA / 'crater_tes_dust_scored_10km.csv'
COLORS = ((42,222,255), (44,254,251), (28,247,205), (39,212,20))
SCORES = ('0', '0.3333333333333333', '0.6666666666666666', '1')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def score_for(rgb, invert=False):
    rank = COLORS.index(rgb)  # Unknown colors must fail, never become a default score.
    return SCORES[3-rank if invert else rank]


def generate(output=OUTPUT, invert=False):
    output = output.resolve()
    if output in (SOURCE.resolve(), DEM.resolve()):
        raise ValueError('Output must not overwrite source data')
    before = {p.name:digest(p) for p in (SOURCE, DEM)}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.csv.partial')
    frequencies = Counter()
    try:
        # Copy every original field verbatim; append only one comma and one score.
        with SOURCE.open('r',encoding='utf-8',newline='') as source, temporary.open('w',encoding='utf-8',newline='') as target:
            header_line = source.readline()
            fields = next(csv.reader([header_line]))
            if fields[:4] != ['row','col','x_m','y_m'] or 'dust_score' in fields:
                raise ValueError('Unexpected input schema')
            band_indices = [fields.index(name) for name in ('band_1_red','band_2_green','band_3_blue')]
            newline = '\r\n' if header_line.endswith('\r\n') else '\n'
            target.write(header_line.rstrip('\r\n')+',dust_score'+newline)
            for index, line in enumerate(source):
                values = next(csv.reader([line]))
                if len(values) != len(fields):
                    raise ValueError(f'Unexpected input row {index}')
                row,col = divmod(index,417)
                assert values[0] == str(row) and values[1] == str(col)
                rgb = tuple(int(values[i]) for i in band_indices)
                score = score_for(rgb,invert)
                target.write(line.rstrip('\r\n')+','+score+newline)
                frequencies[rgb] += 1
        count = 0
        with SOURCE.open(newline='',encoding='utf-8') as a, temporary.open(newline='',encoding='utf-8') as b, DEM.open(newline='',encoding='utf-8') as c:
            original, scored, dem = csv.reader(a),csv.reader(b),csv.reader(c)
            old_header,new_header,dem_header = next(original),next(scored),next(dem)
            assert new_header == old_header+['dust_score']
            assert old_header[:4] == dem_header[:4]
            for count,(old,new,ref) in enumerate(itertools.zip_longest(original,scored,dem),1):
                assert old is not None and new is not None and ref is not None
                assert new[:-1] == old  # Every source column and cell order preserved.
                assert new[:4] == ref[:4]  # Exact DEM grid alignment, no tolerance.
                rgb = tuple(int(old[i]) for i in band_indices)
                assert new[-1] == score_for(rgb,invert)
                assert 0 <= float(new[-1]) <= 1
        assert count == sum(frequencies.values()) == 417*417
        assert set(frequencies) == set(COLORS)
        assert before == {p.name:digest(p) for p in (SOURCE,DEM)}
        temporary.replace(output)
        metadata = {
            'source': SOURCE.name, 'output': output.name, 'rows':count,
            'source_sha256':before[SOURCE.name], 'dem_csv_sha256':before[DEM.name],
            'output_sha256':digest(output), 'added_column':'dust_score',
            'classification':'EXPERIMENTAL_UNCALIBRATED_RGB_ORDINAL_RANK',
            'direction':'green to blue-cyan' if invert else 'blue-cyan to green',
            'inverted':invert, 'formula':'(3-rank)/3' if invert else 'rank/3',
            'warning':'Visual hue order only; dust meaning and direction unverified. Equal rank spacing is conventional. 0 is not no dust; 1 is not maximum hazard. Not a calibrated scientific measurement or validated route cost.',
            'precision':'Finite decimal approximations of 1/3 and 2/3; no physical precision implied.',
            'mapping':[{'rgb':list(rgb),'dust_score':score_for(rgb,invert),'cells':frequencies[rgb]} for rgb in COLORS],
            'verification':'All original fields preserved verbatim; every row/col/x/y exactly matches the DEM CSV; 173889 cells; source hashes unchanged.',
            'spatial_limit':'Repeated coarse source colors do not provide 24 m scientific resolution. Source latitude convention remains subject to the TES extraction provenance caveat.',
        }
        output.with_suffix('.metadata.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(metadata,indent=2))
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=OUTPUT)
    parser.add_argument('--invert',action='store_true',help='Reverse the experimental ranks; not evidence of physical direction.')
    args = parser.parse_args()
    # Check both directions without generating any inverted CSV.
    assert [score_for(rgb) for rgb in COLORS] == list(SCORES)
    assert [score_for(rgb,True) for rgb in COLORS] == list(reversed(SCORES))
    generate(args.output,args.invert)
