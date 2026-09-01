import { describe, expect, it } from 'vitest'
import {
  SceneValidationError,
  normalizeScene,
  parseScene,
  validateScene,
  type SceneManifest
} from './index.js'

function createScene(): SceneManifest {
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

    expect(parsed.view.rotation).toBe(0)
    expect(parsed.layers[0]?.visible).toBe(true)
    expect(parsed.layers[0]?.opacity).toBe(1)
    expect(parsed.layers[1]?.type === 'vector' && parsed.layers[1].interaction?.selectable).toBe(false)
    expect(parsed.presentation?.chapters?.[0]?.view.rotation).toBe(0)
  })

  it('does not mutate the caller scene while normalizing', () => {
    const scene = createScene()
    const normalized = normalizeScene(scene)

    expect(scene.view.rotation).toBeUndefined()
    expect(scene.layers[0]?.visible).toBeUndefined()
    expect(normalized).not.toBe(scene)
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
