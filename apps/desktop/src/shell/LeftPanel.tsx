import type { ReactNode } from 'react'
import { DockWindow } from './docking/DockWindow'

interface LeftPanelProps { children: ReactNode; actions?: ReactNode; title?: string; footer?: ReactNode; reserveBottom?: boolean }

/** 图层和场景树共用窗口，业务内容由工作区注入。 */
export function LeftPanel({ children, actions, title = '图层', footer, reserveBottom }: LeftPanelProps) {
  return <DockWindow id="left" title={title} label={`${title}面板`} actions={actions} footer={footer} reserveBottom={reserveBottom}>{children}</DockWindow>
}
