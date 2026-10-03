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
  RefreshCw,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { LayerPopupMenu } from './LayerPopupMenu'
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
  const caps = getLayerCapabilities(layerId)

  function run(action: () => void): void {
    action()
    onClose()
  }

  return (
    <LayerPopupMenu x={x} y={y} label="图层菜单" onClose={onClose}>
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
        <MenuItem icon={ArrowUp} label="上移图层" onClick={() => run(() => layerCommands.moveUp(layerId))} />
        <MenuItem icon={ArrowDown} label="下移图层" onClick={() => run(() => layerCommands.moveDown(layerId))} />
        <MenuSeparator />
        <MenuItem
          icon={Trash2}
          label="移除"
          disabled={!caps.canRemove}
          onClick={() => run(() => layerCommands.remove(layerId))}
        />
    </LayerPopupMenu>
  )
}
