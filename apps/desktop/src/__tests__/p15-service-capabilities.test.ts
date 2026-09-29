import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  capabilitiesForDataset,
  type GisFeature
} from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { getLayerCapabilities, layerCommands } from '@/app/commands/layer.commands'
import { _resetCredentialsForTests, getSessionCredential, putSessionCredential } from '@/services/credentials'
import { connectService } from '@/services/service-connect'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureXml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/ogc-io/fixtures/wms-1.3.0-capabilities.xml'),
  'utf8'
)

function feat(id: string): GisFeature {
  return {
    id,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { name: id }
  }
}

function resetStores(): void {
  useProjectStore.getState()._resetAttributeHistoryForTests()
  layerCommands._resetStyleHistoryForTests()
  useSessionStore.setState({ sessions: {} })
  _resetCredentialsForTests()
  useProjectStore.setState({
    project: createProject('P15 test'),
    featuresByDataset: {},
    dirty: false,
    selectedLayerId: null,
    selection: { layerId: null, featureIds: [] },
    lastSelectionCountAfterFilter: null
  })
}

describe('P15 service description / capabilities / connect', () => {
  beforeEach(() => {
    resetStores()
  })

  it('old vector projects still open after P15 types', () => {
    const store = useProjectStore.getState()
    store.addLayer('ds-a', 'A', [feat('a1')], 'point')
    const snap = {
      project: useProjectStore.getState().project,
      featuresByDataset: useProjectStore.getState().featuresByDataset
    }
    const restored = parseProjectSnapshot(serializeProjectSnapshot(snap))
    expect(restored.project.datasets[0]?.kind).toBe('vector')
    expect(restored.project.layers).toHaveLength(1)
  })

  it('service layer round-trip persists credentialRef only (no token value)', () => {
    const key = putSessionCredential({ kind: 'bearer', value: 'SUPER-SECRET' })
    const result = useProjectStore.getState().addServiceLayer({
      name: 'Cities WMS',
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms?map=/data',
        version: '1.3.0',
        layerNames: ['cities'],
        authMode: 'bearer',
        credentialRef: { key }
      }
    })
    expect(result).not.toBeNull()

    const snap = {
      project: useProjectStore.getState().project,
      featuresByDataset: useProjectStore.getState().featuresByDataset
    }
    const json = serializeProjectSnapshot(snap)
    expect(json).not.toContain('SUPER-SECRET')
    expect(json).toContain(key)

    const restored = parseProjectSnapshot(json)
    const ds = restored.project.datasets.find((d) => d.kind === 'wms')
    expect(ds?.kind).toBe('wms')
    if (ds?.kind === 'wms') {
      expect(ds.source.credentialRef?.key).toBe(key)
      expect(ds.source.url).toContain('map=')
      expect(JSON.stringify(ds)).not.toContain('SUPER-SECRET')
    }
  })

  it('WMS/WMTS layers cannot export or edit geometry via capabilities', () => {
    const added = useProjectStore.getState().addServiceLayer({
      name: 'Ortho',
      kind: 'wmts',
      source: {
        type: 'wmts',
        url: 'https://example.com/wmts',
        version: '1.0.0',
        layer: 'ortho',
        authMode: 'none'
      }
    })!
    const caps = getLayerCapabilities(added.layerId)
    expect(caps.isService).toBe(true)
    expect(caps.canExport).toBe(false)
    expect(caps.canCopy).toBe(false)
    expect(caps.canEditGeometry).toBe(false)
    expect(caps.canAttributeTable).toBe(false)

    const layer = useProjectStore.getState().project.layers.find((l) => l.id === added.layerId)!
    expect(layer.editable).toBe(false)
    const dataset = useProjectStore.getState().project.datasets.find((d) => d.id === layer.datasetId)
    expect(capabilitiesForDataset(dataset).editGeometry).toBe(false)
  })

  it('failed connect creates no empty layer', async () => {
    const before = useProjectStore.getState().project.layers.length
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    // Bypass connectService's native bridge by calling with a bad URL through mocked global fetch
    // connectService uses fetchTextPreferNative — stub fetch to fail.
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchImpl
    try {
      const result = await connectService({
        url: 'https://example.com/wms',
        service: 'WMS',
        auth: { mode: 'none' },
        generation: 1
      })
      expect(result.ok).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(useProjectStore.getState().project.layers.length).toBe(before)
  })

  it('successful connect does not dump catalog into project until addServiceLayer', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () =>
      new Response(fixtureXml, { status: 200, headers: { 'content-type': 'text/xml' } })
    ) as unknown as typeof fetch
    try {
      const result = await connectService({
        url: 'https://example.com/wms',
        service: 'WMS',
        auth: { mode: 'none' },
        generation: 2
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.selectable.length).toBeGreaterThan(0)
      }
      expect(useProjectStore.getState().project.layers).toHaveLength(0)

      // User selects one layer only
      if (result.ok) {
        const layer = result.selectable[0]!
        useProjectStore.getState().addServiceLayer({
          name: layer.title || layer.name,
          kind: 'wms',
          source: {
            type: 'wms',
            url: result.shareableUrl,
            version: result.description.version,
            layerNames: [layer.name],
            authMode: 'none'
          }
        })
      }
      expect(useProjectStore.getState().project.layers).toHaveLength(1)
      expect(useProjectStore.getState().project.datasets[0]?.kind).toBe('wms')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('session credential vault stores secrets off the project', () => {
    const key = putSessionCredential({ kind: 'query-token', param: 'token', value: 'abc' })
    expect(getSessionCredential(key)?.value).toBe('abc')
    const projectJson = serializeProjectSnapshot({
      project: useProjectStore.getState().project,
      featuresByDataset: {}
    })
    expect(projectJson).not.toContain('abc')
  })
})