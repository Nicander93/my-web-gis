import type { GisFeature } from './types'
import { cloneValue } from './clone'

export interface FeatureStore {
  getAll(datasetId: string): GisFeature[]
  getById(datasetId: string, featureId: string): GisFeature | undefined
  setAll(datasetId: string, features: GisFeature[]): void
  add(datasetId: string, feature: GisFeature): void
  update(datasetId: string, feature: GisFeature): void
  remove(datasetId: string, featureId: string): void
  clear(datasetId: string): void
  snapshot(): Record<string, GisFeature[]>
}

export class MemoryFeatureStore implements FeatureStore {
  private readonly byDataset = new Map<string, Map<string, GisFeature>>()

  getAll(datasetId: string): GisFeature[] {
    return Array.from(this.ensureDataset(datasetId).values()).map((feature) => cloneValue(feature))
  }

  getById(datasetId: string, featureId: string): GisFeature | undefined {
    const feature = this.ensureDataset(datasetId).get(featureId)
    return feature ? cloneValue(feature) : undefined
  }

  setAll(datasetId: string, features: GisFeature[]): void {
    const map = new Map<string, GisFeature>()
    for (const feature of features) {
      map.set(feature.id, cloneValue(feature))
    }
    this.byDataset.set(datasetId, map)
  }

  add(datasetId: string, feature: GisFeature): void {
    this.ensureDataset(datasetId).set(feature.id, cloneValue(feature))
  }

  update(datasetId: string, feature: GisFeature): void {
    const map = this.ensureDataset(datasetId)
    if (!map.has(feature.id)) {
      throw new Error(`Feature not found: ${feature.id}`)
    }
    map.set(feature.id, cloneValue(feature))
  }

  remove(datasetId: string, featureId: string): void {
    this.ensureDataset(datasetId).delete(featureId)
  }

  clear(datasetId: string): void {
    this.byDataset.delete(datasetId)
  }

  snapshot(): Record<string, GisFeature[]> {
    const snapshot: Record<string, GisFeature[]> = {}
    for (const [datasetId, features] of this.byDataset.entries()) {
      snapshot[datasetId] = Array.from(features.values()).map((feature) => cloneValue(feature))
    }
    return snapshot
  }

  private ensureDataset(datasetId: string): Map<string, GisFeature> {
    let map = this.byDataset.get(datasetId)
    if (!map) {
      map = new Map()
      this.byDataset.set(datasetId, map)
    }
    return map
  }
}
