import { FolderPlus, Layers2, PanelBottom, PanelRight, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { BottomPanel } from './BottomPanel'
import { LeftPanel } from './LeftPanel'
import { RightPanel } from './RightPanel'
import { viewCommands } from './commands/view.commands'
import { layerCommands } from './commands/layer.commands'
import { useProjectStore } from '@/stores/project.store'
import { AttributeTable } from '@/features/attribute-table/AttributeTable'
import { Inspector } from '@/features/inspector/Inspector'
import { LayerPanel } from '@/features/layers/LayerPanel'
import { MapCanvas } from '@/features/map/MapCanvas'
import { useWorkspaceStore } from '@/stores/workspace.store'

/** Reserve visible map space for open panels so navigation stays reachable. */
export function Workspace() {
  const [layerSearchOpen, setLayerSearchOpen] = useState(false)
  const layerSearchButtonRef = useRef<HTMLButtonElement>(null)
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
      } else if (key === 'f') {
        event.preventDefault()
        viewCommands.toggleFocusMode()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    function handleResize(): void {
      useWorkspaceStore.getState().constrainPanelSizes()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <main className="workspace" aria-label="GIS Workspace">
      <MapCanvas leftOffset={leftOffset} rightOffset={rightOffset} bottomOffset={bottom.open ? bottom.height : 0} />
      <LeftPanel actions={
        <>
          <button ref={layerSearchButtonRef} type="button" className="ui-button ui-button-icon" title="搜索图层"
            aria-label="搜索图层" aria-expanded={layerSearchOpen} onClick={() => setLayerSearchOpen((open) => !open)}>
            <Search size={15} />
          </button>
          <Button variant="icon" title="新建组" aria-label="新建组" onClick={() => {
            const selected = useProjectStore.getState().selectedLayerId
            layerCommands.createGroup('新建组', selected ? [selected] : [])
          }}><FolderPlus size={15} /></Button>
        </>
      }>
        <LayerPanel searchOpen={layerSearchOpen} onCloseSearch={() => {
          setLayerSearchOpen(false)
          layerSearchButtonRef.current?.focus()
        }} />
      </LeftPanel>
      {!left.open && (
        <Button
          className="restore-trigger restore-left"
          variant="icon"
          title="恢复图层面板"
          aria-label="恢复图层面板"
          onClick={() => useWorkspaceStore.getState().restoreLeft()}
        >
          <Layers2 size={15} />
        </Button>
      )}
      <RightPanel>
        <Inspector />
      </RightPanel>
      {!right.open && (
        <Button
          className="restore-trigger restore-right"
          variant="icon"
          title="恢复检查器"
          aria-label="恢复检查器"
          onClick={() => useWorkspaceStore.getState().restoreRight()}
        >
          <PanelRight size={15} />
        </Button>
      )}
      <BottomPanel leftOffset={leftOffset} rightOffset={rightOffset}>
        <AttributeTable />
      </BottomPanel>
      {!bottom.open && (
        <Button
          className="restore-trigger restore-bottom"
          variant="icon"
          title="恢复属性表"
          aria-label="恢复属性表"
          onClick={() => useWorkspaceStore.getState().restoreBottom()}
        >
          <PanelBottom size={15} />
        </Button>
      )}
    </main>
  )
}
