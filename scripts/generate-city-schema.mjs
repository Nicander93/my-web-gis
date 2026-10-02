import { readFile, writeFile } from 'node:fs/promises'

// JSON Schema complements the TypeScript validator. Cross-resource references,
// unique node IDs and distinct polygon points are validated by parseCityScene.
const number = { type: 'number' }
const text = { type: 'string' }
const boolean = { type: 'boolean' }
const positive = { type: 'number', exclusiveMinimum: 0 }
const ref = name => ({ $ref: `#/$defs/${name}` })
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required })
const tuple = items => ({ type: 'array', prefixItems: items, minItems: items.length, maxItems: items.length })
const base = { id: { type: 'string', pattern: '\\S' }, name: text, visible: boolean, popup: ref('cityPopup') }
const asset = { asset: text }
const node = properties => object({ ...base, ...properties }, ['id', 'name', 'visible', ...Object.keys(properties).filter(key => !['maximumScreenSpaceError', 'cacheBytes', 'color'].includes(key))])
const defs = {
  cityPosition: tuple([{ type: 'number', minimum: -180, maximum: 180 }, { type: 'number', minimum: -90, maximum: 90 }, number]),
  cityTriple: tuple([number, number, number]),
  cityTransform: object({ translation: ref('cityTriple'), rotation: ref('cityTriple'), scale: { ...positive, maximum: 10000 } }),
  cityPopup: object({ title: text, titleField: text, fields: { type: 'array', items: object({ field: text, label: text }, ['field']) } }, ['fields']),
  cityCamera: object({ position: ref('cityPosition'), heading: number, pitch: { type: 'number', minimum: -90, maximum: 90 }, roll: number }),
  cityAsset: object({ type: { enum: ['3dtiles', 'glb', 'geojson'] }, url: { type: 'string', minLength: 1 } }),
  cityTileset: node({ type: { const: '3dtiles' }, ...asset, transform: ref('cityTransform'), maximumScreenSpaceError: positive, cacheBytes: positive }),
  cityModel: node({ type: { const: 'model' }, ...asset, position: ref('cityPosition'), transform: ref('cityTransform') }),
  cityGeoJson: node({ type: { const: 'geojson' }, ...asset, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } }),
  cityWater: node({ type: { const: 'water' }, boundary: { type: 'array', minItems: 3, items: ref('cityPosition') }, height: number, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' }, amplitude: { ...number, minimum: 0 }, frequency: positive, speed: { ...number, minimum: 0 } }),
  cityScene: object({ version: { const: 1 }, camera: ref('cityCamera'), basemap: object({ url: text, attribution: text }, ['url']), terrain: object({ url: text }), assets: { type: 'object', additionalProperties: ref('cityAsset') }, nodes: { type: 'array', items: { oneOf: ['cityTileset', 'cityModel', 'cityGeoJson', 'cityWater'].map(ref) } }, effects: object({ fog: { ...number, minimum: 0, maximum: 1 }, bloom: boolean }) }, ['version', 'camera', 'assets', 'nodes', 'effects'])
}
const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'CityScene v1', ...ref('cityScene'), $defs: defs }
defs.cityWater.required.push('color')
await writeFile(new URL('../packages/cesium-scene-schema/city.schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n')
const scenePath = new URL('../packages/scene-schema/scene.schema.json', import.meta.url)
const scene = JSON.parse(await readFile(scenePath, 'utf8'))
scene.properties.city = ref('cityScene')
Object.assign(scene.$defs, defs)
scene.allOf = [{ if: { required: ['city'] }, then: { properties: { version: { const: 2 } } } }]
await writeFile(scenePath, JSON.stringify(scene, null, 2) + '\n')
