import { createEditorProject } from '@/services/project-type'
import type { ProjectType } from '@/services/project-type'
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
let newProjectCallback: (() => void) | null = null
let replacementGuard: (() => Promise<boolean>) | null = null

export function registerProjectReplacementGuard(guard: (() => Promise<boolean>) | null): void {
  replacementGuard = guard
}

export function registerNewProjectDialog(callback: (() => void) | null): void {
  newProjectCallback = callback
}

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
    if (newProjectCallback) { newProjectCallback(); return }
    projectCommands.createWorkspace('2d', '')
  },

  createWorkspace(type: ProjectType, name: string): void {
    bumpProjectGeneration()
    useProjectStore.getState().loadSnapshot({
      project: createEditorProject(type, name),
      featuresByDataset: {}
    })
    setCurrentProjectPath(null)
    emitCommandStatus(type === '3d' ? '已创建三维场景' : '已创建二维地图')
  },

  async openProject(): Promise<void> {
    try {
      if (useProjectStore.getState().dirty && replacementGuard && !await replacementGuard()) return
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
