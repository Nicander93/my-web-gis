import { useState } from 'react'
import { EditorDialog } from '@/components/ui/EditorDialog'

export function CityCreateGroupDialog({ count, locked, onClose, onCreate }: { count: number; locked: boolean; onClose(): void; onCreate(name: string, includeSelection: boolean): void }) {
  const [name, setName] = useState('新建分组'), [includeSelection, setIncludeSelection] = useState(count > 0 && !locked), [error, setError] = useState('')
  return <EditorDialog title="新建场景分组" onClose={onClose}><form onSubmit={event => { event.preventDefault(); try { onCreate(name, includeSelection); onClose() } catch (reason) { setError(reason instanceof Error ? reason.message : '创建失败') } }}><div className="dialog-body"><label className="editor-field">分组名称<input autoFocus required value={name} onChange={event => setName(event.target.value)} /></label>{count > 0 && <label className="city-check"><input type="checkbox" checked={includeSelection} disabled={locked} onChange={event => setIncludeSelection(event.target.checked)} />将选中的 {count} 个对象移入分组</label>}{locked && <p className="editor-help">选中对象含锁定项，本次可创建空分组；移动前请先解锁。</p>}{error && <p className="editor-error" role="alert">{error}</p>}</div><footer className="dialog-footer"><button type="button" className="button-secondary" onClick={onClose}>取消</button><button className="button-primary" disabled={!name.trim()}>创建分组</button></footer></form></EditorDialog>
}
