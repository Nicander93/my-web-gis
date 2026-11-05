import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/project/project-session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLayerStyle, createProject, requireMapContent, UpdatePropertiesCommand, type ProjectEditContext } from '@desktop-webgis/project'
import { useProjectStore, getProjectContentVersion } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { featureCommands } from '@/commands/feature.commands'
import { featureData } from '@/project/datasets/feature-data'
import { projectEdits } from './project-edits'
import { emitCommandStatus } from '@/platform/command-status'

vi.mock('@/platform/command-status', () => ({ emitCommandStatus: vi.fn() }))

beforeEach(() => {
  const project = createProject('Application edits'), content = requireMapContent(project)
  content.datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  content.layers = [{ id: 'layer', datasetId: 'data', name: 'Layer', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
  projectSession.loadSnapshot({ project, featuresByDataset: { data: ['one', 'two'].map(id => ({ id,
    geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } })) } })
})

describe('application edit boundary', () => {
  it('keeps committed data and history when a later UI follow-up fails', () => {
    const row = featureData.getById('data', 'one')!, revision = featureData.revision
    expect(projectEdits.execute({ id: 'follow-up', label: 'Follow-up', execute(context) {
      context.featureStore.update('data', { ...row, properties: { value: 5 } })
      ;(context as ProjectEditContext).afterCommit?.(() => { throw new Error('Window unavailable') })
    }, undo(context) { context.featureStore.update('data', row) } })).toBe(true)
    expect(featureData.getById('data', 'one')?.properties.value).toBe(5)
    expect(featureData.revision).toBe(revision + 1)
    expect(projectEdits.getState().canUndo).toBe(true)
    expect(emitCommandStatus).toHaveBeenCalledWith(expect.stringContaining('编辑已完成；界面跟随更新失败'))
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.getById('data', 'one')?.properties.value).toBe(1)
  })

  it('coalesces opacity only within an explicit gesture and separates later gestures', () => {
    const state = useProjectStore.getState(), opacity = () => requireMapContent(useProjectStore.getState().project).layers[0].opacity
    layerConfigurationCommands.setLayerOpacity('layer', 0.2)
    layerConfigurationCommands.setLayerOpacity('layer', 0.5)
    projectEdits.undo()
    expect(opacity()).toBe(0.2)
    projectEdits.redo()
    layerConfigurationCommands.setLayerOpacity('layer', 0.3, 'first-gesture')
    layerConfigurationCommands.setLayerOpacity('layer', 0.4, 'first-gesture')
    layerConfigurationCommands.setLayerOpacity('layer', 0.8, 'second-gesture')
    layerConfigurationCommands.setLayerOpacity('layer', 0.9, 'second-gesture')
    projectEdits.undo()
    expect(opacity()).toBe(0.4)
    projectEdits.undo()
    expect(opacity()).toBe(0.5)
  })

  it('prevents configuration/data batch privilege mixing and 2D row edits inside a scene project', () => {
    expect(() => projectEdits.executeMany([
      { id: 'config', label: 'Config', scope: 'configuration', execute() {}, undo() {} },
      { id: 'data', label: 'Data', execute() {}, undo() {} }
    ])).toThrow('不能合并')
    projectSession.loadSnapshot({ project: createProject('Scene', 'scene3d'), featuresByDataset: {} })
    const state = useProjectStore.getState()
    expect(() => projectEdits.execute({ id: 'scene-data', label: 'Invalid rows', execute(context) {
      context.featureStore.add('data', { id: 'one', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} })
    }, undo() {} })).toThrow('不能访问要素数据')
    expect(useProjectStore.getState()).toBe(state)
    expect(featureData.getDatasetIds()).toEqual([])
    expect(projectEdits.canUndo()).toBe(false)
  })

  it('stages configuration, rows and UI effects without publishing any partial failed command', () => {
    const state = useProjectStore.getState(), rows = featureData.readSnapshot(), version = getProjectContentVersion()
    const session = useLayerViewStore.getState(), uiEffect = vi.fn(), listener = vi.fn()
    const stopProject = useProjectStore.subscribe(listener), stopData = featureData.subscribe(listener), stopHistory = projectEdits.subscribe(listener)
    try {
      expect(() => projectEdits.execute({ id: 'failed', label: 'Failed mixed edit', execute(context) {
        const host = context as ProjectEditContext
        host.replaceProject({ ...host.getProject(), metadata: { ...host.getProject().metadata, name: 'Temporary' } })
        expect(host.getProject().metadata.name).toBe('Temporary')
        expect(useProjectStore.getState().project).toBe(state.project)
        context.featureStore.update('data', { ...rows.data[0], properties: { value: 9 } })
        host.afterCommit?.(uiEffect)
        host.onDatasetFieldChange?.('data', 'value', 'renamed')
        throw new Error('Rejected')
      }, undo() {} })).toThrow('Rejected')
      expect(useProjectStore.getState()).toBe(state)
      expect(featureData.readSnapshot()).toBe(rows)
      expect(useLayerViewStore.getState()).toBe(session)
      expect(getProjectContentVersion()).toBe(version)
      expect(projectEdits.canUndo()).toBe(false)
      expect(listener).not.toHaveBeenCalled()
      expect(uiEffect).not.toHaveBeenCalled()
    } finally { stopProject(); stopData(); stopHistory() }
  })

  it('commits configuration and data once and runs UI follow-up against the committed state', () => {
    const old = useProjectStore.getState(), row = featureData.getById('data', 'one')!, listener = vi.fn(), effect = vi.fn()
    const stopProject = useProjectStore.subscribe(listener), stopData = featureData.subscribe(listener)
    try {
      projectEdits.execute({ id: 'combined', label: 'Combined edit', execute(context) {
        const host = context as ProjectEditContext, project = host.getProject()
        host.replaceProject({ ...project, metadata: { ...project.metadata, name: 'Committed' } })
        context.featureStore.update('data', { ...row, properties: { value: 8 } })
        host.afterCommit?.(() => effect(useProjectStore.getState().project.metadata.name, featureData.getById('data', 'one')?.properties.value))
      }, undo(context) {
        ;(context as ProjectEditContext).replaceProject(old.project)
        context.featureStore.update('data', row)
      } })
      expect(effect).toHaveBeenCalledExactlyOnceWith('Committed', 8)
      expect(listener).toHaveBeenCalledTimes(2)
      expect(useProjectStore.getState().configRevision).toBe(old.configRevision + 1)
      expect(projectEdits.undo()).toBe(true)
      expect(useProjectStore.getState().project.metadata.name).toBe('Application edits')
      expect(featureData.getById('data', 'one')?.properties.value).toBe(1)
    } finally { stopProject(); stopData() }
  })

  it('uses one atomic undo step for a multi-row gesture', () => {
    const before = featureData.readSnapshot(), listener = vi.fn(), stop = featureData.subscribe(listener)
    try {
      const commands = before.data.map((row, index) => new UpdatePropertiesCommand(`row-${row.id}`, 'data', row.id, row.properties, { value: index + 4 }))
      expect(projectEdits.executeMany(commands)).toBe(true)
      commands.length = 0
      expect(featureData.readSnapshot().data.map(row => row.properties.value)).toEqual([4, 5])
      expect(listener).toHaveBeenCalledTimes(1)
      expect(projectEdits.undo()).toBe(true)
      expect(featureData.readSnapshot().data.map(row => row.properties.value)).toEqual([1, 1])
      expect(projectEdits.canUndo()).toBe(false)
      expect(projectEdits.redo()).toBe(true)
      expect(featureData.readSnapshot().data.map(row => row.properties.value)).toEqual([4, 5])
    } finally { stop() }
  })

  it('rolls back an incomplete batch and retains an existing redo branch', () => {
    featureCommands.updateProperties('layer', 'one', { value: 3 })
    projectEdits.undo()
    const before = featureData.readSnapshot(), history = projectEdits.getState()
    expect(() => projectEdits.executeMany([
      new UpdatePropertiesCommand('first', 'data', 'one', { value: 1 }, { value: 9 }),
      { id: 'second', label: 'Failure', execute() { throw new Error('Second row failed') }, undo() {} }
    ])).toThrow('Second row failed')
    expect(featureData.readSnapshot()).toBe(before)
    expect(projectEdits.getState()).toBe(history)
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.getById('data', 'one')?.properties.value).toBe(3)
  })

  it('does not consume history or configuration when an undo command fails', () => {
    const row = featureData.getById('data', 'one')!
    projectEdits.execute({ id: 'undo-fails', label: 'Undo fails', execute(context) {
      context.featureStore.update('data', { ...row, properties: { value: 4 } })
    }, undo(context) {
      const host = context as ProjectEditContext, project = host.getProject()
      host.replaceProject({ ...project, metadata: { ...project.metadata, name: 'Must roll back' } })
      context.featureStore.update('data', row)
      throw new Error('Undo rejected')
    } })
    const state = useProjectStore.getState(), rows = featureData.readSnapshot(), history = projectEdits.getState()
    expect(() => projectEdits.undo()).toThrow('Undo rejected')
    expect(useProjectStore.getState()).toBe(state)
    expect(featureData.readSnapshot()).toBe(rows)
    expect(projectEdits.getState()).toBe(history)
    expect(projectEdits.canUndo()).toBe(true)
    expect(projectEdits.canRedo()).toBe(false)
  })

  it('skips no-op configuration and rejects invalid opacity without changing the redo branch', () => {
    const state = useProjectStore.getState(), group = layerConfigurationCommands.createGroup('Group')!
    layerConfigurationCommands.renameGroup(group, 'Changed')
    projectEdits.undo()
    const history = projectEdits.getState(), project = useProjectStore.getState().project
    layerConfigurationCommands.setGroupLocked(group, false)
    expect(projectEdits.getState()).toBe(history)
    expect(useProjectStore.getState().project).toBe(project)
    expect(() => layerConfigurationCommands.setLayerOpacity('layer', NaN)).toThrow('有限数值')
    expect(projectEdits.getState()).toBe(history)
    expect(projectEdits.redo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).groups[0].name).toBe('Changed')
  })

  it('keeps read-only service attributes and unchanged properties outside data history', () => {
    expect(featureCommands.updateProperties('layer', 'one', { value: 1 })).toBe(true)
    const state = useProjectStore.getState()
    const service = layerContentCommands.addServiceLayer({ name: 'Remote', kind: 'wfs', source: { type: 'wfs', url: 'https://example.invalid/wfs', version: '2.0.0', typeName: 'remote', outputFormat: 'application/json', authMode: 'none' } })!
    featureCommands.replaceDatasetFeatures(service.datasetId, [{ id: 'remote', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 2 } }])
    const history = projectEdits.getState()
    expect(featureCommands.updateProperties(service.layerId, 'remote', { value: 9 })).toBe(false)
    expect(featureData.getById(service.datasetId, 'remote')?.properties.value).toBe(2)
    expect(projectEdits.getState()).toBe(history)
    expect(useProjectStore.getState()).not.toHaveProperty('executeEditCommand')
    expect(useProjectStore.getState()).not.toHaveProperty('updateFeatureProperties')
  })
})
