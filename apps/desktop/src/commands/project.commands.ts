import { projectSession } from '@/project/project-session'
import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { createEditorProject } from '@/project/project-type'
import { isTauri } from '@tauri-apps/api/core'
import type { ProjectType } from '@/project/project-type'
import { openSceneDocument, saveSceneDocument } from '@/io/scene-document-io'
import { saveSceneArchive } from '@/io/scene-archive-io'
import { createProjectSceneDocument } from '@/io/project-scene-document'
import { replaceSceneDocumentAsEdit } from '@/commands/scene-document.commands'
import { getLiveSceneCamera } from '@/engine-host/scene3d-runtime-host'
import { resolveSceneDrafts } from '@/project/scene-draft-guard'
import { emitCommandStatus } from '@/platform/command-status'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useProjectStore, getProjectContentVersion } from '@/project/project.store'
import { requestProjectSave } from '@/project/project-save'
import { hasUnsavedProjectWork, requestUnsavedWorkSave } from '@/project/unsaved-work'
import {
  createSnapshotFromState,
  openSnapshotFromDisk,
  setCurrentProjectPath
} from '@/project/project-io'
import {
  clearSessionCredentials,
  collectCredentialRefKeys,
  hydrateCredentialsFromRefs
} from '@/platform/credentials'

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
  useLayerViewStore.getState().bumpWfsLoadGeneration()
  useLayerViewStore.getState().abortAllWfsLoads()
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
      if (hasUnsavedProjectWork() && replacementGuard && !await replacementGuard()) return
      operation.signal.throwIfAborted()
      const before = JSON.stringify(projectSession.getSnapshot())
      const epoch = useProjectStore.getState().projectEpoch
      const opened = await openSceneDocument(operation.signal)
      operation.signal.throwIfAborted()
      if (!opened) { emitCommandStatus('已取消导入场景'); return }
      if (useProjectStore.getState().projectEpoch !== epoch || JSON.stringify(projectSession.getSnapshot()) !== before) throw new Error('选择文件期间项目已改变，请重新导入')
      replaceSceneDocumentAsEdit(opened.document)
      emitCommandStatus(`已导入完整场景：${opened.path}，可撤销恢复`)
    } catch (error) {
      if (operation.signal.aborted) return
      emitCommandStatus(error instanceof Error ? `导入失败：${error.message}` : '导入失败')
    } finally { if (sceneImport === operation) sceneImport = null }
  },
  async exportScene(): Promise<void> {
    try {
      const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
      const snapshot = createSnapshotFromState(state.project, stateFeatureData)
      const camera = getLiveSceneCamera()
      if (snapshot.project.content.scene && camera) snapshot.project.content.scene.camera = camera
      const result = await saveSceneDocument(createProjectSceneDocument(snapshot), state.project.metadata.name)
      emitCommandStatus(result.kind === 'saved' ? `已导出完整场景：${result.path}` : result.kind === 'cancelled' ? '已取消导出场景' : `完整场景下载已发起：${result.name}`)
    } catch (error) { emitCommandStatus(error instanceof Error ? `导出失败：${error.message}` : '导出失败') }
  },
  async exportSceneArchive(): Promise<void> {
    try {
      const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
      const snapshot = createSnapshotFromState(state.project, stateFeatureData)
      const camera = getLiveSceneCamera()
      if (snapshot.project.content.scene && camera) snapshot.project.content.scene.camera = camera
      const result = await saveSceneArchive(createProjectSceneDocument(snapshot), state.project.metadata.name)
      emitCommandStatus(result.kind === 'saved' ? `已导出场景资源包：${result.path}` : result.kind === 'cancelled' ? '已取消导出资源包' : `场景资源包下载已发起：${result.name}`)
    } catch (error) { emitCommandStatus(error instanceof Error ? `资源包导出失败：${error.message}` : '资源包导出失败') }
  },
  newProject(): void {
    if (newProjectCallback) { newProjectCallback(); return }
    projectCommands.createWorkspace('2d', '')
  },

  createWorkspace(type: ProjectType, name: string): void {
    bumpProjectGeneration()
    projectSession.loadSnapshot({
      project: createEditorProject(type, name),
      featuresByDataset: {}
    })
    setCurrentProjectPath(null)
    emitCommandStatus(type === '3d' ? '已创建三维场景' : '已创建二维地图')
  },

  async openProject(): Promise<void> {
    try {
      const epoch = useProjectStore.getState().projectEpoch
      if (!await resolveSceneDrafts()) return
      if (hasUnsavedProjectWork() && replacementGuard && !await replacementGuard()) return
      if (epoch !== useProjectStore.getState().projectEpoch) throw new Error('工程已切换，请重新打开文件')
      const version = getProjectContentVersion()
      const opened = await openSnapshotFromDisk()
      if (!opened) {
        emitCommandStatus('已取消打开')
        return
      }
      if (epoch !== useProjectStore.getState().projectEpoch || version !== getProjectContentVersion()) throw new Error('选择或读取文件期间工程已改变，原内容保留')
      bumpProjectGeneration()
      // credentialRef keys only in file — hydrate secrets from OS secure store when available.
      projectSession.loadSnapshot(opened.snapshot)
      setCurrentProjectPath(isTauri() ? opened.path : null)
      const installedEpoch = useProjectStore.getState().projectEpoch
      await hydrateCredentialsFromRefs(
        collectCredentialRefKeys(opened.snapshot.project.content.kind === 'map2d' ? opened.snapshot.project.content.datasets.filter(dataset => dataset.kind !== 'vector') : [])
      )
      if (installedEpoch === useProjectStore.getState().projectEpoch) emitCommandStatus(`已打开项目：${opened.path}${opened.migration ? '；旧工程已兼容读入，保存时将写入新版工程格式' : ''}`)
    } catch (error) {
      emitCommandStatus(error instanceof Error ? `打开失败：${error.message}` : '打开失败')
    }
  },

  async saveProject(): Promise<void> { await requestProjectSave() },

  /** 关闭或打开项目时的确认：提交配置并提交已绑定的数据。Ctrl+S 仍然只保存配置。 */
  saveProjectAndConfirm(): Promise<boolean> { return requestUnsavedWorkSave() },

  async saveProjectAs(): Promise<void> { await requestProjectSave(true) },

  /** 测试和辅助用：清空会话中的凭据，凭据不会写进项目。 */
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
