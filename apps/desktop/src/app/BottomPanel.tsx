import { useState, type ReactNode } from 'react'
import { DockHeaderContext } from '@/components/ui/DockHeaderContext'
import { ModelessWindow } from '@/components/ui/ModelessWindow'
import { DockWindow } from './docking/DockWindow'
import { useActivityPanelStore } from '@/stores/activity-panel.store'
import { ActivityPanel } from '@/features/activity/ActivityPanel'
import type { ResourceStates } from '@/services/diagnostics'

/** The bottom dock belongs to attribute tables; task lifetimes are independent of their windows. */
export function BottomPanel({ children, sceneStates, onSelectResource }: { children?: ReactNode; sceneStates?: ResourceStates; onSelectResource?(id: string): void }) {
  const [header, setHeader] = useState<HTMLDivElement | null>(null)
  const tasksOpen = useActivityPanelStore(state => state.tasksOpen)
  const diagnosticsOpen = useActivityPanelStore(state => state.diagnosticsOpen)
  return <>
    {children && <DockHeaderContext.Provider value={header}>
      <DockWindow id="bottom" title="属性表" label="属性表面板" titleContent={<div className="dock-feature-tabs" ref={setHeader} />}>
        <div className="activity-attribute-body">{children}</div>
      </DockWindow>
    </DockHeaderContext.Provider>}
    {tasksOpen && <ModelessWindow title="任务中心" onClose={() => useActivityPanelStore.getState().setOpen('tasks', false)}>
      <ActivityPanel tab="tasks" />
    </ModelessWindow>}
    {diagnosticsOpen && <ModelessWindow title="诊断中心" width={760} height={480} onClose={() => useActivityPanelStore.getState().setOpen('diagnostics', false)}>
      <ActivityPanel tab="diagnostics" sceneStates={sceneStates} onSelectResource={onSelectResource} />
    </ModelessWindow>}
  </>
}
