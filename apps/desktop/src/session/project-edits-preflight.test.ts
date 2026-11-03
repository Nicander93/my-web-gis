import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddFeatureCommand, createDefaultLayerStyle, createProject, requireMapContent, SetCesiumSceneCommand,
  UpdateGeometryCommand, UpdatePropertiesCommand, type Dataset } from '@desktop-webgis/project'
import { createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { commitProjectConfiguration, useProjectStore } from '@/session/project.store'
import { useLayerViewStore } from '@/view-state/layer-view.store'
import { useWorkbenchStore } from '@/view-state/workbench.store'
import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { getLayerCapabilities } from '@/commands/layer.commands'
import { featureCommands } from '@/commands/feature.commands'
import { editCommands } from '@/commands/edit.commands'
import { projectConfiguration } from './project-configuration'
import { moveSceneSelection, reorderSceneFolder } from '@/features/scene3d/scene3d-commands'
import { featureData } from '@/data/feature-data'
import { projectSession } from './project-session'
import { projectEdits } from './project-edits'

vi.mock('@/platform/command-status', () => ({ emitCommandStatus: vi.fn() }))

beforeEach(() => {
  const project = createProject('Preflight'), content = requireMapContent(project)
  content.datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } },
    { id: 'remote', name: 'Remote', kind: 'wfs', source: { type: 'wfs', url: 'https://example.com/wfs', typeName: 'remote', version: '2.0.0', authMode: 'none' } }]
  content.layers = [['one', 'data'], ['two', 'data'], ['remote-layer', 'remote']].map(([id, datasetId]) => ({
    id, datasetId, name: id, visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point')
  }))
  content.groups = [{ id: 'group', name: 'Group', visible: true, layerIds: ['one'] }]
  projectSession.loadSnapshot({ project, featuresByDataset: Object.fromEntries(['data', 'remote'].map(id => [id,
    [{ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }]])) })
})

function externalLock(locked: boolean): void {
  const project = structuredClone(useProjectStore.getState().project), content = requireMapContent(project)
  content.groups[0].locked = locked
  commitProjectConfiguration(project)
}

describe('Application history preflight', () => {
  it('blocks editing through an unlocked display when another display of its dataset is locally locked', () => {
    layerConfigurationCommands.setLayerLocked('two', true)
    expect(getLayerCapabilities('one')).toMatchObject({ canStyle: true, canEditGeometry: false })
    expect(editCommands.beginLayer('one')).toBe(false)
    expect(featureCommands.updateProperties('one', 'row', { value: 2 })).toBe(false)
    expect(() => projectEdits.execute(new UpdatePropertiesCommand('shared', 'data', 'row', { value: 1 }, { value: 2 }))).toThrow('锁定')
    layerConfigurationCommands.setLayerLocked('two', false)
    expect(getLayerCapabilities('one').canEditGeometry).toBe(true)
    expect(featureCommands.updateProperties('one', 'row', { value: 2 })).toBe(true)
  })

  it('allows local lock history but rejects editing a locked layer alongside its unlock', () => {
    layerConfigurationCommands.setLayerLocked('two', true)
    const before = useProjectStore.getState(), history = projectEdits.getState(), rows = featureData.readSnapshot()
    const draft = structuredClone(before.project), layer = requireMapContent(draft).layers.find(layer => layer.id === 'two')!
    layer.locked = false; layer.name = 'Bypass'
    expect(() => projectConfiguration.apply(draft, 'Unlock and rename')).toThrow('锁定')
    expect(useProjectStore.getState()).toBe(before); expect(projectEdits.getState()).toBe(history); expect(featureData.readSnapshot()).toBe(rows)
    layerConfigurationCommands.setLayerLocked('two', false)
    expect(projectEdits.undo()).toBe(true); expect(requireMapContent(useProjectStore.getState().project).layers[1].locked).toBe(true)
    expect(projectEdits.redo()).toBe(true); expect(requireMapContent(useProjectStore.getState().project).layers[1].locked).toBe(false)
  })

  it('does not treat a simultaneous folder unlock and rename as only a lock toggle', () => {
    layerConfigurationCommands.setGroupLocked('group', true)
    const draft = structuredClone(useProjectStore.getState().project), group = requireMapContent(draft).groups[0]
    group.locked = false; group.name = 'Bypass'
    expect(() => projectConfiguration.apply(draft, 'Unlock and rename')).toThrow('锁定')
    layerConfigurationCommands.setGroupLocked('group', false)
    expect(projectEdits.undo()).toBe(true)
    expect(projectEdits.redo()).toBe(true)
  })

  it('does not bypass scene node locks by combining unlock and name changes', () => {
    const project = createProject('Scene', 'scene3d'), scene = createCesiumScene()
    scene.assets.model = { type: 'glb', url: './model.glb' }
    scene.nodes = [{ id: 'node', type: 'model', name: 'Node', visible: true, locked: true, asset: 'model', position: [0, 0, 0], transform: createTransform() }]
    project.content.scene = scene; projectSession.loadSnapshot({ project, featuresByDataset: {} })
    const draft = structuredClone(useProjectStore.getState().project)
    if (draft.content.kind !== 'scene3d') throw new Error('Wrong test workspace')
    draft.content.scene.nodes[0].locked = false; draft.content.scene.nodes[0].name = 'Bypass'
    expect(() => projectConfiguration.apply(draft, 'Unlock and rename')).toThrow('锁定')
  })

  it('treats a missing local lock as false when a nested visibility draft is applied under a locked parent', () => {
    const project = structuredClone(useProjectStore.getState().project), content = requireMapContent(project)
    content.groups.push({ id: 'parent', name: 'Parent', visible: true, locked: true, layerIds: [] })
    content.groups[0].parentId = 'parent'; delete content.groups[0].locked
    commitProjectConfiguration(project)
    const draft = projectConfiguration.getSnapshot(), group = requireMapContent(draft).groups[0]
    group.visible = false; group.locked = false
    expect(projectConfiguration.apply(draft, 'Visibility')).toBe(true)
    expect(projectEdits.getBlockReason('undo')).toBeNull(); expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).groups[0].visible).toBe(true)
  })

  it('captures scene reorder targets independently of later selection-list changes', () => {
    const project = createProject('Scene order', 'scene3d'), scene = createCesiumScene()
    scene.assets.model = { type: 'glb', url: './model.glb' }
    scene.nodes = ['one', 'two'].map(id => ({ id, type: 'model' as const, name: id, visible: true, asset: 'model', position: [0, 0, 0], transform: createTransform() }))
    scene.groups = ['first', 'second'].map(id => ({ id, name: id, visible: true }))
    project.content.scene = scene; projectSession.loadSnapshot({ project, featuresByDataset: {} })
    const selection = ['two']
    moveSceneSelection(selection, undefined, 'one'); selection[0] = 'one'
    const locked = structuredClone(useProjectStore.getState().project)
    if (locked.content.kind !== 'scene3d') throw new Error('Wrong test workspace')
    locked.content.scene.nodes.find(node => node.id === 'two')!.locked = true; commitProjectConfiguration(locked)
    expect(projectEdits.getBlockReason('undo')).toContain('锁定'); expect(projectEdits.undo()).toBe(false)
    projectSession.loadSnapshot({ project, featuresByDataset: {} })
    reorderSceneFolder('first', 1)
    const folders = structuredClone(useProjectStore.getState().project)
    if (folders.content.kind !== 'scene3d') throw new Error('Wrong test workspace')
    folders.content.scene.groups!.find(group => group.id === 'first')!.locked = true
    commitProjectConfiguration(folders)
    expect(projectEdits.getBlockReason('undo')).toContain('锁定'); expect(projectEdits.undo()).toBe(false)
  })

  it('returns no blocked reason for empty history in either direction', () => {
    expect(projectEdits.getBlockReason('undo')).toBeNull()
    expect(projectEdits.getBlockReason('redo')).toBeNull()
    expect(projectEdits.undo()).toBe(false); expect(projectEdits.redo()).toBe(false)
  })

  it('enforces row permissions inside custom commands that did not declare targets', () => {
    const rows = featureData.readSnapshot(), history = projectEdits.getState(), state = useProjectStore.getState()
    expect(() => projectEdits.execute({ id: 'replace-readonly', label: 'Replace', execute(context) { context.featureStore.setAll('remote', []) }, undo() {} })).toThrow('只读')
    expect(() => projectEdits.execute({ id: 'clear-readonly', label: 'Clear', execute(context) { context.featureStore.clear('remote') }, undo() {} })).toThrow('只读')
    expect(() => projectEdits.execute({ id: 'orphan', label: 'Orphan', execute(context) { context.featureStore.setAll('missing', []) }, undo() {} })).toThrow('不存在')
    expect(featureData.readSnapshot()).toBe(rows); expect(projectEdits.getState()).toBe(history); expect(useProjectStore.getState()).toBe(state)
  })

  it('keeps custom-command undo available when its contextual write is blocked and exposes the reason', () => {
    const before = featureData.getById('data', 'row')!, after = { ...before, properties: { value: 8 } }
    projectEdits.execute({ id: 'custom', label: 'Custom', execute(context) { context.featureStore.update('data', after) }, undo(context) { context.featureStore.update('data', before) } })
    externalLock(true)
    const rows = featureData.readSnapshot(), revision = featureData.revision, history = projectEdits.getState()
    expect(projectEdits.undo()).toBe(false)
    expect(projectEdits.getBlockReason('undo')).toContain('锁定')
    expect(featureData.readSnapshot()).toBe(rows); expect(featureData.revision).toBe(revision); expect(projectEdits.getState()).toBe(history)
    externalLock(false)
    expect(projectEdits.getBlockReason('undo')).toBeNull()
    expect(projectEdits.undo()).toBe(true); expect(projectEdits.redo()).toBe(true)
  })

  it('rejects readonly/missing dataset row commands before mutation and retains redo', () => {
    layerConfigurationCommands.renameLayer('two', 'Changed'); projectEdits.undo()
    const state = useProjectStore.getState(), rows = featureData.readSnapshot(), history = projectEdits.getState()
    expect(() => projectEdits.execute(new UpdatePropertiesCommand('readonly', 'remote', 'row', { value: 1 }, { value: 2 }))).toThrow('只读')
    expect(() => projectEdits.execute(new AddFeatureCommand('missing', 'missing', { id: 'new', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }))).toThrow('不存在')
    expect(useProjectStore.getState()).toBe(state); expect(featureData.readSnapshot()).toBe(rows)
    expect(projectEdits.getState()).toBe(history); expect(projectEdits.redo()).toBe(true)
  })

  it('blocks data undo against any locked shared layer without reads or side effects, then resumes', () => {
    projectEdits.execute(new UpdateGeometryCommand('geometry', 'data', 'row', { type: 'Point', coordinates: [0, 0] }, { type: 'Point', coordinates: [1, 2] }))
    externalLock(true)
    const rows = featureData.readSnapshot(), revision = featureData.revision, state = useProjectStore.getState(), history = projectEdits.getState()
    const session = useLayerViewStore.getState(), workbench = useWorkbenchStore.getState()
    const read = vi.spyOn(featureData, 'readSnapshot').mockImplementation(() => { throw new Error('row reads forbidden') })
    const snapshot = vi.spyOn(featureData, 'snapshot').mockImplementation(() => { throw new Error('snapshot forbidden') })
    try {
      expect(projectEdits.getBlockReason('undo')).toContain('锁定')
      expect(projectEdits.undo()).toBe(false)
      expect(projectEdits.getBlockReason('undo')).toContain('锁定')
      expect(read).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled()
    } finally { read.mockRestore(); snapshot.mockRestore() }
    expect(useProjectStore.getState()).toBe(state); expect(featureData.readSnapshot()).toBe(rows)
    expect(featureData.revision).toBe(revision); expect(projectEdits.getState()).toBe(history)
    expect(useLayerViewStore.getState()).toBe(session); expect(useWorkbenchStore.getState()).toBe(workbench)
    externalLock(false)
    expect(projectEdits.getBlockReason('undo')).toBeNull()
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.getById('data', 'row')?.geometry).toEqual({ type: 'Point', coordinates: [0, 0] })
    expect(projectEdits.redo()).toBe(true)
  })

  it('rechecks current dataset capability before redo and keeps that branch available', () => {
    const original = structuredClone(requireMapContent(useProjectStore.getState().project).datasets[0])
    projectEdits.execute(new UpdatePropertiesCommand('properties', 'data', 'row', { value: 1 }, { value: 9 })); projectEdits.undo()
    function source(dataset: Dataset) {
      const project = structuredClone(useProjectStore.getState().project), content = requireMapContent(project)
      content.datasets = content.datasets.map(item => item.id === 'data' ? dataset : item)
      commitProjectConfiguration(project)
    }
    source({ id: 'data', name: 'Readonly', kind: 'wfs', source: { type: 'wfs', url: 'https://example.com/wfs', typeName: 'data', version: '2.0.0', authMode: 'none' } })
    const history = projectEdits.getState(), rows = featureData.readSnapshot()
    expect(projectEdits.getBlockReason('redo')).toContain('只读')
    expect(projectEdits.redo()).toBe(false)
    expect(featureData.readSnapshot()).toBe(rows); expect(projectEdits.getState()).toBe(history)
    source(original)
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.getById('data', 'row')?.properties.value).toBe(9)
  })

  it('preflights every batch member before the first one can write', () => {
    const update = vi.spyOn(featureData, 'update'), rows = featureData.readSnapshot(), history = projectEdits.getState()
    try {
      expect(() => projectEdits.executeMany([
        new UpdatePropertiesCommand('one', 'data', 'row', { value: 1 }, { value: 2 }),
        new UpdatePropertiesCommand('two', 'remote', 'row', { value: 1 }, { value: 2 })
      ])).toThrow('只读')
      expect(update).not.toHaveBeenCalled()
    } finally { update.mockRestore() }
    expect(featureData.readSnapshot()).toBe(rows); expect(projectEdits.getState()).toBe(history)
  })

  it('keeps visibility and local unlock undoable while the parent lock remains authoritative', () => {
    externalLock(true)
    layerConfigurationCommands.setGroupVisible('group', false)
    expect(projectEdits.getBlockReason('undo')).toBeNull(); expect(projectEdits.undo()).toBe(true)
    layerConfigurationCommands.setLayerVisible('one', false)
    expect(projectEdits.undo()).toBe(true)
    layerConfigurationCommands.setGroupLocked('group', false)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).groups[0].locked).toBe(true)
  })

  it('retains the moved target identity even when a root reorder changed no layer fields', () => {
    const index = requireMapContent(useProjectStore.getState().project).rootOrder.findIndex(entry => entry.id === 'two')
    layerConfigurationCommands.moveLayer('two', index === 0 ? 'down' : 'up')
    expect(projectEdits.canUndo()).toBe(true)
    const project = structuredClone(useProjectStore.getState().project), content = requireMapContent(project)
    content.groups[0].layerIds.push('two'); content.groups[0].locked = true
    content.groups[0].childOrder = [...(content.groups[0].childOrder ?? []), { type: 'layer', id: 'two' }]
    content.rootOrder = content.rootOrder.filter(entry => entry.id !== 'two')
    commitProjectConfiguration(project)
    const history = projectEdits.getState()
    expect(projectEdits.getBlockReason('undo')).toContain('锁定')
    expect(projectEdits.undo()).toBe(false); expect(projectEdits.getState()).toBe(history)
  })

  it('checks scene node and asset targets while allowing local unlock and visibility history', () => {
    const project = createProject('Scene', 'scene3d'), scene = createCesiumScene()
    scene.assets.model = { type: 'glb', url: './model.glb' }
    scene.nodes = [{ id: 'node', type: 'model', name: 'Model', visible: true, asset: 'model', position: [0, 0, 0], transform: createTransform() }]
    project.content.scene = scene; projectSession.loadSnapshot({ project, featuresByDataset: {} })
    const renamed = structuredClone(scene); renamed.nodes[0].name = 'Renamed'
    projectEdits.execute(new SetCesiumSceneCommand('rename', 'Rename', scene, renamed))
    const locked = structuredClone(useProjectStore.getState().project)
    if (locked.content.kind !== 'scene3d') throw new Error('Wrong test workspace')
    locked.content.scene.nodes[0].locked = true; commitProjectConfiguration(locked)
    const history = projectEdits.getState()
    expect(projectEdits.getBlockReason('undo')).toContain('锁定')
    expect(projectEdits.undo()).toBe(false); expect(projectEdits.getState()).toBe(history)
    const hidden = structuredClone(locked.content.scene); hidden.nodes[0].visible = false
    projectEdits.execute(new SetCesiumSceneCommand('visibility', 'Visibility', locked.content.scene, hidden))
    expect(projectEdits.undo()).toBe(true)
    const asset = structuredClone(locked.content.scene); asset.assets.model = { type: 'glb', url: './new.glb' }
    expect(() => projectEdits.execute(new SetCesiumSceneCommand('asset', 'Asset', locked.content.scene, asset))).toThrow('锁定')
    const unlocked = structuredClone(locked.content.scene); unlocked.nodes[0].locked = false
    projectEdits.execute(new SetCesiumSceneCommand('unlock', 'Unlock', locked.content.scene, unlocked))
    expect(projectEdits.undo()).toBe(true)
  })
})
