import { emitCommandStatus } from './status'

/** 项目相关的应用级操作占位，后续接入现有 GIS Project Service。 */
export const projectCommands = {
  newProject(): void {
    emitCommandStatus('新建项目（项目服务待接入）')
  },
  openProject(): void {
    emitCommandStatus('打开项目（项目服务待接入）')
  },
  saveProject(): void {
    emitCommandStatus('保存项目（项目服务待接入）')
  },
  saveProjectAs(): void {
    emitCommandStatus('另存项目（项目服务待接入）')
  },
  addData(): void {
    emitCommandStatus('添加数据（数据服务待接入）')
  },
  exportData(): void {
    emitCommandStatus('导出（数据服务待接入）')
  }
}
