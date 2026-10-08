import {
  AddFeatureCommand,
  DeleteFeatureCommand,
  UpdateGeometryCommand,
  cloneValue,
  createId,
  type EditTool,
  type GisFeature
} from '@desktop-webgis/gis-core'
import type Feature from 'ol/Feature'
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
  onAddFeature(datasetId: string, feature: GisFeature, command: AddFeatureCommand): void
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
  private drawing = false
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
        return layer?.isVisible(this.mapRuntime.getMap().getView()) && layer.getSource() ? [layer.getSource() as VectorSource] : []
      })
    const targets = new Collection<Feature<Geometry>>()
    const refreshTargets = () => {
      targets.clear()
      targets.extend([...new Set(sources.flatMap(source => source.getFeatures()))])
    }
    refreshTargets()
    for (const source of new Set(sources)) {
      this.snapKeys.push(source.on('addfeature', event => {
        if (event.feature && !targets.getArray().includes(event.feature)) targets.push(event.feature)
      }), source.on('removefeature', event => {
        const feature = event.feature
        if (feature && !sources.some(item => item.hasFeature(feature))) targets.remove(feature)
      }), source.on('clear', refreshTargets))
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
    this.drawing = false
    this.clearSnapping()
    this.editSource = null
    const map = this.mapRuntime.getMap()
    for (const interaction of this.interactions) {
      map.removeInteraction(interaction)
    }
    this.interactions = []
  }

  private activateDraw(tool: EditTool, source: VectorSource, callbacks: ToolCallbacks): void {
    const type = tool === 'draw-point' ? 'Point' : tool === 'draw-line' ? 'LineString' : 'Polygon'
    const draw = new Draw({ source, type })
    draw.on('drawstart', () => { this.drawing = true })
    draw.on('drawabort', () => { this.drawing = false })
    draw.on('drawend', (event) => {
      this.drawing = false
      const datasetId = this.getActiveDatasetId(callbacks)
      if (!datasetId) return
      const feature = fromOlFeature(event.feature as Feature<Geometry>)
      feature.id = createId('feature')
      event.feature.setId(feature.id)
      event.feature.set('domainFeatureId', feature.id)
      const command = new AddFeatureCommand(createId('cmd'), datasetId, feature)
      callbacks.onAddFeature(datasetId, feature, command)
    })
    this.addInteractions(draw)
    this.editSource = source
    this.refreshSnapping()
  }

  /** 只取消未完成的绘制，不回滚已进入历史的修改。 */
  cancelSketch(): boolean {
    if (!this.drawing) return false
    const draw = this.interactions.find((interaction): interaction is Draw => interaction instanceof Draw)
    draw?.abortDrawing()
    this.drawing = false
    return Boolean(draw)
  }

  private activateModify(source: VectorSource, callbacks: ToolCallbacks): void {
    const select = new Select({ style: createSelectionStyle(), layers: layer => layer.getSource() === source })
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
      event.features.forEach((feature) => {
        const domainFeature = fromOlFeature(feature as Feature<Geometry>)
        beforeByFeature.set(domainFeature.id, cloneValue(domainFeature.geometry))
      })
    })

    modify.on('modifyend', (event) => {
      const datasetId = this.getActiveDatasetId(callbacks)
      if (!datasetId) return
      event.features.forEach((feature) => {
        const after = fromOlFeature(feature as Feature<Geometry>)
        const before = beforeByFeature.get(after.id)
        if (!before) return
        const command = new UpdateGeometryCommand(createId('cmd'), datasetId, after.id, before, after.geometry)
        callbacks.onUpdateGeometry(datasetId, after.id, before, after.geometry, command)
      })
      beforeByFeature.clear()
    })

    this.addInteractions(select, modify)
    this.editSource = source
    this.refreshSnapping()
  }

  private activateDelete(source: VectorSource, callbacks: ToolCallbacks): void {
    const select = new Select({ style: createSelectionStyle(), layers: layer => layer.getSource() === source })
    select.on('select', () => {
      const selected = select.getFeatures().getArray()
      if (selected.length === 0) return
      const datasetId = this.getActiveDatasetId(callbacks)
      if (!datasetId) return
      const features = selected.map((feature) => fromOlFeature(feature as Feature<Geometry>))
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

  private getActiveDatasetId(callbacks: ToolCallbacks): string | null {
    const layerId = callbacks.getActiveLayerId()
    if (!layerId) return null
    return this.mapRuntime.registry.getDatasetIdForLayer(layerId) ?? null
  }
}
