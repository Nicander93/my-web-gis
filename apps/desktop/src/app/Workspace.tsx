import {
  FolderPlus,
  Layers2,
  PanelBottom,
  PanelRight,
  Search
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { BottomPanel } from './BottomPanel'
import { LeftPanel } from './LeftPanel'
import { RightPanel } from './RightPanel'
import { viewCommands } from './commands/view.commands'
import { layerCommands, getLayerCapabilities } from './commands/layer.commands'
import { useProjectStore } from '@/stores/project.store'
import { AttributeTable } from '@/features/attribute-table/AttributeTable'
import { Inspector } from '@/features/inspector/Inspector'
import { LayerPanel } from '@/features/layers/LayerPanel'
import { MapCanvas } from '@/features/map/MapCanvas'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { cancelMapOperation } from '@/features/map/map-runtime-host'
import { emitCommandStatus } from './commands/status'

/** Reserve visible map space for open panels so navigation stays reachable. */
export function Workspace({
  processing,
  onCloseProcessing
}: {
  processing?: ReactNode
  onCloseProcessing?: () => void
}) {
  const project = useProjectStore((state) => state.project)
  const inspectorId = useWorkbenchStore((state) => state.inspectorLayerId)
  const tableId = useWorkbenchStore((state) => state.tableLayerId)
  const inspectorLayer = project.layers.find(
    (layer) => layer.id === inspectorId
  )
  const [layerSearchOpen, setLayerSearchOpen] = useState(false)
  const layerSearchButtonRef = useRef<HTMLButtonElement>(null)
  const left = useWorkspaceStore((state) => state.left)
  const right = useWorkspaceStore((state) => state.right)
  const bottom = useWorkspaceStore((state) => state.bottom)
  const leftOffset = left.open ? left.width : 0
  const rightOffset = right.open ? right.width : 0

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest(
            'input, textarea, select, [role="dialog"], [role="menu"], [role="region"]'
          )
        )
      ) {
        if (cancelMapOperation()) {
          event.preventDefault()
          emitCommandStatus('已取消当前操作；已完成的修改可通过撤销恢复')
        }
        return
      }
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
      <MapCanvas
        leftOffset={leftOffset}
        rightOffset={rightOffset}
        bottomOffset={bottom.open ? bottom.height : 0}
      />
      <LeftPanel
        actions={
          <>
            <button
              ref={layerSearchButtonRef}
              type="button"
              className="ui-button ui-button-icon"
              title="搜索图层"
              aria-label="搜索图层"
              aria-expanded={layerSearchOpen}
              onClick={() => setLayerSearchOpen((open) => !open)}
            >
              <Search size={15} />
            </button>
            <Button
              variant="icon"
              title="新建组"
              aria-label="新建组"
              onClick={() => {
                const selected = useProjectStore.getState().selectedLayerId
                layerCommands.createGroup('新建组', selected ? [selected] : [])
              }}
            >
              <FolderPlus size={15} />
            </Button>
          </>
        }
      >
        <LayerPanel
          searchOpen={layerSearchOpen}
          onCloseSearch={() => {
            setLayerSearchOpen(false)
            layerSearchButtonRef.current?.focus()
          }}
        />
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
      <RightPanel
        title={processing ? '空间处理' : '图层属性'}
        actions={
          !processing && (
            <label className="target-picker">
              对象
              <select
                aria-label="配置图层"
                value={inspectorId ?? ''}
                onChange={(event) =>
                  layerCommands.properties(event.target.value)
                }
              >
                <option value="" disabled>
                  选择图层
                </option>
                {project.layers.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name}
                  </option>
                ))}
              </select>
              {inspectorLayer && (
                <span className="target-bound-label">固定目标</span>
              )}
            </label>
          )
        }
        onClose={processing ? onCloseProcessing : undefined}
      >
        {processing || <Inspector key={inspectorId} />}
      </RightPanel>
      {!right.open && (
        <Button
          className="restore-trigger restore-right"
          variant="icon"
          title="恢复检查器"
          aria-label="恢复检查器"
          onClick={viewCommands.toggleInspector}
        >
          <PanelRight size={15} />
        </Button>
      )}
      <BottomPanel
        leftOffset={leftOffset}
        rightOffset={rightOffset}
        title="属性表"
        actions={
          <select
            className="table-target-picker"
            aria-label="属性表图层"
            value={tableId ?? ''}
            onChange={(event) =>
              layerCommands.openAttributeTable(event.target.value)
            }
          >
            <option value="" disabled>
              选择图层
            </option>
            {project.layers
              .filter(
                (layer) => getLayerCapabilities(layer.id).canAttributeTable
              )
              .map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.name}
                </option>
              ))}
          </select>
        }
      >
        <AttributeTable key={tableId} />
      </BottomPanel>
      {!bottom.open && (
        <Button
          className="restore-trigger restore-bottom"
          variant="icon"
          title="恢复属性表"
          aria-label="恢复属性表"
          onClick={viewCommands.toggleAttributeTable}
        >
          <PanelBottom size={15} />
        </Button>
      )}
    </main>
  )
}
