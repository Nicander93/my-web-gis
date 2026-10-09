"""Build the v3 structural schema using the existing shared style/city contracts."""
import copy
import json
from pathlib import Path

root = Path(__file__).parent
legacy = json.loads((root / 'scene.schema.json').read_text(encoding='utf-8'))
defs = copy.deepcopy(legacy['$defs'])

def ref(name):
    return {'$ref': '#/$defs/' + name}

def obj(properties, required=(), closed=True):
    return {'type': 'object', 'properties': properties, 'required': list(required), 'additionalProperties': not closed}

string = {'type': 'string'}
boolean = {'type': 'boolean'}
number = {'type': 'number'}
text = ref('nonEmptyString')
array = lambda item: {'type': 'array', 'items': item}
count = {'type': 'integer', 'minimum': 0}
auth = {'enum': ['none', 'runtime']}
defs['wmsSource'] = obj(dict(type={'const': 'wms'}, url=text, version=text, layerNames=array(text), styleNames=array(string), format=string, transparent=boolean, crs=string, bboxWgs84=ref('extent'), authMode=auth), ['type', 'url', 'version', 'layerNames', 'authMode'])
defs['wmtsMatrix'] = obj(dict(identifier=text, scaleDenominator={'type': 'number', 'exclusiveMinimum': 0}, topLeftCorner=ref('numberPair'), tileWidth={'type': 'integer', 'minimum': 1}, tileHeight={'type': 'integer', 'minimum': 1}, matrixWidth={'type': 'integer', 'minimum': 1}, matrixHeight={'type': 'integer', 'minimum': 1}), ['identifier', 'scaleDenominator', 'topLeftCorner', 'tileWidth', 'tileHeight'])
defs['wmtsSource'] = obj(dict(type={'const': 'wmts'}, url=text, version=text, layer=text, style=string, format=string, tileMatrixSet=text, requestEncoding={'enum': ['KVP', 'REST']}, urls=array(text), projection=string, supportedCrs=string, bboxWgs84=ref('extent'), tileMatrices={**array(ref('wmtsMatrix')), 'minItems': 1}, authMode=auth), ['type', 'url', 'version', 'layer', 'tileMatrixSet', 'requestEncoding', 'tileMatrices', 'authMode'])
defs['wfsSource'] = obj(dict(type={'const': 'wfs'}, url=text, version=text, typeName=text, outputFormat=string, maxFeatures={'type': 'integer', 'minimum': 1}, srsName=string, bboxWgs84=ref('extent'), queryExtentWgs84=ref('extent'), extentMode={'enum': ['view', 'full']}, paginationUsed=boolean, loadedCount=count, complete=boolean, truncatedByLimit=boolean, duplicateIdCount=count, lastLoadedAt={'type': 'string', 'format': 'date-time'}, authMode=auth, snapshot=ref('geoJsonFeatureCollection')), ['type', 'url', 'version', 'typeName', 'authMode', 'snapshot'])
metadata = dict(title=string, fields=array(obj(dict(name=text, type={'enum': ['string', 'number', 'boolean', 'json']}, nullable=boolean), ['name', 'type', 'nullable'])), featureMetadata={'type': 'object', 'propertyNames': {'pattern': '^(string|number):'}, 'additionalProperties': obj(dict(sourceId={'type': ['string', 'number']}, overlaySourceId=string, sourceCrs=string, importId=string))}, authentication=obj(dict(mode={'enum': ['query-token', 'bearer']}, credential=text, tokenParam=string), ['mode']))
resource_names = ['geoJsonSource', 'xyzSource', 'tiandituSource', 'googleMapTilesSource', 'wmsSource', 'wmtsSource', 'wfsSource', 'cityAsset']
for name in resource_names:
    defs[name]['properties'].update(metadata)
defs['resource'] = {'oneOf': [ref(name) for name in resource_names]}
defs['filter'] = obj(dict(field=text, op={'enum': ['eq', 'neq', 'contains', 'lt', 'lte', 'gt', 'gte', 'is-empty', 'is-not-empty']}, value={}), ['field', 'op'])
defs['filter']['if'] = {'properties': {'op': {'enum': ['is-empty', 'is-not-empty']}}}
defs['filter']['else'] = {'required': ['value']}
node_names = ['tileLayer', 'vectorLayer', 'cityTileset', 'cityModel', 'cityGeoJson', 'cityWater', 'cityGraphic']
for name in node_names:
    definition = defs[name]
    props = definition['properties']
    for old in ['source', 'asset']:
        if old in props:
            props['resource'] = props.pop(old)
            definition['required'] = ['resource' if key == old else key for key in definition.get('required', [])]
    props.pop('groupId', None)
    props.update(parentId=text, locked=boolean)
defs['vectorLayer']['properties']['filter'] = array(ref('filter'))
defs['group'] = obj(dict(type={'const': 'group'}, id=text, name=text, visible=boolean, locked=boolean, parentId=text, scope={'enum': ['2d', '3d']}), ['type', 'id', 'name', 'visible'])
defs['node'] = {'oneOf': [ref(name) for name in [*node_names, 'group']]}
defs['view2d'] = copy.deepcopy(defs['view'])
defs['view2d']['properties']['type'] = {'const': '2d'}
defs['view2d']['required'].append('type')
defs['view3d'] = obj(dict(type={'const': '3d'}, camera=ref('cityCamera'), heightReference={'const': 'ellipsoid'}), ['type', 'camera', 'heightReference'])
environment = {key: defs['cityScene']['properties'][key] for key in ['basemap', 'terrain', 'effects', 'lighting']}
document = obj(dict(version={'const': 3}, id=text, title=text, description=string, resources={'type': 'object', 'propertyNames': text, 'additionalProperties': ref('resource')}, nodes=array(ref('node')), views={'type': 'object', 'minProperties': 1, 'additionalProperties': {'oneOf': [ref('view2d'), ref('view3d')]}}, activeView=text, environment=obj(environment), credentials=legacy['properties']['credentials'], widgets=ref('widgets'), theme=ref('theme'), presentation=ref('presentation'), metadata={'type': 'object'}, extensions={'type': 'object', 'additionalProperties': obj(dict(version={'type': 'integer', 'minimum': 1}, required=boolean, data={}), ['version', 'required', 'data'])}), ['version', 'id', 'title', 'resources', 'nodes', 'views', 'activeView'])
document.update({'$schema': legacy['$schema'], '$id': 'https://desktop-webgis.dev/schemas/scene-document-v3.json', 'title': 'Desktop WebGIS SceneDocument v3', '$comment': 'Structural validation only. Use validateSceneDocument for reference integrity, cycles, resource compatibility and cross-field constraints.', '$defs': defs})
(root / 'scene-document.schema.json').write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
