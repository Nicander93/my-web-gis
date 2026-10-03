import { useState } from 'react'
import { Box, Map } from 'lucide-react'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { projectCommands } from '@/app/commands/project.commands'
import { useProjectStore } from '@/stores/project.store'
import type { ProjectType } from '@/services/project-type'

interface NewProjectDialogProps { onClose(): void }

export function NewProjectDialog({ onClose }: NewProjectDialogProps) {
  const dirty = useProjectStore(state => state.dirty)
  const [type, setType] = useState<ProjectType>('2d')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(save: boolean): Promise<void> {
    setError('')
    if (save) {
      setBusy(true)
      await projectCommands.saveProject()
      setBusy(false)
      if (useProjectStore.getState().dirty) { setError('当前项目尚未保存，已保留修改。可以重试保存或取消新建。'); return }
    }
    projectCommands.createWorkspace(type, name)
    onClose()
  }

  return <EditorDialog title="新建项目" onClose={onClose} busy={busy} className="new-project-dialog">
    <form onSubmit={event => { event.preventDefault(); void create(dirty) }}>
      <div className="dialog-body">
        <p className="dialog-description">选择工作空间类型，开始地图制作或三维场景编辑。</p>
        <fieldset className="project-types"><legend>项目类型</legend>
          <label className={`project-type ${type === '2d' ? 'project-type--selected' : ''}`}><input type="radio" name="project-type" value="2d" checked={type === '2d'} onChange={() => setType('2d')} /><Map size={28} aria-hidden="true" /><strong>二维地图</strong><span>矢量编辑、专题制图与空间分析</span></label>
          <label className={`project-type ${type === '3d' ? 'project-type--selected' : ''}`}><input type="radio" name="project-type" value="3d" checked={type === '3d'} onChange={() => setType('3d')} /><Box size={28} aria-hidden="true" /><strong>三维场景</strong><span>城市模型、对象布局与环境效果</span></label>
        </fieldset>
        <label className="editor-field">项目名称<input value={name} name="project-name" autoComplete="off" maxLength={120} onChange={event => setName(event.target.value)} placeholder={type === '3d' ? '例如：中心城区场景' : '例如：城市用地分析'} /></label>
        {dirty && <p className="editor-warning">当前项目有未保存的修改。创建新项目前，请保存或明确放弃这些修改。</p>}
        {error && <p className="editor-error" role="alert">{error}</p>}
      </div>
      <footer className="dialog-footer"><button type="button" className="button-secondary" disabled={busy} onClick={onClose}>取消</button>{dirty && <button type="button" className="button-secondary" disabled={busy} onClick={() => void create(false)}>放弃修改并创建</button>}<button type="submit" className="button-primary" disabled={busy}>{busy ? '保存中…' : dirty ? '保存并创建' : '创建项目'}</button></footer>
    </form>
  </EditorDialog>
}
