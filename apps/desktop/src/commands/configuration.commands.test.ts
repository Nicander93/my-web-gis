import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLayerStyle, createProject, requireMapContent, type MapState } from '@desktop-webgis/project'
import { createCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { useProjectStore } from '@/session/project.store'
import { useLayerViewStore } from '@/view-state/layer-view.store'
import { featureData } from '@/data/feature-data'
import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { createSnapshotFromState } from '@/session/project-io'
import { layerConfigurationQueries } from '@/session/layer-configuration-query'
import { projectConfiguration } from '@/session/project-configuration'
import { layerConfigurationCommands } from './layer-configuration.commands'
import { datasetConfigurationCommands } from './dataset-configuration.commands'
import { mapCommands } from './map.commands'
import { layerCommands } from './layer.commands'

const probe = vi.hoisted(() => ({ view: null as MapState | null, camera: vi.fn() }))
vi.mock('@/runtime/map-runtime-host', () => ({ getLiveMapState: () => probe.view }))
vi.mock('@/runtime/scene3d-runtime-host', () => ({ getLiveSceneCamera: probe.camera }))
vi.mock('@/platform/command-status', () => ({ emitCommandStatus: vi.fn() }))

beforeEach(() => {
  const project = createProject('Configuration'), content = requireMapContent(project)
  content.datasets = [{ id: 'local', name: 'Local', kind: 'vector', source: { type: 'memory', label: 'Local' } },
    { id: 'remote', name: 'Remote', kind: 'wfs', source: { type: 'wfs', url: 'https://example.com/wfs', version: '2.0.0', typeName: 'remote', authMode: 'none' } }]
  content.layers = [{ id: 'layer', datasetId: 'local', name: 'Layer', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
  projectSession.loadSnapshot({ project, featuresByDataset: { local: [{ id: 'row', properties: { value: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } }] } })
  probe.view = null; probe.camera.mockReset()
})

describe('Application configuration ownership', () => {
  it('applies a complete configuration draft with one undo and no feature-store reads', () => {
    const before = projectConfiguration.getSnapshot(), rows = featureData.readSnapshot(), revision = featureData.revision
    const draft = projectConfiguration.getSnapshot()
    requireMapContent(draft).layers[0].name = 'Properties'
    requireMapContent(draft).layers[0].opacity = .4
    const read = vi.spyOn(featureData, 'readSnapshot').mockImplementation(() => { throw new Error('feature view forbidden') })
    const snapshot = vi.spyOn(featureData, 'snapshot').mockImplementation(() => { throw new Error('feature snapshot forbidden') })
    try {
      expect(projectConfiguration.apply(draft, '应用完整属性')).toBe(true)
      requireMapContent(draft).layers[0].opacity = .9
      expect(requireMapContent(useProjectStore.getState().project).layers[0]).toMatchObject({ name: 'Properties', opacity: .4 })
      expect(projectEdits.undo()).toBe(true)
      expect(useProjectStore.getState().project).toEqual(before)
      expect(projectEdits.canUndo()).toBe(false)
      expect(projectEdits.redo()).toBe(true)
      expect(read).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled()
    } finally { read.mockRestore(); snapshot.mockRestore() }
    expect(featureData.readSnapshot()).toBe(rows); expect(featureData.revision).toBe(revision)
  })

  it('rejects configuration drafts that rebind/delete data owners or change locked standard drawing', () => {
    const draft = projectConfiguration.getSnapshot()
    requireMapContent(draft).layers[0].datasetId = 'remote'
    const state = useProjectStore.getState(), history = projectEdits.getState()
    expect(() => projectConfiguration.apply(draft, 'Rebind')).toThrow('重新绑定')
    requireMapContent(draft).layers = []
    expect(() => projectConfiguration.apply(draft, 'Remove')).toThrow('创建、删除')
    expect(useProjectStore.getState()).toBe(state); expect(projectEdits.getState()).toBe(history)
    const group = layerConfigurationCommands.createGroup('Locked', ['layer'])!
    layerConfigurationCommands.setGroupLocked(group, true)
    const drawing = projectConfiguration.getSnapshot(), content = requireMapContent(drawing)
    const circle = content.cartography!.styleLayers.find(layer => layer.type === 'circle')!
    circle.paint = { ...circle.paint, 'circle-radius': 42 }
    const lockedState = useProjectStore.getState(), lockedHistory = projectEdits.getState()
    expect(() => projectConfiguration.apply(drawing, 'Style')).toThrow('锁定')
    expect(useProjectStore.getState()).toBe(lockedState); expect(projectEdits.getState()).toBe(lockedHistory)
  })

  it('changes popup/selectability and undoes them without projecting scene features', () => {
    const revision = featureData.revision
    const read = vi.spyOn(featureData, 'readSnapshot').mockImplementation(() => { throw new Error('feature view forbidden') })
    const snapshot = vi.spyOn(featureData, 'snapshot').mockImplementation(() => { throw new Error('feature snapshot forbidden') })
    try {
      layerCommands.setPopup('layer', { fields: [{ field: 'value', label: 'Value' }] })
      layerCommands.setSelectable('layer', false)
      expect(requireMapContent(useProjectStore.getState().project).layers[0].interaction).toEqual({ popup: { fields: [{ field: 'value', label: 'Value' }] }, selectable: false })
      expect(projectEdits.undo()).toBe(true)
      expect(requireMapContent(useProjectStore.getState().project).layers[0].interaction?.selectable).toBeUndefined()
      expect(projectEdits.undo()).toBe(true)
      expect(requireMapContent(useProjectStore.getState().project).layers[0].interaction).toBeUndefined()
      expect(read).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled()
    } finally { read.mockRestore(); snapshot.mockRestore() }
    expect(featureData.revision).toBe(revision)
  })

  it('blocks editing a locked descendant while retaining visibility navigation and the redo branch', () => {
    const group = layerConfigurationCommands.createGroup('Group', ['layer'])!
    layerConfigurationCommands.setGroupLocked(group, true)
    layerConfigurationCommands.setLayerVisible('layer', false); projectEdits.undo()
    const state = useProjectStore.getState(), history = projectEdits.getState(), rows = featureData.readSnapshot()
    expect(() => layerConfigurationCommands.setLayerFilter('layer', [{ field: 'value', op: 'eq', value: 1 }])).toThrow('锁定')
    expect(() => layerConfigurationCommands.setLayerOpacity('layer', .5)).toThrow('锁定')
    expect(() => layerConfigurationCommands.renameLayer('layer', 'Changed')).toThrow('锁定')
    expect(() => layerConfigurationCommands.setLayerOpacity('layer', Infinity)).toThrow('有限数值')
    expect(() => layerConfigurationCommands.setLayerFilter('layer', [{ field: '', op: 'eq' }])).toThrow('过滤条件')
    expect(useProjectStore.getState()).toBe(state); expect(projectEdits.getState()).toBe(history)
    expect(featureData.readSnapshot()).toBe(rows)
    expect(projectEdits.redo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers[0].visible).toBe(false)
  })

  it('publishes WFS load metadata only on change, without data/history access or aliases', () => {
    const state = useProjectStore.getState(), rows = featureData.readSnapshot(), history = projectEdits.getState()
    const snapshot = vi.spyOn(featureData, 'snapshot').mockImplementation(() => { throw new Error('full data read forbidden') })
    const patch = { loadedCount: 4, queryExtentWgs84: [0, 0, 1, 1] as [number, number, number, number] }
    try {
      datasetConfigurationCommands.patchWfsServiceSource('missing', patch)
      datasetConfigurationCommands.patchWfsServiceSource('local', patch)
      expect(useProjectStore.getState()).toBe(state)
      datasetConfigurationCommands.patchWfsServiceSource('remote', patch)
      const updated = useProjectStore.getState()
      expect(updated.configRevision).toBe(state.configRevision + 1)
      expect(updated.dirty).toBe(true)
      patch.queryExtentWgs84[0] = 99
      expect(requireMapContent(updated.project).datasets[1].source).toMatchObject({ loadedCount: 4, queryExtentWgs84: [0, 0, 1, 1] })
      datasetConfigurationCommands.patchWfsServiceSource('remote', { loadedCount: 4 })
      expect(useProjectStore.getState()).toBe(updated)
      expect(() => datasetConfigurationCommands.patchWfsServiceSource('remote', Object.assign({ loadedCount: 5 }, { authorization: 'secret' }))).toThrow('密钥')
      expect(useProjectStore.getState()).toBe(updated)
      expect(featureData.readSnapshot()).toBe(rows); expect(projectEdits.getState()).toBe(history)
      expect(snapshot).not.toHaveBeenCalled()
    } finally { snapshot.mockRestore() }
  })

  it('records an explicit initial view as one configuration edit with undo/redo and detached input', () => {
    const before = useProjectStore.getState(), rows = featureData.readSnapshot(), revision = featureData.revision
    mapCommands.setInitialView(); expect(useProjectStore.getState()).toBe(before)
    probe.view = { center: [20, 30], zoom: 5, rotation: .2 }
    mapCommands.setInitialView()
    const expected = structuredClone(probe.view)
    probe.view.center[0] = 99
    expect(requireMapContent(useProjectStore.getState().project).initialView).toEqual(expected)
    expect(featureData.readSnapshot()).toBe(rows); expect(featureData.revision).toBe(revision)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).initialView).toEqual(requireMapContent(before.project).initialView)
    expect(projectEdits.canUndo()).toBe(false)
    expect(projectEdits.redo()).toBe(true)
    probe.view = expected
    const current = useProjectStore.getState(), history = projectEdits.getState()
    mapCommands.setInitialView()
    expect(useProjectStore.getState()).toBe(current); expect(projectEdits.getState()).toBe(history)
    probe.view = { ...expected, zoom: NaN }
    expect(() => mapCommands.setInitialView()).toThrow('有限数值')
    expect(projectEdits.getState()).toBe(history)
  })

  it('persists configured map/scene presets without reading live navigation or modifying the project', () => {
    const state = useProjectStore.getState(), view = structuredClone(requireMapContent(state.project).initialView)
    probe.view = { center: [40, 50], zoom: 12, rotation: 1 }
    useLayerViewStore.getState().setSelectedLayer('layer')
    expect(requireMapContent(createSnapshotFromState(state.project, featureData.snapshot()).project).initialView).toEqual(view)
    expect(useProjectStore.getState()).toBe(state)
    const scene = createProject('Scene', 'scene3d')
    scene.content.scene = createCesiumScene()
    probe.camera.mockImplementation(() => { throw new Error('runtime camera must not be read') })
    expect(createSnapshotFromState(scene, {}).project.content.scene?.camera).toEqual(scene.content.scene.camera)
    expect(probe.camera).not.toHaveBeenCalled()
  })

  it('keeps ProjectStore limited to configuration ownership while queries avoid feature materialization', () => {
    const state = useProjectStore.getState(), history = projectEdits.getState()
    expect(Object.keys(state).sort()).toEqual(['configRevision', 'dirty', 'project', 'projectEpoch', 'setDirty'])
    const read = vi.spyOn(featureData, 'readSnapshot').mockImplementation(() => { throw new Error('feature materialization forbidden') })
    try {
      expect(layerConfigurationQueries.getMapLayers().map(layer => layer.id)).toEqual(['layer'])
      expect(layerConfigurationQueries.getNormalizedLayerStyle('layer')).toBeTruthy()
      expect(layerConfigurationQueries.getNormalizedLayerStyle('missing')).toBeNull()
      expect(read).not.toHaveBeenCalled()
    } finally { read.mockRestore() }
    expect(useProjectStore.getState()).toBe(state); expect(projectEdits.getState()).toBe(history)
  })
})
