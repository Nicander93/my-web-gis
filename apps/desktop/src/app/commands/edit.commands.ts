import { emitCommandStatus } from './status'
import { layerCommands } from './layer.commands'

/** 编辑命令的最小集合；样式配置撤销优先于要素编辑（后者待接入）。 */
export const editCommands = {
  undo(): void {
    if (layerCommands.undoStyle()) return
    emitCommandStatus('撤销（编辑服务待接入）')
  },
  redo(): void {
    if (layerCommands.redoStyle()) return
    emitCommandStatus('重做（编辑服务待接入）')
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
