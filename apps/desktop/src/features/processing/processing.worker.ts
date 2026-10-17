import type { GisFeature, ProcessingOptions } from '@desktop-webgis/gis-core'
import { executeProcessing } from './executeProcessing'
import { checkGeometries } from '@desktop-webgis/spatial-analysis'

self.onmessage = async (event: MessageEvent<{ features: GisFeature[]; options: ProcessingOptions; overlay?: GisFeature[]; kind?: 'check-geometry' }>) => {
  try {
    const { features, options, overlay, kind } = event.data
    const result = kind === 'check-geometry' ? checkGeometries(features)
      : options.tool === 'simplify' ? await (await import('./geolibre-processing')).simplifyFeatures(features, options)
      : executeProcessing(features, options, overlay)
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '空间处理失败。' })
  }
}
