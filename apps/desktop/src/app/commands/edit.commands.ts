import { emitCommandStatus } from './status'
import { finishStyleInteraction } from '@/features/inspector/style-interaction'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { capabilitiesForDataset, getEffectiveLocked } from '@desktop-webgis/gis-core'
import {
  isToolRuntimeMounted,
  setActiveEditTool
} from '@/features/map/map-runtime-host'

/** 编辑命令：撤销/重做走 EditHistory；绘制/修改/删除接入 OlToolRuntime。 */
export const editCommands = {
  begin(): void {
    const layerId = useProjectStore.getState().selectedLayerId
    if (!layerId) {
      emitCommandStatus('请选择可编辑的本地矢量图层')
      return
    }
    editCommands.beginLayer(layerId)
  },
  /** Tables have their own target, independent of the layer selected in the tree. */
  beginLayer(layerId: string): boolean {
    const state = useProjectStore.getState()
    const current = useWorkbenchStore.getState().editLayerId
    if (current && current !== layerId) {
      emitCommandStatus('请先结束当前图层编辑，再切换编辑目标')
      return false
    }
    const layer = state.project.layers.find(
      (item) => item.id === layerId
    )
    if (
      !layer ||
      getEffectiveLocked(state.project, layer.id) ||
      !capabilitiesForDataset(
        state.project.datasets.find((item) => item.id === layer.datasetId)
      ).editGeometry
    ) {
      emitCommandStatus('请选择可编辑的本地矢量图层')
      return false
    }
    if (current === layerId) return true
    useWorkbenchStore.getState().setEditLayer(layer.id)
    setActiveEditTool('pan')
    emitCommandStatus(`编辑目标已锁定：${layer.name}`)
    return true
  },
  end(): void {
    setActiveEditTool('select')
    useWorkbenchStore.getState().setEditLayer(null)
    emitCommandStatus('已结束编辑；修改已记录，可撤销，请保存项目')
  },
  endLayer(layerId: string): boolean {
    if (useWorkbenchStore.getState().editLayerId !== layerId) return false
    editCommands.end()
    return true
  },
  undo(): void {
    finishStyleInteraction()
    if (useProjectStore.getState().undoEdit()) {
      emitCommandStatus('已撤销')
      return
    }
    emitCommandStatus(useProjectStore.getState().getHistoryBlockReason('undo') ?? '撤销（无可撤销操作）')
  },
  redo(): void {
    finishStyleInteraction()
    if (useProjectStore.getState().redoEdit()) {
      emitCommandStatus('已重做')
      return
    }
    emitCommandStatus(useProjectStore.getState().getHistoryBlockReason('redo') ?? '重做（无可重做操作）')
  },
  draw(): void {
    if (!isToolRuntimeMounted()) {
      emitCommandStatus('绘制（编辑工具运行时未挂载）')
      return
    }
    if (setActiveEditTool('draw-point')) {
      emitCommandStatus('绘制工具已激活')
      return
    }
    emitCommandStatus('绘制（请选择可编辑矢量图层）')
  },
  modify(): void {
    if (!isToolRuntimeMounted()) {
      emitCommandStatus('修改（编辑工具运行时未挂载）')
      return
    }
    if (setActiveEditTool('modify')) {
      emitCommandStatus('顶点编辑已激活：Shift 多选，拖动公共顶点同步修改，Alt 单击删除顶点，Esc 取消当前拖动')
      return
    }
    emitCommandStatus('修改（请选择可编辑矢量图层）')
  },
  deleteSelected(): void {
    if (!isToolRuntimeMounted()) {
      emitCommandStatus('删除（编辑工具运行时未挂载）')
      return
    }
    if (setActiveEditTool('delete')) {
      emitCommandStatus('删除工具已激活（单击要素删除）')
      return
    }
    emitCommandStatus('删除（请选择可编辑矢量图层）')
  }
}
