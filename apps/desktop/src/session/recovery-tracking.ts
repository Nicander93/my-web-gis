import { buildPersistedSnapshot, type ProjectSnapshot } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { emitCommandStatus } from '@/platform/command-status'
import { createSnapshotFromState, getCurrentProjectPath } from './project-io'
import { projectRecovery, recoveryOwner } from './project-recovery'
import { featureData } from '@/data/feature-data'
import { hasUnsavedProjectWork } from './unsaved-work'
import type { DatasetRecoverySession } from '@/data/feature-data-runtime'

interface PendingDraft {
  snapshot: ProjectSnapshot
  dataSessions: Record<string, DatasetRecoverySession>
  sourcePath: string | null
  epoch: number
}
let discardedReplacement: { state: ReturnType<typeof useProjectStore.getState>; features: ReturnType<typeof featureData.readSnapshot> } | null = null

/** Mark only an explicit discard; cancelling a file picker still retains the current draft. */
export function discardRecoveryOnReplacement(): void { discardedReplacement = { state: useProjectStore.getState(), features: featureData.readSnapshot() } }

/** Save applied document edits, never layout, credentials or uncommitted form previews. */
export function startRecoveryTracking(delayMs = 5_000, intervalMs = 120_000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: PendingDraft | null = null
  let stopped = false
  let observedFeatures = featureData.readSnapshot()
  let observedSessions = featureData.captureActiveSessions()
  let observedEditRevision = featureData.getEditState().revision
  let lastSource = { epoch: useProjectStore.getState().projectEpoch, path: getCurrentProjectPath() }
  const report = (error: unknown) => {
    if (!stopped) emitCommandStatus(`恢复草稿写入失败，正式项目未改变：${error instanceof Error ? error.message : String(error)}`)
  }
  const write = (draft: PendingDraft) => {
    void projectRecovery.write(draft.snapshot, draft.sourcePath, recoveryOwner(draft.epoch), undefined, draft.dataSessions).catch(report)
  }
  const capture = () => {
    const state = useProjectStore.getState()
    lastSource = { epoch: state.projectEpoch, path: getCurrentProjectPath() }
    observedSessions = featureData.captureActiveSessions()
    observedEditRevision = featureData.getEditState().revision
    return {
      snapshot: createSnapshotFromState(state.project, featureData.readSnapshot()),
      dataSessions: observedSessions,
      sourcePath: getCurrentProjectPath(),
      epoch: state.projectEpoch,
    }
  }
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!hasUnsavedProjectWork()) { pending = null; return }
    try { const draft = capture(); pending = null; write(draft) } catch (error) { report(error) }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }
  const noteWork = () => {
    discardedReplacement = null
    try { pending = capture(); schedule() } catch (error) { report(error) }
  }
  const unsubscribe = useProjectStore.subscribe((state, previous) => {
    try {
      const previousFeatures = observedFeatures, previousSessions = observedSessions, currentFeatures = featureData.readSnapshot()
      observedFeatures = currentFeatures
      if (state.projectEpoch !== previous.projectEpoch) {
        if (previous.dirty || Object.values(previousSessions).some(session => session.pending)) {
          const snapshot = buildPersistedSnapshot(previous.project, previousFeatures)
          if (discardedReplacement?.state.projectEpoch === previous.projectEpoch && discardedReplacement.state.project === previous.project && discardedReplacement.features === previousFeatures) {
            void projectRecovery.clearSaved(snapshot, recoveryOwner(previous.projectEpoch)).catch(report)
          } else write({
            snapshot,
            dataSessions: previousSessions,
            sourcePath: lastSource.epoch === previous.projectEpoch ? lastSource.path : null,
            epoch: previous.projectEpoch,
          })
        }
        discardedReplacement = null
        if (timer) clearTimeout(timer)
        timer = undefined; pending = null
        observedSessions = featureData.captureActiveSessions()
        observedEditRevision = featureData.getEditState().revision
      }
      if (!hasUnsavedProjectWork()) {
        if (timer) clearTimeout(timer)
        timer = undefined; pending = null; return
      }
      if (state.project !== previous.project || currentFeatures !== previousFeatures || state.dirty !== previous.dirty || !previous.dirty) {
        noteWork()
      }
    } catch (error) { report(error) }
  })
  const noteDataChange = () => {
    const features = featureData.readSnapshot(), editRevision = featureData.getEditState().revision
    if (features === observedFeatures && editRevision === observedEditRevision) return
    observedFeatures = features
    if (hasUnsavedProjectWork()) noteWork()
    else {
      observedSessions = featureData.captureActiveSessions()
      observedEditRevision = editRevision
    }
  }
  const unsubscribeData = featureData.subscribe(noteDataChange)
  const unsubscribeEdits = featureData.subscribeEdits(noteDataChange)
  if (hasUnsavedProjectWork()) { try { pending = capture(); schedule() } catch (error) { report(error) } }
  const interval = setInterval(flush, intervalMs)
  const visibility = () => { if (document.visibilityState === 'hidden') flush() }
  document.addEventListener('visibilitychange', visibility)
  return () => {
    stopped = true; unsubscribe(); unsubscribeData(); unsubscribeEdits(); clearInterval(interval)
    document.removeEventListener('visibilitychange', visibility)
    if (timer) clearTimeout(timer)
    if (pending) write(pending)
  }
}
