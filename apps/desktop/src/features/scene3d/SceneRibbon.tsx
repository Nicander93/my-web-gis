import { HelpCircle, Play, Redo2, Save, Undo2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { WorkbenchRibbon } from '@/app/header/WorkbenchRibbon'
import { MenuItem } from '@/app/header/menus/MenuItem'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { helpCommands } from '@/app/commands/help.commands'
import { Button } from '@/components/ui/Button'
import { useSaveStore } from '@/stores/save.store'

export interface SceneRibbonCommand { id: string; label: string; icon: LucideIcon; disabled?: string; active?: boolean; execute(): void }
interface SceneRibbonProps {
  commands: SceneRibbonCommand[]
  target: string
  preview: boolean
  onPreview(): void
  onUndo(): void
  onRedo(): void
  onSave(): void
  canUndo: boolean
  canRedo: boolean
}

/** Scene capabilities stay independent while desktop chrome is shared. */
export function SceneRibbon({ commands: all, target, preview, onPreview, onUndo, onRedo, onSave, canUndo, canRedo }: SceneRibbonProps) {
  const saving = useSaveStore((state) => state.pending > 0)
  function commands(ids: string[]): SceneRibbonCommand[] { return ids.flatMap(id => all.filter(item => item.id === id)) }
  const category = useWorkspaceStore(state => state.ribbonCategory)
  const add = all.find(item => item.id === 'add')
  const groups = (values: Array<[string, string[]]>) => values.map(([label, ids]) => ({ label, commands: commands(ids) }))
  const categories = [
    { id: 'scene', label: '场景', groups: groups([['浏览', ['select', 'initial', 'camera']], ['场景表现', ['quality', 'lighting', 'surface', 'environment']], ['组织', ['new-group']]]) },
    { id: 'draw', label: '标绘', groups: groups([['符号', ['point', 'billboard']], ['几何', ['line', 'polygon', 'rectangle', 'ellipse']], ['效果', ['water']]]) },
    { id: 'edit', label: '编辑', groups: groups([['对象', ['select', 'vertices']], ['变换', ['move', 'rotate', 'scale']], ['管理', ['delete']]]) },
    { id: 'tiles', label: '瓦片', groups: groups([['精度', ['quality']], ['区域处理', ['clip', 'flatten']]]) },
    { id: 'analysis', label: '分析', groups: groups([['距离', ['measure-space', 'measure-ground']], ['面积与高差', ['measure-area', 'measure-height']]]) }
  ].map(item => ({ ...item, commands: item.groups.flatMap(group => group.commands) }))
  return <WorkbenchRibbon categories={categories} target={category === 'scene' ? undefined : `编辑目标：${target}`} onAdd={() => add?.execute()} preview={preview}
    quickActions={<><Button variant="icon" aria-label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></Button><Button variant="icon" aria-label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></Button><Button variant="icon" aria-label="保存项目" disabled={saving} loading={saving} aria-busy={saving} onClick={onSave}><Save size={16} /></Button></>}
    previewAction={<Button variant="ghost" className="ribbon-command" aria-pressed={preview} onClick={onPreview}><Play size={14} />{preview ? '退出预览' : '预览'}</Button>}
    more={<>{commands(['left','right','reset','new-group']).map(item => <MenuItem key={item.id} icon={item.icon} label={item.label} disabled={!!item.disabled} onClick={item.execute} />)}<MenuItem icon={HelpCircle} label="操作帮助" onClick={helpCommands.openHelp} /><MenuItem icon={HelpCircle} label="关于" onClick={helpCommands.openAbout} /></>} />
}
