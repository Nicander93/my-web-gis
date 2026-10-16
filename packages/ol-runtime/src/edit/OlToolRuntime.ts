import {
  AddFeatureCommand,
  DeleteFeatureCommand,
  UpdateGeometryCommand,
  UpdateGeometriesCommand,
  cloneValue,
  createId,
  type EditTool,
  type GisFeature
} from '@desktop-webgis/gis-core'
import Feature from 'ol/Feature'
import Collection from 'ol/Collection'
import { unByKey } from 'ol/Observable'
import type { EventsKey } from 'ol/events'
import Draw from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import Select from 'ol/interaction/Select'
import Snap from 'ol/interaction/Snap'
import type Geometry from 'ol/geom/Geometry'
import type VectorSource from 'ol/source/Vector'
import { fromOlFeature } from '../feature/featureAdapter'
import { createSelectionStyle } from '../layer/style'
import type { OlMapRuntime } from '../map/OlMapRuntime'

export interface ToolCallbacks {
  getActiveLayerId(): string | null
  getSelectedFeatureIds?(): string[]
  getFeatureGeometry?(datasetId: string, featureId: string): GisFeature['geometry'] | undefined
  validateGeometries?(datasetId: string, features: { id: string; geometry: GisFeature['geometry'] }[]): boolean
  onUpdateGeometries?(command: UpdateGeometriesCommand): boolean | void
  onAddFeature(datasetId: string, feature: GisFeature, command: AddFeatureCommand): boolean | void
  onDeleteFeatures(datasetId: string, features: GisFeature[], commands: DeleteFeatureCommand[]): void
  onUpdateGeometry(datasetId: string, featureId: string, before: GisFeature['geometry'], after: GisFeature['geometry'], command: UpdateGeometryCommand): void
  onSelectionChange(featureIds: string[]): void
}

type RuntimeInteraction = Draw | Modify | Select | Snap

export interface SnappingOptions {
  enabled: boolean
  vertex: boolean
  edge: boolean
  pixelTolerance: number
  scope: 'active' | 'visible'
}

export const DEFAULT_SNAPPING: SnappingOptions = { enabled: true, vertex: true, edge: true, pixelTolerance: 10, scope: 'active' }

export class OlToolRuntime {
  private interactions: RuntimeInteraction[] = []
  private snapping: SnappingOptions = { ...DEFAULT_SNAPPING }
  private snap: Snap | null = null
  private snapKeys: EventsKey[] = []
  private editSource: VectorSource | null = null
  private editLayerId: string | null = null
  private drawing = false
  private modifySelection: Select | null = null
  private modifyOriginals = new Map<Feature<Geometry>, Geometry>()
  private onSnapChange: (snapped: boolean) => void = () => undefined

  constructor(private readonly mapRuntime: OlMapRuntime) {}

  /** Refresh only capture targets; changing settings must not discard an unfinished drawing. */
  setSnapping(options: SnappingOptions, onChange?: (snapped: boolean) => void): void {
    const tolerance = Number.isFinite(options.pixelTolerance) ? options.pixelTolerance : DEFAULT_SNAPPING.pixelTolerance
    this.snapping = { ...options, pixelTolerance: Math.max(1, Math.min(30, tolerance)) }
    if (onChange) this.onSnapChange = onChange
    this.refreshSnapping()
  }

  refreshSnapping(): void {
    this.clearSnapping()
    if (!this.editSource || !this.snapping.enabled || (!this.snapping.vertex && !this.snapping.edge)) return
    const sources = this.snapping.scope === 'active' ? [this.editSource] : this.mapRuntime.registry.entries()
      .flatMap(([id]) => {
        const layer = this.mapRuntime.registry.getVector(id)
        return this.mapRuntime.isLayerVisible(id) && layer?.getSource() ? [layer.getSource() as VectorSource] : []
      })
    const targets = new Collection<Feature<Geometry>>()
    const refreshTargets = () => {
      targets.clear()
      const layers = this.mapRuntime.registry.entries().filter(([id]) => this.snapping.scope === 'visible' || id === this.editLayerId)
      targets.extend([...new Set(layers.flatMap(([id]) => {
        const layer = this.mapRuntime.registry.getVector(id)
        return this.mapRuntime.isLayerVisible(id) ? layer?.getSource()?.getFeatures().filter(feature => feature instanceof Feature && this.mapRuntime.isFeatureIncluded(id, feature)) as Feature<Geometry>[] ?? [] : []
      }))])
    }
    refreshTargets()
    for (const source of new Set(sources)) {
      this.snapKeys.push(...source.on(['addfeature', 'removefeature', 'changefeature', 'clear'], refreshTargets))
    }
    this.snap = new Snap({ features: targets, vertex: this.snapping.vertex, edge: this.snapping.edge, pixelTolerance: this.snapping.pixelTolerance })
    this.snapKeys.push(this.snap.on('snap', () => this.onSnapChange(true)), this.snap.on('unsnap', () => this.onSnapChange(false)))
    // OpenLayers handles interactions in reverse order: Snap must precede Draw/Modify handling.
    this.mapRuntime.getMap().addInteraction(this.snap)
  }

  private clearSnapping(): void {
    unByKey(this.snapKeys)
    this.snapKeys = []
    if (this.snap) this.mapRuntime.getMap().removeInteraction(this.snap)
    this.snap = null
    this.onSnapChange(false)
  }

  activate(tool: EditTool, callbacks: ToolCallbacks): void {
    this.deactivate()
    if (tool === 'none' || tool === 'pan' || tool === 'select') return

    const layerId = callbacks.getActiveLayerId()
    if (!layerId) return
    const layer = this.mapRuntime.registry.getVector(layerId)
    const source = layer?.getSource() as VectorSource | undefined
    if (!source) return
    this.editLayerId = layerId

    if (tool === 'draw-point' || tool === 'draw-line' || tool === 'draw-polygon') {
      this.activateDraw(tool, source, callbacks)
      return
    }

    if (tool === 'modify') {
      this.activateModify(source, callbacks)
      return
    }

    if (tool === 'delete') {
      this.activateDelete(source, callbacks)
    }
  }

  deactivate(): void {
    this.cancelModification()
    this.modifySelection = null
    this.drawing = false
    this.clearSnapping()
    this.editSource = null
    this.editLayerId = null
    const map = this.mapRuntime.getMap()
    for (const interaction of this.interactions) {
      map.removeInteraction(interaction)
    }
    this.interactions = []
  }

  private activateDraw(tool: EditTool, source: VectorSource, callbacks: ToolCallbacks): void {
    const type = tool === 'draw-point' ? 'Point' : tool === 'draw-line' ? 'LineString' : 'Polygon'
    // The host may reject invalid geometry; only accepted results enter the source.
    const draw = new Draw({ type })
    draw.on('drawstart', () => { this.drawing = true })
    draw.on('drawabort', () => { this.drawing = false })
    draw.on('drawend', (event) => {
      this.drawing = false
      const datasetId = this.getActiveDatasetId(callbacks)
      if (!datasetId) return
      const feature = fromOlFeature(event.feature as Feature<Geometry>, this.mapRuntime.getMap().getView().getProjection().getCode())
      feature.id = createId('feature')
      event.feature.setId(feature.id)
      event.feature.set('domainFeatureId', feature.id)
      if (callbacks.validateGeometries?.(datasetId, [feature]) === false) return
      const command = new AddFeatureCommand(createId('cmd'), datasetId, feature)
      if (callbacks.onAddFeature(datasetId, feature, command) === false) return
      if (!source.getFeatureById(feature.id)) source.addFeature(event.feature as Feature<Geometry>)
    })
    this.addInteractions(draw)
    this.editSource = source
    this.refreshSnapping()
  }

  /** Cancel only an in-flight sketch or vertex gesture, leaving committed history intact. */
  cancelSketch(): boolean {
    if (this.cancelModification()) return true
    if (!this.drawing) return false
    const draw = this.interactions.find((interaction): interaction is Draw => interaction instanceof Draw)
    draw?.abortDrawing()
    this.drawing = false
    return Boolean(draw)
  }

  private activateModify(source: VectorSource, callbacks: ToolCallbacks): void {
    const select = this.createEditSelection(callbacks)
    this.modifySelection = select
    this.syncSelection(callbacks.getSelectedFeatureIds?.() ?? [])
    const modify = new Modify({ features: select.getFeatures() })
    const beforeByFeature = new Map<string, GisFeature['geometry']>()

    select.on('select', () => {
      callbacks.onSelectionChange(
        select
          .getFeatures()
          .getArray()
          .map((feature) => feature.get('domainFeatureId') ?? feature.getId())
          .filter((id): id is string | number => id !== undefined)
          .map(String)
      )
    })

    modify.on('modifystart', (event) => {
      beforeByFeature.clear()
      this.modifyOriginals.clear()
      event.features.forEach((feature) => {
        const domainFeature = fromOlFeature(feature as Feature<Geometry>, this.mapRuntime.getMap().getView().getProjection().getCode())
        const datasetId = this.getActiveDatasetId(callbacks)
        beforeByFeature.set(domainFeature.id, cloneValue(datasetId ? callbacks.getFeatureGeometry?.(datasetId, domainFeature.id) ?? domainFeature.geometry : domainFeature.geometry))
        const geometry = feature.getGeometry()
        if (geometry) this.modifyOriginals.set(feature as Feature<Geometry>, geometry.clone())
      })
    })

    modify.on('modifyend', (event) => {
      if (!this.modifyOriginals.size) return
      const datasetId = this.getActiveDatasetId(callbacks)
      if (!datasetId) { this.cancelModification(); return }
      const changes: { featureId: string; before: GisFeature['geometry']; after: GisFeature['geometry'] }[] = []
      event.features.forEach((feature) => {
        const after = fromOlFeature(feature as Feature<Geometry>, this.mapRuntime.getMap().getView().getProjection().getCode())
        const before = beforeByFeature.get(after.id)
        const original = this.modifyOriginals.get(feature as Feature<Geometry>)
        const originalDomain = original ? fromOlFeature(new Feature(original), this.mapRuntime.getMap().getView().getProjection().getCode()).geometry : undefined
        if (!before || !originalDomain || JSON.stringify(originalDomain) === JSON.stringify(after.geometry)) return
        changes.push({ featureId: after.id, before, after: preserveUnchangedPositions(before, originalDomain, after.geometry) })
      })
      beforeByFeature.clear()
      try {
        if (changes.length && callbacks.validateGeometries?.(datasetId, changes.map(change => ({ id: change.featureId, geometry: change.after }))) === false) {
          this.cancelModification()
          return
        }
        if (changes.length && callbacks.onUpdateGeometries) {
          if (callbacks.onUpdateGeometries(new UpdateGeometriesCommand(createId('cmd'), datasetId, changes)) === false) this.cancelModification()
        }
        else for (const change of changes) callbacks.onUpdateGeometry(datasetId, change.featureId, change.before, change.after, new UpdateGeometryCommand(createId('cmd'), datasetId, change.featureId, change.before, change.after))
        this.modifyOriginals.clear()
      } catch (error) { this.cancelModification(); throw error }
    })

    this.addInteractions(select, modify)
    this.editSource = source
    this.refreshSnapping()
  }

  /** Rebind by stable IDs after a project refresh replaces native features. */
  syncSelection(ids: string[]): void {
    if (!this.modifySelection || this.modifyOriginals.size || !this.editLayerId) return
    const layerId = this.editLayerId
    const selected = new Set(ids)
    const features = this.mapRuntime.registry.getVector(layerId)?.getSource()?.getFeatures().filter(feature => feature instanceof Feature && selected.has(String(feature.get('domainFeatureId') ?? feature.getId())) && this.mapRuntime.isFeatureIncluded(layerId, feature)) as Feature<Geometry>[] ?? []
    const collection = this.modifySelection.getFeatures()
    if (collection.getLength() === features.length && features.every((feature, index) => collection.item(index) === feature)) return
    collection.clear(); collection.extend(features)
  }

  private cancelModification(): boolean {
    if (!this.modifyOriginals.size) return false
    const originals = [...this.modifyOriginals]
    this.modifyOriginals.clear()
    for (const [feature, geometry] of originals) feature.setGeometry(geometry.clone())
    return true
  }

  private activateDelete(source: VectorSource, callbacks: ToolCallbacks): void {
    const select = this.createEditSelection(callbacks)
    select.on('select', () => {
      const selected = select.getFeatures().getArray()
      if (selected.length === 0) return
      const datasetId = this.getActiveDatasetId(callbacks)
      if (!datasetId) return
      const features = selected.map((feature) => fromOlFeature(feature as Feature<Geometry>, this.mapRuntime.getMap().getView().getProjection().getCode()))
      const commands = features.map((feature) => new DeleteFeatureCommand(createId('cmd'), datasetId, feature))
      for (const feature of selected) source.removeFeature(feature as Feature<Geometry>)
      select.getFeatures().clear()
      callbacks.onDeleteFeatures(datasetId, features, commands)
    })
    this.addInteractions(select)
  }

  private addInteractions(...interactions: RuntimeInteraction[]): void {
    const map = this.mapRuntime.getMap()
    this.interactions = interactions
    for (const interaction of interactions) {
      map.addInteraction(interaction)
    }
  }

  private createEditSelection(callbacks: ToolCallbacks): Select {
    return new Select({ style: createSelectionStyle(),
      layers: layer => layer === this.mapRuntime.registry.getVector(callbacks.getActiveLayerId() ?? ''),
      filter: feature => feature instanceof Feature && this.mapRuntime.isFeatureIncluded(callbacks.getActiveLayerId() ?? '', feature)
    })
  }

  private getActiveDatasetId(callbacks: ToolCallbacks): string | null {
    const layerId = callbacks.getActiveLayerId()
    if (!layerId) return null
    return this.mapRuntime.registry.getDatasetIdForLayer(layerId) ?? null
  }
}

/** Keep untouched vertices exact instead of introducing projection round-trip noise. */
function preserveUnchangedPositions(before: GisFeature['geometry'], projectedBefore: GisFeature['geometry'], after: GisFeature['geometry']): GisFeature['geometry'] {
  const originals = new Map<string, number[]>()
  function remember(projected: unknown, original: unknown): void {
    if (!Array.isArray(projected) || !Array.isArray(original)) return
    if (typeof projected[0] === 'number') originals.set(JSON.stringify(projected), original)
    else projected.forEach((child, index) => remember(child, original[index]))
  }
  function restore(value: unknown): void {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number') {
      const original = originals.get(JSON.stringify(value))
      if (original) value.splice(0, value.length, ...original)
    } else value.forEach(restore)
  }
  remember(projectedBefore.coordinates, before.coordinates)
  const result = cloneValue(after)
  restore(result.coordinates)
  return result
}
