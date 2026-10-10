import { PanelLeftClose } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { useWorkspaceStore } from '@/stores/workspace.store'

interface LeftPanelProps {
  children: ReactNode
  actions?: ReactNode
  title?: string
  footer?: ReactNode
}

/** 左侧固定承载 Layer Manager，并负责自身开关、尺寸与恢复入口。 */
export function LeftPanel({ children, actions, title = '图层', footer }: LeftPanelProps) {
  const left = useWorkspaceStore((state) => state.left)
  const setOpen = useWorkspaceStore((state) => state.setLeftOpen)
  const setWidth = useWorkspaceStore((state) => state.setLeftWidth)

  return (
    <aside
      className="workspace-panel panel-left"
      style={{ width: left.width, display: left.open ? undefined : 'none' }}
      aria-label={`${title}面板`}
      aria-hidden={!left.open}
    >
      <header className="panel-titlebar">
        <div>
          <h2>{title}</h2>
        </div>
        <div className="panel-actions">
        {actions}
        <Button variant="icon" title="收起图层面板" aria-label="收起图层面板" onClick={() => setOpen(false)}>
          <PanelLeftClose size={16} />
        </Button>
        </div>
      </header>
      <div className="panel-body">{children}</div>
      {footer}
      <ResizeHandle
        orientation="horizontal"
        label="调整图层面板宽度"
        onResize={(delta) => setWidth(useWorkspaceStore.getState().left.width + delta)}
      />
    </aside>
  )
}
