import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  flattenLayerIds,
  getEffectiveVisible,
  normalizeLayerTree,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  type GisFeature
} from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { getLayerCapabilities, layerCommands } from '@/app/commands/layer.commands'
import { registerExportDataCallback } from '@/app/commands/project.commands'

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
  useProjectStore.setState({
    project: createProject('P14 test'),
    featuresByDataset: {},
    dirty: false,
    selectedLayerId: null,
    selection: { layerId: null, featureIds: [] },
    lastSelectionCountAfterFilter: null
  })
}

describe('P14 layer context menu / groups', () => {
  beforeEach(() => {
    resetStores()
  })

  it('persists visibility and order across serialize/parse', () => {
    const store = useProjectStore.getState()
    store.addLayer('ds-a', 'A', [feat('a1')], 'point')
    store.addLayer('ds-b', 'B', [feat('b1')], 'point')
    store.addLayer('ds-c', 'C', [feat('c1')], 'point')
    const ids = useProjectStore.getState().project.layers.map((l) => l.id)
    const [a, b, c] = ids
    useProjectStore.getState().setLayerVisible(b!, false)
    useProjectStore.getState().createGroup('G', [b!, c!])
    // createGroup prepends the group; move ungrouped A below by moving group stays first.
    const snap = {
      project: useProjectStore.getState().project,
      featuresByDataset: useProjectStore.getState().featuresByDataset
    }
    const restored = parseProjectSnapshot(serializeProjectSnapshot(snap)).project
    expect(flattenLayerIds(restored)).toEqual([b, c, a])
    expect(restored.layers.find((l) => l.id === b)?.visible).toBe(false)
    expect(getEffectiveVisible(restored, b!)).toBe(false)
    expect((restored.groups ?? [])).toHaveLength(1)
    expect(restored.groups[0]?.layerIds).toEqual([b, c])
  })

  it('group hide preserves child visible and restores effective visibility', () => {
    const store = useProjectStore.getState()
    store.addLayer('ds-a', 'A', [feat('a1')], 'point')
    store.addLayer('ds-b', 'B', [feat('b1')], 'point')
    const [a, b] = useProjectStore.getState().project.layers.map((l) => l.id)
    useProjectStore.getState().setLayerVisible(b!, false)
    const groupId = useProjectStore.getState().createGroup('G', [a!, b!])!
    useProjectStore.getState().setGroupVisible(groupId, false)

    let project = useProjectStore.getState().project
    expect(project.layers.find((l) => l.id === a)?.visible).toBe(true)
    expect(project.layers.find((l) => l.id === b)?.visible).toBe(false)
    expect(getEffectiveVisible(project, a!)).toBe(false)
    expect(getEffectiveVisible(project, b!)).toBe(false)

    useProjectStore.getState().setGroupVisible(groupId, true)
    project = useProjectStore.getState().project
    expect(getEffectiveVisible(project, a!)).toBe(true)
    expect(getEffectiveVisible(project, b!)).toBe(false)
  })

  it('getMapLayers list order matches flatten; list top is first', () => {
    const store = useProjectStore.getState()
    store.addLayer('ds-a', 'A', [feat('a1')], 'point')
    store.addLayer('ds-b', 'B', [feat('b1')], 'point')
    const [a, b] = useProjectStore.getState().project.layers.map((l) => l.id)
    useProjectStore.getState().moveLayer(b!, 'up')
    const mapLayers = useProjectStore.getState().getMapLayers()
    expect(mapLayers.map((l) => l.id)).toEqual([b, a])
    expect(flattenLayerIds(useProjectStore.getState().project)).toEqual([b, a])
  })

  it('removeLayer cleans selection, session draft, group refs, orphan dataset', () => {
    const store = useProjectStore.getState()
    store.addLayer('ds-a', 'A', [feat('a1'), feat('a2')], 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setSelection({ layerId, featureIds: ['a1'] })
    useSessionStore.getState().setLayerLoading(layerId, true)
    useSessionStore.getState().setInspectorTab(layerId, 'style')
    const groupId = useProjectStore.getState().createGroup('G', [layerId])!

    const ok = useProjectStore.getState().removeLayer(layerId)
    expect(ok).toBe(true)
    const state = useProjectStore.getState()
    expect(state.project.layers).toHaveLength(0)
    expect(state.project.datasets).toHaveLength(0)
    expect(state.featuresByDataset).toEqual({})
    expect(state.selection).toEqual({ layerId: null, featureIds: [] })
    expect(state.selectedLayerId).toBeNull()
    expect(useSessionStore.getState().sessions[layerId]).toBeUndefined()
    expect((state.project.groups ?? []).find((g) => g.id === groupId)?.layerIds ?? []).toEqual([])
  })

  it('removeGroup keepChildren vs removeChildren', () => {
    const store = useProjectStore.getState()
    store.addLayer('ds-a', 'A', [feat('a1')], 'point')
    store.addLayer('ds-b', 'B', [feat('b1')], 'point')
    const [a, b] = useProjectStore.getState().project.layers.map((l) => l.id)
    const groupId = useProjectStore.getState().createGroup('G', [a!, b!])!

    useProjectStore.getState().removeGroup(groupId, false)
    expect(useProjectStore.getState().project.groups).toHaveLength(0)
    expect(flattenLayerIds(useProjectStore.getState().project).sort()).toEqual([a, b].sort())

    const g2 = useProjectStore.getState().createGroup('G2', [a!, b!])!
    useProjectStore.getState().removeGroup(g2, true)
    expect(useProjectStore.getState().project.layers).toHaveLength(0)
  })

  it('capabilities gate non-existent layers', () => {
    expect(getLayerCapabilities(null).canExport).toBe(false)
    expect(getLayerCapabilities('missing').exists).toBe(false)
    useProjectStore.getState().addLayer('ds-a', 'A', [feat('a1')], 'point')
    const id = useProjectStore.getState().selectedLayerId!
    const caps = getLayerCapabilities(id)
    expect(caps.canStyle).toBe(true)
    expect(caps.canExport).toBe(true)
    expect(caps.canCopy).toBe(true)
  })

  it('export and copy commands register distinct dialog modes', () => {
    const calls: Array<{ layerId: string | null | undefined; mode?: string }> = []
    // Wire via projectCommands registration
    registerExportDataCallback({
      openDialog: (layerId, mode) => {
        calls.push({ layerId, mode })
      }
    })
    useProjectStore.getState().addLayer('ds-a', 'A', [feat('a1')], 'point')
    const id = useProjectStore.getState().selectedLayerId!
    layerCommands.export(id)
    layerCommands.copyToLocalLayer(id)
    expect(calls).toEqual([
      { layerId: id, mode: 'export' },
      { layerId: id, mode: 'copy' }
    ])
  })

  it('normalizeLayerTree drops stale refs', () => {
    let project = createProject('x')
    project.layers = []
    project.groups = [
      {
        id: 'g1',
        name: 'G',
        visible: true,
        layerIds: ['ghost']
      }
    ]
    project.rootOrder = [{ type: 'group', id: 'g1' }, { type: 'layer', id: 'ghost' }]
    project = normalizeLayerTree(project)
    expect((project.groups ?? [])[0]?.layerIds).toEqual([])
    expect(project.rootOrder).toEqual([{ type: 'group', id: 'g1' }])
  })
})
