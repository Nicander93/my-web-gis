import { createProject } from '@desktop-webgis/gis-core'
import { emitCommandStatus } from './status'
import { useSessionStore } from '@/stores/session.store'
import { useProjectStore } from '@/stores/project.store'
import {
  createSnapshotFromState,
  getCurrentProjectPath,
  openSnapshotFromDisk,
  pickAndSaveSnapshot,
  saveSnapshotToPath,
  setCurrentProjectPath
} from '@/services/project-io'
import {
  clearSessionCredentials,
  collectCredentialRefKeys,
  hydrateCredentialsFromRefs
} from '@/services/credentials'

export type ExportDialogMode = 'export' | 'copy'

export interface AddDataCallback {
  openDialog: () => void
}

export interface ExportDataCallback {
  openDialog: (layerId?: string | null, mode?: ExportDialogMode) => void
}

let addDataCallback: AddDataCallback | null = null
let exportDataCallback: ExportDataCallback | null = null

export function registerAddDataCallback(callback: AddDataCallback): void {
  addDataCallback = callback
}

export function registerExportDataCallback(callback: ExportDataCallback): void {
  exportDataCallback = callback
}

function bumpProjectGeneration(): void {
  useSessionStore.getState().bumpWfsLoadGeneration()
  useSessionStore.getState().abortAllWfsLoads()
}

export const projectCommands = {
  newProject(): void {
    bumpProjectGeneration()
    useProjectStore.getState().loadSnapshot({
      project: createProject(),
      featuresByDataset: {}
    })
    setCurrentProjectPath(null)
    emitCommandStatus('已新建项目')
  },

  async openProject(): Promise<void> {
    try {
      const opened = await openSnapshotFromDisk()
      if (!opened) {
        emitCommandStatus('已取消打开')
        return
      }
      bumpProjectGeneration()
      // credentialRef keys only in file — hydrate secrets from OS secure store when available.
      useProjectStore.getState().loadSnapshot(opened.snapshot)
      await hydrateCredentialsFromRefs(
        collectCredentialRefKeys(opened.snapshot.project.datasets.filter(dataset => dataset.kind !== 'vector'))
      )
      emitCommandStatus(`已打开项目：${opened.path}`)
    } catch (error) {
      emitCommandStatus(error instanceof Error ? `打开失败：${error.message}` : '打开失败')
    }
  },

  async saveProject(): Promise<void> {
    try {
      const state = useProjectStore.getState()
      const snapshot = createSnapshotFromState(state.project, state.featuresByDataset)
      const existing = getCurrentProjectPath()
      if (existing) {
        await saveSnapshotToPath(existing, snapshot)
        state.setDirty(false)
        emitCommandStatus(`已保存：${existing}`)
        return
      }
      const path = await pickAndSaveSnapshot(snapshot, `${state.project.name || 'project'}.webgis.json`)
      if (!path) {
        emitCommandStatus('已取消保存')
        return
      }
      state.setDirty(false)
      emitCommandStatus(`已保存：${path}`)
    } catch (error) {
      emitCommandStatus(error instanceof Error ? `保存失败：${error.message}` : '保存失败')
    }
  },

  async saveProjectAs(): Promise<void> {
    try {
      const state = useProjectStore.getState()
      const snapshot = createSnapshotFromState(state.project, state.featuresByDataset)
      const path = await pickAndSaveSnapshot(snapshot, `${state.project.name || 'project'}.webgis.json`)
      if (!path) {
        emitCommandStatus('已取消另存')
        return
      }
      state.setDirty(false)
      emitCommandStatus(`已另存：${path}`)
    } catch (error) {
      emitCommandStatus(error instanceof Error ? `另存失败：${error.message}` : '另存失败')
    }
  },

  /** Test/helper: clear session credentials (never written to project). */
  clearCredentialsForTests(): void {
    clearSessionCredentials()
  },

  addData(): void {
    if (addDataCallback) {
      addDataCallback.openDialog()
    } else {
      emitCommandStatus('添加数据（对话框未注册）')
    }
  },

  exportData(layerId?: string | null, mode: ExportDialogMode = 'export'): void {
    if (exportDataCallback) {
      exportDataCallback.openDialog(layerId, mode)
    } else {
      emitCommandStatus('导出（对话框未注册）')
    }
  }
}
