import { useState } from 'react'
import { EditorDialog } from '@/ui/components/EditorDialog'
import { Button } from '@/ui/components/Button'
import { projectCommands, type ProjectReplacementAction, type ProjectReplacementDecision } from '@/commands/project.commands'
import { hasUnsavedProjectWork } from '@/project/unsaved-work'
import { UnsavedWorkNotice } from './UnsavedWorkNotice'

export function UnsavedProjectDialog({ action, onResolve }: { action: ProjectReplacementAction; onResolve(decision: ProjectReplacementDecision): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const saved = await projectCommands.saveProjectAndConfirm()
      if (!saved || hasUnsavedProjectWork()) {
        setError(`尚有修改待保存。请重试，或取消${action}后处理数据修改。`)
        return
      }
      onResolve('saved')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <EditorDialog title="保存当前项目？" busy={busy} onClose={() => onResolve(null)}>
    <div className="dialog-body"><UnsavedWorkNotice />{action === '导入' && <p>导入后可以撤销，正式项目文件不会被覆盖。</p>}{error && <p role="alert" className="editor-error">{error}</p>}</div>
    <footer className="dialog-footer">
      <Button disabled={busy} onClick={() => onResolve(null)}>取消</Button>
      <Button danger={action === '打开'} disabled={busy} onClick={() => onResolve('discard')}>{action === '打开' ? '放弃修改并打开' : '直接导入'}</Button>
      <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : `保存并${action}`}</Button>
    </footer>
  </EditorDialog>
}
