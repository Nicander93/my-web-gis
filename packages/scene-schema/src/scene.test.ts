import { describe, expect, it } from 'vitest'
import {
  SceneValidationError,
  migrateScene,
  normalizeScene,
  parseScene,
  validateScene,
  type SceneManifestV1
} from './index.js'

function createScene(): SceneManifestV1 {
  return {
    version: 1,
    id: 'city-report',
    title: 'City report',
    view: {
      projection: 'EPSG:3857',
      center: [12958000, 4852000],
      zoom: 11
    },
    sources: {
      base: {
        type: 'xyz',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors'
      },
      stations: {
        type: 'geojson',
        url: './data/stations.geojson',
        dataProjection: 'EPSG:4326',
        idField: 'station_id'
      }
    },
    layers: [
      {
        id: 'osm',
        type: 'tile',
        name: 'Base map',
        source: 'base',
        role: 'basemap'
      },
      {
        id: 'stations',
        type: 'vector',
        name: 'Stations',
        source: 'stations',
        style: {
          type: 'point',
          radius: 7,
          fill: '#2563eb',
          stroke: '#ffffff',
          strokeWidth: 2
        },
        interaction: {
          popup: {
            titleField: 'name',
            fields: [{ field: 'name', label: 'Name', format: 'text' }]
          }
        }
      }
    ],
    widgets: {
      layerSwitcher: true,
      legend: true
    },
    presentation: {
      chapters: [
        {
          id: 'overview',
          title: 'Overview',
          view: {
            projection: 'EPSG:3857',
            center: [12958000, 4852000],
            zoom: 10
          },
          visibleLayers: ['osm', 'stations']
        }
      ]
    }
  }
}

describe('SceneManifest v1', () => {
  it('parses valid JSON and makes runtime defaults explicit', () => {
    const parsed = parseScene(JSON.stringify(createScene()))

    expect(parsed.version).toBe(2)
    expect(parsed.view.rotation).toBe(0)
    expect(parsed.layers[0]?.visible).toBe(true)
    expect(parsed.layers[0]?.opacity).toBe(1)
    expect(parsed.layers[1]?.type === 'vector' && parsed.layers[1].interaction?.selectable).toBe(false)
    expect(parsed.layers[1]?.type === 'vector' && parsed.layers[1].style.mode).toBe('single')
    expect(parsed.presentation?.chapters?.[0]?.view.rotation).toBe(0)
  })

  it('does not mutate the caller scene while normalizing', () => {
    const scene = createScene()
    const migrated = migrateScene(structuredClone(scene))
    const normalized = normalizeScene(migrated)

    expect(scene.view.rotation).toBeUndefined()
    expect(scene.layers[0]?.visible).toBeUndefined()
    expect(normalized).not.toBe(migrated)
    expect(normalized.version).toBe(2)
  })

  it('reports duplicate layers and broken references with precise paths', () => {
    const scene = createScene() as unknown as Record<string, unknown>
    const layers = scene.layers as Array<Record<string, unknown>>
    layers[1]!.id = 'osm'
    layers[1]!.source = 'missing'

    const result = validateScene(scene)

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '$.layers[1].id', code: 'id.duplicate' }),
        expect.objectContaining({ path: '$.layers[1].source', code: 'reference.source' })
      ])
    )
  })

  it('rejects ambiguous GeoJSON locations and local paths', () => {
    const scene = createScene() as unknown as Record<string, unknown>
    const sources = scene.sources as Record<string, Record<string, unknown>>
    sources.stations!.data = { type: 'FeatureCollection', features: [] }
    sources.stations!.url = 'C:\\private\\stations.geojson'

    const result = validateScene(scene)

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '$.sources.stations', code: 'source.location' }),
        expect.objectContaining({ path: '$.sources.stations.url', code: 'url.localPath' })
      ])
    )
  })

  it('rejects invalid opacity, tile templates and chapter layer references', () => {
    const scene = createScene() as unknown as Record<string, unknown>
    const layers = scene.layers as Array<Record<string, unknown>>
    layers[0]!.opacity = 2
    const sources = scene.sources as Record<string, Record<string, unknown>>
    sources.base!.url = 'https://example.com/tiles.png'
    const presentation = scene.presentation as Record<string, unknown>
    const chapters = presentation.chapters as Array<Record<string, unknown>>
    chapters[0]!.visibleLayers = ['missing']

    const result = validateScene(scene)

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'range.opacity' }),
        expect.objectContaining({ code: 'xyz.placeholders' }),
        expect.objectContaining({ code: 'reference.layer' })
      ])
    )
  })

  it('throws a typed error for malformed JSON', () => {
    expect(() => parseScene('{')).toThrow(SceneValidationError)
    try {
      parseScene('{')
    } catch (error) {
      expect(error).toBeInstanceOf(SceneValidationError)
      expect((error as SceneValidationError).issues[0]?.code).toBe('json.syntax')
    }
  })

  it('warns on unknown top-level fields instead of silently accepting typos', () => {
    const scene = { ...createScene(), layres: [] }
    const result = validateScene(scene)

    expect(result.issues).toContainEqual({
      path: '$.layres',
      code: 'field.unknown',
      message: '未知顶层字段'
    })
  })

  it('validates provider credentials without storing the secret', () => {
    const scene = createScene() as unknown as Record<string, unknown>
    scene.credentials = {
      tianditu: { type: 'runtime-reference', key: 'TIANDITU_TOKEN' }
    }
    const sources = scene.sources as Record<string, unknown>
    sources.base = {
      type: 'provider',
      provider: 'tianditu',
      mapType: 'imagery',
      withLabels: true,
      credential: 'tianditu'
    }

    expect(validateScene(scene).valid).toBe(true)
    ;(sources.base as Record<string, unknown>).credential = 'missing'
    expect(validateScene(scene).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'reference.credential' })])
    )
  })
})


describe('SceneManifest v2 and migration', () => {
  it('migrates v1 point style and field label into single LayerStyle', () => {
    const scene = createScene()
    const layers = scene.layers as Array<Record<string, unknown>>
    layers[1]!.label = {
      field: 'name',
      color: '#172033',
      haloColor: '#ffffff',
      haloWidth: 3,
      font: '14px sans-serif',
      offset: [0, -18],
      minZoom: 8,
      maxZoom: 16
    }

    const migrated = migrateScene(scene)
    expect(migrated.version).toBe(2)
    const vector = migrated.layers[1]
    expect(vector?.type).toBe('vector')
    if (vector?.type !== 'vector') throw new Error('expected vector')
    expect(vector.style.mode).toBe('single')
    if (vector.style.mode !== 'single') throw new Error('expected single')
    expect(vector.style.symbol).toMatchObject({
      type: 'circle',
      radius: 7,
      fill: { r: 37, g: 99, b: 235, a: 1 },
      stroke: { r: 255, g: 255, b: 255, a: 1 },
      strokeWidth: 2
    })
    expect(vector.style.label).toMatchObject({
      field: 'name',
      fontSize: 14,
      color: { r: 23, g: 32, b: 51, a: 1 },
      strokeColor: { r: 255, g: 255, b: 255, a: 1 },
      strokeWidth: 3,
      offsetX: 0,
      offsetY: -18,
      minZoom: 8,
      maxZoom: 16
    })
    expect('label' in vector && (vector as { label?: unknown }).label).toBeFalsy()
  })

  it('accepts native v2 categorized styles and rejects stuffing mode into v1', () => {
    const v2 = {
      version: 2,
      id: 'cats',
      title: 'Cats',
      view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
      sources: {
        places: { type: 'geojson', url: './data/places.geojson' }
      },
      layers: [
        {
          id: 'places',
          type: 'vector',
          name: 'Places',
          source: 'places',
          style: {
            mode: 'categorized',
            field: 'status',
            categories: [
              {
                value: 'open',
                symbol: { type: 'circle', radius: 6, fill: { r: 0, g: 160, b: 0, a: 1 } }
              }
            ],
            fallback: { type: 'circle', radius: 4, fill: { r: 120, g: 120, b: 120, a: 1 } },
            label: { field: 'name', fontSize: 12 }
          }
        }
      ]
    }

    const parsed = parseScene(v2)
    expect(parsed.version).toBe(2)
    expect(parsed.layers[0]?.type === 'vector' && parsed.layers[0].style.mode).toBe('categorized')

    const stuffed = {
      ...createScene(),
      layers: [
        {
          id: 'stations',
          type: 'vector',
          name: 'Stations',
          source: 'stations',
          style: {
            mode: 'categorized',
            field: 'status',
            categories: [],
            fallback: { type: 'circle', radius: 4 }
          }
        }
      ]
    }
    const result = validateScene(stuffed)
    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'style.type' })])
    )
  })

  it('rejects version 2 documents that keep a top-level legacy label field', () => {
    const result = validateScene({
      version: 2,
      id: 'legacy-label',
      title: 'Legacy label',
      view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
      sources: { places: { type: 'geojson', url: './x.geojson' } },
      layers: [
        {
          id: 'places',
          type: 'vector',
          name: 'Places',
          source: 'places',
          style: {
            mode: 'single',
            symbol: { type: 'circle', radius: 5, fill: { r: 1, g: 2, b: 3, a: 1 } }
          },
          label: { field: 'name' }
        }
      ]
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'style.legacyLabel' })])
    )
  })
})

