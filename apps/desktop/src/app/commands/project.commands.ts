import { emitCommandStatus } from './status'

export interface AddDataCallback {
  openDialog: () => void
}

export interface ExportDataCallback {
  openDialog: (layerId?: string | null) => void
}

let addDataCallback: AddDataCallback | null = null
let exportDataCallback: ExportDataCallback | null = null

export function registerAddDataCallback(callback: AddDataCallback): void {
  addDataCallback = callback
}

export function registerExportDataCallback(callback: ExportDataCallback): void {
  exportDataCallback = callback
}

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
    if (addDataCallback) {
      addDataCallback.openDialog()
    } else {
      emitCommandStatus('添加数据（对话框未注册）')
    }
  },
  exportData(layerId?: string | null): void {
    if (exportDataCallback) {
      exportDataCallback.openDialog(layerId)
    } else {
      emitCommandStatus('导出（对话框未注册）')
    }
  }
}
