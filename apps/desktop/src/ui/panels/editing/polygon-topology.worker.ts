import { mergePolygonGeometries, splitPolygonGeometry } from '@desktop-webgis/spatial-analysis'
import type { PolygonGeometryRequest, PolygonGeometryResult } from './polygon-edit'

self.onmessage = (event: MessageEvent<PolygonGeometryRequest>) => {
  const input = event.data
  const progress = (done: number, total: number) => self.postMessage({ type: 'progress', done, total })
  try {
    let result: PolygonGeometryResult
    if (input.mode === 'merge') result = { mode: 'merge', geometry: mergePolygonGeometries(input.features.map((feature) => feature.geometry), progress) }
    else {
      if (!input.cutter) throw new Error('请选择或输入切割线')
      const parts: Record<string, ReturnType<typeof splitPolygonGeometry>> = Object.create(null)
      input.features.forEach((feature, index) => {
        parts[feature.id] = splitPolygonGeometry(feature.geometry, input.cutter!)
        progress(index + 1, input.features.length)
      })
      result = { mode: 'split', parts }
    }
    self.postMessage({ type: 'result', result })
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
