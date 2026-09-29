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

export class OlToolRuntime {
  private interactions: RuntimeInteraction[] = []

  constructor(private readonly mapRuntime: OlMapRuntime) {}

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
    const map = this.mapRuntime.getMap()
    for (const interaction of this.interactions) {
      map.removeInteraction(interaction)
    }
    this.interactions = []
  }

  private activateDraw(tool: EditTool, source: VectorSource, callbacks: ToolCallbacks): void {
    const type = tool === 'draw-point' ? 'Point' : tool === 'draw-line' ? 'LineString' : 'Polygon'
    const draw = new Draw({ source, type })
    draw.on('drawend', (event) => {
      const datasetId = this.getActiveDatasetId(callbacks)
      if (!datasetId) return
      const feature = fromOlFeature(event.feature as Feature<Geometry>)
      feature.id = createId('feature')
      event.feature.setId(feature.id)
      event.feature.set('domainFeatureId', feature.id)
      const command = new AddFeatureCommand(createId('cmd'), datasetId, feature)
      callbacks.onAddFeature(datasetId, feature, command)
    })
    this.addInteractions(draw, new Snap({ source }))
  }

  private activateModify(source: VectorSource, callbacks: ToolCallbacks): void {
    const select = new Select({ style: createSelectionStyle() })
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

    this.addInteractions(select, modify, new Snap({ source }))
  }

  private activateDelete(source: VectorSource, callbacks: ToolCallbacks): void {
    const select = new Select({ style: createSelectionStyle() })
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
