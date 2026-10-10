import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, FolderOpen, MoreHorizontal, Plus, type LucideIcon } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { getProjectType } from '@/services/project-type'
import { ProjectMenu } from './menus/ProjectMenu'

export interface RibbonCommand {
  id: string
  label: string
  icon: LucideIcon
  execute(): void
  disabled?: string
  active?: boolean
}

export interface RibbonCategory {
  id: string
  label: string
  commands: RibbonCommand[]
}

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

/** Shared desktop chrome; engines supply commands without sharing rendering state. */
export function WorkbenchRibbon({ categories, target, onAdd, quickActions, extraTools, more, preview = false, previewAction }: WorkbenchRibbonProps) {
  const project = useProjectStore(state => state.project)
  const dirty = useProjectStore(state => state.dirty)
  const category = useWorkspaceStore(state => state.ribbonCategory)
  const expanded = useWorkspaceStore(state => state.ribbonExpanded)
  const active = categories.find(item => item.id === category) ?? categories[0]
  const [menu, setMenu] = useState<'project' | 'more' | null>(null)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!menu) return
    function pointer(event: MouseEvent): void { if (!ref.current?.contains(event.target as Node)) setMenu(null) }
    function key(event: KeyboardEvent): void { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', pointer)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', pointer); document.removeEventListener('keydown', key) }
  }, [menu])
  useEffect(() => { setMenu(null) }, [project.id, preview])
  const type = getProjectType(project)
  return <header ref={ref} className="app-header workbench-ribbon">
    <div className="workbench-ribbon__top">
      <div className="menu-item-wrapper">
        <button className="workbench-project" title={project.name} aria-haspopup="true" aria-expanded={menu === 'project'} onClick={() => setMenu(menu === 'project' ? null : 'project')}><FolderOpen size={16} /><span>{project.name === 'Untitled Project' ? '未命名二维地图' : project.name}</span><ChevronDown size={13} /></button>
        {menu === 'project' && <div className="menu-dropdown"><ProjectMenu onClose={() => setMenu(null)} /></div>}
      </div>
      <span className="project-kind">{type === '3d' ? '三维场景' : '二维地图'}</span>
      {dirty && <span className="project-dirty" role="status">未保存</span>}
      {!preview && <>
        <button className="ribbon-command" onClick={onAdd}><Plus size={16} />添加数据</button>
        <nav className="workbench-ribbon__tabs" aria-label="操作分类" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          const index = categories.findIndex(item => item.id === active?.id)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length
          event.preventDefault()
          useWorkspaceStore.getState().setRibbonCategory(categories[next].id)
          event.currentTarget.querySelectorAll('button')[next]?.focus()
        }}>
          {categories.map(item => <button key={item.id} aria-pressed={active?.id === item.id} onClick={() => useWorkspaceStore.getState().setRibbonCategory(item.id)}>{item.label}</button>)}
        </nav>
        <div className="workbench-ribbon__quick">{quickActions}
          {more && <div className="menu-item-wrapper"><button aria-label="更多操作" aria-expanded={menu === 'more'} aria-haspopup="true" onClick={() => setMenu(menu === 'more' ? null : 'more')}><MoreHorizontal size={16} /></button>{menu === 'more' && <div className="menu-dropdown workbench-more" onClick={() => setMenu(null)}>{more}</div>}</div>}
          <button aria-label={expanded ? '收起工具区' : '展开工具区'} aria-expanded={expanded} onClick={() => useWorkspaceStore.getState().toggleRibbon()}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
        </div>
      </>}
      {previewAction}
    </div>
    {!preview && expanded && active && <div className="workbench-ribbon__tools" aria-label={`${active.label}工具`}>
      {active.commands.map(command => <button key={command.id} className="ribbon-command" title={command.disabled ?? command.label} disabled={!!command.disabled} aria-pressed={command.active} onClick={command.execute}><command.icon size={16} /><span>{command.label}</span></button>)}
      {extraTools}
      {target && <span className="workbench-target" title={target}>{target}</span>}
    </div>}
  </header>
}
