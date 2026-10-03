import { useEffect, useRef, useState } from 'react'
import { ProjectMenu } from './menus/ProjectMenu'
import { DataMenu } from './menus/DataMenu'
import { LayerMenu } from './menus/LayerMenu'
import { EditMenu } from './menus/EditMenu'
import { ViewMenu } from './menus/ViewMenu'
import { HelpMenu } from './menus/HelpMenu'
import { CityMenu } from '@/features/city/CityMenu'
import { useProjectStore } from '@/stores/project.store'
import { getProjectType } from '@/services/project-type'

export type MenuId = 'project' | 'data' | 'layer' | 'edit' | 'view' | 'help'

const menus: Array<{ id: MenuId; label: string }> = [
  { id: 'project', label: '项目' },
  { id: 'data', label: '数据' },
  { id: 'layer', label: '图层' },
  { id: 'edit', label: '编辑' },
  { id: 'view', label: '视图' },
  { id: 'help', label: '帮助' }
]

const menuComponents: Record<MenuId, React.ComponentType<{ onClose(): void }>> = {
  project: ProjectMenu,
  data: DataMenu,
  layer: LayerMenu,
  edit: EditMenu,
  view: ViewMenu,
  help: HelpMenu
}

export function MenuBar() {
  const city = useProjectStore(state => getProjectType(state.project) === '3d')
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
              {city && menu.id === 'layer' ? '对象' : menu.label}
            </button>
            {isOpen && (
              <div className="menu-dropdown">
                {city && menu.id !== 'project' ? <CityMenu section={menu.id} onClose={closeMenu} /> : <MenuComponent onClose={closeMenu} />}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
