import { emitCommandStatus } from './status'

/** 编辑命令的最小集合，具体要素编辑将在 GIS 回接阶段实现。 */
export const editCommands = {
  undo(): void {
    emitCommandStatus('撤销（编辑服务待接入）')
  },
  redo(): void {
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
