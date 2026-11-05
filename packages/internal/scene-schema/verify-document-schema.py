"""Exercise the published Draft 2020-12 contract (requires Python jsonschema)."""
import copy
import json
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads((Path(__file__).parent / 'scene-document.schema.json').read_text(encoding='utf-8'))
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
document = dict(version=3, id='consumer', title='Consumer', resources={}, nodes=[], views={'map': dict(type='2d', projection='EPSG:3857', center=[0, 0], zoom=2)}, activeView='map')
for resource in [dict(type='geojson', url='./data.geojson'), dict(type='3dtiles', url='./tiles/tileset.json'), dict(type='glb', url='./model.glb'), dict(type='wms', url='https://example.test/wms', version='1.3.0', layerNames=['roads'], authMode='none')]:
    document['resources'] = {'data': resource}
    validator.validate(document)
for geometry in [dict(type='Point', coordinates=[1, 2]), dict(type='LineString', coordinates=[[0, 0], [1, 1]]), dict(type='Polygon', coordinates=[[[0, 0], [1, 0], [1, 1], [0, 0]]]), dict(type='GeometryCollection', geometries=[]), None]:
    document['resources'] = {'data': dict(type='geojson', data=dict(type='FeatureCollection', features=[dict(type='Feature', id=1, properties={}, geometry=geometry)]))}
    validator.validate(document)
invalid = copy.deepcopy(document)
invalid['resources']['data']['data']['features'][0]['geometry'] = dict(type='Point', coordinates=[1])
assert not validator.is_valid(invalid)
invalid = copy.deepcopy(document)
invalid['extensions'] = {'unscoped': dict(version=1, required=False, data={})}
assert not validator.is_valid(invalid)
invalid = copy.deepcopy(document)
invalid['nodes'] = [dict(type='vector', id='points', name='Points', resource='data', style=dict(type='point', radius=5, fill='#ffffff'))]
assert not validator.is_valid(invalid)
print('Draft 2020-12: resources, geometries and negative contracts passed')
