import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('ships a self-contained v3 schema with resolvable references for both engines', () => {
  const schema = JSON.parse(readFileSync(new URL('../scene-document.schema.json', import.meta.url), 'utf8'))
  expect(schema.properties.version.const).toBe(3)
  expect(schema.additionalProperties).toBe(false)
  expect(schema.$defs.cityAsset.properties.type.enum).toEqual(['3dtiles', 'glb'])
  expect(schema.$defs.vectorLayer.properties.style).toEqual({ $ref: '#/$defs/layerStyle' })
  expect(schema.$defs.geoJsonFeatureCollection.properties.features.items).toEqual({ $ref: '#/$defs/geoJsonFeature' })
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if ('$ref' in value) {
      const reference = String(value.$ref)
      expect(reference.startsWith('#/$defs/')).toBe(true)
      expect(schema.$defs[reference.slice('#/$defs/'.length)]).toBeDefined()
    }
    Object.values(value).forEach(walk)
  }
  walk(schema)
  for (const name of ['wmsSource', 'wmtsSource', 'wfsSource', 'cityAsset']) {
    expect(schema.$defs[name].properties.authentication).toBeDefined()
  }
  for (const name of ['tileLayer', 'vectorLayer', 'cityTileset', 'cityModel', 'cityGeoJson']) {
    expect(schema.$defs[name].required).toContain('resource')
    expect(schema.$defs[name].properties.source).toBeUndefined()
    expect(schema.$defs[name].properties.asset).toBeUndefined()
  }
})
