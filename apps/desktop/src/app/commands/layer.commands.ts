import { emitCommandStatus } from './status'
import { projectCommands } from './project.commands'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { capabilitiesForDataset, cloneValue, isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'
import type { LayerStyle } from '@desktop-webgis/ol-style'

interface StyleConfigOp {
  layerId: string
  before: LayerStyle
  after: LayerStyle
}

const styleUndoStack: StyleConfigOp[] = []
const styleRedoStack: StyleConfigOp[] = []

function normalizeStyle(style: LayerStyle | { kind: string }): LayerStyle {
  if (isLegacyStyle(style as never)) {
    return migrateLegacyStyle(style as never)
  }
  return cloneValue(style as LayerStyle)
}

function requireSelectedLayerId(): string | null {
  const layerId = useProjectStore.getState().selectedLayerId
  if (!layerId) {
    emitCommandStatus('请先选择图层')
    return null
  }
  return layerId
}

/** Capabilities for gating context-menu / edit / export (from Dataset kind flags). */
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
  const layer = state.project.layers.find((item) => item.id === layerId)
  if (!layer) return empty
  const dataset = state.project.datasets.find((item) => item.id === layer.datasetId)
  const flags = capabilitiesForDataset(dataset)
  const isVector = dataset?.kind === 'vector'
  const isService = dataset?.kind === 'wms' || dataset?.kind === 'wmts' || dataset?.kind === 'wfs'
  const hasFeatures = (state.featuresByDataset[layer.datasetId]?.length ?? 0) > 0
  return {
    exists: true,
    isVector,
    isService,
    hasFeatures,
    canStyle: flags.style,
    canLabel: flags.style,
    canAttributeTable: flags.queryAttributes,
    canFilter: flags.filter,
    canExport: flags.exportVector,
    canCopy: flags.copyToLocal,
    canEditGeometry: flags.editGeometry,
    canRename: true,
    canRemove: true,
    canZoom: true,
    canRetry: dataset?.kind === 'wms' || dataset?.kind === 'wmts'
  }
}

/** 图层相关命令，供 Header 按钮与 Layer Context Menu 共用。 */
export const layerCommands = {
  zoomToLayer(layerId?: string | null): void {
    const id = layerId ?? useProjectStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useProjectStore.getState().setSelectedLayer(id)
    const state = useProjectStore.getState()
    const layer = state.project.layers.find((item) => item.id === id)
    const dataset = layer
      ? state.project.datasets.find((item) => item.id === layer.datasetId)
      : undefined
    if (dataset?.kind === 'wms' && dataset.source.bboxWgs84) {
      const [w, s, e, n] = dataset.source.bboxWgs84
      emitCommandStatus(
        `缩放到 WMS 范围 [${w.toFixed(2)}, ${s.toFixed(2)}, ${e.toFixed(2)}, ${n.toFixed(2)}]（地图运行时接入后自动 fit）`
      )
      return
    }
    emitCommandStatus('缩放到图层（地图运行时接入后生效）')
  },

  /** Re-request WMS/WMTS imagery after a transient failure (runtime refresh when mounted). */
  retryServiceLayer(layerId?: string | null): void {
    const id = layerId ?? useProjectStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    const state = useProjectStore.getState()
    const layer = state.project.layers.find((item) => item.id === id)
    const dataset = layer
      ? state.project.datasets.find((item) => item.id === layer.datasetId)
      : undefined
    if (!dataset || (dataset.kind !== 'wms' && dataset.kind !== 'wmts')) {
      emitCommandStatus('仅 WMS/WMTS 图层支持重新加载')
      return
    }
    useSessionStore.getState().setLayerLoading(id, true)
    // Session bump lets a future MapCanvas subscriber call runtime.retryWmsLayer.
    useSessionStore.getState().setLayerLoading(id, false)
    emitCommandStatus('已请求重新加载服务图层')
  },

  moveUp(layerId?: string | null): void {
    const id = layerId ?? useProjectStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useProjectStore.getState().setSelectedLayer(id)
    useProjectStore.getState().moveLayer(id, 'up')
    emitCommandStatus('图层已上移')
  },

  moveDown(layerId?: string | null): void {
    const id = layerId ?? useProjectStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useProjectStore.getState().setSelectedLayer(id)
    useProjectStore.getState().moveLayer(id, 'down')
    emitCommandStatus('图层已下移')
  },

  remove(layerId?: string | null): void {
    const id = layerId ?? useProjectStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    const ok = useProjectStore.getState().removeLayer(id)
    emitCommandStatus(ok ? '已移除图层' : '图层不存在')
  },

  rename(layerId?: string | null, name?: string): void {
    const id = layerId ?? useProjectStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    if (name == null) {
      emitCommandStatus('请输入新名称')
      return
    }
    useProjectStore.getState().renameLayer(id, name)
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
    useProjectStore.getState().setSelectedLayer(id)
    useWorkspaceStore.getState().setRightOpen(true)
    useSessionStore.getState().setInspectorTab(id, 'style')
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
    useProjectStore.getState().setSelectedLayer(id)
    useWorkspaceStore.getState().setRightOpen(true)
    useSessionStore.getState().setInspectorTab(id, 'label')
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
    useProjectStore.getState().setSelectedLayer(id)
    useWorkspaceStore.getState().setBottomOpen(true)
    emitCommandStatus('属性表已打开')
  },

  openFilter(layerId?: string | null): void {
    const id = layerId ?? requireSelectedLayerId()
    if (!id) return
    const caps = getLayerCapabilities(id)
    if (!caps.canFilter) {
      emitCommandStatus('当前图层不支持过滤')
      return
    }
    useProjectStore.getState().setSelectedLayer(id)
    useWorkspaceStore.getState().setBottomOpen(true)
    emitCommandStatus('已打开属性表过滤')
  },

  /** Open export dialog in export mode (no copy primary). */
  export(layerId?: string | null): void {
    const id = layerId ?? useProjectStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useProjectStore.getState().setSelectedLayer(id)
    projectCommands.exportData(id, 'export')
  },

  /** Open export dialog in copy mode. */
  copyToLocalLayer(layerId?: string | null): void {
    const id = layerId ?? useProjectStore.getState().selectedLayerId
    if (!id) {
      emitCommandStatus('请先选择图层')
      return
    }
    useProjectStore.getState().setSelectedLayer(id)
    projectCommands.exportData(id, 'copy')
  },

  createGroup(name?: string, layerIds?: string[]): void {
    const id = useProjectStore.getState().createGroup(name, layerIds)
    emitCommandStatus(id ? '已创建图层组' : '创建图层组失败')
  },

  /**
   * 一次应用 = 一次可撤销配置操作。
   * 草稿写入项目图层样式，并同步会话草稿为干净状态。
   */
  applyStyle(layerId: string, style: LayerStyle): boolean {
    const projectState = useProjectStore.getState()
    const layer = projectState.project.layers.find((item) => item.id === layerId)
    if (!layer) {
      emitCommandStatus('图层不存在')
      return false
    }

    const before = normalizeStyle(layer.style as never)
    const after = cloneValue(style)
    projectState.setLayerStyle(layerId, after)

    styleUndoStack.push({ layerId, before, after })
    styleRedoStack.length = 0

    useSessionStore.getState().setStyleDraft(layerId, {
      style: cloneValue(after),
      dirty: false,
      classCount:
        after.mode === 'graduated' ? Math.max(after.breaks.length, 1) : 5,
      colorRampId: useSessionStore.getState().getLayerSession(layerId).styleDraft?.colorRampId ?? 'BlueRed'
    })

    emitCommandStatus('已应用样式')
    return true
  },

  /** 重置草稿为当前已应用样式 */
  resetStyleDraft(layerId: string): void {
    const applied = useProjectStore.getState().getNormalizedLayerStyle(layerId)
    if (!applied) {
      emitCommandStatus('图层不存在')
      return
    }
    const existing = useSessionStore.getState().getLayerSession(layerId).styleDraft
    useSessionStore.getState().setStyleDraft(layerId, {
      style: cloneValue(applied),
      dirty: false,
      classCount: existing?.classCount ?? (applied.mode === 'graduated' ? Math.max(applied.breaks.length, 1) : 5),
      colorRampId: existing?.colorRampId ?? 'BlueRed'
    })
    emitCommandStatus('已重置样式草稿')
  },

  undoStyle(): boolean {
    const op = styleUndoStack.pop()
    if (!op) return false
    useProjectStore.getState().setLayerStyle(op.layerId, op.before)
    styleRedoStack.push(op)
    const existing = useSessionStore.getState().getLayerSession(op.layerId).styleDraft
    useSessionStore.getState().setStyleDraft(op.layerId, {
      style: cloneValue(op.before),
      dirty: false,
      classCount: existing?.classCount ?? 5,
      colorRampId: existing?.colorRampId ?? 'BlueRed'
    })
    emitCommandStatus('已撤销样式应用')
    return true
  },

  redoStyle(): boolean {
    const op = styleRedoStack.pop()
    if (!op) return false
    useProjectStore.getState().setLayerStyle(op.layerId, op.after)
    styleUndoStack.push(op)
    const existing = useSessionStore.getState().getLayerSession(op.layerId).styleDraft
    useSessionStore.getState().setStyleDraft(op.layerId, {
      style: cloneValue(op.after),
      dirty: false,
      classCount: existing?.classCount ?? 5,
      colorRampId: existing?.colorRampId ?? 'BlueRed'
    })
    emitCommandStatus('已重做样式应用')
    return true
  },

  canUndoStyle(): boolean {
    return styleUndoStack.length > 0
  },

  canRedoStyle(): boolean {
    return styleRedoStack.length > 0
  },

  /** 测试用：清空样式撤销栈 */
  _resetStyleHistoryForTests(): void {
    styleUndoStack.length = 0
    styleRedoStack.length = 0
  }
}
