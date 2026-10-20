import { useState, type ReactNode } from 'react'
import { DockHeaderContext } from '@/components/ui/DockHeaderContext'
import { DockWindow } from './docking/DockWindow'
import { Tabs } from 'antd'
import { useActivityPanelStore, type ActivityTab } from '@/stores/activity-panel.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { ActivityPanel } from '@/features/activity/ActivityPanel'
import type { ResourceStates } from '@/services/diagnostics'

/** 属性表、任务日志与诊断共用一个可停靠窗口，界面状态不进入项目。 */
export function BottomPanel({ children, sceneStates, onSelectResource }: { children?: ReactNode; sceneStates?: ResourceStates; onSelectResource?(id: string): void }) {
  const requested = useActivityPanelStore(state => state.tab)
  const open = useWorkspaceStore(state => state.bottom.open)
  const tab = requested === 'attributes' && !children ? 'tasks' : requested
  const title = tab === 'attributes' ? '属性表' : '任务与诊断'
  const [header, setHeader] = useState<HTMLDivElement | null>(null)
  return <DockHeaderContext.Provider value={header}><DockWindow id="bottom" title={title} label={`${title}面板`} titleContent={<>
    <Tabs className="activity-panel-tabs activity-panel-tabs--header" size="small" activeKey={tab} onChange={key => useActivityPanelStore.getState().setTab(key as ActivityTab)}
      items={[...(children ? [{ key: 'attributes', label: '属性表' }] : []), { key: 'tasks', label: '任务日志' }, { key: 'diagnostics', label: '诊断' }]} />
    <div className="dock-feature-tabs" ref={setHeader} hidden={tab !== 'attributes'} />
  </>}>
    {children && <div className="activity-attribute-body" hidden={tab !== 'attributes'}>{children}</div>}
    {open && tab !== 'attributes' && <ActivityPanel tab={tab} sceneStates={sceneStates} onSelectResource={onSelectResource} />}
  </DockWindow></DockHeaderContext.Provider>
}
