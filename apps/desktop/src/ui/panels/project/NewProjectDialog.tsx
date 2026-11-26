import { useState } from 'react'
import { Box, Map } from 'lucide-react'
import { EditorDialog } from '@/ui/components/EditorDialog'
import { Button } from '@/ui/components/Button'
import { projectCommands } from '@/commands/project.commands'
import { useProjectStore } from '@/project/project.store'
import type { ProjectType } from '@/project/project-type'
import { finishStyleInteraction } from '@/project/style-interaction'
import { discardRecoveryOnReplacement } from '@/project/recovery-tracking'
import { hasUnsavedProjectWork } from '@/project/unsaved-work'
import { assertNoWorkspaceDrafts } from '@/stores/workspace-drafts'
import { useFeatureEditState } from '@/project/datasets/feature-data'
import { UnsavedWorkNotice } from './UnsavedWorkNotice'

interface NewProjectDialogProps { onClose(): void }

export function NewProjectDialog({ onClose }: NewProjectDialogProps) {
  const dirty = useProjectStore(state => state.dirty)
  const { unsavedCount } = useFeatureEditState()
  const unsaved = dirty || unsavedCount > 0
  const [type, setType] = useState<ProjectType>('2d')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ownerEpoch] = useState(useProjectStore.getState().projectEpoch)

  async function create(discard = false): Promise<void> {
    setError('')
    setBusy(true)
    try {
      if (ownerEpoch !== useProjectStore.getState().projectEpoch) throw new Error('工程已切换，请重新打开新建窗口')
      assertNoWorkspaceDrafts()
      if (!discard) finishStyleInteraction()
      if (!discard && hasUnsavedProjectWork()) {
        const saved = await projectCommands.saveProjectAndConfirm()
        if (!saved || hasUnsavedProjectWork()) throw new Error('尚有修改待保存。请重试，或取消新建后处理数据修改。')
      }
      if (ownerEpoch !== useProjectStore.getState().projectEpoch) throw new Error('工程已切换，请重新打开新建窗口')
      assertNoWorkspaceDrafts()
      if (discard) discardRecoveryOnReplacement()
      projectCommands.createWorkspace(type, name)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  return <EditorDialog title="新建项目" onClose={onClose} busy={busy} className="new-project-dialog">
    <form onSubmit={event => { event.preventDefault(); void create() }}>
      <div className="dialog-body">
        <p className="dialog-description">选择工作空间类型，开始地图制作或三维场景编辑。</p>
        <fieldset className="project-types"><legend>项目类型</legend>
          <label className={`project-type ${type === '2d' ? 'project-type--selected' : ''}`}><input type="radio" name="project-type" value="2d" checked={type === '2d'} onChange={() => setType('2d')} /><Map size={28} aria-hidden="true" /><strong>二维地图</strong><span>矢量编辑、专题制图与空间分析</span></label>
          <label className={`project-type ${type === '3d' ? 'project-type--selected' : ''}`}><input type="radio" name="project-type" value="3d" checked={type === '3d'} onChange={() => setType('3d')} /><Box size={28} aria-hidden="true" /><strong>三维场景</strong><span>模型、地形、标绘与环境效果</span></label>
        </fieldset>
        <label className="editor-field">项目名称<input value={name} name="project-name" autoComplete="off" maxLength={120} onChange={event => setName(event.target.value)} placeholder={type === '3d' ? '例如：园区三维场景' : '例如：城市用地分析'} /></label>
        <UnsavedWorkNotice />
        {error && <p className="editor-error" role="alert">{error}</p>}
      </div>
      <footer className="dialog-footer"><Button disabled={busy} onClick={onClose}>取消</Button>{unsaved && <Button danger disabled={busy} onClick={() => void create(true)}>放弃修改并创建</Button>}<Button type="submit" variant="primary" disabled={busy}>{busy ? '保存中…' : unsaved ? '保存并创建' : '创建项目'}</Button></footer>
    </form>
  </EditorDialog>
}
