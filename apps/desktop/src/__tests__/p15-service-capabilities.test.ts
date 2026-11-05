import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectEdits } from '@/project/project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  capabilitiesForDataset,
  type GisFeature
} from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { getLayerCapabilities, layerCommands } from '@/commands/layer.commands'
import {
  _resetCredentialsForTests,
  _setSecureCredentialBackendForTests,
  getSessionCredential,
  putSessionCredential
} from '@/platform/credentials'
import { connectService } from '@/io/service-connect'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureXml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/public/ogc-io/fixtures/wms-1.3.0-capabilities.xml'),
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
  projectEdits.clear()
  layerCommands._resetStyleHistoryForTests()
  useLayerViewStore.setState({ sessions: {} })
  _resetCredentialsForTests()
  useProjectStore.setState({ project: createProject('P15 test'), dirty: false }); featureData.replaceAll({}); useLayerViewStore.setState({ selectedLayerId: null, selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: null })
}

describe('P15 service description / capabilities / connect', () => {
  beforeEach(() => {
    resetStores()
  })

  it('old vector projects still open after P15 types', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('ds-a', 'A', [feat('a1')], 'point')
    const snap = {
      project: useProjectStore.getState().project,
      featuresByDataset: featureData.readSnapshot()
    }
    const restored = parseProjectSnapshot(serializeProjectSnapshot(snap))
    expect(requireMapContent(restored.project).datasets[0]?.kind).toBe('vector')
    expect(requireMapContent(restored.project).layers).toHaveLength(1)
  })

  it('service layer round-trip persists credentialRef only (no token value)', () => {
    const key = putSessionCredential({ kind: 'bearer', value: 'SUPER-SECRET' })
    const result = layerContentCommands.addServiceLayer({
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
      featuresByDataset: featureData.readSnapshot()
    }
    const json = serializeProjectSnapshot(snap)
    expect(json).not.toContain('SUPER-SECRET')
    expect(json).toContain(key)

    const restored = parseProjectSnapshot(json)
    const ds = requireMapContent(restored.project).datasets.find((d) => d.kind === 'wms')
    expect(ds?.kind).toBe('wms')
    if (ds?.kind === 'wms') {
      expect(ds.source.credentialRef?.key).toBe(key)
      expect(ds.source.url).toContain('map=')
      expect(JSON.stringify(ds)).not.toContain('SUPER-SECRET')
    }
  })

  it('WMS/WMTS layers cannot export or edit geometry via capabilities', () => {
    const added = layerContentCommands.addServiceLayer({
      name: 'Ortho',
      kind: 'wmts',
      source: {
        type: 'wmts',
        url: 'https://example.com/wmts',
        version: '1.0.0',
        layer: 'ortho',
        tileMatrixSet: 'GoogleMapsCompatible',
        requestEncoding: 'KVP',
        tileMatrices: [
          {
            identifier: '0',
            scaleDenominator: 559082264.0287178,
            topLeftCorner: [-20037508.34278925, 20037508.34278925],
            tileWidth: 256,
            tileHeight: 256
          }
        ],
        authMode: 'none'
      }
    })!
    const caps = getLayerCapabilities(added.layerId)
    expect(caps.isService).toBe(true)
    expect(caps.canExport).toBe(false)
    expect(caps.canCopy).toBe(false)
    expect(caps.canEditGeometry).toBe(false)
    expect(caps.canAttributeTable).toBe(false)

    const layer = requireMapContent(useProjectStore.getState().project).layers.find((l) => l.id === added.layerId)!
    expect(layer.editable).toBe(false)
    const dataset = requireMapContent(useProjectStore.getState().project).datasets.find((d) => d.id === layer.datasetId)
    expect(capabilitiesForDataset(dataset).editGeometry).toBe(false)
  })

  it('failed connect creates no empty layer', async () => {
    const before = requireMapContent(useProjectStore.getState().project).layers.length
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    // 用错误的 URL 配合 mock 过的全局 fetch，绕过 connectService 的原生桥接。
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
    expect(requireMapContent(useProjectStore.getState().project).layers.length).toBe(before)
  })

  it('persists credentials only after a successful connect', async () => {
    const backend = {
      isAvailable: () => true,
      set: vi.fn(async (_key: string, _payload: string) => {}),
      get: vi.fn(async () => null),
      delete: vi.fn(async (_key: string) => {})
    }
    _setSecureCredentialBackendForTests(backend)

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
      const failed = await connectService({
        url: 'https://example.com/wms',
        service: 'WMS',
        auth: { mode: 'bearer', token: 'FAILED-TOKEN' },
        generation: 3
      })
      expect(failed.ok).toBe(false)
      expect(backend.set).not.toHaveBeenCalled()

      backend.set.mockClear()
      globalThis.fetch = vi.fn(async () =>
        new Response(fixtureXml, { status: 200, headers: { 'content-type': 'text/xml' } })
      ) as unknown as typeof fetch
      const succeeded = await connectService({
        url: 'https://example.com/wms',
        service: 'WMS',
        auth: { mode: 'bearer', token: 'SUCCESS-TOKEN' },
        generation: 4
      })
      expect(succeeded.ok).toBe(true)
      expect(backend.set).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
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
      expect(requireMapContent(useProjectStore.getState().project).layers).toHaveLength(0)

      // 用户只能选择一个图层。
      if (result.ok) {
        const layer = result.selectable[0]!
        layerContentCommands.addServiceLayer({
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
      expect(requireMapContent(useProjectStore.getState().project).layers).toHaveLength(1)
      expect(requireMapContent(useProjectStore.getState().project).datasets[0]?.kind).toBe('wms')
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