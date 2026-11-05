import { useLayerViewStore } from '@/stores/layer-view.store'
import { requireMapContent } from '@desktop-webgis/project'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useDockingStore } from '@/stores/docking.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useProjectStore } from '@/project/project.store'
import { emitCommandStatus } from '@/platform/command-status'
import { getMapRuntime } from '@/engine-host/map-runtime-host'
import { projectedMapView } from '@/engine-host/map-projections'
import { projectConfiguration } from '@/project/project-configuration'
import { openActivityPanel } from '@/stores/activity-panel.store'

/** 视图命令直接操作 Workspace Store，供 Header、快捷键和菜单复用。 */
export const viewCommands = {
  toggleRightPanel(task: 'inspector' | 'information' | 'processing'): void {
    const workspace = useWorkspaceStore.getState()
    const workbench = useWorkbenchStore.getState()
    const open = !workspace.right.open || workbench.rightTask !== task
    if (task === 'inspector' && !workbench.inspectorLayerId) workbench.bindInspector(useLayerViewStore.getState().selectedLayerId)
    workbench.setRightTask(task)
    workspace.setRightOpen(open)
    if (open && typeof window !== 'undefined' && window.innerWidth < workspace.left.width + workspace.right.width + 300) workspace.setLeftOpen(false)
  },
  openTaskLog(): void { openActivityPanel('tasks') },
  openDiagnostics(): void { openActivityPanel('diagnostics') },
  setMapProjection(code: string): void {
    const runtime = getMapRuntime()
    const project = useProjectStore.getState().project
    if (project.content.kind !== 'map2d' || !runtime || code === project.content.crs) return
    if (useWorkbenchStore.getState().editLayerId) { emitCommandStatus('请先结束图层编辑再切换投影'); return }
    try {
      const content = project.content
      const { projection, center, zoom, rotation, type: _type, ...constraints } = projectedMapView(runtime.getMap().getView(), code, content.viewConstraints)
      runtime.getMap().getView().cancelAnimations()
      const next: typeof content = { ...content, crs: projection, initialView: { center, zoom, rotation }, viewConstraints: constraints }
      if (!Object.keys(constraints).length) delete next.viewConstraints
      projectConfiguration.apply({ ...project, content: next }, '切换地图投影')
      emitCommandStatus(`地图投影已切换为 ${code}`)
    } catch (error) { emitCommandStatus(error instanceof Error ? error.message : '地图投影切换失败') }
  },
  toggleLayers(): void {
    const state = useWorkspaceStore.getState()
    const open = !state.left.open
    state.setLeftOpen(open)
    emitCommandStatus(open ? '图层面板已打开' : '图层面板已收起')
  },
  toggleInspector(): void {
    const state = useWorkspaceStore.getState()
    const open = !state.right.open || useWorkbenchStore.getState().rightTask !== 'inspector'
    if (open && !useWorkbenchStore.getState().inspectorLayerId)
      useWorkbenchStore
        .getState()
        .bindInspector(useLayerViewStore.getState().selectedLayerId)
    if (open) useWorkbenchStore.getState().setRightTask('inspector')
    state.setRightOpen(open)
    emitCommandStatus(open ? '检查器已打开' : '检查器已收起')
  },
  toggleAttributeTable(): void {
    const state = useWorkspaceStore.getState()
    const open = !state.bottom.open
    if (open && !useWorkbenchStore.getState().tableLayerId)
      useWorkbenchStore
        .getState()
        .bindTable(useLayerViewStore.getState().selectedLayerId)
    if (open) openActivityPanel('attributes')
    else state.setBottomOpen(false)
    emitCommandStatus(open ? '属性表已打开' : '属性表已收起')
  },
  openAttributeTable(): void {
    if (!useWorkbenchStore.getState().tableLayerId)
      useWorkbenchStore
        .getState()
        .bindTable(useLayerViewStore.getState().selectedLayerId)
    openActivityPanel('attributes')
    emitCommandStatus('属性表已打开')
  },
  resetLayout(): void {
    useWorkspaceStore.getState().resetLayout()
    useDockingStore.getState().reset()
    emitCommandStatus('Workspace 布局已重置')
  },
  toggleFocusMode(): void {
    const state = useWorkspaceStore.getState()
    if (state.focusMode) {
      state.exitFocusMode()
      emitCommandStatus('已退出专注模式')
    } else {
      state.enterFocusMode()
      emitCommandStatus('已进入专注模式')
    }
  }
}
