import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type GisFeature } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { layerCommands } from '@/app/commands/layer.commands'
import { editCommands } from '@/app/commands/edit.commands'
import {
  mountMapRuntime,
  unmountMapRuntime,
  setActiveEditTool
} from '@/features/map/map-runtime-host'

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
  useProjectStore.getState().addLayer(datasetId, name, features, 'point')
  return useProjectStore.getState().selectedLayerId!
}

it('keeps styles in Project while inspector sessions contain only UI state', () => {
  const id = addLayer('style-history', 'Style history', 'name')
  const original = useProjectStore.getState().getNormalizedLayerStyle(id)!
  useProjectStore.getState().setLayerStyle(id, { ...original, label: { field: 'name' } })
  expect(useProjectStore.getState().getNormalizedLayerStyle(id)?.label?.field).toBe('name')
  expect(useSessionStore.getState().sessions[id] ?? {}).not.toHaveProperty('styleDraft')
  expect(useProjectStore.getState().undoEdit()).toBe(true)
  expect(useProjectStore.getState().getNormalizedLayerStyle(id)).toEqual(original)
})

beforeEach(() => {
  unmountMapRuntime()
  vi.clearAllMocks()
  vi.stubGlobal('window', new EventTarget())
  useProjectStore
    .getState()
    .loadSnapshot({
      project: createProject('Workbench'),
      featuresByDataset: {}
    })
  useSessionStore.setState({ sessions: {} })
  useWorkspaceStore.getState().resetLayout()
})

describe('workbench task targets', () => {
  it('keeps runtime callbacks and geometry tools bound while browsing another layer', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    const second = addLayer('ds-second', 'Second', 'secondField')
    useProjectStore.getState().setSelectedLayer(first)
    mountMapRuntime(
      {} as HTMLElement,
      useProjectStore.getState().project.mapState
    )
    expect(setActiveEditTool('modify')).toBe(true)
    const callbacks = mocks.activate.mock.calls.at(-1)![1]
    useProjectStore.getState().setSelectedLayer(second)
    expect(mocks.activate).toHaveBeenCalledTimes(1)
    expect(callbacks.getActiveLayerId()).toBe(first)
    callbacks.onSelectionChange(['ds-first-feature'])
    expect(useProjectStore.getState().selection.layerId).toBe(first)
    expect(callbacks.getSelectedFeatureIds()).toEqual(['ds-first-feature'])
    expect(callbacks.getFeatureGeometry('ds-first', 'ds-first-feature')).toEqual({ type: 'Point', coordinates: [0, 0] })
    expect(mocks.syncSelection).toHaveBeenLastCalledWith(['ds-first-feature'])
    expect(callbacks.validateGeometries('ds-first', [{ id: 'ds-first-feature', geometry: { type: 'Point', coordinates: [0, 0] } }])).toBe(true)
    expect(callbacks.validateGeometries('ds-second', [{ id: 'ds-second-feature', geometry: { type: 'Point', coordinates: [0, 0] } }])).toBe(false)
    useProjectStore.setState(state => ({ project: { ...state.project, groups: [{ id: 'locked', name: 'Locked', visible: true, locked: true, layerIds: [first] }] } }))
    expect(callbacks.validateGeometries('ds-first', [{ id: 'ds-first-feature', geometry: { type: 'Point', coordinates: [0, 0] } }])).toBe(false)
    editCommands.end()
    expect(useWorkbenchStore.getState().editLayerId).toBeNull()
    expect(useWorkbenchStore.getState().activeTool).toBe('select')
  })

  it('deactivates geometry editing when its layer is removed', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    mountMapRuntime(
      {} as HTMLElement,
      useProjectStore.getState().project.mapState
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
    const style = useProjectStore.getState().getNormalizedLayerStyle(first)!
    useProjectStore.getState().setLayerStyle(first, { ...style, label: { field: 'firstField' } })
    useProjectStore.getState().setSelectedLayer(second)
    expect(useWorkbenchStore.getState().tableLayerId).toBe(first)
    expect(useWorkbenchStore.getState().inspectorLayerId).toBe(first)
    expect(useProjectStore.getState().getNormalizedLayerStyle(first)?.label?.field).toBe('firstField')
    expect(
      useSessionStore.getState().getLayerSession(first).attributeTable
        ?.filterOpen ?? false
    ).toBe(false)
    layerCommands.openFilter(first)
    expect(
      useSessionStore.getState().getLayerSession(first).attributeTable
        ?.filterOpen
    ).toBe(true)
    expect(useWorkbenchStore.getState().tableLayerId).toBe(first)
  })

  it('switches the inspector directly after immediate style edits without losing them', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    const second = addLayer('ds-second', 'Second', 'secondField')
    layerCommands.editStyle(first)
    const style = useProjectStore.getState().getNormalizedLayerStyle(first)!
    useProjectStore.getState().setLayerStyle(first, { ...style, label: { field: 'firstField' } })
    layerCommands.editStyle(second)
    expect(useWorkbenchStore.getState().inspectorLayerId).toBe(second)
    expect(useProjectStore.getState().getNormalizedLayerStyle(first)?.label?.field).toBe('firstField')
    expect(useProjectStore.getState().undoEdit()).toBe(true)
    expect(useProjectStore.getState().getNormalizedLayerStyle(first)).toEqual(style)
  })

  it('clears targets on project replacement without dirtying the project for UI changes', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    useProjectStore.getState().setDirty(false)
    editCommands.begin()
    layerCommands.properties(first)
    layerCommands.openAttributeTable(first)
    expect(useProjectStore.getState().dirty).toBe(false)
    useProjectStore
      .getState()
      .loadSnapshot({
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
