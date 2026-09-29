import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  capabilitiesForDataset
} from '@desktop-webgis/gis-core'
import {
  listSelectableLayers,
  parseCapabilitiesXml,
  WFS_DEFAULT_MAX_FEATURES
} from '@desktop-webgis/ogc-io'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { getLayerCapabilities, layerCommands } from '@/app/commands/layer.commands'
import { _resetCredentialsForTests } from '@/services/credentials'
import { startWfsBoundedLoad } from '@/services/wfs-commands'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/ogc-io/fixtures'
)

function resetStores(): void {
  useProjectStore.getState()._resetAttributeHistoryForTests()
  layerCommands._resetStyleHistoryForTests()
  useSessionStore.setState({
    sessions: {},
    mapViewExtentWgs84: [116.3, 39.8, 116.5, 40.0],
    wfsLoadGeneration: 0,
    wfsAbortByLayer: {}
  })
  _resetCredentialsForTests()
  useProjectStore.setState({
    project: createProject('P18 test'),
    featuresByDataset: {},
    dirty: false,
    selectedLayerId: null,
    selection: { layerId: null, featureIds: [] },
    lastSelectionCountAfterFilter: null
  })
}

describe('P18 WFS bounded snapshot', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: { dispatchEvent: (event?: unknown) => boolean } }).window = {
      dispatchEvent: () => true
    }
    resetStores()
  })

  it('adds WFS layer as read-only snapshot with metadata and reopen', async () => {
    const xml = readFileSync(join(fixturesDir, 'wfs-2.0.0-capabilities.xml'), 'utf8')
    const geojson = readFileSync(join(fixturesDir, 'wfs-getfeature-geojson.json'), 'utf8')
    const desc = parseCapabilitiesXml(xml, {
      shareableUrl: 'https://example.com/geoserver/wfs',
      hint: 'WFS'
    })
    const parks = listSelectableLayers(desc).find((l) => l.name === 'playground:parks')!

    const fetchImpl = vi.fn(async () => {
      return new Response(geojson, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    vi.stubGlobal('fetch', fetchImpl)

    const added = useProjectStore.getState().addServiceLayer({
      name: parks.title || parks.name,
      kind: 'wfs',
      source: {
        type: 'wfs',
        url: 'https://example.com/geoserver/wfs',
        version: desc.version,
        typeName: parks.name,
        outputFormat: 'application/json',
        maxFeatures: WFS_DEFAULT_MAX_FEATURES,
        srsName: 'EPSG:4326',
        bboxWgs84: parks.bboxWgs84,
        extentMode: 'view',
        authMode: 'none'
      }
    })!
    expect(added).toBeTruthy()

    const layer = useProjectStore.getState().project.layers.find((l) => l.id === added.layerId)!
    expect(layer.editable).toBe(false)

    await startWfsBoundedLoad({
      layerId: added.layerId,
      datasetId: added.datasetId,
      description: desc,
      selection: {
        typeName: parks.name,
        outputFormat: 'application/json',
        maxFeatures: 100,
        extentMode: 'view',
        viewExtentWgs84: [116.3, 39.8, 116.5, 40.0]
      },
      authMode: 'none',
      isRefresh: false
    })

    const features = useProjectStore.getState().featuresByDataset[added.datasetId] ?? []
    expect(features.length).toBe(2)

    const ds = useProjectStore.getState().project.datasets.find((d) => d.id === added.datasetId)
    expect(ds?.kind).toBe('wfs')
    if (ds?.kind === 'wfs') {
      expect(ds.source.loadedCount).toBe(2)
      expect(ds.source.complete).toBe(true)
      expect(ds.source.truncatedByLimit).toBe(false)
      expect(ds.source.queryExtentWgs84).toEqual([116.3, 39.8, 116.5, 40.0])
    }

    const caps = capabilitiesForDataset(ds)
    expect(caps.editGeometry).toBe(false)
    expect(caps.style).toBe(true)
    expect(caps.copyToLocal).toBe(true)
    expect(caps.filter).toBe(true)
    expect(caps.exportVector).toBe(true)

    const layerCaps = getLayerCapabilities(added.layerId)
    expect(layerCaps.canRetry).toBe(true)
    expect(layerCaps.canStyle).toBe(true)
    expect(layerCaps.canEditGeometry).toBe(false)

    const snap = {
      project: useProjectStore.getState().project,
      featuresByDataset: useProjectStore.getState().featuresByDataset
    }
    const restored = parseProjectSnapshot(serializeProjectSnapshot(snap))
    const restoredDs = restored.project.datasets.find((d) => d.kind === 'wfs')
    expect(restoredDs?.kind).toBe('wfs')
    if (restoredDs?.kind === 'wfs') {
      expect(restoredDs.source.loadedCount).toBe(2)
      expect(restored.featuresByDataset[restoredDs.id]?.length).toBe(2)
    }

    vi.unstubAllGlobals()
  })

  it('marks truncated loads incomplete and never as complete', async () => {
    const xml = readFileSync(join(fixturesDir, 'wfs-2.0.0-capabilities.xml'), 'utf8')
    const desc = parseCapabilitiesXml(xml, {
      shareableUrl: 'https://example.com/geoserver/wfs',
      hint: 'WFS'
    })
    // Return exactly maxFeatures features so truncatedByLimit=true
    const features = Array.from({ length: 3 }, (_, i) => ({
      type: 'Feature',
      id: `p.${i}`,
      geometry: { type: 'Point', coordinates: [116.4 + i * 0.01, 39.9] },
      properties: { name: `P${i}` }
    }))
    const body = JSON.stringify({ type: 'FeatureCollection', features })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    )

    const added = useProjectStore.getState().addServiceLayer({
      name: 'parks',
      kind: 'wfs',
      source: {
        type: 'wfs',
        url: 'https://example.com/geoserver/wfs',
        version: '2.0.0',
        typeName: 'playground:parks',
        outputFormat: 'application/json',
        maxFeatures: 3,
        extentMode: 'full',
        authMode: 'none'
      }
    })!

    await startWfsBoundedLoad({
      layerId: added.layerId,
      datasetId: added.datasetId,
      description: desc,
      selection: {
        typeName: 'playground:parks',
        maxFeatures: 3,
        extentMode: 'full'
      },
      authMode: 'none'
    })

    const ds = useProjectStore.getState().project.datasets.find((d) => d.id === added.datasetId)
    expect(ds?.kind).toBe('wfs')
    if (ds?.kind === 'wfs') {
      expect(ds.source.loadedCount).toBe(3)
      expect(ds.source.complete).toBe(false)
      expect(ds.source.truncatedByLimit).toBe(true)
    }
    vi.unstubAllGlobals()
  })

  it('refresh failure keeps previous snapshot', async () => {
    const xml = readFileSync(join(fixturesDir, 'wfs-2.0.0-capabilities.xml'), 'utf8')
    const geojson = readFileSync(join(fixturesDir, 'wfs-getfeature-geojson.json'), 'utf8')
    const desc = parseCapabilitiesXml(xml, {
      shareableUrl: 'https://example.com/geoserver/wfs',
      hint: 'WFS'
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(geojson, { status: 200, headers: { 'content-type': 'application/json' } })
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const added = useProjectStore.getState().addServiceLayer({
      name: 'parks',
      kind: 'wfs',
      source: {
        type: 'wfs',
        url: 'https://example.com/geoserver/wfs',
        version: '2.0.0',
        typeName: 'playground:parks',
        outputFormat: 'application/json',
        maxFeatures: 100,
        extentMode: 'view',
        authMode: 'none'
      }
    })!

    await startWfsBoundedLoad({
      layerId: added.layerId,
      datasetId: added.datasetId,
      description: desc,
      selection: {
        typeName: 'playground:parks',
        maxFeatures: 100,
        extentMode: 'view',
        viewExtentWgs84: [116.3, 39.8, 116.5, 40.0]
      },
      authMode: 'none'
    })
    expect(useProjectStore.getState().featuresByDataset[added.datasetId]?.length).toBe(2)

    await startWfsBoundedLoad({
      layerId: added.layerId,
      datasetId: added.datasetId,
      description: desc,
      selection: {
        typeName: 'playground:parks',
        maxFeatures: 100,
        extentMode: 'view',
        viewExtentWgs84: [116.3, 39.8, 116.5, 40.0]
      },
      authMode: 'none',
      isRefresh: true
    })
    expect(useProjectStore.getState().featuresByDataset[added.datasetId]?.length).toBe(2)
    vi.unstubAllGlobals()
  })

  it('copy to local creates editable vector without WFS-T', () => {
    const added = useProjectStore.getState().addServiceLayer({
      name: 'parks',
      kind: 'wfs',
      source: {
        type: 'wfs',
        url: 'https://example.com/wfs',
        version: '2.0.0',
        typeName: 'playground:parks',
        authMode: 'none'
      }
    })!
    useProjectStore.getState().setDatasetFeatures(added.datasetId, [
      {
        id: '1',
        geometry: { type: 'Point', coordinates: [116.4, 39.9] },
        properties: { name: 'A' }
      }
    ])

    const copied = useProjectStore.getState().copyFeaturesToLocalLayer(
      useProjectStore.getState().featuresByDataset[added.datasetId]!,
      'parks (本地)',
      'point'
    )
    expect(copied).toBeTruthy()
    const localDs = useProjectStore.getState().project.datasets.find((d) => d.id === copied!.datasetId)
    expect(localDs?.kind).toBe('vector')
    expect(capabilitiesForDataset(localDs).editGeometry).toBe(true)
    // Original WFS remains non-editable
    const wfsDs = useProjectStore.getState().project.datasets.find((d) => d.id === added.datasetId)
    expect(capabilitiesForDataset(wfsDs).editGeometry).toBe(false)
  })

  it('cancel / project switch / delete do not pollute state', async () => {
    const xml = readFileSync(join(fixturesDir, 'wfs-2.0.0-capabilities.xml'), 'utf8')
    const desc = parseCapabilitiesXml(xml, {
      shareableUrl: 'https://example.com/geoserver/wfs',
      hint: 'WFS'
    })

    const pendingFetch: { resolve: ((value: Response) => void) | null } = { resolve: null }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pendingFetch.resolve = resolve
          })
      )
    )

    const added = useProjectStore.getState().addServiceLayer({
      name: 'parks',
      kind: 'wfs',
      source: {
        type: 'wfs',
        url: 'https://example.com/geoserver/wfs',
        version: '2.0.0',
        typeName: 'playground:parks',
        outputFormat: 'application/json',
        maxFeatures: 100,
        extentMode: 'view',
        authMode: 'none'
      }
    })!

    const loadPromise = startWfsBoundedLoad({
      layerId: added.layerId,
      datasetId: added.datasetId,
      description: desc,
      selection: {
        typeName: 'playground:parks',
        maxFeatures: 100,
        extentMode: 'view',
        viewExtentWgs84: [116.3, 39.8, 116.5, 40.0]
      },
      authMode: 'none'
    })

    // Switch project generation mid-flight
    useSessionStore.getState().bumpWfsLoadGeneration()
    pendingFetch.resolve?.(
      new Response(readFileSync(join(fixturesDir, 'wfs-getfeature-geojson.json'), 'utf8'), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    await loadPromise
    // Features must not be applied after generation bump
    expect(useProjectStore.getState().featuresByDataset[added.datasetId] ?? []).toEqual([])

    vi.unstubAllGlobals()
  })
})
