import { emitCommandStatus } from './status'

/** 地图操作命令先提供 UI 入口，具体运行时将在 GIS 回接阶段注入。 */
export const mapCommands = {
  pan(): void {
    emitCommandStatus('平移地图')
  },
  zoomIn(): void {
    emitCommandStatus('放大地图')
  },
  zoomOut(): void {
    emitCommandStatus('缩小地图')
  },
  zoomToAll(): void {
    emitCommandStatus('缩放至全图（地图运行时待接入）')
  },
  locate(): void {
    emitCommandStatus('定位（定位服务待接入）')
  },
  select(): void {
    emitCommandStatus('选择要素（选择服务待接入）')
  },
  clearSelection(): void {
    emitCommandStatus('已清除选择')
  }
}
