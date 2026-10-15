import {
  FolderPlus,
  Search
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { BottomPanel } from './BottomPanel'
import { LeftPanel } from './LeftPanel'
import { RightPanel } from './RightPanel'
import { viewCommands } from './commands/view.commands'
import { layerCommands } from './commands/layer.commands'
import { useProjectStore } from '@/stores/project.store'
import { AttributeTableHost } from '@/features/attribute-table/AttributeTableHost'
import { Inspector } from '@/features/inspector/Inspector'
import { LayerPropertyWindowHost } from '@/features/inspector/LayerPropertyWindow'
import { LayerPanel } from '@/features/layers/LayerPanel'
import { MapCanvas } from '@/features/map/MapCanvas'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { cancelMapOperation } from '@/features/map/map-runtime-host'
import { emitCommandStatus } from './commands/status'
import { editCommands } from './commands/edit.commands'

/** 面板覆盖完整地图视口，不改变地图尺寸和定位中心。 */
export function Workspace({
  processing,
  onCloseProcessing
}: {
  processing?: ReactNode
  onCloseProcessing?: () => void
}) {
  const project = useProjectStore((state) => state.project)
  const inspectorId = useWorkbenchStore((state) => state.inspectorLayerId)
  const inspectorLayer = project.layers.find(
    (layer) => layer.id === inspectorId
  )
  const [layerSearchOpen, setLayerSearchOpen] = useState(false)
  const layerSearchButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing ||
        (event.target instanceof HTMLElement && event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"]'
        ))) return
      if (event.key === 'Escape') {
        if (cancelMapOperation()) {
          event.preventDefault()
          emitCommandStatus('已取消当前操作；已完成的修改可通过撤销恢复')
        }
        return
      }
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'y' && !event.altKey) {
        event.preventDefault()
        editCommands.redo()
        return
      }
      if (mod && event.key.toLowerCase() === 'z' && !event.altKey) {
        event.preventDefault()
        if (event.shiftKey) editCommands.redo()
        else editCommands.undo()
        return
      }
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
      <MapCanvas />
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
      <BottomPanel>
        <AttributeTableHost />
      </BottomPanel>
      <LayerPropertyWindowHost />
    </main>
  )
}
