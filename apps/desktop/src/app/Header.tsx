import { AppWindow } from 'lucide-react'
import { MenuBar } from './header/MenuBar'
import { Toolbar } from './header/Toolbar'

/** Desktop 应用顶部 Header，开始页显示项目菜单，工作区使用共用 Ribbon。 */
export function Header({ showToolbar = true }: { showToolbar?: boolean }) {
  if (showToolbar) return <Toolbar />
  return (
    <header className="app-header">
      <div className="window-bar">
        <div className="brand-lockup">
          <span className="brand-mark"><AppWindow size={15} /></span>
          <strong>Desktop WebGIS</strong>
          <span className="window-separator" />
          <span className="workspace-name">未打开项目</span>
        </div>
      </div>
      <MenuBar />
    </header>
  )
}
