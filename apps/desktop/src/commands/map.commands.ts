import { emitCommandStatus } from '@/platform/command-status'
import { useWorkbenchStore } from '@/view-state/workbench.store'
import { createId, requireMapContent, SetMapInitialViewCommand } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { projectEdits } from '@/session/project-edits'
import {
  clearMapSelection,
  getLiveMapState,
  isMapRuntimeMounted,
  isSelectionRuntimeMounted,
  setActiveEditTool,
  zoomMapBy,
  zoomMapToAll
} from '@/runtime/map-runtime-host'

/** 地图操作命令：接入 OlMapRuntime / OlSelectionRuntime 后驱动真实视图与选择。 */
export const mapCommands = {
  setInitialView(): void {
    const project = useProjectStore.getState().project
    if (project.content.kind !== 'map2d') return
    const view = getLiveMapState()
    if (!view) { emitCommandStatus('地图尚未就绪'); return }
    const applied = projectEdits.execute(new SetMapInitialViewCommand(createId('cmd'), requireMapContent(project).initialView, view))
    emitCommandStatus(applied ? '已设为二维初始视角，可撤销' : '当前视角与初始视角一致')
  },
  identify(): void {
    if (!setActiveEditTool('pan')) { emitCommandStatus('地图尚未就绪'); return }
    useWorkbenchStore.getState().setIdentifyActive(true)
    emitCommandStatus('点击要素查看信息')
  },
  pan(): void {
    if (setActiveEditTool('pan')) {
      emitCommandStatus('平移地图')
      return
    }
    emitCommandStatus('平移地图（地图运行时未挂载）')
  },
  zoomIn(): void {
    if (zoomMapBy(1)) {
      emitCommandStatus('放大地图')
      return
    }
    emitCommandStatus('放大地图（地图运行时未挂载）')
  },
  zoomOut(): void {
    if (zoomMapBy(-1)) {
      emitCommandStatus('缩小地图')
      return
    }
    emitCommandStatus('缩小地图（地图运行时未挂载）')
  },
  zoomToAll(): void {
    if (zoomMapToAll()) {
      emitCommandStatus('缩放至全图')
      return
    }
    emitCommandStatus('缩放至全图（地图运行时未挂载）')
  },
  locate(): void {
    emitCommandStatus('定位（定位服务待接入）')
  },
  select(): void {
    if (setActiveEditTool('select')) {
      emitCommandStatus('选择要素')
      return
    }
    emitCommandStatus('选择要素（选择运行时未挂载）')
  },
  clearSelection(): void {
    clearMapSelection()
    emitCommandStatus('已清除选择')
  }
}

export function mapRuntimeReady(): boolean {
  return isMapRuntimeMounted()
}

export function selectionRuntimeReady(): boolean {
  return isSelectionRuntimeMounted()
}
