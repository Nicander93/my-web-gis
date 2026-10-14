import { useState } from 'react'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { Button } from '@/components/ui/Button'
import { projectCommands } from '@/app/commands/project.commands'
import { useProjectStore } from '@/stores/project.store'

export function UnsavedProjectDialog({ onResolve }: { onResolve(continueOpening: boolean): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(): Promise<void> {
    setBusy(true); const saved = await projectCommands.saveProjectAndConfirm(); setBusy(false)
    if (!saved || useProjectStore.getState().dirty) { setError('项目尚未保存。请重试保存，或取消打开操作。'); return }
    onResolve(true)
  }
  return <EditorDialog title="保存当前项目？" busy={busy} onClose={() => onResolve(false)}>
    <div className="dialog-body"><p>当前项目有未保存的修改。打开其他项目前，请先保存或明确放弃修改。</p>{error && <p role="alert" className="editor-error">{error}</p>}</div>
    <footer className="dialog-footer"><Button disabled={busy} onClick={() => onResolve(false)}>取消</Button><Button disabled={busy} onClick={() => onResolve(true)}>放弃修改并打开</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存并打开'}</Button></footer>
  </EditorDialog>
}
