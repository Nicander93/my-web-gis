import type { ReactNode } from 'react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { useWorkspaceStore } from '@/stores/workspace.store'

interface BottomPanelProps {
  leftOffset: number
  rightOffset: number
  children: ReactNode
}

/** 底部固定承载 Attribute Table，并按左右面板开关动态避让。 */
export function BottomPanel({
  leftOffset,
  rightOffset,
  children
}: BottomPanelProps) {
  const bottom = useWorkspaceStore((state) => state.bottom)
  const setHeight = useWorkspaceStore((state) => state.setBottomHeight)

  return (
    <aside
      className="workspace-panel panel-bottom"
      style={{
        left: leftOffset,
        right: rightOffset,
        height: bottom.height,
        display: bottom.open ? undefined : 'none'
      }}
      aria-label="属性表面板"
      aria-hidden={!bottom.open}
    >
      <ResizeHandle
        orientation="vertical"
        label="调整属性表面板高度"
        onResize={(delta) =>
          setHeight(useWorkspaceStore.getState().bottom.height - delta)
        }
      />
      <div className="panel-body">{children}</div>
    </aside>
  )
}
