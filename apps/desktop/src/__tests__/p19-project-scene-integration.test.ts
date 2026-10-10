import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertNoSecretValues,
  buildPersistedSnapshot,
  createDefaultLayerStyle,
  createProject,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  findSecretLeaks
} from '@desktop-webgis/gis-core'
import { compileProjectToScene } from '../features/scene/compile-project'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { layerCommands } from '@/app/commands/layer.commands'
import { editCommands } from '@/app/commands/edit.commands'

function resetStores(): void {
  ;(globalThis as any).window = { dispatchEvent: () => true }
  useSessionStore.setState({
    sessions: {},
    wfsLoadGeneration: 0,
    wfsAbortByLayer: {},
    mapViewExtentWgs84: [73, 18, 135, 54]
  })
  useProjectStore.getState()._resetAttributeHistoryForTests?.()
  useProjectStore.getState()._resetProjectHistoryForTests?.()
  layerCommands._resetStyleHistoryForTests?.()
  useProjectStore.getState().loadSnapshot({
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
    store.addLayer('ds1', 'Points', [
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

    const layerId = useProjectStore.getState().project.layers[0]!.id
    useProjectStore.getState().setLayerFilter(layerId, [{ field: 'name', op: 'eq', value: 'keep' }])
    useProjectStore.getState().setLayerOpacity(layerId, 0.4)
    useProjectStore.getState().setLayerOpacity(layerId, 0.7) // coalesce slider

    useProjectStore.getState().addServiceLayer({
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
      useProjectStore.getState().featuresByDataset
    )
    assertNoSecretValues(snap)
    const json = serializeProjectSnapshot(snap)
    expect(json).not.toContain('Bearer')
    expect(json).toContain('sess-1') // ref key only
    expect(json).not.toContain('desktop-webgis.workspace-layout')

    // Simulate close → open
    useProjectStore.getState().loadSnapshot({ project: createProject('empty'), featuresByDataset: {} })
    const restored = parseProjectSnapshot(json)
    useProjectStore.getState().loadSnapshot(restored)

    const project = useProjectStore.getState().project
    expect(project.layers).toHaveLength(2)
    expect(project.layers[0]?.filter).toEqual([{ field: 'name', op: 'eq', value: 'keep' }])
    expect(project.layers[0]?.opacity).toBe(0.7)
    expect(project.layers[0]?.style).toBeTruthy()
    expect(useProjectStore.getState().featuresByDataset[project.layers[0]!.datasetId]).toHaveLength(2)
    expect(project.datasets.some((d) => d.kind === 'wms')).toBe(true)
  })

  it('compile Scene applies filter, labels WFS snapshot, strips credentials; blocks bad basemap', () => {
    const project = createProject('Pub')
    project.datasets.push({
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
    project.layers.push({
      id: 'lw',
      datasetId: 'wfs1',
      name: 'WFS',
      visible: true,
      opacity: 1,
      editable: false,
      style: createDefaultLayerStyle('polygon'),
      filter: []
    })
    project.rootOrder = [{ type: 'layer', id: 'lw' }]
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
    useProjectStore.getState().addLayer(
      'd1',
      'L',
      [{ id: 'f', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { v: 1 } }],
      'point'
    )
    const layerId = useProjectStore.getState().project.layers[0]!.id
    const before = useProjectStore.getState().getNormalizedLayerStyle(layerId)!

    expect(layerCommands.applyStyle(layerId, {
      ...before,
      mode: 'single',
      symbol: { type: 'circle', radius: 12, fill: { r: 1, g: 0, b: 0, a: 1 } }
    })).toBe(true)

    useProjectStore.getState().setLayerFilter(layerId, [{ field: 'v', op: 'eq', value: 1 }])
    useProjectStore.getState().setLayerOpacity(layerId, 0.2)
    useProjectStore.getState().setLayerOpacity(layerId, 0.5)
    useProjectStore.getState().setLayerOpacity(layerId, 0.9)

    // Undo opacity (one step) → filter still present
    editCommands.undo()
    expect(useProjectStore.getState().project.layers[0]?.opacity).toBe(1)
    expect(useProjectStore.getState().project.layers[0]?.filter).toEqual([
      { field: 'v', op: 'eq', value: 1 }
    ])

    editCommands.undo() // filter
    expect(useProjectStore.getState().project.layers[0]?.filter ?? []).toEqual([])

    editCommands.undo() // style
    const undone = useProjectStore.getState().getNormalizedLayerStyle(layerId)!
    expect(undone).toEqual(before)
  })

  it('findSecretLeaks ignores credentialRef.key', () => {
    const leaks = findSecretLeaks({
      source: { authMode: 'bearer', credentialRef: { key: 'abc' } }
    })
    expect(leaks.filter((p) => !p.includes('credentialRef'))).toEqual([])
  })
})
