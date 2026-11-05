import {
  Copy,
  SlidersHorizontal,
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
  ArrowDown,
  Upload,
  LockKeyhole,
  LockKeyholeOpen,
  Save,
  RotateCcw
} from 'lucide-react'
import { findGroupForLayer, getLayerGroupState } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { LayerPopupMenu } from './LayerPopupMenu'
import { MenuItem } from '@/ui/components/MenuItem'
import { MenuSeparator } from '@/ui/components/MenuSeparator'
import { openPropertyWindow } from '@/stores/property-window-request'
import {
  getLayerCapabilities,
  layerCommands
} from '@/commands/layer.commands'
import { useFeatureEditState } from '@/project/datasets/feature-data'

export interface LayerContextMenuProps {
  layerId: string
  x: number
  y: number
  onClose(): void
  onRequestRename(layerId: string): void
}

/** 图层树右键和行尾的“更多”按钮共用。 */
export function LayerContextMenu({
  layerId,
  x,
  y,
  onClose,
  onRequestRename
}: LayerContextMenuProps) {
  const caps = getLayerCapabilities(layerId)
  const project = useProjectStore(state => state.project)
  const layer = project.content.kind === 'map2d' ? project.content.layers.find(layer => layer.id === layerId) : undefined
  const parentLocked = project.content.kind === 'map2d' && getLayerGroupState(project, findGroupForLayer(project, layerId)?.id).locked
  const editState = useFeatureEditState()
  const pending = layer ? editState.datasets.find(dataset => dataset.datasetId === layer.datasetId)?.pendingCount ?? 0 : 0

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
        label="图层属性"
        onClick={() => run(() => layerCommands.properties(layerId))}
      />
      <MenuItem icon={SlidersHorizontal} label="完整属性" onClick={() => run(() => openPropertyWindow({ kind: 'layer', id: layerId }))} />
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
        icon={Save}
        label="保存数据"
        disabled={!pending}
        onClick={() => run(() => { void layerCommands.saveData(layerId) })}
      />
      <MenuItem
        icon={RotateCcw}
        label="放弃数据编辑"
        disabled={!pending}
        onClick={() => run(() => layerCommands.discardData(layerId))}
      />
      <MenuItem
        icon={Download}
        label="导出"
        disabled={!caps.canExport}
        onClick={() => run(() => layerCommands.export(layerId))}
      />
      <MenuItem icon={Download} label="导出 SLD…" disabled={!caps.canStyle} onClick={() => run(() => layerCommands.openStyleDialog(layerId, 'sld'))} />
      <MenuItem icon={Upload} label="发布到 GeoServer…" disabled={!caps.canStyle} onClick={() => run(() => layerCommands.openStyleDialog(layerId, 'publish'))} />
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
        icon={ArrowUp}
        disabled={!caps.canRename}
        label="上移图层"
        onClick={() => run(() => layerCommands.moveUp(layerId))}
      />
      <MenuItem
        icon={ArrowDown}
        disabled={!caps.canRename}
        label="下移图层"
        onClick={() => run(() => layerCommands.moveDown(layerId))}
      />
      <MenuSeparator />
      <MenuItem
        icon={layer?.locked ? LockKeyholeOpen : LockKeyhole}
        label={layer?.locked ? '解锁图层' : '锁定图层'}
        disabled={!layer || parentLocked}
        onClick={() => run(() => layerCommands.setLocked(layerId, !layer?.locked))}
      />
      <MenuItem
        icon={Trash2}
        label="移除"
        disabled={!caps.canRemove}
        onClick={() => run(() => layerCommands.remove(layerId))}
      />
    </LayerPopupMenu>
  )
}
