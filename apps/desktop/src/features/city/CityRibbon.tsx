import { ChevronDown, ChevronUp, Play, Redo2, Save, Undo2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCityLayoutStore } from './city-layout.store'
import type { CityCategory } from './city-layout.store'

export interface CityRibbonCommand { id: string; label: string; icon: LucideIcon; disabled?: string; active?: boolean; execute(): void }
export interface CityRibbonGroup { label: string; commands: CityRibbonCommand[] }
interface CityRibbonProps {
  groups: Record<CityCategory, CityRibbonGroup[]>
  preview: boolean
  onPreview(): void
  onUndo(): void
  onRedo(): void
  onSave(): void
  canUndo: boolean
  canRedo: boolean
}
const categories: Array<[CityCategory,string]> = [['scene','场景配置'],['data','数据'],['edit','编辑'],['effects','特效'],['view','视图']]

/** Visible command groups keep discovery predictable as editor capabilities grow. */
export function CityRibbon({ groups, preview, onPreview, onUndo, onRedo, onSave, canUndo, canRedo }: CityRibbonProps) {
  const { category, expanded, setCategory, toggleExpanded } = useCityLayoutStore()
  const activeGroups = groups[category] ?? groups.data
  return <section className="city-ribbon" aria-label="三维功能区">
    <nav className="city-ribbon__tabs" aria-label="三维功能分类" role="tablist" onKeyDown={event => {
      const button = event.target as HTMLElement
      if (button.getAttribute('role') !== 'tab' || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
      const index = categories.findIndex(([id]) => id === category), next = event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length
      event.preventDefault(); setCategory(categories[next][0]); document.getElementById(`city-tab-${categories[next][0]}`)?.focus()
    }}>
      {!preview && categories.map(([id,label]) => <button key={id} id={`city-tab-${id}`} type="button" role="tab" aria-selected={id === category} aria-controls="city-ribbon-commands" onClick={() => setCategory(id)}>{label}</button>)}
      <div className="city-ribbon__quick">
        {!preview && <><button aria-label="撤销" title="撤销 · Ctrl+Z" disabled={!canUndo} onClick={onUndo}><Undo2 size={15} /></button><button aria-label="重做" title="重做 · Ctrl+Shift+Z" disabled={!canRedo} onClick={onRedo}><Redo2 size={15} /></button><button aria-label="保存项目" title="保存项目 · Ctrl+S" onClick={onSave}><Save size={15} /></button><span className="toolbar-separator" /><button aria-label={expanded ? '收起功能区' : '展开功能区'} aria-expanded={expanded} onClick={toggleExpanded}>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></>}
        <button className="city-ribbon__preview" aria-pressed={preview} onClick={onPreview}><Play size={14} aria-hidden="true" />{preview ? '退出预览' : '预览'}</button>
      </div>
    </nav>
    {!preview && expanded && <div className="city-ribbon__commands" id="city-ribbon-commands" role="tabpanel" aria-labelledby={`city-tab-${category}`}>
      {activeGroups.map(group => <section className="city-ribbon__group" key={group.label} aria-label={group.label}><div className="city-ribbon__items">{group.commands.map(command => <button key={command.id} type="button" className="city-ribbon__command" disabled={Boolean(command.disabled)} title={command.disabled ?? command.label} aria-pressed={command.active ?? false} onClick={command.execute}><command.icon size={18} aria-hidden="true" /><span>{command.label}</span></button>)}</div><span className="city-ribbon__group-label">{group.label}</span></section>)}
    </div>}
  </section>
}
