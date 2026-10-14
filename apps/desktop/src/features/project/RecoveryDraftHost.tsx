import { useEffect, useState } from 'react'
import { Alert } from 'antd'
import { isTauri } from '@tauri-apps/api/core'
import { parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/gis-core'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { Button } from '@/components/ui/Button'
import { useProjectStore, getProjectContentVersion } from '@/stores/project.store'
import { projectRecovery, recoveryOwner, type RecoveryCandidate } from '@/services/project-recovery'
import { startRecoveryTracking } from '@/services/recovery-tracking'
import { readTextFile } from '@/services/files'
import { setCurrentProjectPath } from '@/services/project-io'
import { collectCredentialRefKeys, hydrateCredentialsFromRefs } from '@/services/credentials'
import { emitCommandStatus } from '@/app/commands/status'

interface Candidate extends RecoveryCandidate { comparison?: string }

export function RecoveryDraftHost() {
  const [entries, setEntries] = useState<Candidate[]>([])
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [check, setCheck] = useState(0)
  useEffect(() => {
    let alive = true
    let stop: (() => void) | undefined
    void (async () => {
      try {
        const candidates: Candidate[] = []
        for (const entry of await projectRecovery.list()) {
          if (isTauri() && entry.draft?.sourcePath) {
            try {
              const formal = parseProjectSnapshot(await readTextFile(entry.draft.sourcePath))
              if (serializeProjectSnapshot(formal) === serializeProjectSnapshot(entry.draft.snapshot)) {
                if (await projectRecovery.discard(entry)) continue
              }
              candidates.push({ ...entry, comparison: '正式文件与草稿内容不同。恢复为未保存副本，保存时重新选择位置。' })
            } catch { candidates.push({ ...entry, comparison: '正式文件暂不可读取。草稿可独立恢复为未保存副本。' }) }
          } else candidates.push(entry)
        }
        if (alive) setEntries(candidates)
      } catch (reason) {
        const message = `恢复缓存检查失败：${reason instanceof Error ? reason.message : String(reason)}`
        emitCommandStatus(message); if (alive) setError(message)
      }
      finally { if (alive) stop = startRecoveryTracking() }
    })()
    return () => { alive = false; stop?.() }
  }, [check])

  async function discard(entry: Candidate): Promise<void> {
    setBusy(true); setError('')
    try {
      if (!await projectRecovery.discard(entry)) throw new Error('草稿已改变，请重启后检查最新草稿；未删除新内容')
      setEntries((current) => current.filter((item) => item.key !== entry.key))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  async function restore(entry: Candidate): Promise<void> {
    if (!entry.draft) return
    setBusy(true); setError('')
    const epoch = useProjectStore.getState().projectEpoch, version = getProjectContentVersion()
    try {
      if (useProjectStore.getState().dirty) throw new Error('当前项目已有修改，请先保存，再重启处理恢复草稿')
      await projectRecovery.write(entry.draft.snapshot, entry.draft.sourcePath, recoveryOwner(epoch + 1), entry)
      if (epoch !== useProjectStore.getState().projectEpoch || version !== getProjectContentVersion() || useProjectStore.getState().dirty) throw new Error('恢复期间工程已改变，当前内容已保留；草稿仍在缓存中')
      useProjectStore.getState().loadSnapshot(entry.draft.snapshot)
      setCurrentProjectPath(null)
      useProjectStore.getState().setDirty(true)
      setHidden(true)
      void hydrateCredentialsFromRefs(collectCredentialRefKeys(entry.draft.snapshot.project.datasets.filter((dataset) => dataset.kind !== 'vector')))
        .catch(() => emitCommandStatus('草稿已恢复；部分服务凭据尚未加载，请重新连接服务'))
      emitCommandStatus('已恢复未保存副本，请保存项目；正式文件未覆盖')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  if (hidden || (!entries.length && !error)) return null
  return <EditorDialog title="发现恢复草稿" busy={busy} onClose={() => setHidden(true)}>
    <div className="dialog-body recovery-drafts">
      <p>以下草稿保存在本机独立缓存。恢复后仍需保存项目；舍弃只删除所选草稿。</p>
      {entries.map((entry) => <section key={entry.key} className="recovery-draft" aria-label={entry.draft?.snapshot.project.name ?? '无法读取的恢复草稿'}>
        <strong>{entry.draft?.snapshot.project.name ?? '无法读取的恢复草稿'}</strong>
        {entry.draft && <p>{entry.draft.snapshot.project.city ? '三维场景' : '二维地图'} · {new Date(entry.draft.updatedAt).toLocaleString('zh-CN')}
          {entry.draft.sourcePath && <><br /><span>{entry.draft.sourcePath}</span></>}</p>}
        {entry.comparison && <p>{entry.comparison}</p>}
        {entry.error && <Alert type="warning" title={entry.error} />}
        <div className="recovery-draft-actions"><Button disabled={busy} onClick={() => void discard(entry)}>舍弃草稿</Button>
          <Button variant="primary" disabled={busy || !entry.draft} onClick={() => void restore(entry)}>恢复草稿</Button></div>
      </section>)}
      {error && <Alert type="error" title={error} />}
    </div>
    <footer className="dialog-footer">{error && <Button disabled={busy} onClick={() => { setError(''); setCheck((value) => value + 1) }}>重新检查</Button>}<Button disabled={busy} onClick={() => setHidden(true)}>暂不处理</Button></footer>
  </EditorDialog>
}
