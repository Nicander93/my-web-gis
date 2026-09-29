import { beforeEach, describe, expect, it } from 'vitest'
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
import { _resetCredentialsForTests } from '@/services/credentials'
import { listSelectableLayers, parseCapabilitiesXml } from '@desktop-webgis/ogc-io'
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
  useSessionStore.setState({ sessions: {} })
  _resetCredentialsForTests()
  useProjectStore.setState({
    project: createProject('P16 test'),
    featuresByDataset: {},
    dirty: false,
    selectedLayerId: null,
    selection: { layerId: null, featureIds: [] },
    lastSelectionCountAfterFilter: null
  })
}

describe('P16 WMS layers', () => {
  beforeEach(() => {
    // Commands emit status via window CustomEvent (jsdom-less vitest node env).
    ;(globalThis as unknown as { window: { dispatchEvent: (event?: unknown) => boolean } }).window = {
      dispatchEvent: () => true
    }
    resetStores()
  })

  it('adds WMS layer with inherited CRS/extent and persists on reopen', () => {
    const xml = readFileSync(join(fixturesDir, 'wms-1.3.0-capabilities.xml'), 'utf8')
    const desc = parseCapabilitiesXml(xml, {
      shareableUrl: 'https://example.com/wms',
      hint: 'WMS'
    })
    const rivers = listSelectableLayers(desc).find((l) => l.name === 'rivers')!
    expect(rivers.crs).toEqual(['EPSG:4326', 'EPSG:3857'])
    expect(rivers.bboxWgs84).toEqual([-180, -90, 180, 90])

    const added = useProjectStore.getState().addServiceLayer({
      name: rivers.title || rivers.name,
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms',
        version: desc.version,
        layerNames: [rivers.name],
        styleNames: ['default'],
        format: 'image/png',
        transparent: true,
        crs: 'EPSG:3857',
        bboxWgs84: rivers.bboxWgs84,
        authMode: 'none'
      }
    })!
    expect(added).toBeTruthy()

    const layer = useProjectStore.getState().project.layers.find((l) => l.id === added.layerId)!
    expect(layer.editable).toBe(false)
    expect(layer.opacity).toBe(1)

    useProjectStore.getState().setLayerOpacity(added.layerId, 0.4)
    expect(
      useProjectStore.getState().project.layers.find((l) => l.id === added.layerId)?.opacity
    ).toBe(0.4)

    const snap = {
      project: useProjectStore.getState().project,
      featuresByDataset: useProjectStore.getState().featuresByDataset
    }
    const restored = parseProjectSnapshot(serializeProjectSnapshot(snap))
    const ds = restored.project.datasets.find((d) => d.kind === 'wms')
    expect(ds?.kind).toBe('wms')
    if (ds?.kind === 'wms') {
      expect(ds.source.bboxWgs84).toEqual([-180, -90, 180, 90])
      expect(ds.source.crs).toBe('EPSG:3857')
      expect(ds.source.layerNames).toEqual(['rivers'])
    }
    expect(restored.project.layers[0]?.opacity).toBe(0.4)
  })

  it('does not expose attribute table / style for WMS', () => {
    const added = useProjectStore.getState().addServiceLayer({
      name: 'Cities',
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms',
        version: '1.3.0',
        layerNames: ['cities'],
        bboxWgs84: [-10, 40, 10, 60],
        authMode: 'none'
      }
    })!
    const caps = getLayerCapabilities(added.layerId)
    expect(caps.canAttributeTable).toBe(false)
    expect(caps.canStyle).toBe(false)
    expect(caps.canRetry).toBe(true)
    expect(caps.canZoom).toBe(true)
    const dataset = useProjectStore
      .getState()
      .project.datasets.find((d) => d.id === added.datasetId)
    expect(capabilitiesForDataset(dataset).queryAttributes).toBe(false)
  })

  it('visibility and z-order remain editable for WMS layers', () => {
    const a = useProjectStore.getState().addServiceLayer({
      name: 'A',
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms',
        version: '1.1.1',
        layerNames: ['dem'],
        authMode: 'none'
      }
    })!
    const feat: GisFeature = {
      id: 'v1',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {}
    }
    useProjectStore.getState().addLayer('local-ds', 'Local', [feat], 'point')
    useProjectStore.getState().setLayerVisible(a.layerId, false)
    const layer = useProjectStore.getState().project.layers.find((l) => l.id === a.layerId)!
    expect(layer.visible).toBe(false)
    useProjectStore.getState().moveLayer(a.layerId, 'up')
    const order = useProjectStore.getState().project.rootOrder.map((e) => e.id)
    expect(order[0]).toBe(a.layerId)
  })

  it('retryServiceLayer is gated to WMS/WMTS', () => {
    const wms = useProjectStore.getState().addServiceLayer({
      name: 'W',
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms',
        version: '1.3.0',
        layerNames: ['cities'],
        authMode: 'none'
      }
    })!
    layerCommands.retryServiceLayer(wms.layerId)
    expect(getLayerCapabilities(wms.layerId).canRetry).toBe(true)

    useProjectStore.getState().addLayer(
      'ds-local',
      'Local',
      [
        {
          id: '1',
          geometry: { type: 'Point', coordinates: [1, 1] },
          properties: {}
        }
      ],
      'point'
    )
    const localId = useProjectStore.getState().selectedLayerId!
    expect(getLayerCapabilities(localId).canRetry).toBe(false)
  })
})
