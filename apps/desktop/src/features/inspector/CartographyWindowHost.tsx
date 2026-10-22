import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { SldExportDialog } from './SldExportDialog'
import { GeoServerPublishDialog } from './GeoServerPublishDialog'
import { addPublishedWmsLayer } from './published-wms'

/** Context-menu publishing reuses the same dialogs and services as the style menu. */
export function CartographyWindowHost() {
  const request = useWorkbenchStore(state => state.cartographyDialog)
  const epoch = useProjectStore(state => state.projectEpoch)
  const exists = useProjectStore(state => state.project.layers.some(layer => layer.id === request?.layerId))
  if (!request || request.epoch !== epoch || !exists) return null
  function close() {
    if (useWorkbenchStore.getState().cartographyDialog === request) useWorkbenchStore.getState().setCartographyDialog(null)
  }
  const key = `${epoch}:${request.layerId}:${request.kind}`
  return request.kind === 'sld' ? <SldExportDialog key={key} layerId={request.layerId} onClose={close} />
    : <GeoServerPublishDialog key={key} layerId={request.layerId} onClose={close} onLoadWms={request => { if (addPublishedWmsLayer(request)) close() }} />
}
