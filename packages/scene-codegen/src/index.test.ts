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
})
