import { beforeEach, expect, it, vi } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { editCommands } from './edit.commands'

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  useProjectStore.getState().loadSnapshot({ project: createProject(), featuresByDataset: {} })
})

function addLayer(name: string): string {
  useProjectStore.getState().addLayer(name, name, [{ id: name,
    geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 12 } }], 'point')
  return useProjectStore.getState().selectedLayerId!
}

it('starts the table target without changing tree selection, project data or history', () => {
  const tableId = addLayer('table'), selectedId = addLayer('selected')
  const state = useProjectStore.getState()
  state.setSelection({ layerId: selectedId, featureIds: ['selected'] })
  state.setDirty(false)
  const before = state.getSnapshot()
  const history = { undo: state.canUndoEdit(), redo: state.canRedoEdit() }
  expect(editCommands.beginLayer(tableId)).toBe(true)
  expect(useWorkbenchStore.getState().editLayerId).toBe(tableId)
  expect(useProjectStore.getState().selectedLayerId).toBe(selectedId)
  expect(useProjectStore.getState().selection).toEqual({ layerId: selectedId, featureIds: ['selected'] })
  expect(editCommands.endLayer(tableId)).toBe(true)
  expect(useWorkbenchStore.getState().editLayerId).toBeNull()
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect({ undo: state.canUndoEdit(), redo: state.canRedoEdit() }).toEqual(history)
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
  const groupId = useProjectStore.getState().createGroup('locked group', [id])!
  useProjectStore.getState().setGroupLocked(groupId, true)
  expect(editCommands.beginLayer(id)).toBe(false)
  useProjectStore.getState().setGroupLocked(groupId, false)
  const remote = useProjectStore.getState().addServiceLayer({ name: 'WFS', kind: 'wfs', source: {
    type: 'wfs', url: 'https://example.com/wfs', version: '2.0.0', typeName: 'stations', outputFormat: 'application/json', authMode: 'none'
  } })!
  expect(editCommands.beginLayer(remote.layerId)).toBe(false)
  useProjectStore.getState().removeLayer(id)
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
