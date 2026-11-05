import { describe, expect, it, vi } from 'vitest'
import { isManagedDatasetFile, readManagedDatasetFile, stringifyManagedDatasetFile } from './dataset-file'
import { stringifyGeoJson } from './geojson'
import type { DatasetField, GisFeature } from './types'

function row(): GisFeature {
  return { id: 'stable-id', geometry: { type: 'Point', coordinates: [116.4, 39.9, 7] }, properties: { code: '001', data: { enabled: false, values: [1, null, '二'] } },
    metadata: { sourceId: 42, overlaySourceId: 'overlay', sourceCrs: 'EPSG:3857', importId: 'original-import' } }
}
const fields: DatasetField[] = [{ name: 'code', type: 'string', nullable: false }, { name: 'data', type: 'json', nullable: true }]

describe('managed GeoJSON source codec', () => {
  it('round trips stable internal IDs, source provenance, declared fields and canonical coordinates', () => {
    const feature = row(), text = stringifyManagedDatasetFile([feature], fields), parsed = JSON.parse(text)
    expect(isManagedDatasetFile(parsed)).toBe(true)
    expect(parsed['webgis:dataset']).toEqual({ version: 1, coordinateCrs: 'EPSG:4326' })
    expect(readManagedDatasetFile(text)).toEqual({ features: [feature], fields })
    const loaded = readManagedDatasetFile(text); loaded.features[0].properties.code = 'changed'
    expect(feature.properties.code).toBe('001')
    expect(JSON.parse(stringifyGeoJson([feature], fields))).not.toHaveProperty('webgis:dataset')
  })

  it('retains empty/all-null typed columns and omits host-only scene mappings', () => {
    const schema: DatasetField[] = [{ name: 'empty', type: 'number', nullable: true }]
    expect(readManagedDatasetFile(stringifyManagedDatasetFile([], schema))).toEqual({ features: [], fields: schema })
    const feature = row(); feature.properties = { empty: null }; feature.metadata!.sceneFeatureId = 'host'; feature.metadata!.sceneMetadataPresent = true
    const loaded = readManagedDatasetFile(stringifyManagedDatasetFile([feature], schema))
    expect(loaded.features[0].properties).toEqual({ empty: null })
    expect(loaded.features[0].metadata).toEqual({ sourceId: 42, overlaySourceId: 'overlay', sourceCrs: 'EPSG:3857', importId: 'original-import' })
  })

  it.each([undefined, Number.NaN, Infinity, BigInt(1), new Date(), () => 1, Symbol('value')])('refuses non-JSON attributes instead of coercing or omitting %s', value => {
    const feature = row(); feature.properties = { value }
    expect(() => stringifyManagedDatasetFile([feature])).toThrow()
  })

  it('rejects sparse arrays, cycles and getters without invoking them', () => {
    const feature = row(), getter = vi.fn(() => 'secret')
    feature.properties = { value: new Array(2) }
    expect(() => stringifyManagedDatasetFile([feature])).toThrow('sparse')
    feature.properties = {}; feature.properties.cycle = feature.properties
    expect(() => stringifyManagedDatasetFile([feature])).toThrow('cyclic')
    feature.properties = {}; Object.defineProperty(feature.properties, 'value', { enumerable: true, get: getter })
    expect(() => stringifyManagedDatasetFile([feature])).toThrow('non-JSON property')
    expect(getter).not.toHaveBeenCalled()
  })

  it('fails the whole managed read for unsupported versions, duplicate IDs and invalid geometries', () => {
    const original = JSON.parse(stringifyManagedDatasetFile([row()], fields))
    const version = structuredClone(original); version['webgis:dataset'].version = 2
    expect(() => readManagedDatasetFile(version)).toThrow('Unsupported')
    const duplicate = structuredClone(original); duplicate.features.push(structuredClone(duplicate.features[0]))
    expect(() => readManagedDatasetFile(duplicate)).toThrow('duplicate')
    const bad = structuredClone(original); bad.features[0].geometry = { type: 'GeometryCollection', geometries: [] }
    expect(() => readManagedDatasetFile(bad)).toThrow('geometry')
    const numeric = structuredClone(original); numeric.features[0].id = 42
    expect(() => readManagedDatasetFile(numeric)).toThrow('feature')
    const metadata = structuredClone(original); metadata.features[0]['webgis:metadata'].sceneFeatureId = 5
    expect(() => readManagedDatasetFile(metadata)).toThrow('Unsupported')
    const extra = structuredClone(original); extra.originalDocument = { value: 1 }
    expect(() => readManagedDatasetFile(extra)).toThrow('Unsupported')
  })

  it('validates topology/schema before writing and preserves closed rings and metadata presence', () => {
    const feature = row(); feature.geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }; delete feature.metadata
    expect(readManagedDatasetFile(stringifyManagedDatasetFile([feature], fields)).features).toEqual([feature])
    feature.geometry.coordinates[0][3] = [0, 1]
    expect(() => stringifyManagedDatasetFile([feature], fields)).toThrow('geometry')
    expect(() => stringifyManagedDatasetFile([row(), row()], fields)).toThrow('duplicate')
    const required: DatasetField[] = [{ name: 'missing', type: 'string', nullable: false }]
    expect(() => stringifyManagedDatasetFile([row()], required)).toThrow('does not allow null')
  })
})
