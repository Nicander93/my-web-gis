import type { GisFeature, ProcessingOptions } from '@desktop-webgis/gis-core'
import { executeProcessing } from './executeProcessing'
import { checkGeometries } from '@desktop-webgis/spatial-analysis'

self.onmessage = (event: MessageEvent<{ features: GisFeature[]; options: ProcessingOptions; overlay?: GisFeature[]; kind?: 'check-geometry' }>) => {
  try {
    self.postMessage({ result: event.data.kind === 'check-geometry' ? checkGeometries(event.data.features) : executeProcessing(event.data.features, event.data.options, event.data.overlay) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '空间处理失败。' })
  }
}
