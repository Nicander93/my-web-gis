"""Reproducible SHP/SHX/UTF-8 DBF fixture; standard library only, public domain."""
import math
import struct
import zipfile
from pathlib import Path

WKT = 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","3857"]]'


def projected(lon, lat):
    return (6378137 * math.radians(lon), 6378137 * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def header(points, words):
    xs, ys = zip(*points)
    return struct.pack('>7i', 9994, 0, 0, 0, 0, 0, words) + struct.pack('<2i8d', 1000, 1, min(xs), min(ys), max(xs), max(ys), 0, 0, 0, 0)


def layer(rows):
    points = [projected(lon, lat) for _, _, lon, lat in rows]
    shp = header(points, 50 + 14 * len(rows))
    shx = header(points, 50 + 4 * len(rows))
    for index, point in enumerate(points):
        shp += struct.pack('>2i', index + 1, 10) + struct.pack('<i2d', 1, *point)
        shx += struct.pack('>2i', 50 + 14 * index, 10)
    dbf = bytearray(32)
    dbf[0:4] = bytes([3, 126, 10, 11])
    struct.pack_into('<IHH', dbf, 4, len(rows), 97, 81)
    for name in ['编号', '名称']:
        field = bytearray(32)
        field[:len(name.encode())] = name.encode()
        field[11], field[16] = ord('C'), 40
        dbf += field
    dbf += b'\r'
    for identifier, name, _, _ in rows:
        dbf += b' ' + str(identifier).encode().ljust(40, b' ') + name.encode().ljust(40, b' ')
    dbf += b'\x1a'
    return {'shp': shp, 'shx': shx, 'dbf': dbf, 'prj': WKT.encode(), 'cpg': b'UTF-8'}


if __name__ == '__main__':
    layers = {
        'stations': [('01', '北京站', 116.4, 39.9), ('02', '北站', 116.42, 39.91)],
        'sites': [('03', '试验点', 116.44, 39.92)],
        'excluded': [('04', '不导入', 116.46, 39.93)]
    }
    target = Path(__file__).with_name('projected-chinese-multi.zip')
    with zipfile.ZipFile(target, 'w') as archive:
        for name, rows in layers.items():
            for extension, content in layer(rows).items():
                info = zipfile.ZipInfo(f'{name}.{extension}', (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, content)
    print(target.name)
