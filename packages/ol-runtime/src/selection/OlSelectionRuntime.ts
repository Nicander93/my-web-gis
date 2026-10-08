import type { SelectionState } from '@desktop-webgis/gis-core'
import { createSelectionController, type SelectionController, type SelectionRequest } from '@desktop-webgis/ol-selection'
import { createSelectionStyle } from '../layer/style'
import type { OlMapRuntime } from '../map/OlMapRuntime'
import Feature from 'ol/Feature'

/** Adapts the independent controller to the workbench's single-layer selection state. */
export class OlSelectionRuntime {
  private controller: SelectionController
  private callback?: (state: SelectionState, request: SelectionRequest) => void
  private activeLayerId: string | null = null
  private targetLayer: ReturnType<OlMapRuntime['registry']['getVector']>

  constructor(private readonly mapRuntime: OlMapRuntime) {
    this.controller = createSelectionController({
      map: mapRuntime.getMap(), targets: [], style: createSelectionStyle(),
      getFeatureId: feature => feature.get('domainFeatureId') ?? feature.getId(),
      resolveSelectedFeature: ref => {
        const layer = mapRuntime.registry.getVector(ref.layerKey)
        const feature = layer?.isVisible(mapRuntime.getMap().getView()) ? layer.getSource()?.getFeatureById(ref.featureId) : undefined
        return feature instanceof Feature ? feature : undefined
      },
      onSelectionRequest: request => {
        this.callback?.({ layerId: this.activeLayerId, featureIds: request.selection.map(ref => String(ref.featureId)) }, request)
      }
    })
  }

  activate(layerId: string | null, callback: (state: SelectionState, request: SelectionRequest) => void): void {
    this.activeLayerId = layerId
    this.callback = callback
    this.setTarget(layerId)
    this.controller.setActive(true)
  }

  private setTarget(layerId: string | null): void {
    const layer = layerId ? this.mapRuntime.registry.getVector(layerId) : undefined
    if (layer === this.targetLayer && this.targetKey === layerId) return
    this.targetLayer = layer
    this.targetKey = layerId
    this.controller.setTargets(layer && layerId ? [{ layerKey: layerId, layer }] : [])
  }
  private targetKey: string | null = null

  deactivate(): void { this.controller.setActive(false) }
  cancelGesture(): boolean { return this.controller.cancelGesture() }
  dispose(): void { this.controller.dispose() }

  syncSelection(state: SelectionState): void {
    this.setTarget(this.activeLayerId ?? state.layerId)
    const layerId = state.layerId
    this.controller.setSelection(layerId ? state.featureIds.map(featureId => ({ layerKey: layerId, featureId })) : [])
  }

  clear(): void { this.controller.setSelection([]) }
}
