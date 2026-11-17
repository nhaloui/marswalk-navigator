"""Align TES RGB by inverse mapping target pixel centers (nearest source center).

Respects the source's declared geodetic Mars 2000 ellipsoid and converts target
planetocentric latitude explicitly. No RGB-to-physical dust conversion.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.warp import transform

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'public/data/mars'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inspect_source(src):
    bands = []
    for index in src.indexes:
        a = src.read(index, masked=True)
        values = a.compressed()
        values = values[np.isfinite(values)]
        bands.append({'band': index, 'color': src.colorinterp[index-1].name,
                      'dtype': src.dtypes[index-1], 'description': src.descriptions[index-1],
                      'unit': src.units[index-1], 'scale': src.scales[index-1], 'offset': src.offsets[index-1],
                      'nodata': src.nodatavals[index-1], 'valid_pixels': len(values),
                      'min': float(values.min()) if values.size else None,
                      'max': float(values.max()) if values.size else None,
                      'unique_values': len(np.unique(values)),
                      # GDAL virtual derived datasets can contain local absolute paths.
                      'metadata': {str(ns): src.tags(index, ns=ns) for ns in [None, *src.tag_namespaces(index)]
                                   if ns != 'DERIVED_SUBDATASETS'}})
    return {'file': Path(src.name).name, 'crs_wkt': src.crs.to_wkt(),
            'dimensions': [src.width, src.height], 'resolution_degrees': list(src.res),
            'bounds': list(src.bounds), 'transform': list(src.transform), 'bands': bands,
            'metadata': {str(ns): src.tags(ns=ns) for ns in [None, *src.tag_namespaces()]
                         if ns != 'DERIVED_SUBDATASETS'}}


def main(convention):
    source = DATA/'TES_Dust.tif'
    dem = DATA/'crater_dem_10km_local.tif'
    reference_csv = DATA/'crater_altitudes_slopes_10km.csv'
    output = DATA/'crater_tes_dust_10km_local.tif'
    csv_path = DATA/'crater_tes_dust_10km.csv'
    protected = [*DATA.glob('*.tif'), *DATA.glob('*.csv')]
    protected = [p for p in protected if p not in (output, csv_path)]
    before = {p.name: digest(p) for p in protected}
    report = {'source_inspection': None, 'source_latitude_interpretation': convention,
              'registration_warning': 'Source provenance/latitude convention is not documented. Default follows declared ellipsoidal geodetic CRS; verify against original product documentation before scientific use.',
              'scientific_interpretation': 'Three RGB uint8 display channels, no calibrated dust variable, units, legend, or scientific product identifier in metadata. Do not interpret RGB as dust abundance, opacity or route cost.',
              'resampling': 'Nearest source pixel center selected by inverse coordinate mapping of every target cell center. No averaging, interpolation, normalization or color-to-physics conversion.'}
    with rasterio.open(dem) as reference, rasterio.open(source) as src:
        assert src.count == 3 and [c.name for c in src.colorinterp] == ['red','green','blue']
        assert set(src.dtypes) == {'uint8'} and src.crs.is_geographic
        assert reference.shape == (417,417) and tuple(reference.bounds) == (-5000.,-5000.,5000.,5000.)
        spec = src.crs.to_dict()
        a, rf = float(spec['a']), float(spec['rf'])
        b = a*(1-1/rf)
        assert np.isclose(a,3396190)
        sphere = CRS.from_string('+proj=longlat +R=3396190 +no_defs')
        report['source_inspection'] = inspect_source(src)
        rows, cols = np.indices(reference.shape)
        grid = reference.transform
        x = grid.c+(cols+.5)*grid.a+(rows+.5)*grid.b
        y = grid.f+(cols+.5)*grid.d+(rows+.5)*grid.e
        lon, lat = transform(reference.crs, sphere, x.ravel().tolist(), y.ravel().tolist())
        lon = np.asarray(lon).reshape(reference.shape)
        centric = np.asarray(lat).reshape(reference.shape)
        # Geodetic/planetographic latitude on the declared ellipsoid vs spherical
        # planetocentric latitude. No Earth datum or arbitrary ballpark transform.
        geographic = np.degrees(np.arctan2(a*a*np.sin(np.radians(centric)), b*b*np.cos(np.radians(centric))))
        lat = geographic if convention == 'declared_geodetic' else centric
        inverse = ~src.transform
        source_cols_float = inverse.a*lon+inverse.b*lat+inverse.c
        source_rows_float = inverse.d*lon+inverse.e*lat+inverse.f
        # Pixel coordinates refer to edges: floor chooses the nearest center.
        source_cols = np.floor(source_cols_float).astype(np.int64)
        source_rows = np.floor(source_rows_float).astype(np.int64)
        inside = (source_cols>=0)&(source_cols<src.width)&(source_rows>=0)&(source_rows<src.height)
        assert inside.all(), 'Target footprint extends outside TES raster'
        source_data = src.read(masked=True)
        sampled = source_data[:,source_rows,source_cols]
        band_valid = ~np.ma.getmaskarray(sampled)
        valid = band_valid.all(axis=0)
        raw = sampled.filled(0).astype('uint8')
        profile = dict(driver='GTiff',width=reference.width,height=reference.height,count=src.count,
                       dtype='uint8',crs=reference.crs,transform=grid,tiled=True,
                       blockxsize=256,blockysize=256,compress='deflate',photometric='RGB')
        with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
            with rasterio.open(output,'w',**profile) as dst:
                dst.write(raw)
                dst.write_mask(valid.astype('uint8')*255)
                dst.colorinterp = src.colorinterp
                dst.scales, dst.offsets = src.scales, src.offsets
                for index in src.indexes:
                    dst.set_band_description(index, f'TES display {src.colorinterp[index-1].name}; not a physical dust measurement')
                    dst.update_tags(index, **src.tags(index))
                dst.update_tags(SOURCE_FILE=source.name,SOURCE_SHA256=before[source.name],
                                RESAMPLING='nearest source center; inverse projected grid mapping',
                                SOURCE_LATITUDE_INTERPRETATION=convention,
                                VALUE_MEANING='RGB display channels only; physical variable and units unknown',
                                REGISTRATION='Follows declared source CRS; source convention needs provenance confirmation')
        csv_values = np.column_stack((rows.ravel(),cols.ravel(),x.ravel(),y.ravel(),
                                     *[np.where(band_valid[i],raw[i],np.nan).ravel() for i in range(src.count)]))
        np.savetxt(csv_path,csv_values,delimiter=',',header='row,col,x_m,y_m,band_1_red,band_2_green,band_3_blue',
                   comments='',fmt=['%d','%d','%.17g','%.17g','%.17g','%.17g','%.17g'])
        # Every CSV cell aligns with the altitude/slope table, no join or rounding needed.
        existing = np.loadtxt(reference_csv,delimiter=',',skiprows=1,usecols=(0,1,2,3))
        saved = np.loadtxt(csv_path,delimiter=',',skiprows=1)
        np.testing.assert_array_equal(saved[:,:4],existing)
        np.testing.assert_array_equal(saved,csv_values)
        np.testing.assert_array_equal(raw,source_data.data[:,source_rows,source_cols])
        with rasterio.open(output) as check:
            assert check.crs == reference.crs and check.transform == reference.transform
            assert check.bounds == reference.bounds and check.shape == reference.shape
            np.testing.assert_array_equal(check.read(),raw)
            np.testing.assert_array_equal(check.dataset_mask()>0,valid)
        # Independent scalar center check of the latitude convention and source cell.
        center_lon, center_centric = transform(reference.crs,sphere,[0],[0])
        assert np.allclose([center_lon[0],center_centric[0]],[22.03879,40.8563],atol=1e-9,rtol=0)
        center_graphic = math.degrees(math.atan(math.tan(math.radians(center_centric[0]))/(b/a)**2))
        selected_lat = center_graphic if convention=='declared_geodetic' else center_centric[0]
        center_row, center_col = src.index(center_lon[0],selected_lat)
        np.testing.assert_array_equal(raw[:,208,208],src.read(window=rasterio.windows.Window(center_col,center_row,1,1))[:,0,0])
        pairs = np.unique(np.column_stack((source_rows.ravel(),source_cols.ravel())),axis=0)
        colors = np.unique(raw.reshape(3,-1).T,axis=0)
        report.update({'output':output.name,'csv':csv_path.name,'rows':len(saved),
                       'dimensions':[reference.width,reference.height], 'bounds_m':list(reference.bounds),
                       'crs_wkt':reference.crs.to_wkt(),'resolution_m':list(reference.res),
                       'valid_pixels':int(valid.sum()), 'missing_pixels':int((~valid).sum()),
                       'distinct_source_pixels':len(pairs),'distinct_RGB_colors':len(colors),
                       'source_pixel_rows': [int(source_rows.min()),int(source_rows.max())],
                       'source_pixel_cols': [int(source_cols.min()),int(source_cols.max())],
                       'center':{'longitude_E':center_lon[0],'latitude_planetocentric_N':center_centric[0],
                                 'source_latitude_geodetic_N':center_graphic,'source_row':center_row,'source_col':center_col,
                                 'rgb':raw[:,208,208].tolist()},
                       'source_pixel_nominal_size_m':{'north_south':3396190*math.radians(src.res[1]),
                                                       'east_west_at_center':3396190*math.cos(math.radians(center_centric[0]))*math.radians(src.res[0])},
                       'verification':'All 173889 CSV row/col/x/y entries exactly match altitude CSV; every band equals selected source pixel; output CRS/transform/bounds and masks verified.',
                       'routing_suitability':'Not usable directly as a physical/scientific dust cost. Obtain calibrated numerical TES data with product definition, units, validity mask, native resolution and latitude convention.'})
    assert before == {p.name:digest(p) for p in protected}
    report['protected_source_hashes'] = before
    report['originals_unchanged'] = True
    (DATA/'crater_tes_dust_10km.metadata.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('source_inspection','protected_source_hashes','crs_wkt')},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-latitude-convention',choices=['declared_geodetic','planetocentric'],default='declared_geodetic',help='Default follows source CRS. Override only with source-product documentation; recorded in metadata.')
    main(parser.parse_args().source_latitude_convention)
