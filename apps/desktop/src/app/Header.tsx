import { AppWindow } from 'lucide-react'
import { MenuBar } from './header/MenuBar'
import { Toolbar } from './header/Toolbar'

/** Desktop 应用顶部 Header，采用紧凑菜单栏与固定工具栏。 */
export function Header() {
  return (
    <header className="app-header">
      <div className="window-bar">
        <div className="brand-lockup">
          <span className="brand-mark"><AppWindow size={15} /></span>
          <strong>Desktop WebGIS</strong>
          <span className="window-separator" />
          <span className="workspace-name">未命名工作空间</span>
        </div>
        <span className="window-context">Map first · 2D workspace</span>
      </div>
      <MenuBar />
      <Toolbar />
    </header>
  )
}
