import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Dropdown } from 'antd'
import { ToolbarButton } from './ToolbarButton'
import { MoreHorizontal, Plus, type LucideIcon } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace.store'

export interface RibbonCommand { id: string; label: string; icon: LucideIcon; execute(): void; disabled?: string; active?: boolean }
export interface RibbonCategory { id: string; label: string; commands: RibbonCommand[]; groups?: Array<{ label: string; commands: RibbonCommand[] }> }
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
  const tools = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const element = tools.current
    if (!element) return
    const update = () => setOverflow(element.scrollWidth > element.clientWidth + 1)
    const observer = new ResizeObserver(update)
    observer.observe(element); update()
    return () => observer.disconnect()
  }, [active?.id, preview])
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
        {categories.map(item => <Button type="text" key={item.id} id={`scene-tab-${item.id}`} role="tab" tabIndex={item.id === active?.id ? 0 : -1} aria-selected={active?.id === item.id} aria-controls="scene-ribbon-tools" onClick={() => useWorkspaceStore.getState().setRibbonCategory(item.id)}>{item.label}</Button>)}
      </nav>
      {target && <span className="workbench-context" title={target}>{target}</span>}
      <div className="workbench-quick">{quickActions}{previewAction}</div>
    </div>
    {!preview && active && <div id="scene-ribbon-tools" role="tabpanel" aria-labelledby={`scene-tab-${active.id}`} className="workbench-ribbon-commands">
      <div ref={tools} className="ribbon-tool-groups">
      {active.id === 'scene' && <div className="workbench-ribbon-group" role="group" aria-label="数据"><ToolbarButton icon={Plus} label="添加数据" onClick={onAdd} /></div>}
      {(active.groups ?? [{ label: active.label, commands: active.commands }]).map(group => <div className="workbench-ribbon-group" key={group.label} role="group" aria-label={group.label}>
        {group.commands.map(command => <ToolbarButton key={command.id} icon={command.icon} label={command.label} disabled={!!command.disabled} disabledReason={command.disabled} active={command.active} onClick={command.execute} />)}
      </div>)}
      </div>
      {overflow && <Dropdown trigger={['click']} menu={{ items: active.commands.map(command => ({ key: command.id, label: command.disabled ? `${command.label} · ${command.disabled}` : command.label, disabled: !!command.disabled, onClick: command.execute })) }}><Button type="text" aria-label="更多工具" icon={<MoreHorizontal size={16} />}>更多</Button></Dropdown>}
      {!active.commands.length && <span className="ribbon-unavailable">三维测量与分析尚未接入</span>}
      {extraTools}
      {more && <details className="ribbon-more" open={moreOpen} onToggle={event => setMoreOpen(event.currentTarget.open)}>
        <summary aria-label="更多操作"><MoreHorizontal size={16} /></summary><div className="menu-dropdown" onClick={() => setMoreOpen(false)}>{more}</div>
      </details>}
    </div>}
  </section>
}
