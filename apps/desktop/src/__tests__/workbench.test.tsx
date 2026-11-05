import { layerConfigurationQueries } from '@/project/layer-configuration-query'
import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type GisFeature } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { layerCommands } from '@/commands/layer.commands'
import { editCommands } from '@/commands/edit.commands'
import { selectionCommands } from '@/commands/selection.commands'
import {
  mountMapRuntime,
  unmountMapRuntime,
  setActiveEditTool
} from '@/engine-host/map-runtime-host'

const mocks = vi.hoisted(() => ({ activate: vi.fn(), deactivate: vi.fn(), syncSelection: vi.fn() }))
vi.mock('@desktop-webgis/ol-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@desktop-webgis/ol-runtime')>()),
  OlMapRuntime: class {
    mount() {}
    unmount() {}
    getMap() {
      return {
        on() {},
        un() {},
        getSize() {
          return undefined
        }
      }
    }
  },
  OlSelectionRuntime: class {
    activate() {}
    deactivate() {}
    dispose() {}
    cancelGesture() { return false }
    syncSelection() {}
  },
  OlToolRuntime: class {
    setSnapping() {}
    syncSelection = mocks.syncSelection
    activate = mocks.activate
    deactivate = mocks.deactivate
  }
}))

function addLayer(datasetId: string, name: string, field: string) {
  const features: GisFeature[] = [
    {
      id: `${datasetId}-feature`,
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { [field]: name }
    }
  ]
  layerContentCommands.addLayer(datasetId, name, features, 'point')
  return useLayerViewStore.getState().selectedLayerId!
}

it('keeps styles in Project while inspector sessions contain only UI state', () => {
  const id = addLayer('style-history', 'Style history', 'name')
  const original = layerConfigurationQueries.getNormalizedLayerStyle(id)!
  layerConfigurationCommands.setLayerStyle(id, { ...original, label: { field: 'name' } })
  expect(layerConfigurationQueries.getNormalizedLayerStyle(id)?.label?.field).toBe('name')
  expect(useLayerViewStore.getState().sessions[id] ?? {}).not.toHaveProperty('styleDraft')
  expect(projectEdits.undo()).toBe(true)
  expect(layerConfigurationQueries.getNormalizedLayerStyle(id)).toEqual(original)
})

beforeEach(() => {
  unmountMapRuntime()
  vi.clearAllMocks()
  vi.stubGlobal('window', new EventTarget())
  projectSession.loadSnapshot({
      project: createProject('Workbench'),
      featuresByDataset: {}
    })
  useLayerViewStore.setState({ sessions: {} })
  useWorkspaceStore.getState().resetLayout()
})

describe('workbench task targets', () => {
  it('releases session subscriptions on remount and unmount without duplicate selection callbacks', () => {
    const id = addLayer('session-lifecycle', 'Session lifecycle', 'name')
    const initialView = requireMapContent(useProjectStore.getState().project).initialView
    mountMapRuntime({} as HTMLElement, initialView)
    mountMapRuntime({} as HTMLElement, initialView)
    expect(setActiveEditTool('modify')).toBe(true)
    mocks.syncSelection.mockClear()
    selectionCommands.setSelection({ layerId: id, featureIds: ['session-lifecycle-feature'] })
    expect(mocks.syncSelection).toHaveBeenCalledExactlyOnceWith(['session-lifecycle-feature'])
    unmountMapRuntime()
    mocks.syncSelection.mockClear()
    selectionCommands.clearSelection()
    expect(mocks.syncSelection).not.toHaveBeenCalled()
  })

  it('keeps runtime callbacks and geometry tools bound while browsing another layer', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    const second = addLayer('ds-second', 'Second', 'secondField')
    useLayerViewStore.getState().setSelectedLayer(first)
    mountMapRuntime(
      {} as HTMLElement,
      requireMapContent(useProjectStore.getState().project).initialView
    )
    expect(setActiveEditTool('modify')).toBe(true)
    const callbacks = mocks.activate.mock.calls.at(-1)![1]
    useLayerViewStore.getState().setSelectedLayer(second)
    expect(mocks.activate).toHaveBeenCalledTimes(1)
    expect(callbacks.getActiveLayerId()).toBe(first)
    callbacks.onSelectionChange(['ds-first-feature'])
    expect(useLayerViewStore.getState().selection.layerId).toBe(first)
    expect(callbacks.getSelectedFeatureIds()).toEqual(['ds-first-feature'])
    expect(callbacks.getFeatureGeometry('ds-first', 'ds-first-feature')).toEqual({ type: 'Point', coordinates: [0, 0] })
    expect(mocks.syncSelection).toHaveBeenLastCalledWith(['ds-first-feature'])
    expect(callbacks.validateGeometries('ds-first', [{ id: 'ds-first-feature', geometry: { type: 'Point', coordinates: [0, 0] } }])).toBe(true)
    expect(callbacks.validateGeometries('ds-second', [{ id: 'ds-second-feature', geometry: { type: 'Point', coordinates: [0, 0] } }])).toBe(false)
    useProjectStore.setState(state => ({ project: { ...state.project, content: { ...requireMapContent(state.project), groups: [{ id: 'locked', name: 'Locked', visible: true, locked: true, layerIds: [first] }] } } }))
    expect(callbacks.validateGeometries('ds-first', [{ id: 'ds-first-feature', geometry: { type: 'Point', coordinates: [0, 0] } }])).toBe(false)
    editCommands.end()
    expect(useWorkbenchStore.getState().editLayerId).toBeNull()
    expect(useWorkbenchStore.getState().activeTool).toBe('select')
  })

  it('deactivates geometry editing when its layer is removed', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    mountMapRuntime(
      {} as HTMLElement,
      requireMapContent(useProjectStore.getState().project).initialView
    )
    setActiveEditTool('modify')
    layerCommands.remove(first)
    expect(useWorkbenchStore.getState().editLayerId).toBeNull()
    expect(useWorkbenchStore.getState().activeTool).toBe('select')
  })

  it('pins the table and inspector independently of the browsed layer and preserves styles', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    const second = addLayer('ds-second', 'Second', 'secondField')
    layerCommands.openAttributeTable(first)
    layerCommands.editStyle(first)
    const style = layerConfigurationQueries.getNormalizedLayerStyle(first)!
    layerConfigurationCommands.setLayerStyle(first, { ...style, label: { field: 'firstField' } })
    useLayerViewStore.getState().setSelectedLayer(second)
    expect(useWorkbenchStore.getState().tableLayerId).toBe(first)
    expect(useWorkbenchStore.getState().inspectorLayerId).toBe(first)
    expect(layerConfigurationQueries.getNormalizedLayerStyle(first)?.label?.field).toBe('firstField')
    expect(
      useLayerViewStore.getState().getLayerSession(first).attributeTable
        ?.filterOpen ?? false
    ).toBe(false)
    const opened: string[] = []
    const onFilter = (event: Event) => opened.push((event as CustomEvent<string>).detail)
    window.addEventListener('desktop-webgis:layer-filter', onFilter)
    layerCommands.openFilter(first)
    window.removeEventListener('desktop-webgis:layer-filter', onFilter)
    expect(opened).toEqual([first])
    expect(
      useLayerViewStore.getState().getLayerSession(first).attributeTable
        ?.filterOpen ?? false
    ).toBe(false)
    expect(useWorkbenchStore.getState().tableLayerId).toBe(first)
  })

  it('switches the inspector directly after immediate style edits without losing them', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    const second = addLayer('ds-second', 'Second', 'secondField')
    layerCommands.editStyle(first)
    const style = layerConfigurationQueries.getNormalizedLayerStyle(first)!
    layerConfigurationCommands.setLayerStyle(first, { ...style, label: { field: 'firstField' } })
    layerCommands.editStyle(second)
    expect(useWorkbenchStore.getState().inspectorLayerId).toBe(second)
    expect(layerConfigurationQueries.getNormalizedLayerStyle(first)?.label?.field).toBe('firstField')
    expect(projectEdits.undo()).toBe(true)
    expect(layerConfigurationQueries.getNormalizedLayerStyle(first)).toEqual(style)
  })

  it('clears targets on project replacement without dirtying the project for UI changes', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    useProjectStore.getState().setDirty(false)
    editCommands.begin()
    layerCommands.properties(first)
    layerCommands.openAttributeTable(first)
    expect(useProjectStore.getState().dirty).toBe(false)
    projectSession.loadSnapshot({
        project: createProject('Replacement'),
        featuresByDataset: {}
      })
    const state = useWorkbenchStore.getState()
    expect([
      state.editLayerId,
      state.inspectorLayerId,
      state.tableLayerId
    ]).toEqual([null, null, null])
    expect(state.rightTask).toBe('inspector')
  })
})
