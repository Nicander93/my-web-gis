import { useProjectStore } from '@/stores/project.store'
import type { GeoServerLoadWmsRequest } from './GeoServerPublishDialog'

/** Installs the verified publication result only into the originating project session. */
export function addPublishedWmsLayer(request: GeoServerLoadWmsRequest): boolean {
  const state = useProjectStore.getState()
  if (state.projectEpoch !== request.epoch) return false
  state.addServiceLayer({ name: `${request.workspace}:${request.layerName}（已发布）`, kind: 'wms', source: {
    type: 'wms', url: `${request.baseUrl.replace(/\/$/, '')}/wms`, version: '1.1.1',
    layerNames: [`${request.workspace}:${request.layerName}`], styleNames: [`${request.workspace}:${request.styleName}`],
    format: 'image/png', transparent: true, crs: 'EPSG:4326', ...(request.bbox ? { bboxWgs84: request.bbox } : {}),
    authMode: request.credentialRef ? 'bearer' : 'none', ...(request.credentialRef ? { credentialRef: { key: request.credentialRef } } : {})
  } })
  return true
}
