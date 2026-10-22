import { useEffect, useRef, useState } from 'react'
import { Button, App } from 'antd'
import { Minus, Square, Copy, X } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { Button as DialogButton } from '@/components/ui/Button'
import { useProjectStore, getProjectContentVersion } from '@/stores/project.store'
import { hasPendingPropertyEdits } from '@/services/pending-property-edits'
import { projectCommands } from '@/app/commands/project.commands'
import { resolveSceneDrafts } from '@/features/inspector/scene-draft-guard'
import { finishStyleInteraction } from '@/features/inspector/style-interaction'
import { createSnapshotFromState } from '@/services/project-io'
import { projectRecovery, recoveryOwner } from '@/services/project-recovery'
import { allowWindowClose, createCloseSession, subscribeMaximized, type UnsavedCloseChoice } from './native-window'

/** Native window actions share the application title bar with its menus. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const [unsavedOpen, setUnsavedOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingChoice = useRef<((choice: UnsavedCloseChoice) => void) | null>(null)
  const { message } = App.useApp()

  useEffect(() => {
    const appWindow = getCurrentWindow()
    return subscribeMaximized(
      appWindow,
      setMaximized,
      (error) => { void message.error(`窗口状态同步失败：${String(error)}`) }
    )
  }, [message])

  useEffect(() => {
    const appWindow = getCurrentWindow()
    let disposed = false
    let destroying = false
    const session = createCloseSession(() => allowWindowClose({
      projectEpoch: () => useProjectStore.getState().projectEpoch,
      contentVersion: getProjectContentVersion,
      hasDirtyDrafts: hasPendingPropertyEdits,
      resolveDrafts: async () => {
        if (hasPendingPropertyEdits()) throw new Error('请先应用或取消完整属性窗口中的编辑，再关闭项目。')
        return resolveSceneDrafts()
      },
      isProjectDirty: () => useProjectStore.getState().dirty,
      confirmUnsaved: () => new Promise(resolve => {
        pendingChoice.current?.('cancel')
        pendingChoice.current = resolve
        setError('')
        setUnsavedOpen(true)
      }),
      saveProject: () => projectCommands.saveProjectAndConfirm(),
      discardRecovery: async () => {
        const state = useProjectStore.getState()
        await projectRecovery.clearSaved(createSnapshotFromState(state.project, state.featuresByDataset), recoveryOwner(state.projectEpoch))
      }
    }))
    const listener = appWindow.onCloseRequested(async (event) => {
      event.preventDefault()
      finishStyleInteraction()
      if (disposed) return
      try {
        if (await session.request() && !disposed && !destroying) {
          destroying = true
          try { await appWindow.destroy() }
          catch (error) { destroying = false; throw error }
        }
      } catch (error: unknown) {
        if (!disposed) void message.error(`关闭窗口失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (!disposed) {
          pendingChoice.current = null
          setUnsavedOpen(false)
          setBusy(false)
        }
      }
    })
    void listener.catch((error: unknown) => { if (!disposed) void message.error(`窗口关闭保护未能启动：${String(error)}`) })
    return () => {
      disposed = true
      pendingChoice.current?.('cancel')
      pendingChoice.current = null
      void listener.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [message])

  function execute(action: () => Promise<void>) {
    void action().catch((error: unknown) => message.error(`窗口操作失败：${String(error)}`))
  }

  function choose(choice: UnsavedCloseChoice) {
    const resolve = pendingChoice.current
    pendingChoice.current = null
    setUnsavedOpen(false)
    resolve?.(choice)
  }

  async function saveAndClose(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const saved = await projectCommands.saveProjectAndConfirm()
      if (!saved || useProjectStore.getState().dirty) {
        setError('项目尚未保存。请重试保存，或取消关闭。')
        return
      }
      choose('save')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="window-controls" aria-label="窗口控制">
      <Button type="text" aria-label="最小化窗口" icon={<Minus size={14} />} onClick={() => execute(() => getCurrentWindow().minimize())} />
      <Button type="text" aria-label={maximized ? '还原窗口' : '最大化窗口'} icon={maximized ? <Copy size={13} /> : <Square size={13} />} onClick={() => execute(() => getCurrentWindow().toggleMaximize())} />
      <Button type="text" className="window-close" aria-label="关闭窗口" icon={<X size={16} />} onClick={() => execute(() => getCurrentWindow().close())} />
      {unsavedOpen && <EditorDialog title="项目尚未保存" busy={busy} onClose={() => choose('cancel')}>
        <div className="dialog-body">
          <p>关闭窗口前请保存或明确放弃更改。</p>
          {error && <p role="alert" className="editor-error">{error}</p>}
        </div>
        <footer className="dialog-footer">
          <DialogButton disabled={busy} onClick={() => choose('cancel')}>取消</DialogButton>
          <DialogButton disabled={busy} onClick={() => choose('discard')}>放弃更改并关闭</DialogButton>
          <DialogButton variant="primary" disabled={busy} onClick={() => void saveAndClose()}>{busy ? '保存中…' : '保存并关闭'}</DialogButton>
        </footer>
      </EditorDialog>}
    </div>
  )
}
