import { featureData } from '@/data/feature-data'
import { requireSceneContent } from '@desktop-webgis/project'
import { isTauri } from '@tauri-apps/api/core'
import { cloneValue, serializeProjectSnapshot, type ProjectSnapshot } from '@desktop-webgis/project'
import { useProjectStore, getProjectContentVersion } from '@/session/project.store'
import { useSaveStore } from '@/session/save.store'
import { emitCommandStatus } from '@/platform/command-status'
import { createConfigurationSnapshot, getCurrentProjectPath, pickAndSaveSnapshot, saveSnapshotToPath, setCurrentProjectPath } from './project-io'
import { projectRecovery, recoveryOwner } from './project-recovery'
import { finishStyleInteraction } from '@/session/style-interaction'

let queue: Promise<unknown> = Promise.resolve()
const waiting = new Map<string, Promise<boolean>>()

function sameSavedContent(before: ProjectSnapshot, after: ProjectSnapshot): boolean {
  const previous = before.project.content.scene?.camera, next = after.project.content.scene?.camera
  if (!previous || !next || !after.project.content.scene) return serializeProjectSnapshot(before) === serializeProjectSnapshot(after)
  const camera = cloneValue(next)
  const close = (a: number, b: number, tolerance: number, period?: number) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    const delta = period ? Math.abs(((a - b + period / 2) % period + period) % period - period / 2) : Math.abs(a - b)
    return delta <= tolerance
  }
  // Cesium's Cartesian angle decomposition jitters at ~1e-13 degrees. Ignore only
  // tiny position/angle noise; explicit document edits still fail the revision guard.
  camera.position = camera.position.map((value, index) => close(value, previous.position[index], index === 2 ? 1e-6 : 1e-9, index === 0 ? 360 : undefined)
    ? previous.position[index] : value) as typeof camera.position
  for (const field of ['heading', 'pitch', 'roll'] as const) {
    if (close(camera[field], previous[field], 1e-9, field === 'pitch' ? undefined : 360)) camera[field] = previous[field]
  }
  return serializeProjectSnapshot(before) === serializeProjectSnapshot({ ...after, project: { ...after.project, content: { ...requireSceneContent(after.project), scene: { ...after.project.content.scene, camera } } } })
}

/** Serialize disk writes; one queued request per project/mode captures the latest content when it starts. */
export function requestProjectSave(saveAs = false): Promise<boolean> {
  finishStyleInteraction()
  const owner = useProjectStore.getState()
  const epoch = owner.projectEpoch
  const key = `${epoch}:${saveAs}`
  const pending = waiting.get(key)
  if (pending) return pending
  useSaveStore.setState((state) => ({ pending: state.pending + 1 }))
  const task = queue.then(async () => {
    waiting.delete(key)
    const ownsProject = () => useProjectStore.getState().projectEpoch === epoch
    if (!ownsProject()) { emitCommandStatus('保存请求所属工程已切换，未启动写入'); return false }
    try {
      const state = useProjectStore.getState(), version = getProjectContentVersion()
      const sessions = featureData.captureActiveSessions()
      const snapshot = createConfigurationSnapshot(state.project, sessions)
      const existing = saveAs ? null : getCurrentProjectPath()
      const path = existing ?? await pickAndSaveSnapshot(snapshot, `${state.project.metadata.name || 'project'}.webgis.json`)
      if (existing) await saveSnapshotToPath(existing, snapshot)
      if (!path) { emitCommandStatus(saveAs ? '已取消另存' : '已取消保存'); return false }
      if (!ownsProject()) { emitCommandStatus('原工程快照已写入；当前工程未改变'); return false }
      setCurrentProjectPath(isTauri() ? path : null)
      const current = useProjectStore.getState()
      const unchanged = version === getProjectContentVersion() && sameSavedContent(snapshot, createConfigurationSnapshot(current.project, featureData.captureActiveSessions()))
      current.setDirty(!unchanged)
      let cleanupError = ''
      // Configuration acknowledgement does not clear data pending; recovery still holds unsaved Buffer state.
      if (unchanged && featureData.getEditState().unsavedCount === 0) {
        try { await projectRecovery.clearSaved(snapshot, recoveryOwner(epoch)) }
        catch (error) { cleanupError = `；恢复草稿清理失败：${error instanceof Error ? error.message : String(error)}` }
      }
      if (!ownsProject()) { emitCommandStatus('原工程已保存；清理期间当前工程已切换'); return false }
      const latest = useProjectStore.getState()
      const acknowledged = unchanged && version === getProjectContentVersion() && sameSavedContent(snapshot, createConfigurationSnapshot(latest.project, featureData.captureActiveSessions()))
      if (!acknowledged) latest.setDirty(true)
      const pendingNote = featureData.getEditState().unsavedCount > 0 ? '；数据编辑尚未提交' : ''
      emitCommandStatus(`${isTauri() ? '已保存工程配置' : '工程配置下载已发起'}：${path}${acknowledged ? '' : '；期间有新修改，仍需保存'}${pendingNote}${cleanupError}`)
      return acknowledged
    } catch (error) {
      emitCommandStatus(`${saveAs ? '另存' : '保存'}失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }).finally(() => useSaveStore.setState((state) => ({ pending: state.pending - 1 })))
  waiting.set(key, task)
  queue = task.catch(() => undefined)
  return task
}
