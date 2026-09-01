import { emitCommandStatus } from './status'
import { useWorkspaceStore } from '@/stores/workspace.store'

/** 图层操作命令，供 Header 与后续 Layer Context Menu 复用。 */
export const layerCommands = {
  zoomToLayer(): void {
    emitCommandStatus('缩放到图层（地图运行时待接入）')
  },
  moveUp(): void {
    emitCommandStatus('图层上移（图层服务待接入）')
  },
  moveDown(): void {
    emitCommandStatus('图层下移（图层服务待接入）')
  },
  remove(): void {
    emitCommandStatus('移除图层（图层服务待接入）')
  },
  editStyle(): void {
    emitCommandStatus('编辑样式（样式服务待接入）')
  },
  openAttributeTable(): void {
    useWorkspaceStore.getState().setBottomOpen(true)
    emitCommandStatus('属性表已打开')
  },
  export(): void {
    emitCommandStatus('导出图层（数据服务待接入）')
  }
}
