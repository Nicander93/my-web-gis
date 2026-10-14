import { buildPersistedSnapshot, type ProjectSnapshot } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { emitCommandStatus } from '@/app/commands/status'
import { createSnapshotFromState, getCurrentProjectPath } from './project-io'
import { projectRecovery, recoveryOwner } from './project-recovery'

interface PendingDraft { snapshot: ProjectSnapshot; sourcePath: string | null; epoch: number }
let discardedReplacement: ReturnType<typeof useProjectStore.getState> | null = null

/** Mark only an explicit discard; cancelling a file picker still retains the current draft. */
export function discardRecoveryOnReplacement(): void { discardedReplacement = useProjectStore.getState() }

/** Save applied document edits, never layout, credentials or uncommitted form previews. */
export function startRecoveryTracking(delayMs = 5_000, intervalMs = 120_000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: PendingDraft | null = null
  let stopped = false
  let lastSource = { epoch: useProjectStore.getState().projectEpoch, path: getCurrentProjectPath() }
  const report = (error: unknown) => {
    if (!stopped) emitCommandStatus(`恢复草稿写入失败，正式项目未改变：${error instanceof Error ? error.message : String(error)}`)
  }
  const write = (draft: PendingDraft) => {
    void projectRecovery.write(draft.snapshot, draft.sourcePath, recoveryOwner(draft.epoch)).catch(report)
  }
  const capture = () => {
    const state = useProjectStore.getState()
    lastSource = { epoch: state.projectEpoch, path: getCurrentProjectPath() }
    return { snapshot: createSnapshotFromState(state.project, state.featuresByDataset), sourcePath: getCurrentProjectPath(), epoch: state.projectEpoch }
  }
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!useProjectStore.getState().dirty) { pending = null; return }
    try { const draft = capture(); pending = null; write(draft) } catch (error) { report(error) }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }
  const unsubscribe = useProjectStore.subscribe((state, previous) => {
    try {
      if (state.projectEpoch !== previous.projectEpoch) {
        if (previous.dirty) {
          const snapshot = buildPersistedSnapshot(previous.project, previous.featuresByDataset)
          if (discardedReplacement?.projectEpoch === previous.projectEpoch && discardedReplacement.project === previous.project && discardedReplacement.featuresByDataset === previous.featuresByDataset) {
            void projectRecovery.clearSaved(snapshot, recoveryOwner(previous.projectEpoch)).catch(report)
          } else write({ snapshot, sourcePath: lastSource.epoch === previous.projectEpoch ? lastSource.path : null, epoch: previous.projectEpoch })
        }
        discardedReplacement = null
        if (timer) clearTimeout(timer)
        timer = undefined; pending = null
      }
      if (!state.dirty) {
        if (timer) clearTimeout(timer)
        timer = undefined; pending = null; return
      }
      if (state.project !== previous.project || state.featuresByDataset !== previous.featuresByDataset || !previous.dirty) {
        discardedReplacement = null
        pending = capture(); schedule()
      }
    } catch (error) { report(error) }
  })
  if (useProjectStore.getState().dirty) { try { pending = capture(); schedule() } catch (error) { report(error) } }
  const interval = setInterval(flush, intervalMs)
  const visibility = () => { if (document.visibilityState === 'hidden') flush() }
  document.addEventListener('visibilitychange', visibility)
  return () => {
    stopped = true; unsubscribe(); clearInterval(interval)
    document.removeEventListener('visibilitychange', visibility)
    if (timer) clearTimeout(timer)
    // A pending draft is already detached. Unmount does not wait on asynchronous IO.
    if (pending) write(pending)
  }
}
