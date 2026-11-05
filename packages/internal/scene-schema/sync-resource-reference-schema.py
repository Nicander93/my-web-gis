"""Keep the portable reference definition in the city and legacy structural schemas."""
import json
from pathlib import Path

root = Path(__file__).parent
reference = {
    'oneOf': [
        {'type': 'object', 'additionalProperties': False, 'properties': {'kind': {'const': 'relative'},
         'path': {'type': 'string', 'minLength': 1}}, 'required': ['kind', 'path']},
        {'type': 'object', 'additionalProperties': False, 'properties': {'kind': {'const': 'absolute'},
         'path': {'type': 'string', 'minLength': 1}}, 'required': ['kind', 'path']},
        {'type': 'object', 'additionalProperties': False, 'properties': {'kind': {'const': 'url'},
         'url': {'type': 'string', 'pattern': '^https?://'}, 'credentialRef': {'type': 'string', 'pattern': r'\S'}},
         'required': ['kind', 'url']},
    ],
    '$comment': 'Structural shape only. validateResourceReference enforces path kind, protocols and credential exclusion.',
}
for path in [root.parent / 'cesium-scene-schema' / 'city.schema.json', root / 'scene.schema.json']:
    schema = json.loads(path.read_text(encoding='utf-8'))
    schema['$defs']['resourceReference'] = reference
    asset = schema['$defs']['cityAsset']
    asset['properties']['reference'] = {'$ref': '#/$defs/resourceReference'}
    if 'url' in asset.get('required', []):
        asset['required'].remove('url')
        asset['anyOf'] = [{'required': ['url']}, {'required': ['reference']}]
    elif 'anyOf' in asset:
        for branch in asset['anyOf']:
            if 'glb' in branch.get('properties', {}).get('type', {}).get('enum', []) and 'url' in branch.get('required', []):
                branch.pop('required')
                branch['anyOf'] = [{'required': ['url']}, {'required': ['reference']}]
            elif branch.get('properties', {}).get('type', {}).get('const') == 'geojson':
                choices = branch.get('anyOf', [])
                if {'required': ['reference']} not in choices:
                    choices.append({'required': ['reference']})
                branch['anyOf'] = choices
    path.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
