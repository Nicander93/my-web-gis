import { PanelBottomClose } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { useWorkspaceStore } from '@/stores/workspace.store'

interface BottomPanelProps {
  leftOffset: number
  rightOffset: number
  children: ReactNode
}

/** 底部固定承载 Attribute Table，并按左右面板开关动态避让。 */
export function BottomPanel({ leftOffset, rightOffset, children }: BottomPanelProps) {
  const bottom = useWorkspaceStore((state) => state.bottom)
  const setOpen = useWorkspaceStore((state) => state.setBottomOpen)
  const setHeight = useWorkspaceStore((state) => state.setBottomHeight)

  return (
    <aside
      className="workspace-panel panel-bottom"
      style={{ left: leftOffset, right: rightOffset, height: bottom.height }}
      aria-label="属性表面板"
    >
      <ResizeHandle
        orientation="vertical"
        label="调整属性表面板高度"
        onResize={(delta) => setHeight(useWorkspaceStore.getState().bottom.height - delta)}
      />
      <header className="panel-titlebar">
        <div>
          <span className="panel-kicker">PANEL / BOTTOM</span>
          <h2>属性表</h2>
        </div>
        <Button variant="icon" title="收起属性表" aria-label="收起属性表" onClick={() => setOpen(false)}>
          <PanelBottomClose size={16} />
        </Button>
      </header>
      <div className="panel-body">{children}</div>
    </aside>
  )
}
