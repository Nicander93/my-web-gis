import { describe, expect, it } from 'vitest'
import { generateOpenLayersModule } from './index.js'

describe('OpenLayers code generation', () => {
  it('embeds a validated scene and runtime credential references without secrets', () => {
    const code = generateOpenLayersModule({
      version: 1,
      id: 'report',
      title: 'Report',
      view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
      credentials: { tianditu: { type: 'runtime-reference', key: 'TDT_TOKEN' } },
      sources: {
        base: {
          type: 'provider',
          provider: 'tianditu',
          mapType: 'vector',
          credential: 'tianditu'
        }
      },
      layers: [{ id: 'base', name: 'Base', type: 'tile', source: 'base' }]
    })

    expect(code).toContain("createSceneRuntime")
    expect(code).toContain('globalThis["__MAP_CREDENTIALS__"]')
    expect(code).toContain('"tianditu"')
    expect(code).not.toContain('secret-token')
  })


  it('preserves categorized styles in generated modules (no silent downgrade)', () => {
    const code = generateOpenLayersModule({
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
          name: 'Places',
          type: 'vector',
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
            fallback: { type: 'circle', radius: 3, fill: { r: 90, g: 90, b: 90, a: 1 } }
          }
        }
      ]
    })

    expect(code).toContain('"version": 2')
    expect(code).toContain('"mode": "categorized"')
    expect(code).toContain('"field": "status"')
    expect(code).not.toContain('"type": "point"')
  })

  it('migrates legacy v1 scenes during codegen', () => {
    const code = generateOpenLayersModule({
      version: 1,
      id: 'legacy',
      title: 'Legacy',
      view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
      sources: {
        places: { type: 'geojson', url: './data/places.geojson' }
      },
      layers: [
        {
          id: 'places',
          name: 'Places',
          type: 'vector',
          source: 'places',
          style: { type: 'point', radius: 6, fill: '#2563eb' },
          label: { field: 'name', color: '#111111' }
        }
      ]
    } as never)

    expect(code).toContain('"version": 2')
    expect(code).toContain('"mode": "single"')
    expect(code).toContain('"field": "name"')
  })

})
