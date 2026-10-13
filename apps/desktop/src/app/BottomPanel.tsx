import type { ReactNode } from 'react'
import { DockWindow } from './docking/DockWindow'

/** 属性表默认横跨工作区，也可以停靠侧边、浮动或最大化。 */
export function BottomPanel({ children }: { children: ReactNode }) {
  return <DockWindow id="bottom" title="属性表" label="属性表面板">{children}</DockWindow>
}
