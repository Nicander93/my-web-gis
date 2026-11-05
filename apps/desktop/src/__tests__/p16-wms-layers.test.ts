import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectEdits } from '@/project/project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it } from 'vitest'
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
import { _resetCredentialsForTests } from '@/platform/credentials'
import { listSelectableLayers, parseCapabilitiesXml } from '@desktop-webgis/ogc-io'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/public/ogc-io/fixtures'
)

function resetStores(): void {
  projectEdits.clear()
  layerCommands._resetStyleHistoryForTests()
  useLayerViewStore.setState({ sessions: {} })
  _resetCredentialsForTests()
  useProjectStore.setState({ project: createProject('P16 test'), dirty: false }); featureData.replaceAll({}); useLayerViewStore.setState({ selectedLayerId: null, selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: null })
}

describe('P16 WMS layers', () => {
  beforeEach(() => {
    // 命令通过 window 上的 CustomEvent 发出状态（因为测试跑在没有 jsdom 的 node 环境里）。
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

    const added = layerContentCommands.addServiceLayer({
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

    const layer = requireMapContent(useProjectStore.getState().project).layers.find((l) => l.id === added.layerId)!
    expect(layer.editable).toBe(false)
    expect(layer.opacity).toBe(1)

    layerConfigurationCommands.setLayerOpacity(added.layerId, 0.4)
    expect(
      requireMapContent(useProjectStore.getState().project).layers.find((l) => l.id === added.layerId)?.opacity
    ).toBe(0.4)

    const snap = {
      project: useProjectStore.getState().project,
      featuresByDataset: featureData.readSnapshot()
    }
    const restored = parseProjectSnapshot(serializeProjectSnapshot(snap))
    const ds = requireMapContent(restored.project).datasets.find((d) => d.kind === 'wms')
    expect(ds?.kind).toBe('wms')
    if (ds?.kind === 'wms') {
      expect(ds.source.bboxWgs84).toEqual([-180, -90, 180, 90])
      expect(ds.source.crs).toBe('EPSG:3857')
      expect(ds.source.layerNames).toEqual(['rivers'])
    }
    expect(requireMapContent(restored.project).layers[0]?.opacity).toBe(0.4)
  })

  it('does not expose attribute table / style for WMS', () => {
    const added = layerContentCommands.addServiceLayer({
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
    const dataset = requireMapContent(useProjectStore
      .getState()
      .project).datasets.find((d) => d.id === added.datasetId)
    expect(capabilitiesForDataset(dataset).queryAttributes).toBe(false)
  })

  it('visibility and z-order remain editable for WMS layers', () => {
    const a = layerContentCommands.addServiceLayer({
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
    layerContentCommands.addLayer('local-ds', 'Local', [feat], 'point')
    layerConfigurationCommands.setLayerVisible(a.layerId, false)
    const layer = requireMapContent(useProjectStore.getState().project).layers.find((l) => l.id === a.layerId)!
    expect(layer.visible).toBe(false)
    layerConfigurationCommands.moveLayer(a.layerId, 'up')
    const order = requireMapContent(useProjectStore.getState().project).rootOrder.map((e) => e.id)
    expect(order[0]).toBe(a.layerId)
  })

  it('retryServiceLayer is gated to WMS/WMTS', () => {
    const wms = layerContentCommands.addServiceLayer({
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

    layerContentCommands.addLayer(
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
    const localId = useLayerViewStore.getState().selectedLayerId!
    expect(getLayerCapabilities(localId).canRetry).toBe(false)
  })
})
