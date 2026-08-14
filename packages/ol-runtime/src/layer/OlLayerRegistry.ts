import type VectorLayer from 'ol/layer/Vector'
import type VectorSource from 'ol/source/Vector'
import type { FeatureLike } from 'ol/Feature'

export type RuntimeVectorLayer = VectorLayer<VectorSource<FeatureLike>>

export class OlLayerRegistry {
  private readonly layers = new Map<string, RuntimeVectorLayer>()
  private readonly datasetToLayer = new Map<string, string>()

  register(layerId: string, datasetId: string, layer: RuntimeVectorLayer): void {
    this.layers.set(layerId, layer)
    this.datasetToLayer.set(datasetId, layerId)
  }

  unregister(layerId: string): void {
    this.layers.delete(layerId)
    for (const [datasetId, registeredLayerId] of this.datasetToLayer.entries()) {
      if (registeredLayerId === layerId) this.datasetToLayer.delete(datasetId)
    }
  }

  get(layerId: string): RuntimeVectorLayer | undefined {
    return this.layers.get(layerId)
  }

  getByDataset(datasetId: string): RuntimeVectorLayer | undefined {
    const layerId = this.datasetToLayer.get(datasetId)
    return layerId ? this.layers.get(layerId) : undefined
  }

  getDatasetIdForLayer(layerId: string): string | undefined {
    for (const [datasetId, registeredLayerId] of this.datasetToLayer.entries()) {
      if (registeredLayerId === layerId) return datasetId
    }
    return undefined
  }

  entries(): Array<[string, RuntimeVectorLayer]> {
    return Array.from(this.layers.entries())
  }

  clear(): void {
    this.layers.clear()
    this.datasetToLayer.clear()
  }
}
