import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { selectionCommands } from '@/commands/selection.commands'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { beforeEach, expect, it, vi } from 'vitest'
import { createProject } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { editCommands } from './edit.commands'

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
})

function addLayer(name: string): string {
  layerContentCommands.addLayer(name, name, [{ id: name,
    geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 12 } }], 'point')
  return useLayerViewStore.getState().selectedLayerId!
}

it('starts the table target without changing tree selection, project data or history', () => {
  const tableId = addLayer('table'), selectedId = addLayer('selected')
  const state = useProjectStore.getState()
  selectionCommands.setSelection({ layerId: selectedId, featureIds: ['selected'] })
  state.setDirty(false)
  const before = projectSession.getSnapshot()
  const history = { undo: projectEdits.canUndo(), redo: projectEdits.canRedo() }
  expect(editCommands.beginLayer(tableId)).toBe(true)
  expect(useWorkbenchStore.getState().editLayerId).toBe(tableId)
  expect(useLayerViewStore.getState().selectedLayerId).toBe(selectedId)
  expect(useLayerViewStore.getState().selection).toEqual({ layerId: selectedId, featureIds: ['selected'] })
  expect(editCommands.endLayer(tableId)).toBe(true)
  expect(useWorkbenchStore.getState().editLayerId).toBeNull()
  expect(projectSession.getSnapshot()).toEqual(before)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect({ undo: projectEdits.canUndo(), redo: projectEdits.canRedo() }).toEqual(history)
})

it('does not steal or end the editing session owned by another table', () => {
  const first = addLayer('first'), second = addLayer('second')
  expect(editCommands.beginLayer(first)).toBe(true)
  expect(editCommands.beginLayer(second)).toBe(false)
  expect(editCommands.endLayer(second)).toBe(false)
  expect(useWorkbenchStore.getState().editLayerId).toBe(first)
  expect(editCommands.endLayer(first)).toBe(true)
  expect(editCommands.beginLayer(second)).toBe(true)
})

it('rejects locked, removed and remote read-only layers', () => {
  const id = addLayer('locked')
  const groupId = layerConfigurationCommands.createGroup('locked group', [id])!
  layerConfigurationCommands.setGroupLocked(groupId, true)
  expect(editCommands.beginLayer(id)).toBe(false)
  layerConfigurationCommands.setGroupLocked(groupId, false)
  const remote = layerContentCommands.addServiceLayer({ name: 'WFS', kind: 'wfs', source: {
    type: 'wfs', url: 'https://example.com/wfs', version: '2.0.0', typeName: 'stations', outputFormat: 'application/json', authMode: 'none'
  } })!
  expect(editCommands.beginLayer(remote.layerId)).toBe(false)
  layerContentCommands.removeLayer(id)
  expect(editCommands.beginLayer(id)).toBe(false)
  expect(useWorkbenchStore.getState().editLayerId).toBeNull()
})

it('keeps the ribbon entry bound to the selected layer', () => {
  addLayer('first')
  const selected = addLayer('selected')
  editCommands.begin()
  expect(useWorkbenchStore.getState().editLayerId).toBe(selected)
  editCommands.end()
  expect(useWorkbenchStore.getState().editLayerId).toBeNull()
})
