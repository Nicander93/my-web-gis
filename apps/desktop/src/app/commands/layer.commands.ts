import { emitCommandStatus } from './status'
import { projectCommands } from './project.commands'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { cloneValue, isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'
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

/** 图层操作命令，供 Header 与后续 Layer Context Menu 复用。 */
export const layerCommands = {
  zoomToLayer(): void {
    emitCommandStatus('缩放到图层（地图运行时待接入）')
  },
  moveUp(): void {
    emitCommandStatus('图层上移（图层服务待接入）')
  },
  moveDown(): void {
    emitCommandStatus('图层下移（图层服务待接入）')
  },
  remove(): void {
    emitCommandStatus('移除图层（图层服务待接入）')
  },
  editStyle(): void {
    const layerId = useProjectStore.getState().selectedLayerId
    if (!layerId) {
      emitCommandStatus('请先选择图层')
      return
    }
    useWorkspaceStore.getState().setRightOpen(true)
    useSessionStore.getState().setInspectorTab(layerId, 'style')
    emitCommandStatus('已打开样式面板')
  },
  openAttributeTable(): void {
    useWorkspaceStore.getState().setBottomOpen(true)
    emitCommandStatus('属性表已打开')
  },
  export(): void {
    projectCommands.exportData(useProjectStore.getState().selectedLayerId)
  },

  /** Open export dialog pre-focused on copy-friendly scopes (same dialog). */
  copyToLocalLayer(): void {
    projectCommands.exportData(useProjectStore.getState().selectedLayerId)
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

  /** 重置草稿为当前已应用配置 */
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
