import { AppWindow } from 'lucide-react'
import { useState } from 'react'
import { HeaderContent } from './header/HeaderContent'
import { HeaderTabs, type HeaderTabId } from './header/HeaderTabs'

/** Desktop 应用顶部 Header，采用紧凑 Ribbon 交互而非厚重 Office Ribbon。 */
export function Header() {
  const [activeTab, setActiveTab] = useState<HeaderTabId>('start')

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
      <HeaderTabs activeTab={activeTab} onChange={setActiveTab} />
      <HeaderContent activeTab={activeTab} />
    </header>
  )
}
