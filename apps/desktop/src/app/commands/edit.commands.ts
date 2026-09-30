import { emitCommandStatus } from './status'
import { useProjectStore } from '@/stores/project.store'
import {
  isToolRuntimeMounted,
  setActiveEditTool
} from '@/features/map/map-runtime-host'

/** 编辑命令：撤销/重做走 EditHistory；绘制/修改/删除接入 OlToolRuntime。 */
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
      emitCommandStatus('修改工具已激活')
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
