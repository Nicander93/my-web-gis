import { projectSession } from '@/project/project-session'
import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { createEditorProject } from '@/project/project-type'
import { isTauri } from '@tauri-apps/api/core'
import type { ProjectType } from '@/project/project-type'
import { openSceneDocument, saveSceneDocument } from '@/io/scene-document-io'
import { saveSceneArchive } from '@/io/scene-archive-io'
import { createProjectFromSceneDocument, createProjectSceneDocument } from '@/io/project-scene-document'
import { getLiveSceneCamera } from '@/engine-host/scene3d-runtime-host'
import { finishStyleInteraction } from '@/project/style-interaction'
import { emitCommandStatus } from '@/platform/command-status'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useProjectStore, getProjectContentVersion } from '@/project/project.store'
import { requestProjectSave } from '@/project/project-save'
import { hasUnsavedProjectWork, requestUnsavedWorkSave } from '@/project/unsaved-work'
import { assertNoWorkspaceDrafts } from '@/stores/workspace-drafts'
import { discardRecoveryOnReplacement } from '@/project/recovery-tracking'
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
export type ProjectReplacementAction = '打开' | '导入'
export type ProjectReplacementDecision = 'saved' | 'discard' | null

export interface AddDataCallback {
  openDialog: () => void
}

export interface ExportDataCallback {
  openDialog: (layerId?: string | null, mode?: ExportDialogMode) => void
}

let addDataCallback: AddDataCallback | null = null
let exportDataCallback: ExportDataCallback | null = null
let newProjectCallback: (() => void) | null = null
let replacementGuard: ((action: ProjectReplacementAction) => Promise<ProjectReplacementDecision>) | null = null
let sceneImport: AbortController | null = null
let openingProject = false

export function registerProjectReplacementGuard(guard: ((action: ProjectReplacementAction) => Promise<ProjectReplacementDecision>) | null): void {
  replacementGuard = guard
}

function captureReplacementState() {
  return {
    epoch: useProjectStore.getState().projectEpoch,
    configuration: getProjectContentVersion(),
    rows: featureData.readSnapshot(),
    dataRevision: featureData.getEditState().revision
  }
}

function assertReplacementState(before: ReturnType<typeof captureReplacementState>, stage: '读取' | '确认'): void {
  const current = captureReplacementState()
  if (before.epoch !== current.epoch || before.configuration !== current.configuration
    || before.rows !== current.rows || before.dataRevision !== current.dataRevision) {
    throw new Error(`${stage}期间项目已改变。当前修改已保留，请重试。`)
  }
}

async function confirmReplacement(action: ProjectReplacementAction, signal?: AbortSignal) {
  assertNoWorkspaceDrafts()
  finishStyleInteraction()
  const before = captureReplacementState()
  if (!hasUnsavedProjectWork()) return { state: before, discarded: false }
  const decision = await replacementGuard?.(action)
  signal?.throwIfAborted()
  if (!decision) return null
  assertNoWorkspaceDrafts()
  if (before.epoch !== useProjectStore.getState().projectEpoch) throw new Error('项目已切换，请重试。')
  if (decision === 'saved') {
    if (hasUnsavedProjectWork()) throw new Error('保存后又有新的修改，请重试。')
  } else {
    assertReplacementState(before, '确认')
  }
  return { state: captureReplacementState(), discarded: decision === 'discard' }
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
  async importScene(source?: File | string): Promise<void> {
    sceneImport?.abort()
    const operation = new AbortController()
    sceneImport = operation
    try {
      const before = captureReplacementState()
      const opened = await openSceneDocument(operation.signal, {
        source,
        onRead: () => emitCommandStatus('正在读取场景…')
      })
      operation.signal.throwIfAborted()
      if (!opened) { emitCommandStatus('已取消导入场景'); return }
      assertReplacementState(before, '读取')
      const snapshot = createProjectFromSceneDocument(opened.document)
      const kind = snapshot.project.content.kind
      if (before.epoch > 0 && kind !== useProjectStore.getState().project.content.kind) {
        throw new Error(kind === 'scene3d' ? '这是三维场景。请在三维项目中导入。' : '这是二维场景。请在二维项目中导入。')
      }
      const confirmed = await confirmReplacement('导入', operation.signal)
      if (!confirmed) { emitCommandStatus('已取消导入场景'); return }
      operation.signal.throwIfAborted()
      assertReplacementState(confirmed.state, '确认')
      assertNoWorkspaceDrafts()
      if (before.epoch === 0) {
        bumpProjectGeneration()
        projectSession.loadSnapshot(snapshot)
        setCurrentProjectPath(null)
        useProjectStore.getState().setDirty(true)
        emitCommandStatus(`已打开场景：${opened.path}，请保存为项目`)
        return
      }
      projectSession.replaceSnapshotAsEdit(snapshot, '导入完整场景')
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

  async openProject(source?: File | string): Promise<void> {
    if (openingProject) return
    openingProject = true
    try {
      const before = captureReplacementState()
      const opened = await openSnapshotFromDisk(() => emitCommandStatus('正在读取项目…'), source)
      if (!opened) {
        emitCommandStatus('已取消打开')
        return
      }
      assertReplacementState(before, '读取')
      const confirmed = await confirmReplacement('打开')
      if (!confirmed) {
        emitCommandStatus('已取消打开，当前项目保持原样')
        return
      }
      assertReplacementState(confirmed.state, '确认')
      assertNoWorkspaceDrafts()
      if (confirmed.discarded) discardRecoveryOnReplacement()
      bumpProjectGeneration()
      // credentialRef keys only in file — hydrate secrets from OS secure store when available.
      projectSession.loadSnapshot(opened.snapshot)
      setCurrentProjectPath(isTauri() && (source === undefined || typeof source === 'string') ? opened.path : null)
      const installedEpoch = useProjectStore.getState().projectEpoch
      await hydrateCredentialsFromRefs(
        collectCredentialRefKeys(opened.snapshot.project.content.kind === 'map2d' ? opened.snapshot.project.content.datasets.filter(dataset => dataset.kind !== 'vector') : [])
      )
      if (installedEpoch === useProjectStore.getState().projectEpoch) emitCommandStatus(`已打开项目：${opened.path}${opened.migration ? '；旧工程已兼容读入，保存时将写入新版工程格式' : ''}`)
    } catch (error) {
      emitCommandStatus(error instanceof Error ? `打开失败：${error.message}` : '打开失败')
    } finally {
      openingProject = false
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
