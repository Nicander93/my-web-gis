import {
  Copy,
  Download,
  Filter,
  MapPinned,
  Pencil,
  Tag,
  Table2,
  Trash2,
  Type,
  RefreshCw
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { MenuItem } from '@/app/header/menus/MenuItem'
import { MenuSeparator } from '@/app/header/menus/MenuSeparator'
import { getLayerCapabilities, layerCommands } from '@/app/commands/layer.commands'

export interface LayerContextMenuProps {
  layerId: string
  x: number
  y: number
  onClose(): void
  onRequestRename(layerId: string): void
}

/** Shared by LayerPanel right-click and the row "more" button. */
export function LayerContextMenu({
  layerId,
  x,
  y,
  onClose,
  onRequestRename
}: LayerContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const caps = getLayerCapabilities(layerId)

  useEffect(() => {
    function handlePointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  function run(action: () => void): void {
    action()
    onClose()
  }

  const style = {
    top: Math.min(y, typeof window !== 'undefined' ? window.innerHeight - 320 : y),
    left: Math.min(x, typeof window !== 'undefined' ? window.innerWidth - 220 : x)
  }

  return (
    <div
      ref={ref}
      className="layer-context-menu menu-dropdown"
      style={style}
      role="menu"
      aria-label="图层菜单"
    >
      <div className="menu-content">
        <MenuItem
          icon={MapPinned}
          label="定位"
          disabled={!caps.canZoom}
          onClick={() => run(() => layerCommands.zoomToLayer(layerId))}
        />
        <MenuItem
          icon={RefreshCw}
          label="重新加载"
          disabled={!caps.canRetry}
          onClick={() => run(() => layerCommands.retryServiceLayer(layerId))}
        />
        <MenuSeparator />
        <MenuItem
          icon={Pencil}
          label="样式"
          disabled={!caps.canStyle}
          onClick={() => run(() => layerCommands.editStyle(layerId))}
        />
        <MenuItem
          icon={Tag}
          label="标注"
          disabled={!caps.canLabel}
          onClick={() => run(() => layerCommands.editLabel(layerId))}
        />
        <MenuItem
          icon={Table2}
          label="属性表"
          disabled={!caps.canAttributeTable}
          onClick={() => run(() => layerCommands.openAttributeTable(layerId))}
        />
        <MenuItem
          icon={Filter}
          label="过滤"
          disabled={!caps.canFilter}
          onClick={() => run(() => layerCommands.openFilter(layerId))}
        />
        <MenuSeparator />
        <MenuItem
          icon={Download}
          label="导出"
          disabled={!caps.canExport}
          onClick={() => run(() => layerCommands.export(layerId))}
        />
        <MenuItem
          icon={Copy}
          label="复制"
          disabled={!caps.canCopy}
          onClick={() => run(() => layerCommands.copyToLocalLayer(layerId))}
        />
        <MenuItem
          icon={Type}
          label="重命名"
          disabled={!caps.canRename}
          onClick={() => run(() => onRequestRename(layerId))}
        />
        <MenuSeparator />
        <MenuItem
          icon={Trash2}
          label="移除"
          disabled={!caps.canRemove}
          onClick={() => run(() => layerCommands.remove(layerId))}
        />
      </div>
    </div>
  )
}
