import type BaseLayer from 'ol/layer/Base'
import type VectorLayer from 'ol/layer/Vector'
import type VectorSource from 'ol/source/Vector'
import type { FeatureLike } from 'ol/Feature'

export type RuntimeVectorLayer = VectorLayer<VectorSource<FeatureLike>>
export type RuntimeMapLayer = BaseLayer

export class OlLayerRegistry {
  private readonly layers = new Map<string, RuntimeMapLayer>()
  private readonly datasetLayers = new Map<string, Set<string>>()
  private readonly layerDatasets = new Map<string, string>()

  register(layerId: string, datasetId: string, layer: RuntimeMapLayer): void {
    this.unregister(layerId)
    this.layers.set(layerId, layer)
    this.layerDatasets.set(layerId, datasetId)
    const ids = this.datasetLayers.get(datasetId) ?? new Set<string>()
    ids.add(layerId); this.datasetLayers.set(datasetId, ids)
  }

  unregister(layerId: string): void {
    this.layers.delete(layerId)
    const datasetId = this.layerDatasets.get(layerId)
    if (datasetId === undefined) return
    this.layerDatasets.delete(layerId)
    const ids = this.datasetLayers.get(datasetId)
    ids?.delete(layerId)
    if (!ids?.size) this.datasetLayers.delete(datasetId)
  }

  get(layerId: string): RuntimeMapLayer | undefined {
    return this.layers.get(layerId)
  }

  getVector(layerId: string): RuntimeVectorLayer | undefined {
    const layer = this.layers.get(layerId)
    if (!layer) return undefined
    // 矢量图层暴露 VectorSource；瓦片和影像图层不使用 FeatureLike 数据源。
    const source = (layer as RuntimeVectorLayer).getSource?.()
    if (source && typeof (source as VectorSource<FeatureLike>).getFeatures === 'function') {
      return layer as RuntimeVectorLayer
    }
    return undefined
  }

  getByDataset(datasetId: string): RuntimeMapLayer | undefined {
    const layerId = [...this.datasetLayers.get(datasetId) ?? []].at(-1)
    return layerId ? this.layers.get(layerId) : undefined
  }

  /** 一个资源可能有多个显示节点；查询它们时不能丢失各自的宿主身份。 */
  getAllByDataset(datasetId: string): RuntimeMapLayer[] {
    return [...this.datasetLayers.get(datasetId) ?? []].flatMap(id => this.layers.get(id) ?? [])
  }

  getDatasetIdForLayer(layerId: string): string | undefined {
    return this.layerDatasets.get(layerId)
  }

  entries(): Array<[string, RuntimeMapLayer]> {
    return Array.from(this.layers.entries())
  }

  clear(): void {
    this.layers.clear()
    this.datasetLayers.clear(); this.layerDatasets.clear()
  }
}
