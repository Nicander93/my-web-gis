import { create } from 'zustand'
import type { EditTool } from '@desktop-webgis/gis-core'

/** 临时工作目标与项目数据分离；浏览图层不会改变已绑定的任务。 */
interface WorkbenchState {
  editLayerId: string | null
  inspectorLayerId: string | null
  tableLayerId: string | null
  activeTool: EditTool
  rightTask: 'inspector' | 'processing'
  pendingInspector: { layerId: string; tab: 'layer' | 'style' | 'label' } | null
  setPendingInspector(request: WorkbenchState['pendingInspector']): void
  mapReadout: string
  setMapReadout(value: string): void
  setRightTask(task: 'inspector' | 'processing'): void
  setEditLayer(layerId: string | null): void
  bindInspector(layerId: string | null): void
  bindTable(layerId: string | null): void
  setActiveTool(tool: EditTool): void
  clearLayer(layerId: string): void
  reset(): void
}

const initial = {
  editLayerId: null,
  inspectorLayerId: null,
  tableLayerId: null,
  activeTool: 'none' as EditTool,
  rightTask: 'inspector' as const,
  pendingInspector: null,
  mapReadout: ''
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  ...initial,
  setPendingInspector: (pendingInspector) => set({ pendingInspector }),
  setMapReadout: (mapReadout) => set({ mapReadout }),
  setRightTask: (rightTask) => set({ rightTask }),
  setEditLayer: (editLayerId) => set({ editLayerId }),
  bindInspector: (inspectorLayerId) =>
    set({ inspectorLayerId, rightTask: 'inspector' }),
  bindTable: (tableLayerId) => set({ tableLayerId }),
  setActiveTool: (activeTool) => set({ activeTool }),
  clearLayer: (layerId) =>
    set((state) => ({
      editLayerId: state.editLayerId === layerId ? null : state.editLayerId,
      inspectorLayerId:
        state.inspectorLayerId === layerId ? null : state.inspectorLayerId,
      tableLayerId: state.tableLayerId === layerId ? null : state.tableLayerId,
      pendingInspector:
        state.inspectorLayerId === layerId ||
        state.pendingInspector?.layerId === layerId
          ? null
          : state.pendingInspector
    })),
  reset: () => set(initial)
}))
