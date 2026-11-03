import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerConfigurationQueries } from '@/session/layer-configuration-query'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { featureData } from '@/data/feature-data'
import { selectionCommands } from '@/commands/selection.commands'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  flattenLayerIds,
  getEffectiveVisible,
  normalizeLayerTree,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  type GisFeature
} from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { useLayerViewStore } from '@/view-state/layer-view.store'
import { getLayerCapabilities, layerCommands } from '@/commands/layer.commands'
import { registerExportDataCallback } from '@/commands/project.commands'

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
  useProjectStore.setState({ project: createProject('P14 test'), dirty: false }); featureData.replaceAll({}); useLayerViewStore.setState({ selectedLayerId: null, selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: null })
}

describe('P14 layer context menu / groups', () => {
  beforeEach(() => {
    resetStores()
  })
  it('undoes nested folder moves, inherited locks, dissolution and subtree deletion atomically', () => {
    const state = useProjectStore.getState()
    layerContentCommands.addLayer('nested-data', 'Nested layer', [feat('nested')], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id
    const outer = layerConfigurationCommands.createGroup('Outer')!, inner = layerConfigurationCommands.createGroup('Inner', [id], outer)!
    expect(requireMapContent(useProjectStore.getState().project).groups.find(group => group.id === inner)?.parentId).toBe(outer)
    layerConfigurationCommands.setGroupLocked(outer, true)
    expect(getLayerCapabilities(id).canEditGeometry).toBe(false)
    expect(() => layerConfigurationCommands.relocateGroup(inner)).toThrow('锁定')
    projectEdits.undo()
    expect(getLayerCapabilities(id).canEditGeometry).toBe(true)
    const before = projectSession.getSnapshot()
    expect(() => layerConfigurationCommands.relocateGroup(outer, inner)).toThrow('后代')
    expect(projectSession.getSnapshot()).toEqual(before)
    layerContentCommands.removeGroup(outer, true)
    expect(requireMapContent(useProjectStore.getState().project).layers).toHaveLength(0)
    projectEdits.undo()
    expect(projectSession.getSnapshot()).toEqual(before)
    layerContentCommands.removeGroup(outer, false)
    expect(requireMapContent(useProjectStore.getState().project).groups.find(group => group.id === inner)?.parentId).toBeUndefined()
    projectEdits.undo()
    expect(projectSession.getSnapshot()).toEqual(before)
  })

  it('persists visibility and order across serialize/parse', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('ds-a', 'A', [feat('a1')], 'point')
    layerContentCommands.addLayer('ds-b', 'B', [feat('b1')], 'point')
    layerContentCommands.addLayer('ds-c', 'C', [feat('c1')], 'point')
    const ids = requireMapContent(useProjectStore.getState().project).layers.map((l) => l.id)
    const [a, b, c] = ids
    layerConfigurationCommands.setLayerVisible(b!, false)
    layerConfigurationCommands.createGroup('G', [b!, c!])
    // createGroup prepends the group; move ungrouped A below by moving group stays first.
    const snap = {
      project: useProjectStore.getState().project,
      featuresByDataset: featureData.readSnapshot()
    }
    const restored = parseProjectSnapshot(serializeProjectSnapshot(snap)).project
    expect(flattenLayerIds(restored)).toEqual([b, c, a])
    expect(requireMapContent(restored).layers.find((l) => l.id === b)?.visible).toBe(false)
    expect(getEffectiveVisible(restored, b!)).toBe(false)
    expect((requireMapContent(restored).groups ?? [])).toHaveLength(1)
    expect(requireMapContent(restored).groups[0]?.layerIds).toEqual([b, c])
  })

  it('group hide preserves child visible and restores effective visibility', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('ds-a', 'A', [feat('a1')], 'point')
    layerContentCommands.addLayer('ds-b', 'B', [feat('b1')], 'point')
    const [a, b] = requireMapContent(useProjectStore.getState().project).layers.map((l) => l.id)
    layerConfigurationCommands.setLayerVisible(b!, false)
    const groupId = layerConfigurationCommands.createGroup('G', [a!, b!])!
    layerConfigurationCommands.setGroupVisible(groupId, false)

    let project = useProjectStore.getState().project
    expect(requireMapContent(project).layers.find((l) => l.id === a)?.visible).toBe(true)
    expect(requireMapContent(project).layers.find((l) => l.id === b)?.visible).toBe(false)
    expect(getEffectiveVisible(project, a!)).toBe(false)
    expect(getEffectiveVisible(project, b!)).toBe(false)

    layerConfigurationCommands.setGroupVisible(groupId, true)
    project = useProjectStore.getState().project
    expect(getEffectiveVisible(project, a!)).toBe(true)
    expect(getEffectiveVisible(project, b!)).toBe(false)
  })

  it('getMapLayers list order matches flatten; list top is first', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('ds-a', 'A', [feat('a1')], 'point')
    layerContentCommands.addLayer('ds-b', 'B', [feat('b1')], 'point')
    const [a, b] = requireMapContent(useProjectStore.getState().project).layers.map((l) => l.id)
    layerConfigurationCommands.moveLayer(b!, 'up')
    const mapLayers = layerConfigurationQueries.getMapLayers()
    expect(mapLayers.map((l) => l.id)).toEqual([b, a])
    expect(flattenLayerIds(useProjectStore.getState().project)).toEqual([b, a])
  })

  it('removeLayer cleans selection, session draft, group refs, orphan dataset', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('ds-a', 'A', [feat('a1'), feat('a2')], 'point')
    const layerId = useLayerViewStore.getState().selectedLayerId!
    selectionCommands.setSelection({ layerId, featureIds: ['a1'] })
    useLayerViewStore.getState().setLayerLoading(layerId, true)
    useLayerViewStore.getState().setInspectorTab(layerId, 'style')
    const groupId = layerConfigurationCommands.createGroup('G', [layerId])!

    const ok = layerContentCommands.removeLayer(layerId)
    expect(ok).toBe(true)
    const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
    expect(requireMapContent(state.project).layers).toHaveLength(0)
    expect(requireMapContent(state.project).datasets).toHaveLength(0)
    expect(stateFeatureData).toEqual({})
    expect(useLayerViewStore.getState().selection).toEqual({ layerId: null, featureIds: [] })
    expect(useLayerViewStore.getState().selectedLayerId).toBeNull()
    expect(useLayerViewStore.getState().sessions[layerId]).toBeUndefined()
    expect((requireMapContent(state.project).groups ?? []).find((g) => g.id === groupId)?.layerIds ?? []).toEqual([])
  })

  it('removeGroup keepChildren vs removeChildren', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('ds-a', 'A', [feat('a1')], 'point')
    layerContentCommands.addLayer('ds-b', 'B', [feat('b1')], 'point')
    const [a, b] = requireMapContent(useProjectStore.getState().project).layers.map((l) => l.id)
    const groupId = layerConfigurationCommands.createGroup('G', [a!, b!])!

    layerContentCommands.removeGroup(groupId, false)
    expect(requireMapContent(useProjectStore.getState().project).groups).toHaveLength(0)
    expect(flattenLayerIds(useProjectStore.getState().project).sort()).toEqual([a, b].sort())

    const g2 = layerConfigurationCommands.createGroup('G2', [a!, b!])!
    layerContentCommands.removeGroup(g2, true)
    expect(requireMapContent(useProjectStore.getState().project).layers).toHaveLength(0)
  })

  it('capabilities gate non-existent layers', () => {
    expect(getLayerCapabilities(null).canExport).toBe(false)
    expect(getLayerCapabilities('missing').exists).toBe(false)
    layerContentCommands.addLayer('ds-a', 'A', [feat('a1')], 'point')
    const id = useLayerViewStore.getState().selectedLayerId!
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
    layerContentCommands.addLayer('ds-a', 'A', [feat('a1')], 'point')
    const id = useLayerViewStore.getState().selectedLayerId!
    layerCommands.export(id)
    layerCommands.copyToLocalLayer(id)
    expect(calls).toEqual([
      { layerId: id, mode: 'export' },
      { layerId: id, mode: 'copy' }
    ])
  })

  it('normalizeLayerTree drops stale refs', () => {
    let project = createProject('x')
    requireMapContent(project).layers = []
    requireMapContent(project).groups = [
      {
        id: 'g1',
        name: 'G',
        visible: true,
        layerIds: ['ghost']
      }
    ]
    requireMapContent(project).rootOrder = [{ type: 'group', id: 'g1' }, { type: 'layer', id: 'ghost' }]
    project = normalizeLayerTree(project)
    expect((requireMapContent(project).groups ?? [])[0]?.layerIds).toEqual([])
    expect(requireMapContent(project).rootOrder).toEqual([{ type: 'group', id: 'g1' }])
  })
})
