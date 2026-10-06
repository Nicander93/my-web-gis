import { Play, Redo2, Save, Undo2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { WorkbenchRibbon } from '@/app/header/WorkbenchRibbon'
import { MenuItem } from '@/app/header/menus/MenuItem'
import { useWorkspaceStore } from '@/stores/workspace.store'

export interface CityRibbonCommand { id: string; label: string; icon: LucideIcon; disabled?: string; active?: boolean; execute(): void }
interface CityRibbonProps {
  commands: CityRibbonCommand[]
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
export function CityRibbon({ commands: all, target, preview, onPreview, onUndo, onRedo, onSave, canUndo, canRedo }: CityRibbonProps) {
  function commands(ids: string[]): CityRibbonCommand[] { return ids.flatMap(id => all.filter(item => item.id === id)) }
  const category = useWorkspaceStore(state => state.ribbonCategory)
  const add = all.find(item => item.id === 'add')
  return <WorkbenchRibbon categories={[
    { id:'edit', label:'编辑', commands:commands(['select','point','line','polygon','vertices','move','rotate','scale','delete']) },
    { id:'scene', label:'场景', commands:commands(['initial','lighting','surface','environment','camera','water']) }
  ]} target={category === 'scene' ? undefined : `编辑目标：${target}`} onAdd={() => add?.execute()} preview={preview}
    quickActions={<><button aria-label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button><button aria-label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></button><button aria-label="保存项目" onClick={onSave}><Save size={16} /></button></>}
    previewAction={<button className="ribbon-command" aria-pressed={preview} onClick={onPreview}><Play size={14} />{preview ? '退出预览' : '预览'}</button>}
    more={<>{commands(['left','right','reset','new-group']).map(item => <MenuItem key={item.id} icon={item.icon} label={item.label} disabled={!!item.disabled} onClick={item.execute} />)}</>} />
}
