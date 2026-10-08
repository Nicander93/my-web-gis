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

const mocks = vi.hoisted(() => ({ activate: vi.fn(), deactivate: vi.fn() }))
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
    syncSelection() {}
  },
  OlToolRuntime: class {
    setSnapping() {}
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

  it('pins the table and inspector independently of the browsed layer and preserves drafts', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    const second = addLayer('ds-second', 'Second', 'secondField')
    layerCommands.openAttributeTable(first)
    layerCommands.editStyle(first)
    const style = useProjectStore.getState().getNormalizedLayerStyle(first)!
    useSessionStore.getState().ensureStyleDraft(first, style)
    useSessionStore.getState().patchStyleDraft(first, { classCount: 7 })
    useProjectStore.getState().setSelectedLayer(second)
    expect(useWorkbenchStore.getState().tableLayerId).toBe(first)
    expect(useWorkbenchStore.getState().inspectorLayerId).toBe(first)
    expect(
      useSessionStore.getState().getLayerSession(first).styleDraft?.dirty
    ).toBe(true)
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

  it('requires a decision before changing an inspector with an unapplied draft', () => {
    const first = addLayer('ds-first', 'First', 'firstField')
    const second = addLayer('ds-second', 'Second', 'secondField')
    layerCommands.editStyle(first)
    useSessionStore
      .getState()
      .ensureStyleDraft(
        first,
        useProjectStore.getState().getNormalizedLayerStyle(first)!
      )
    useSessionStore.getState().patchStyleDraft(first, { classCount: 7 })
    layerCommands.properties(second)
    expect(useWorkbenchStore.getState().inspectorLayerId).toBe(first)
    expect(useWorkbenchStore.getState().pendingInspector).toEqual({
      layerId: second,
      tab: 'layer'
    })
    useWorkbenchStore.getState().setPendingInspector(null)
    expect(
      useSessionStore.getState().getLayerSession(first).styleDraft?.dirty
    ).toBe(true)
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
