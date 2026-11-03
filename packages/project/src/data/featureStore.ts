import type { GisFeature } from './types'
import { cloneValue } from '../clone'

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
  private readonly rows = new Map<string, GisFeature[]>()
  private view: Record<string, GisFeature[]> | undefined
  private readonly listeners = new Set<() => void>()
  private readonly rollback: Array<() => void> = []
  private depth = 0
  private changed = false
  private dataRevision = 0

  get revision(): number { return this.dataRevision }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Shared immutable rows for current synchronous consumers; snapshot() is the detached export boundary. */
  readSnapshot = (): Record<string, GisFeature[]> => {
    if (!this.view) this.view = Object.freeze(Object.fromEntries([...this.byDataset].map(([id, features]) => {
      let rows = this.rows.get(id)
      if (!rows) { rows = Object.freeze([...features.values()]) as unknown as GisFeature[]; this.rows.set(id, rows) }
      return [id, rows]
    })))
    return this.view
  }

  /** Batch synchronous commands with rollback and a single successful data notification. */
  transaction<T>(action: () => T): T {
    const start = this.rollback.length, previousView = this.view, previousRows = new Map(this.rows), wasChanged = this.changed
    const datasetOrder = [...this.byDataset.keys()]
    this.depth++
    let result: T
    try { result = action() }
    catch (error) {
      for (let index = this.rollback.length - 1; index >= start; index--) this.rollback[index]()
      const restored = new Map(this.byDataset); this.byDataset.clear()
      for (const id of datasetOrder) { const dataset = restored.get(id); if (dataset) this.byDataset.set(id, dataset) }
      this.rollback.length = start
      this.view = previousView; this.rows.clear()
      for (const [id, rows] of previousRows) this.rows.set(id, rows)
      this.changed = wasChanged; this.depth--
      throw error
    }
    this.depth--
    if (!this.depth) { this.rollback.length = 0; this.publish() }
    return result
  }

  /** Replace the opened data session without retaining datasets from its previous owner. */
  replaceAll(snapshot: Record<string, GisFeature[]>): void {
    this.transaction(() => {
      for (const id of this.byDataset.keys()) if (!Object.hasOwn(snapshot, id)) this.clear(id)
      for (const [id, features] of Object.entries(snapshot)) this.setAll(id, features)
    })
  }

  /** Session cleanup needs identities without cloning every feature. */
  getDatasetIds(): string[] { return [...this.byDataset.keys()] }

  getAll(datasetId: string): GisFeature[] {
    return Array.from(this.byDataset.get(datasetId)?.values() ?? []).map((feature) => cloneValue(feature))
  }

  getById(datasetId: string, featureId: string): GisFeature | undefined {
    const feature = this.byDataset.get(datasetId)?.get(featureId)
    return feature ? cloneValue(feature) : undefined
  }

  setAll(datasetId: string, features: GisFeature[]): void {
    const map = new Map<string, GisFeature>()
    for (const feature of features) {
      map.set(feature.id, freezeFeature(feature))
    }
    const previous = this.byDataset.get(datasetId)
    if (this.depth) this.rollback.push(() => { if (previous) this.byDataset.set(datasetId, previous); else this.byDataset.delete(datasetId) })
    this.byDataset.set(datasetId, map)
    this.invalidate(datasetId)
  }

  add(datasetId: string, feature: GisFeature): void {
    this.writeFeature(datasetId, feature)
  }

  update(datasetId: string, feature: GisFeature): void {
    const map = this.byDataset.get(datasetId)
    if (!map?.has(feature.id)) {
      throw new Error(`Feature not found: ${feature.id}`)
    }
    this.writeFeature(datasetId, feature)
  }

  remove(datasetId: string, featureId: string): void {
    const map = this.byDataset.get(datasetId), before = map?.get(featureId)
    if (!map || !before) return
    if (this.depth) {
      const order = [...map.keys()]
      this.rollback.push(() => {
        const values = new Map(map); values.set(featureId, before); map.clear()
        for (const id of order) { const value = values.get(id); if (value) map.set(id, value) }
      })
    }
    map.delete(featureId)
    this.invalidate(datasetId)
  }

  clear(datasetId: string): void {
    const previous = this.byDataset.get(datasetId)
    if (!previous) return
    if (this.depth) this.rollback.push(() => { this.byDataset.set(datasetId, previous) })
    this.byDataset.delete(datasetId)
    this.invalidate(datasetId)
  }

  snapshot(): Record<string, GisFeature[]> {
    const snapshot: Record<string, GisFeature[]> = {}
    for (const [datasetId, features] of this.byDataset.entries()) {
      snapshot[datasetId] = Array.from(features.values()).map((feature) => cloneValue(feature))
    }
    return snapshot
  }

  private writeFeature(datasetId: string, feature: GisFeature): void {
    const next = freezeFeature(feature), previous = this.byDataset.get(datasetId), map = previous ?? new Map<string, GisFeature>()
    const before = map.get(feature.id)
    if (this.depth) this.rollback.push(() => {
      if (!previous) this.byDataset.delete(datasetId)
      else if (before) map.set(feature.id, before)
      else map.delete(feature.id)
    })
    map.set(feature.id, next); this.byDataset.set(datasetId, map)
    this.invalidate(datasetId)
  }

  private invalidate(datasetId: string): void {
    this.rows.delete(datasetId); this.view = undefined; this.changed = true
    if (!this.depth) this.publish()
  }

  private publish(): void {
    if (!this.changed) return
    this.changed = false; this.dataRevision++
    for (const listener of this.listeners) listener()
  }
}

function freezeFeature(feature: GisFeature): GisFeature {
  const copy = cloneValue(feature), seen = new WeakSet<object>()
  function freeze(value: unknown): void {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  freeze(copy)
  return copy
}
