import { emitCommandStatus } from './status'
import { layerCommands } from './layer.commands'
import { useProjectStore } from '@/stores/project.store'

/** 编辑命令的最小集合；样式配置撤销优先，其次属性编辑撤销。 */
export const editCommands = {
  undo(): void {
    if (layerCommands.undoStyle()) return
    if (useProjectStore.getState().undoAttributeEdit()) {
      emitCommandStatus('已撤销属性编辑')
      return
    }
    emitCommandStatus('撤销（无可撤销操作）')
  },
  redo(): void {
    if (layerCommands.redoStyle()) return
    if (useProjectStore.getState().redoAttributeEdit()) {
      emitCommandStatus('已重做属性编辑')
      return
    }
    emitCommandStatus('重做（无可重做操作）')
  },
  draw(): void {
    emitCommandStatus('绘制（绘制工具待接入）')
  },
  modify(): void {
    emitCommandStatus('修改（编辑工具待接入）')
  },
  deleteSelected(): void {
    emitCommandStatus('删除（编辑服务待接入）')
  }
}
