export type HeaderTabId = 'start' | 'map' | 'edit' | 'layers' | 'view'

interface HeaderTabsProps {
  activeTab: HeaderTabId
  onChange(tab: HeaderTabId): void
}

const tabs: Array<{ id: HeaderTabId; label: string }> = [
  { id: 'start', label: '开始' },
  { id: 'map', label: '地图' },
  { id: 'edit', label: '编辑' },
  { id: 'layers', label: '图层' },
  { id: 'view', label: '视图' }
]

/** 管理 Header 当前一级 Tab，状态仅属于 Header。 */
export function HeaderTabs({ activeTab, onChange }: HeaderTabsProps) {
  return (
    <nav className="header-tabs" aria-label="主命令标签">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`header-tab ${activeTab === tab.id ? 'is-active' : ''}`}
          type="button"
          aria-current={activeTab === tab.id ? 'page' : undefined}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
