import { layerContentCommands } from '@/commands/layer-content.commands'
import { useProjectStore } from '@/project/project.store'
import type { GeoServerLoadWmsRequest } from './GeoServerPublishDialog'

/** 只把校验通过的发布结果装回发起它的那个项目会话。 */
export function addPublishedWmsLayer(request: GeoServerLoadWmsRequest): boolean {
  const state = useProjectStore.getState()
  if (state.projectEpoch !== request.epoch) return false
  layerContentCommands.addServiceLayer({ name: `${request.workspace}:${request.layerName}（已发布）`, kind: 'wms', source: {
    type: 'wms', url: `${request.baseUrl.replace(/\/$/, '')}/wms`, version: '1.1.1',
    layerNames: [`${request.workspace}:${request.layerName}`], styleNames: [`${request.workspace}:${request.styleName}`],
    format: 'image/png', transparent: true, crs: 'EPSG:4326', ...(request.bbox ? { bboxWgs84: request.bbox } : {}),
    authMode: request.credentialRef ? 'bearer' : 'none', ...(request.credentialRef ? { credentialRef: { key: request.credentialRef } } : {})
  } })
  return true
}
