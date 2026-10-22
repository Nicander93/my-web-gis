import { create } from 'zustand'
import type { EditTool } from '@desktop-webgis/gis-core'

/** 临时工作目标与项目数据分离；浏览图层不会改变已绑定的任务。 */
interface WorkbenchState {
  editLayerId: string | null
  inspectorLayerId: string | null
  tableLayerId: string | null
  tableLayerIds: string[]
  activeTool: EditTool
  rightTask: 'inspector' | 'information' | 'processing'
  identifyActive: boolean
  cartographyDialog: { layerId: string; kind: 'sld' | 'publish'; epoch: number } | null
  setCartographyDialog(request: WorkbenchState['cartographyDialog']): void
  setIdentifyActive(active: boolean): void
  pendingInspector: { layerId: string; tab: 'layer' | 'style' | 'label' } | null
  setPendingInspector(request: WorkbenchState['pendingInspector']): void
  mapReadout: string
  setMapReadout(value: string): void
  setRightTask(task: WorkbenchState['rightTask']): void
  setEditLayer(layerId: string | null): void
  bindInspector(layerId: string | null): void
  bindTable(layerId: string | null): void
  closeTable(layerId: string): void
  setActiveTool(tool: EditTool): void
  clearLayer(layerId: string): void
  reset(): void
}

const initial = {
  editLayerId: null,
  inspectorLayerId: null,
  tableLayerId: null,
  tableLayerIds: [] as string[],
  activeTool: 'none' as EditTool,
  rightTask: 'inspector' as const,
  identifyActive: false,
  cartographyDialog: null,
  pendingInspector: null,
  mapReadout: ''
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  ...initial,
  setCartographyDialog: cartographyDialog => set({ cartographyDialog }),
  setIdentifyActive: identifyActive => set({ identifyActive }),
  setPendingInspector: (pendingInspector) => set({ pendingInspector }),
  setMapReadout: (mapReadout) => set({ mapReadout }),
  setRightTask: (rightTask) => set({ rightTask }),
  setEditLayer: (editLayerId) => set({ editLayerId }),
  bindInspector: (inspectorLayerId) =>
    set({ inspectorLayerId, rightTask: 'inspector' }),
  bindTable: (tableLayerId) => set((state) => ({
    tableLayerId,
    tableLayerIds: tableLayerId && !state.tableLayerIds.includes(tableLayerId)
      ? [...state.tableLayerIds, tableLayerId] : state.tableLayerIds
  })),
  closeTable: (layerId) => set((state) => {
    const index = state.tableLayerIds.indexOf(layerId)
    const tableLayerIds = state.tableLayerIds.filter((id) => id !== layerId)
    return {
      tableLayerIds,
      tableLayerId: state.tableLayerId === layerId
        ? tableLayerIds[Math.min(index, tableLayerIds.length - 1)] ?? null
        : state.tableLayerId
    }
  }),
  setActiveTool: (activeTool) => set({ activeTool }),
  clearLayer: (layerId) =>
    set((state) => ({
      cartographyDialog: state.cartographyDialog?.layerId === layerId ? null : state.cartographyDialog,
      editLayerId: state.editLayerId === layerId ? null : state.editLayerId,
      inspectorLayerId:
        state.inspectorLayerId === layerId ? null : state.inspectorLayerId,
      tableLayerId: state.tableLayerId === layerId
        ? state.tableLayerIds.filter((id) => id !== layerId)[0] ?? null
        : state.tableLayerId,
      tableLayerIds: state.tableLayerIds.filter((id) => id !== layerId),
      pendingInspector:
        state.inspectorLayerId === layerId ||
        state.pendingInspector?.layerId === layerId
          ? null
          : state.pendingInspector
    })),
  reset: () => set(initial)
}))
