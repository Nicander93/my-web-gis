import type { GisFeature, ProcessingOptions } from '@desktop-webgis/gis-core'
import { executeProcessing } from './executeProcessing'

self.onmessage = (event: MessageEvent<{ features: GisFeature[]; options: ProcessingOptions; overlay?: GisFeature[] }>) => {
  try {
    self.postMessage({ result: executeProcessing(event.data.features, event.data.options, event.data.overlay) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '空间处理失败。' })
  }
}
