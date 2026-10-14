import { useEffect, useRef, useState } from 'react'
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

const menuComponents: Record<MenuId, React.ComponentType<{ onClose(): void }>> = {
  project: ProjectMenu,
  view: ViewMenu,
  settings: SettingsMenu,
  help: HelpMenu
}

/** 原有低频命令保留在设置分类中，避免重组 Shell 时丢失入口。 */
function SettingsMenu({ onClose }: { onClose(): void }) {
  const city = useProjectStore(state => getProjectType(state.project) === '3d')
  return <div className="menu-content">
    {(['data', 'layer', 'edit'] as const).map((section, index) => {
      const Component = [DataMenu, LayerMenu, EditMenu][index]
      return <details key={section} className="application-settings-section"><summary>{['数据操作', city ? '对象操作' : '图层操作', '编辑操作'][index]}</summary>
        {city ? <SceneMenu section={section} onClose={onClose} /> : <Component onClose={onClose} />}
      </details>
    })}
    {city && <SceneMenu section="view" onClose={onClose} />}
  </div>
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const menuBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenu) return

    function handleClickOutside(e: MouseEvent) {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [openMenu])

  function toggleMenu(id: MenuId) {
    setOpenMenu(current => current === id ? null : id)
  }

  function closeMenu() {
    setOpenMenu(null)
  }

  return (
    <nav className="menu-bar" ref={menuBarRef}>
      {menus.map((menu) => {
        const isOpen = openMenu === menu.id
        const MenuComponent = menuComponents[menu.id]

        return (
          <div key={menu.id} className="menu-item-wrapper">
            <button
              className={`menu-trigger ${isOpen ? 'is-open' : ''}`}
              type="button"
              aria-expanded={isOpen}
              aria-haspopup="true"
              onClick={() => toggleMenu(menu.id)}
            >
              {menu.label}
            </button>
            {isOpen && (
              <div className="menu-dropdown" role="menu" aria-label={`${menu.label}菜单`}>
                <MenuComponent onClose={closeMenu} />
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
