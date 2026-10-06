import { PanelRightClose } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { useWorkspaceStore } from '@/stores/workspace.store'

interface RightPanelProps {
  children: ReactNode
  title?: string
}

/** 右侧固定承载 Inspector，并保持面板容器与业务组件解耦。 */
export function RightPanel({ children, title = '检查器' }: RightPanelProps) {
  const right = useWorkspaceStore((state) => state.right)
  const setOpen = useWorkspaceStore((state) => state.setRightOpen)
  const setWidth = useWorkspaceStore((state) => state.setRightWidth)

  return (
    <aside
      className="workspace-panel panel-right"
      style={{ width: right.width, display: right.open ? undefined : 'none' }}
      aria-label="检查器面板"
      aria-hidden={!right.open}
    >
      <header className="panel-titlebar">
        <div>
          <h2 title={title}>{title}</h2>
        </div>
        <Button variant="icon" title="收起检查器" aria-label="收起检查器" onClick={() => setOpen(false)}>
          <PanelRightClose size={16} />
        </Button>
      </header>
      <div className="panel-body">{children}</div>
      <ResizeHandle
        orientation="horizontal"
        label="调整检查器宽度"
        onResize={(delta) => setWidth(useWorkspaceStore.getState().right.width - delta)}
      />
    </aside>
  )
}
