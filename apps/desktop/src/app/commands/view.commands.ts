import { useWorkspaceStore } from '@/stores/workspace.store'
import { emitCommandStatus } from './status'

/** 视图命令直接操作 Workspace Store，供 Header、快捷键和菜单复用。 */
export const viewCommands = {
  toggleLayers(): void {
    const state = useWorkspaceStore.getState()
    const open = !state.left.open
    state.setLeftOpen(open)
    emitCommandStatus(open ? '图层面板已打开' : '图层面板已收起')
  },
  toggleInspector(): void {
    const state = useWorkspaceStore.getState()
    const open = !state.right.open
    state.setRightOpen(open)
    emitCommandStatus(open ? '检查器已打开' : '检查器已收起')
  },
  toggleAttributeTable(): void {
    const state = useWorkspaceStore.getState()
    const open = !state.bottom.open
    state.setBottomOpen(open)
    emitCommandStatus(open ? '属性表已打开' : '属性表已收起')
  },
  openAttributeTable(): void {
    useWorkspaceStore.getState().setBottomOpen(true)
    emitCommandStatus('属性表已打开')
  },
  resetLayout(): void {
    useWorkspaceStore.getState().resetLayout()
    emitCommandStatus('Workspace 布局已重置')
  }
}
