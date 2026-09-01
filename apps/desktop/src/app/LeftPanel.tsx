import { PanelLeftClose } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { useWorkspaceStore } from '@/stores/workspace.store'

interface LeftPanelProps {
  children: ReactNode
}

/** 左侧固定承载 Layer Manager，并负责自身开关、尺寸与恢复入口。 */
export function LeftPanel({ children }: LeftPanelProps) {
  const left = useWorkspaceStore((state) => state.left)
  const setOpen = useWorkspaceStore((state) => state.setLeftOpen)
  const setWidth = useWorkspaceStore((state) => state.setLeftWidth)

  return (
    <aside className="workspace-panel panel-left" style={{ width: left.width }} aria-label="图层面板">
      <header className="panel-titlebar">
        <div>
          <span className="panel-kicker">PANEL / LEFT</span>
          <h2>图层</h2>
        </div>
        <Button variant="icon" title="收起图层面板" aria-label="收起图层面板" onClick={() => setOpen(false)}>
          <PanelLeftClose size={16} />
        </Button>
      </header>
      <div className="panel-body">{children}</div>
      <ResizeHandle
        orientation="horizontal"
        label="调整图层面板宽度"
        onResize={(delta) => setWidth(useWorkspaceStore.getState().left.width + delta)}
      />
    </aside>
  )
}
