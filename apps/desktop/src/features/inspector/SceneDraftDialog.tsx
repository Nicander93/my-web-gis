import { useEffect, useRef, useState } from 'react'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { useSessionStore } from '@/stores/session.store'
import { useProjectStore } from '@/stores/project.store'
import { layerCommands } from '@/app/commands/layer.commands'
import { registerSceneDraftGuard } from './scene-draft-guard'

/** Decide pending drafts before scene import; cancellation preserves all drafts. */
export function SceneDraftDialog() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<((allow: boolean) => void) | null>(null)
  const sessions = useSessionStore(state => state.sessions)
  const layers = useProjectStore(state => state.project.layers)
  const dirty = Object.entries(sessions).filter(([, session]) => session.styleDraft?.dirty)
  function close(allow = false): void {
    pending.current?.(allow); pending.current = null; setOpen(false)
  }
  useEffect(() => {
    registerSceneDraftGuard(() => new Promise(resolve => {
      pending.current?.(false)
      pending.current = resolve; setError(''); setOpen(true)
    }))
    return () => { registerSceneDraftGuard(null); pending.current?.(false) }
  }, [])
  function decide(apply: boolean): void {
    if (dirty.some(([id]) => !layers.some(layer => layer.id === id))) { setError('草稿所属图层已改变，请取消后检查图层'); return }
    for (const [id, session] of dirty) {
      if (apply && !layerCommands.applyStyle(id, session.styleDraft!.style)) { setError('样式未能应用，请检查草稿'); return }
      if (!apply) layerCommands.resetStyleDraft(id)
    }
    close(true)
  }
  if (!open) return null
  return <EditorDialog title="处理未应用样式" onClose={() => close()}>
    <div className="dialog-body">
      <p>{dirty.length} 个图层有未应用的样式或标注修改。</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <footer className="dialog-footer">
      <button className="button-secondary" onClick={() => close()}>取消导入</button>
      <button className="button-secondary" onClick={() => decide(false)}>放弃草稿并继续</button>
      <button className="button-primary" onClick={() => decide(true)}>应用草稿并继续</button>
    </footer>
  </EditorDialog>
}
