import { createEditorProject } from '@/services/project-type'
import { isTauri } from '@tauri-apps/api/core'
import type { ProjectType } from '@/services/project-type'
import { openSceneDocument, saveSceneDocument } from '@/services/scene-document-io'
import { saveSceneArchive } from '@/services/scene-archive-io'
import { createProjectSceneDocument } from '@/features/scene/project-scene-document'
import { replaceSceneDocumentAsEdit } from '@/features/scene/scene-document.commands'
import { getLiveCityCamera } from '@/features/city/city-runtime-host'
import { resolveSceneDrafts } from '@/features/inspector/scene-draft-guard'
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
let sceneImport: AbortController | null = null

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
  isImportingScene(): boolean { return sceneImport !== null },
  cancelSceneImport(): void {
    sceneImport?.abort()
    sceneImport = null
    emitCommandStatus('已取消场景导入，原项目保持不变')
  },
  async importScene(): Promise<void> {
    sceneImport?.abort()
    const operation = new AbortController()
    sceneImport = operation
    try {
      if (!await resolveSceneDrafts()) return
      operation.signal.throwIfAborted()
      if (useProjectStore.getState().dirty && replacementGuard && !await replacementGuard()) return
      operation.signal.throwIfAborted()
      if (Object.values(useSessionStore.getState().sessions).some(session => session.styleDraft?.dirty)) throw new Error('请先应用或放弃样式草稿，再导入场景')
      const before = JSON.stringify(useProjectStore.getState().getSnapshot())
      const opened = await openSceneDocument(operation.signal)
      operation.signal.throwIfAborted()
      if (!opened) { emitCommandStatus('已取消导入场景'); return }
      if (JSON.stringify(useProjectStore.getState().getSnapshot()) !== before) throw new Error('选择文件期间项目已改变，请重新导入')
      replaceSceneDocumentAsEdit(opened.document)
      emitCommandStatus(`已导入完整场景：${opened.path}，可撤销恢复`)
    } catch (error) {
      if (operation.signal.aborted) return
      emitCommandStatus(error instanceof Error ? `导入失败：${error.message}` : '导入失败')
    } finally { if (sceneImport === operation) sceneImport = null }
  },
  async exportScene(): Promise<void> {
    try {
      const state = useProjectStore.getState()
      const snapshot = createSnapshotFromState(state.project, state.featuresByDataset)
      const camera = getLiveCityCamera()
      if (snapshot.project.city && camera) snapshot.project.city.camera = camera
      const result = await saveSceneDocument(createProjectSceneDocument(snapshot), state.project.name)
      emitCommandStatus(result.kind === 'saved' ? `已导出完整场景：${result.path}` : result.kind === 'cancelled' ? '已取消导出场景' : `完整场景下载已发起：${result.name}`)
    } catch (error) { emitCommandStatus(error instanceof Error ? `导出失败：${error.message}` : '导出失败') }
  },
  async exportSceneArchive(): Promise<void> {
    try {
      const state = useProjectStore.getState()
      const snapshot = createSnapshotFromState(state.project, state.featuresByDataset)
      const camera = getLiveCityCamera()
      if (snapshot.project.city && camera) snapshot.project.city.camera = camera
      const result = await saveSceneArchive(createProjectSceneDocument(snapshot), state.project.name)
      emitCommandStatus(result.kind === 'saved' ? `已导出场景资源包：${result.path}` : result.kind === 'cancelled' ? '已取消导出资源包' : `场景资源包下载已发起：${result.name}`)
    } catch (error) { emitCommandStatus(error instanceof Error ? `资源包导出失败：${error.message}` : '资源包导出失败') }
  },
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
      emitCommandStatus(isTauri() ? `已保存：${path}` : `项目下载已发起：${path}`)
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
      emitCommandStatus(isTauri() ? `已另存：${path}` : `项目下载已发起：${path}`)
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
