import type { ReactNode } from 'react'
import { DockWindow } from './docking/DockWindow'

interface RightPanelProps { title?: string; actions?: ReactNode; onClose?: () => void; children: ReactNode; showHeader?: boolean }

/** 检查器与处理任务保留业务状态，窗口仅负责布局。 */
export function RightPanel({ children, title = '图层属性', onClose, actions }: RightPanelProps) {
  return <DockWindow id="right" title={title} label="检查器面板" onClose={onClose}>
    {actions && <div className="panel-context">{actions}</div>}
    {children}
  </DockWindow>
}
