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
  return <WorkbenchRibbon categories={[
    { id:'scene', label:'场景', commands:commands(['select','initial','quality','lighting','surface','environment','camera','new-group']) },
    { id:'draw', label:'标绘', commands:commands(['point','line','polygon','water']) },
    { id:'edit', label:'编辑', commands:commands(['select','vertices','move','rotate','scale','delete']) },
    { id:'tiles', label:'瓦片', commands:commands(['quality','clip']) },
    { id:'analysis', label:'分析', commands:[] }
  ]} target={category === 'scene' ? undefined : `编辑目标：${target}`} onAdd={() => add?.execute()} preview={preview}
    quickActions={<><Button variant="icon" aria-label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></Button><Button variant="icon" aria-label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></Button><Button variant="icon" aria-label="保存项目" disabled={saving} loading={saving} aria-busy={saving} onClick={onSave}><Save size={16} /></Button></>}
    previewAction={<button className="ribbon-command" aria-pressed={preview} onClick={onPreview}><Play size={14} />{preview ? '退出预览' : '预览'}</button>}
    more={<>{commands(['left','right','reset','new-group']).map(item => <MenuItem key={item.id} icon={item.icon} label={item.label} disabled={!!item.disabled} onClick={item.execute} />)}<MenuItem icon={HelpCircle} label="操作帮助" onClick={helpCommands.openHelp} /><MenuItem icon={HelpCircle} label="关于" onClick={helpCommands.openAbout} /></>} />
}
