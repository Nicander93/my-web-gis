import { useState, type ReactNode } from 'react'
import { MoreHorizontal, Plus, type LucideIcon } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace.store'

export interface RibbonCommand { id: string; label: string; icon: LucideIcon; execute(): void; disabled?: string; active?: boolean }
export interface RibbonCategory { id: string; label: string; commands: RibbonCommand[] }
interface WorkbenchRibbonProps {
  categories: RibbonCategory[]
  target?: string
  onAdd(): void
  quickActions: ReactNode
  extraTools?: ReactNode
  more?: ReactNode
  preview?: boolean
  previewAction?: ReactNode
}

/** 引擎提供真实命令，共用两行功能区和应用菜单外壳。 */
export function WorkbenchRibbon({ categories, target, onAdd, quickActions, extraTools, more, preview = false, previewAction }: WorkbenchRibbonProps) {
  const category = useWorkspaceStore(state => state.ribbonCategory)
  const active = categories.find(item => item.id === category) ?? categories[0]
  const [moreOpen, setMoreOpen] = useState(false)
  return <section className="workbench-ribbon" aria-label="三维功能区">
    <div className="workbench-ribbon-top">
      <nav role="tablist" aria-label="三维工作任务" onKeyDown={event => {
        if (event.target !== event.currentTarget && (event.target as HTMLElement).getAttribute('role') !== 'tab') return
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const index = categories.findIndex(item => item.id === active?.id)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length
        event.preventDefault()
        useWorkspaceStore.getState().setRibbonCategory(categories[next].id)
        event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
      }}>
        {categories.map(item => <button key={item.id} id={`scene-tab-${item.id}`} role="tab" tabIndex={item.id === active?.id ? 0 : -1} aria-selected={active?.id === item.id} aria-controls="scene-ribbon-tools" onClick={() => useWorkspaceStore.getState().setRibbonCategory(item.id)}>{item.label}</button>)}
      </nav>
      {target && <span className="workbench-context" title={target}>{target}</span>}
      <div className="workbench-quick">{quickActions}{previewAction}</div>
    </div>
    {!preview && active && <div id="scene-ribbon-tools" role="tabpanel" aria-labelledby={`scene-tab-${active.id}`} className="workbench-ribbon-commands">
      <button className="ribbon-command" onClick={onAdd}><Plus size={16} />添加数据</button>
      {active.commands.map(command => <button key={command.id} className="ribbon-command" title={command.disabled ?? command.label} disabled={!!command.disabled} aria-pressed={command.active} onClick={command.execute}><command.icon size={16} /><span>{command.label}</span></button>)}
      {!active.commands.length && <span className="ribbon-unavailable">三维测量与分析尚未接入</span>}
      {extraTools}
      {more && <details className="ribbon-more" open={moreOpen} onToggle={event => setMoreOpen(event.currentTarget.open)}>
        <summary aria-label="更多操作"><MoreHorizontal size={16} /></summary><div className="menu-dropdown" onClick={() => setMoreOpen(false)}>{more}</div>
      </details>}
    </div>}
  </section>
}
