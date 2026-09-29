import { emitCommandStatus } from './status'
import { useProjectStore } from '@/stores/project.store'

/** 编辑命令的最小集合；样式/过滤/透明度/分组与属性编辑共用 EditHistory。 */
export const editCommands = {
  undo(): void {
    if (useProjectStore.getState().undoEdit()) {
      emitCommandStatus('已撤销')
      return
    }
    emitCommandStatus('撤销（无可撤销操作）')
  },
  redo(): void {
    if (useProjectStore.getState().redoEdit()) {
      emitCommandStatus('已重做')
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
