import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Dropdown } from 'antd'
import { ProjectMenu } from './menus/ProjectMenu'
import { DataMenu } from './menus/DataMenu'
import { LayerMenu } from './menus/LayerMenu'
import { EditMenu } from './menus/EditMenu'
import { ViewMenu } from './menus/ViewMenu'
import { HelpMenu } from './menus/HelpMenu'
import { SceneMenu } from '@/features/scene3d/SceneMenu'
import { useProjectStore } from '@/stores/project.store'
import { getProjectType } from '@/services/project-type'

export type MenuId = 'project' | 'view' | 'settings' | 'help'

const menus: Array<{ id: MenuId; label: string }> = [
  { id: 'project', label: '文件' },
  { id: 'view', label: '窗口' },
  { id: 'settings', label: '设置' },
  { id: 'help', label: '帮助' }
]

const menuComponents: Record<MenuId, ComponentType<{ onClose(): void }>> = {
  project: ProjectMenu,
  view: ViewMenu,
  settings: SettingsMenu,
  help: HelpMenu
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')
}

function menuButtons(label: string): HTMLButtonElement[] {
  const menu = document.querySelector<HTMLElement>(`[role="menu"][aria-label="${label}菜单"]`)
  return Array.from(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
}

/** 原有低频命令保留在设置分类中，避免重组 Shell 时丢失入口。 */
function SettingsMenu({ onClose }: { onClose(): void }) {
  const city = useProjectStore(state => getProjectType(state.project) === '3d')
  const sections = [
    { label: '数据操作', node: city ? <SceneMenu section="data" onClose={onClose} /> : <DataMenu onClose={onClose} /> },
    { label: city ? '对象操作' : '图层操作', node: city ? <SceneMenu section="layer" onClose={onClose} /> : <LayerMenu onClose={onClose} /> },
    { label: '编辑操作', node: city ? <SceneMenu section="edit" onClose={onClose} /> : <EditMenu onClose={onClose} /> }
  ]
  return <div className="menu-content">
    {sections.map(section => (
      <div key={section.label} className="application-settings-section">
        <div className="application-settings-section__label">{section.label}</div>
        {section.node}
      </div>
    ))}
    {city && <div className="application-settings-section">
      <div className="application-settings-section__label">场景视图</div>
      <SceneMenu section="view" onClose={onClose} />
    </div>}
  </div>
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const openRef = useRef<MenuId | null>(null)
  const triggers = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({})

  function closeMenu(restore: boolean) {
    const id = openRef.current
    openRef.current = null
    setOpenMenu(null)
    if (restore && id) queueMicrotask(() => triggers.current[id]?.focus())
  }

  function openAt(id: MenuId) {
    openRef.current = id
    setOpenMenu(id)
  }

  useEffect(() => {
    if (!openMenu) return
    const label = menus.find(item => item.id === openMenu)?.label
    const frame = requestAnimationFrame(() => { if (label) menuButtons(label)[0]?.focus() })
    return () => cancelAnimationFrame(frame)
  }, [openMenu])

  function adjacent(id: MenuId, offset: number): MenuId {
    const index = menus.findIndex(item => item.id === id)
    return menus[(index + offset + menus.length) % menus.length].id
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return
      const current = openRef.current
      if (event.key === 'F10') {
        event.preventDefault()
        if (current) closeMenu(true)
        else triggers.current.project?.focus()
        return
      }
      if (!current) return
      const label = menus.find(item => item.id === current)?.label ?? ''
      const buttons = menuButtons(label)
      const index = buttons.findIndex(button => button === document.activeElement)
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu(true)
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        openAt(adjacent(current, event.key === 'ArrowRight' ? 1 : -1))
        return
      }
      if (!buttons.length) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        buttons[(index + 1) % buttons.length]?.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        buttons[(index - 1 + buttons.length) % buttons.length]?.focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        buttons[0]?.focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        buttons.at(-1)?.focus()
      }
    }

    let altAlone = false
    function handleAltDown(event: KeyboardEvent) {
      altAlone = event.key === 'Alt' && !event.ctrlKey && !event.metaKey && !event.shiftKey
      if (event.key !== 'Alt') altAlone = false
    }
    function handleAltUp(event: KeyboardEvent) {
      if (event.key !== 'Alt' || !altAlone || event.isComposing || isTypingTarget(event.target)) return
      event.preventDefault()
      if (openRef.current) closeMenu(true)
      else triggers.current.project?.focus()
    }

    document.addEventListener('keydown', handleKey)
    document.addEventListener('keydown', handleAltDown)
    document.addEventListener('keyup', handleAltUp)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('keydown', handleAltDown)
      document.removeEventListener('keyup', handleAltUp)
    }
  }, [])

  function onTriggerKey(event: ReactKeyboardEvent<HTMLButtonElement>, id: MenuId) {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = adjacent(id, event.key === 'ArrowRight' ? 1 : -1)
      if (openRef.current) openAt(next)
      else triggers.current[next]?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAt(id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(false)
      event.currentTarget.blur()
    }
  }

  return (
    <nav className="menu-bar" aria-label="应用程序菜单">
      {menus.map((menu) => {
        const isOpen = openMenu === menu.id
        const MenuComponent = menuComponents[menu.id]
        return (
          <Dropdown
            key={menu.id}
            trigger={['click']}
            open={isOpen}
            destroyOnHidden
            placement="bottomLeft"
            classNames={{ root: 'window-menu-overlay' }}
            onOpenChange={(open) => { if (open) openAt(menu.id); else if (openRef.current === menu.id) closeMenu(false) }}
            popupRender={() => (
              <div className="menu-dropdown menu-dropdown--popup" role="menu" aria-label={`${menu.label}菜单`}>
                <MenuComponent onClose={() => closeMenu(true)} />
              </div>
            )}
          >
            <div
              className="menu-item-wrapper"
              onMouseEnter={() => { if (openRef.current && openRef.current !== menu.id) openAt(menu.id) }}
            >
              <button
                ref={(node) => { triggers.current[menu.id] = node }}
                className={`menu-trigger ${isOpen ? 'is-open' : ''}`}
                type="button"
                aria-expanded={isOpen}
                aria-haspopup="true"
                onKeyDown={(event) => onTriggerKey(event, menu.id)}
              >
                {menu.label}
              </button>
            </div>
          </Dropdown>
        )
      })}
    </nav>
  )
}
