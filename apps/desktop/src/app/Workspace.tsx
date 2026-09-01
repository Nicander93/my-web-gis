import { Layers2, PanelBottom, PanelRight, RotateCcw } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { BottomPanel } from './BottomPanel'
import { LeftPanel } from './LeftPanel'
import { RightPanel } from './RightPanel'
import { viewCommands } from './commands/view.commands'
import { AttributeTable } from '@/features/attribute-table/AttributeTable'
import { Inspector } from '@/features/inspector/Inspector'
import { LayerPanel } from '@/features/layers/LayerPanel'
import { MapCanvas } from '@/features/map/MapCanvas'
import { useWorkspaceStore } from '@/stores/workspace.store'

/** Map-first Workspace，地图永远占满，三面板作为其上的辅助 overlay。 */
export function Workspace() {
  const left = useWorkspaceStore((state) => state.left)
  const right = useWorkspaceStore((state) => state.right)
  const bottom = useWorkspaceStore((state) => state.bottom)
  const leftOffset = left.open ? left.width : 0
  const rightOffset = right.open ? right.width : 0

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      const mod = event.ctrlKey || event.metaKey
      if (!mod || !event.shiftKey) return
      const key = event.key.toLowerCase()
      if (key === 'l') {
        event.preventDefault()
        viewCommands.toggleLayers()
      } else if (key === 'i') {
        event.preventDefault()
        viewCommands.toggleInspector()
      } else if (key === 'a') {
        event.preventDefault()
        viewCommands.toggleAttributeTable()
      } else if (key === '0') {
        event.preventDefault()
        viewCommands.resetLayout()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  return (
    <main className="workspace" aria-label="GIS Workspace">
      <MapCanvas />
      {left.open ? (
        <LeftPanel><LayerPanel /></LeftPanel>
      ) : (
        <Button className="restore-trigger restore-left" variant="icon" title="恢复图层面板" aria-label="恢复图层面板" onClick={() => useWorkspaceStore.getState().restoreLeft()}>
          <Layers2 size={15} />
        </Button>
      )}
      {right.open ? (
        <RightPanel><Inspector /></RightPanel>
      ) : (
        <Button className="restore-trigger restore-right" variant="icon" title="恢复检查器" aria-label="恢复检查器" onClick={() => useWorkspaceStore.getState().restoreRight()}>
          <PanelRight size={15} />
        </Button>
      )}
      {bottom.open ? (
        <BottomPanel leftOffset={leftOffset} rightOffset={rightOffset}><AttributeTable /></BottomPanel>
      ) : (
        <Button className="restore-trigger restore-bottom" variant="icon" title="恢复属性表" aria-label="恢复属性表" onClick={() => useWorkspaceStore.getState().restoreBottom()}>
          <PanelBottom size={15} />
        </Button>
      )}
      <Button className="layout-reset-float" variant="icon" title="重置布局" aria-label="重置布局" onClick={() => useWorkspaceStore.getState().resetLayout()}>
        <RotateCcw size={14} />
      </Button>
    </main>
  )
}
