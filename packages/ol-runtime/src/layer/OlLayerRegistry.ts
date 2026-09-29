import type BaseLayer from 'ol/layer/Base'
import type VectorLayer from 'ol/layer/Vector'
import type VectorSource from 'ol/source/Vector'
import type { FeatureLike } from 'ol/Feature'

export type RuntimeVectorLayer = VectorLayer<VectorSource<FeatureLike>>
export type RuntimeMapLayer = BaseLayer

export class OlLayerRegistry {
  private readonly layers = new Map<string, RuntimeMapLayer>()
  private readonly datasetToLayer = new Map<string, string>()

  register(layerId: string, datasetId: string, layer: RuntimeMapLayer): void {
    this.layers.set(layerId, layer)
    this.datasetToLayer.set(datasetId, layerId)
  }

  unregister(layerId: string): void {
    this.layers.delete(layerId)
    for (const [datasetId, registeredLayerId] of this.datasetToLayer.entries()) {
      if (registeredLayerId === layerId) this.datasetToLayer.delete(datasetId)
    }
  }

  get(layerId: string): RuntimeMapLayer | undefined {
    return this.layers.get(layerId)
  }

  getVector(layerId: string): RuntimeVectorLayer | undefined {
    const layer = this.layers.get(layerId)
    if (!layer) return undefined
    // Vector layers expose a VectorSource; tile/image layers do not use FeatureLike sources.
    const source = (layer as RuntimeVectorLayer).getSource?.()
    if (source && typeof (source as VectorSource<FeatureLike>).getFeatures === 'function') {
      return layer as RuntimeVectorLayer
    }
    return undefined
  }

  getByDataset(datasetId: string): RuntimeMapLayer | undefined {
    const layerId = this.datasetToLayer.get(datasetId)
    return layerId ? this.layers.get(layerId) : undefined
  }

  getDatasetIdForLayer(layerId: string): string | undefined {
    for (const [datasetId, registeredLayerId] of this.datasetToLayer.entries()) {
      if (registeredLayerId === layerId) return datasetId
    }
    return undefined
  }

  entries(): Array<[string, RuntimeMapLayer]> {
    return Array.from(this.layers.entries())
  }

  clear(): void {
    this.layers.clear()
    this.datasetToLayer.clear()
  }
}
