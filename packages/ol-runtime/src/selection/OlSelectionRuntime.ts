import type { SelectionState } from '@desktop-webgis/gis-core'
import Select from 'ol/interaction/Select'
import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import { createSelectionStyle } from '../layer/style'
import type { OlMapRuntime } from '../map/OlMapRuntime'

export class OlSelectionRuntime {
  private select: Select | null = null
  private callback?: (state: SelectionState) => void
  private activeLayerId: string | null = null

  constructor(private readonly mapRuntime: OlMapRuntime) {}

  activate(activeLayerId: string | null, callback: (state: SelectionState) => void): void {
    this.deactivate()
    this.activeLayerId = activeLayerId
    this.callback = callback
    this.select = new Select({
      multi: true,
      style: createSelectionStyle(),
      filter: (feature, layer) => {
        if (!activeLayerId) return true
        return this.mapRuntime.registry.get(activeLayerId) === layer
      }
    })
    this.select.on('select', () => this.emitSelection())
    this.mapRuntime.getMap().addInteraction(this.select)
  }

  deactivate(): void {
    if (this.select) {
      this.mapRuntime.getMap().removeInteraction(this.select)
    }
    this.select = null
  }

  syncSelection(state: SelectionState): void {
    if (!this.select) return
    const collection = this.select.getFeatures()
    collection.clear()
    if (!state.layerId) return
    const layer = this.mapRuntime.registry.get(state.layerId)
    const source = layer?.getSource()
    for (const featureId of state.featureIds) {
      const feature = source?.getFeatureById(featureId)
      if (feature) collection.push(feature as Feature<Geometry>)
    }
  }

  clear(): void {
    this.select?.getFeatures().clear()
    this.callback?.({ layerId: this.activeLayerId, featureIds: [] })
  }

  private emitSelection(): void {
    if (!this.select || !this.callback) return
    const features = this.select.getFeatures()
    const featureIds = features
      .getArray()
      .map((feature) => feature as Feature<Geometry>)
      .map((feature) => feature.get('domainFeatureId') ?? feature.getId())
      .filter((id): id is string | number => id !== undefined)
      .map(String)
    this.callback({
      layerId: this.activeLayerId,
      featureIds
    })
  }
}
