import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectEdits } from '@/project/project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { openActivityPanel } from '@/stores/activity-panel.store'
import { emitCommandStatus } from '@/platform/command-status'
import { projectCommands } from './project.commands'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import {
  isMapRuntimeMounted,
  retryMapServiceLayer,
  zoomMapToLayer
} from '@/engine-host/map-runtime-host'
import { refreshWfsLayer } from '@/commands/wfs.commands'
import { projectConfiguration } from '@/project/project-configuration'
import { requestDatasetSave } from '@/project/unsaved-work'
import type { PopupDefinition } from '@desktop-webgis/scene-schema'
import {
  capabilitiesForDataset,
  cloneValue,
  getEffectiveLocked, isDatasetLocked
} from '@desktop-webgis/project'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { finishStyleInteraction } from '@/project/style-interaction'
import { openLayerFilterWindow } from '@/stores/layer-filter-request'

function requireSelectedLayerId(): string | null {
  const layerId = useLayerViewStore.getState().selectedLayerId
  if (!layerId) {
    emitCommandStatus('请先选择图层')
    return null
  }
  return layerId
}

/** 根据数据集类型的标记，判断右键菜单、编辑和导出是否可用。 */
export function getLayerCapabilities(layerId: string | null): {
  exists: boolean
  isVector: boolean
  isService: boolean
  hasFeatures: boolean
  canStyle: boolean
  canLabel: boolean
  canAttributeTable: boolean
  canFilter: boolean
  canExport: boolean
  canCopy: boolean
  canEditGeometry: boolean
  canRename: boolean
  canRemove: boolean
  canZoom: boolean
  canRetry: boolean
} {
  const empty = {
    exists: false,
    isVector: false,
    isService: false,
    hasFeatures: false,
    canStyle: false,
    canLabel: false,
    canAttributeTable: false,
    canFilter: false,
    canExport: false,
    canCopy: false,
    canEditGeometry: false,
    canRename: false,
    canRemove: false,
    canZoom: false,
    canRetry: false
  }
  if (!layerId) return empty
  const state = useProjectStore.getState()
  if (state.project.content.kind !== 'map2d') return empty
  const layer = requireMapContent(state.project).layers.find((item) => item.id === layerId)
  if (!layer) return empty
  const dataset = requireMapContent(state.project).datasets.find(
    (item) => item.id === layer.datasetId
  )
  const flags = capabilitiesForDataset(dataset)
  const isVector = dataset?.kind === 'vector'
  const isService =
    dataset?.kind === 'wms' ||
    dataset?.kind === 'wmts' ||
    dataset?.kind === 'wfs'
  const hasFeatures =
    (featureData.readSnapshot()[layer.datasetId]?.length ?? 0) > 0
  return {
    exists: true,
    isVector,
    isService,
    hasFeatures,
    canStyle: flags.style && !getEffectiveLocked(state.project, layerId),
    canLabel: flags.style && !getEffectiveLocked(state.project, layerId),
    canAttributeTable: flags.queryAttributes,
    canFilter: flags.filter && !getEffectiveLocked(state.project, layerId),
    canExport: flags.exportVector,
    canCopy: flags.copyToLocal,
    canEditGeometry: flags.editGeometry && !isDatasetLocked(state.project, layer.datasetId),
    canRename: !getEffectiveLocked(state.project, layerId),
    canRemove: !getEffectiveLocked(state.project, layerId),
    canZoom: true,
    canRetry:
      dataset?.kind === 'wms' ||
      dataset?.kind === 'wmts' ||
      dataset?.kind === 'wfs'
  }
}

/** 配置目标变化之前先处理未应用的草稿；仅仅浏览图层不会触发配置切换。 */
function openInspector(id: string, tab: 'layer' | 'style' | 'label'): void {
  finishStyleInteraction()
  const workbench = useWorkbenchStore.getState()
  workbench.bindInspector(id)
  useLayerViewStore.getState().setInspectorTab(id, tab)
  useWorkspaceStore.getState().setRightOpen(true)
}

/** 图层相关的命令，供 Header 按钮和图层右键菜单共用。 */
export const layerCommands = {
  setLocked(layerId: string, locked: boolean): void {
    layerConfigurationCommands.setLayerLocked(layerId, locked)
  },
  openStyleDialog(layerId: string, kind: 'sld' | 'publish'): void {
    if (!getLayerCapabilities(layerId).canStyle) return
    useWorkbenchStore.getState().setCartographyDialog({ layerId, kind, epoch: useProjectStore.getState().projectEpoch })
  },
  setPopup(layerId: string, popup?: PopupDefinition): void {
    const project = useProjectStore.getState().project, content = requireMapContent(project)
    const layer = content.layers.find(item => item.id === layerId)
    if (!layer || !capabilitiesForDataset(content.datasets.find(item => item.id === layer.datasetId)).queryAttributes) return
    if (popup && (!Array.isArray(popup.fields) || popup.titleField !== undefined && typeof popup.titleField !== 'string' || popup.fields.some(field =>
      !field || typeof field.field !== 'string' || !field.field || field.label !== undefined && typeof field.label !== 'string' ||
      field.format !== undefined && !['text', 'number', 'date', 'url'].includes(field.format)))) throw new Error('属性弹窗配置无效')
    const interaction = { ...layer.interaction }
    if (popup?.fields.length) interaction.popup = cloneValue(popup)
    else delete interaction.popup
    projectConfiguration.apply({ ...project, content: { ...content,
      layers: content.layers.map(item => item === layer ? { ...layer, interaction } : item) } }, '设置属性弹窗')
  },
  setSelectable(layerId: string, selectable: boolean): void {
    if (typeof selectable !== 'boolean') throw new Error('地图可选择值必须是布尔值')
    const project = useProjectStore.getState().project, content = requireMapContent(project)
    const layer = content.layers.find(item => item.id === layerId)
    if (!layer || !capabilitiesForDataset(content.datasets.find(item => item.id === layer.datasetId)).queryAttributes) return
    projectConfiguration.apply({ ...project, content: { ...content,
      layers: content.layers.map(item => item === layer ? { ...layer, interaction: { ...layer.interaction, selectable } } : item) } }, '设置地图可选择')
  },
  openProperties(layerId: string): void {
    layerCommands.properties(layerId)
  },
  setEditingTarget(layerId: string): void {
    if (!getLayerCapabilities(layerId).canEditGeometry) return
    const workbench = useWorkbenchStore.getState()
    if (workbench.editLayerId && workbench.editLayerId !== layerId) {
      emitCommandStatus('请先结束当前图层编辑，再切换编辑目标')
      return
    }
    workbench.setEditLayer(layerId)
    emitCommandStatus('已设置编辑目标')
  },
  properties(layerId?: string | null): void {
    const id = layerId ?? requireSelectedLayerId()
    if (!id || !getLayerCapabilities(id).exists) return
    openInspector(id, 'layer')
  },
  zoomToLayer(layerId?: string | null): void {
    const id = layerId ?? useLayerViewStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useLayerViewStore.getState().setSelectedLayer(id)
    if (zoomMapToLayer(id)) {
      emitCommandStatus('已缩放到图层')
      return
    }
    emitCommandStatus('缩放到图层（地图运行时未挂载）')
  },

  /** 重新请求 WMS/WMTS 影像，或刷新 WFS 快照；失败时保留原有的内容。 */
  retryServiceLayer(layerId?: string | null): void {
    const id = layerId ?? useLayerViewStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    const state = useProjectStore.getState()
    const layer = requireMapContent(state.project).layers.find((item) => item.id === id)
    const dataset = layer
      ? requireMapContent(state.project).datasets.find((item) => item.id === layer.datasetId)
      : undefined
    if (!dataset) {
      emitCommandStatus('图层不存在')
      return
    }
    if (dataset.kind === 'wfs') {
      void refreshWfsLayer(id)
      return
    }
    if (dataset.kind !== 'wms' && dataset.kind !== 'wmts') {
      emitCommandStatus('仅 WMS/WMTS/WFS 图层支持重新加载')
      return
    }
    useLayerViewStore.getState().setLayerLoading(id, true)
    const retried = retryMapServiceLayer(id)
    useLayerViewStore.getState().setLayerLoading(id, false)
    if (retried) {
      emitCommandStatus('已重新加载服务图层')
      return
    }
    emitCommandStatus(
      isMapRuntimeMounted()
        ? '服务图层重新加载失败'
        : '已请求重新加载服务图层（地图运行时未挂载）'
    )
  },

  moveUp(layerId?: string | null): void {
    const id = layerId ?? useLayerViewStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useLayerViewStore.getState().setSelectedLayer(id)
    layerConfigurationCommands.moveLayer(id, 'up')
    emitCommandStatus('图层已上移')
  },

  moveDown(layerId?: string | null): void {
    const id = layerId ?? useLayerViewStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useLayerViewStore.getState().setSelectedLayer(id)
    layerConfigurationCommands.moveLayer(id, 'down')
    emitCommandStatus('图层已下移')
  },

  remove(layerId?: string | null): void {
    const id = layerId ?? useLayerViewStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    const ok = layerContentCommands.removeLayer(id)
    emitCommandStatus(ok ? '已移除图层' : '图层不存在')
  },

  rename(layerId?: string | null, name?: string): void {
    const id = layerId ?? useLayerViewStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    if (name == null) {
      emitCommandStatus('请输入新名称')
      return
    }
    layerConfigurationCommands.renameLayer(id, name)
    emitCommandStatus('已重命名图层')
  },

  editStyle(layerId?: string | null): void {
    const id = layerId ?? requireSelectedLayerId()
    if (!id) return
    const caps = getLayerCapabilities(id)
    if (!caps.canStyle) {
      emitCommandStatus('当前图层不支持样式')
      return
    }
    useLayerViewStore.getState().setSelectedLayer(id)
    openInspector(id, 'style')
    emitCommandStatus('已打开样式面板')
  },

  editLabel(layerId?: string | null): void {
    const id = layerId ?? requireSelectedLayerId()
    if (!id) return
    const caps = getLayerCapabilities(id)
    if (!caps.canLabel) {
      emitCommandStatus('当前图层不支持标注')
      return
    }
    useLayerViewStore.getState().setSelectedLayer(id)
    openInspector(id, 'label')
    emitCommandStatus('已打开标注面板')
  },

  openAttributeTable(layerId?: string | null): void {
    const id = layerId ?? requireSelectedLayerId()
    if (!id) return
    const caps = getLayerCapabilities(id)
    if (!caps.canAttributeTable) {
      emitCommandStatus('当前图层不支持属性表')
      return
    }
    useLayerViewStore.getState().setSelectedLayer(id)
    openActivityPanel('attributes')
    emitCommandStatus('属性表已打开')
    useWorkbenchStore.getState().bindTable(id)
  },

  openFilter(layerId?: string | null): void {
    const id = layerId ?? requireSelectedLayerId()
    if (!id) return
    const caps = getLayerCapabilities(id)
    if (!caps.canFilter) {
      emitCommandStatus('当前图层不支持过滤')
      return
    }
    useLayerViewStore.getState().setSelectedLayer(id)
    openLayerFilterWindow(id)
    emitCommandStatus('已打开图层过滤')
  },

  async saveData(layerId?: string | null): Promise<void> {
    const id = layerId ?? requireSelectedLayerId()
    if (!id) return
    const layer = requireMapContent(useProjectStore.getState().project).layers.find(item => item.id === id)
    if (!layer) { emitCommandStatus('图层不存在'); return }
    if (await requestDatasetSave(layer.datasetId)) emitCommandStatus('已保存数据')
  },

  discardData(layerId?: string | null): void {
    const id = layerId ?? requireSelectedLayerId()
    if (!id) return
    const layer = requireMapContent(useProjectStore.getState().project).layers.find(item => item.id === id)
    if (!layer) { emitCommandStatus('图层不存在'); return }
    try {
      projectEdits.discardDatasetEdits(layer.datasetId)
      emitCommandStatus('已放弃该数据源的未提交编辑')
    } catch (error) {
      emitCommandStatus(error instanceof Error ? error.message : String(error))
    }
  },

  /** 以导出模式打开导出对话框，主操作不是复制。 */
  export(layerId?: string | null): void {
    const id = layerId ?? useLayerViewStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useLayerViewStore.getState().setSelectedLayer(id)
    projectCommands.exportData(id, 'export')
  },

  /** 以复制模式打开导出对话框。 */
  copyToLocalLayer(layerId?: string | null): void {
    const id = layerId ?? useLayerViewStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useLayerViewStore.getState().setSelectedLayer(id)
    projectCommands.exportData(id, 'copy')
  },

  createGroup(name?: string, layerIds?: string[]): void {
    const id = layerConfigurationCommands.createGroup(name, layerIds)
    emitCommandStatus(id ? '已创建图层组' : '创建图层组失败')
  },

  /**
   * 一次应用 = 一次可撤销配置操作。
   * 兼容命令入口；样式直接写入工程与统一历史。
   */
  applyStyle(layerId: string, style: LayerStyle): boolean {
    const projectState = useProjectStore.getState()
    if (getEffectiveLocked(projectState.project, layerId)) { emitCommandStatus('父文件夹已锁定，请先解锁再应用样式'); return false }
    const layer = requireMapContent(projectState.project).layers.find(
      (item) => item.id === layerId
    )
    if (!layer) {
      emitCommandStatus('图层不存在')
      return false
    }

    const after = cloneValue(style)
    // setLayerStyle 会在统一的 EditHistory 上记录一条 SetLayerStyleCommand。
    layerConfigurationCommands.setLayerStyle(layerId, after)

    emitCommandStatus('已应用样式')
    return true
  },

  undoStyle(): boolean {
    finishStyleInteraction()
    if (!projectEdits.canUndo()) return false
    const ok = projectEdits.undo()
    if (ok) emitCommandStatus('已撤销')
    else { const reason = projectEdits.getBlockReason('undo'); if (reason) emitCommandStatus(reason) }
    return ok
  },

  redoStyle(): boolean {
    finishStyleInteraction()
    if (!projectEdits.canRedo()) return false
    const ok = projectEdits.redo()
    if (ok) emitCommandStatus('已重做')
    else { const reason = projectEdits.getBlockReason('redo'); if (reason) emitCommandStatus(reason) }
    return ok
  },

  canUndoStyle(): boolean {
    return projectEdits.canUndo()
  },

  canRedoStyle(): boolean {
    return projectEdits.canRedo()
  },

  /** 测试用：清空样式的撤销栈 */
  _resetStyleHistoryForTests(): void {
    projectEdits.clear?.()
  }
}
