import type { ReactNode } from 'react'
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
  return <DockWindow id="bottom" title={title} label={`${title}面板`}>
    <Tabs className="activity-panel-tabs" size="small" activeKey={tab} onChange={key => useActivityPanelStore.getState().setTab(key as ActivityTab)}
      items={[...(children ? [{ key: 'attributes', label: '属性表', children }] : []),
        { key: 'tasks', label: '任务日志', children: open && tab === 'tasks' && <ActivityPanel tab="tasks" sceneStates={sceneStates} onSelectResource={onSelectResource} /> },
        { key: 'diagnostics', label: '诊断', children: open && tab === 'diagnostics' && <ActivityPanel tab="diagnostics" sceneStates={sceneStates} onSelectResource={onSelectResource} /> }]} />
  </DockWindow>
}
