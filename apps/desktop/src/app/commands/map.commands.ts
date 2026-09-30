import { emitCommandStatus } from './status'
import {
  isMapRuntimeMounted,
  zoomMapBy,
  zoomMapToAll
} from '@/features/map/map-runtime-host'
import { useProjectStore } from '@/stores/project.store'

/** 地图操作命令：接入 OlMapRuntime 后驱动真实视图。 */
export const mapCommands = {
  pan(): void {
    emitCommandStatus('平移地图')
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
    emitCommandStatus('选择要素（选择服务待接入）')
  },
  clearSelection(): void {
    useProjectStore.getState().clearSelection()
    emitCommandStatus('已清除选择')
  }
}

export function mapRuntimeReady(): boolean {
  return isMapRuntimeMounted()
}
