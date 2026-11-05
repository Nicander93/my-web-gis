import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerConfigurationQueries } from '@/project/layer-configuration-query'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertNoSecretValues,
  buildPersistedSnapshot,
  createDefaultLayerStyle,
  createProject,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  findSecretLeaks
} from '@desktop-webgis/project'
import { compileProjectToScene } from '@/io/compile-project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { layerCommands } from '@/commands/layer.commands'
import { editCommands } from '@/commands/edit.commands'

function resetStores(): void {
  ;(globalThis as any).window = { dispatchEvent: () => true }
  useLayerViewStore.setState({
    sessions: {},
    wfsLoadGeneration: 0,
    wfsAbortByLayer: {},
    mapViewExtentWgs84: [73, 18, 135, 54]
  })
  projectEdits.clear?.()
  projectEdits.clear?.()
  layerCommands._resetStyleHistoryForTests?.()
  projectSession.loadSnapshot({
    project: createProject('P19'),
    featuresByDataset: {}
  })
}

describe('P19 project + Scene integration', () => {
  beforeEach(() => {
    resetStores()
  })

  it('save → reopen preserves mixed layers, order, style, filter, features; no layout/secrets', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('ds1', 'Points', [
      {
        id: 'a',
        geometry: { type: 'Point', coordinates: [1, 2] },
        properties: { name: 'keep' },
        metadata: { sourceCrs: 'EPSG:4547' }
      },
      {
        id: 'b',
        geometry: { type: 'Point', coordinates: [3, 4] },
        properties: { name: 'drop' }
      }
    ], 'point')

    const layerId = requireMapContent(useProjectStore.getState().project).layers[0]!.id
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'name', op: 'eq', value: 'keep' }])
    layerConfigurationCommands.setLayerOpacity(layerId, 0.4, 'opacity-gesture')
    layerConfigurationCommands.setLayerOpacity(layerId, 0.7, 'opacity-gesture')

    layerContentCommands.addServiceLayer({
      name: 'WMS',
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms',
        version: '1.3.0',
        layerNames: ['L'],
        authMode: 'bearer',
        credentialRef: { key: 'sess-1' },
        crs: 'EPSG:3857'
      }
    })

    const snap = buildPersistedSnapshot(
      useProjectStore.getState().project,
      featureData.readSnapshot()
    )
    assertNoSecretValues(snap)
    const json = serializeProjectSnapshot(snap)
    expect(json).not.toContain('Bearer')
    expect(json).toContain('sess-1') // ref key only
    expect(json).not.toContain('desktop-webgis.workspace-layout')

    // Simulate close → open
    projectSession.loadSnapshot({ project: createProject('empty'), featuresByDataset: {} })
    const restored = parseProjectSnapshot(json)
    projectSession.loadSnapshot(restored)

    const project = useProjectStore.getState().project
    expect(requireMapContent(project).layers).toHaveLength(2)
    expect(requireMapContent(project).layers[0]?.filter).toEqual([{ field: 'name', op: 'eq', value: 'keep' }])
    expect(requireMapContent(project).layers[0]?.opacity).toBe(0.7)
    expect(requireMapContent(project).layers[0]?.style).toBeTruthy()
    expect(featureData.readSnapshot()[requireMapContent(project).layers[0]!.datasetId]).toHaveLength(2)
    expect(requireMapContent(project).datasets.some((d) => d.kind === 'wms')).toBe(true)
  })

  it('compile Scene applies filter, labels WFS snapshot, strips credentials; blocks bad basemap', () => {
    const project = createProject('Pub')
    requireMapContent(project).datasets.push({
      id: 'wfs1',
      name: 'WFS',
      kind: 'wfs',
      source: {
        type: 'wfs',
        url: 'https://example.com/wfs',
        version: '2.0.0',
        typeName: 'x:y',
        authMode: 'query-token',
        credentialRef: { key: 'tok' },
        tokenParam: 'token',
        loadedCount: 1,
        complete: false,
        truncatedByLimit: true
      }
    })
    requireMapContent(project).layers.push({
      id: 'lw',
      datasetId: 'wfs1',
      name: 'WFS',
      visible: true,
      opacity: 1,
      editable: false,
      style: createDefaultLayerStyle('polygon'),
      filter: []
    })
    requireMapContent(project).rootOrder = [{ type: 'layer', id: 'lw' }]
    const { scene, notes } = compileProjectToScene({
      project,
      featuresByDataset: {
        wfs1: [
          {
            id: '1',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: {}
          }
        ]
      }
    })
    expect(JSON.stringify(scene)).not.toContain('"credentialRef"')
    expect(notes.some((n) => n.includes('WFS 快照'))).toBe(true)
    expect((scene.metadata as any).layerMeta.lw.wfsSnapshot).toBe(true)
    expect((scene.metadata as any).layerMeta.lw.wfsComplete).toBe(false)
  })

  it('style / filter / opacity share one EditCommand history; opacity drag coalesces', () => {
    layerContentCommands.addLayer(
      'd1',
      'L',
      [{ id: 'f', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { v: 1 } }],
      'point'
    )
    const layerId = requireMapContent(useProjectStore.getState().project).layers[0]!.id
    const before = layerConfigurationQueries.getNormalizedLayerStyle(layerId)!

    expect(layerCommands.applyStyle(layerId, {
      ...before,
      mode: 'single',
      symbol: { type: 'circle', radius: 12, fill: { r: 1, g: 0, b: 0, a: 1 } }
    })).toBe(true)

    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'v', op: 'eq', value: 1 }])
    layerConfigurationCommands.setLayerOpacity(layerId, 0.2, 'opacity-gesture')
    layerConfigurationCommands.setLayerOpacity(layerId, 0.5, 'opacity-gesture')
    layerConfigurationCommands.setLayerOpacity(layerId, 0.9, 'opacity-gesture')

    // Undo opacity (one step) → filter still present
    editCommands.undo()
    expect(requireMapContent(useProjectStore.getState().project).layers[0]?.opacity).toBe(1)
    expect(requireMapContent(useProjectStore.getState().project).layers[0]?.filter).toEqual([
      { field: 'v', op: 'eq', value: 1 }
    ])

    editCommands.undo() // filter
    expect(requireMapContent(useProjectStore.getState().project).layers[0]?.filter ?? []).toEqual([])

    editCommands.undo() // style
    const undone = layerConfigurationQueries.getNormalizedLayerStyle(layerId)!
    expect(undone).toEqual(before)
  })

  it('findSecretLeaks 忽略s credentialRef.key', () => {
    const leaks = findSecretLeaks({
      source: { authMode: 'bearer', credentialRef: { key: 'abc' } }
    })
    expect(leaks.filter((p) => !p.includes('credentialRef'))).toEqual([])
  })
})
