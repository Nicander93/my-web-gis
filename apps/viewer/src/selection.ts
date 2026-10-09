import { createSelectionController, type FeatureRef, type SelectionTarget } from '@desktop-webgis/ol-selection'
import { getSceneFeatureId, type OlDocumentRuntime } from '@desktop-webgis/ol-scene-runtime'
import VectorLayer from 'ol/layer/Vector.js'

/** Viewer owns accepted selection; package interaction/highlight never modifies document content. */
export function createViewerSelection(runtime: OlDocumentRuntime): { refresh(): void; dispose(): void } {
  let accepted: FeatureRef[] = []
  function targets(): SelectionTarget[] {
    const document = runtime.getDocument()
    if (!document) return []
    return document.nodes.flatMap(node => {
      if (node.type !== 'vector' || !node.interaction?.selectable || node.locked) return []
      let parent = node.parentId
      while (parent) {
        const group = document.nodes.find(candidate => candidate.id === parent)
        if (!group || group.type !== 'group' || group.locked || !group.visible) return []
        parent = group.parentId
      }
      const layer = runtime.getLayer(node.id)
      return layer instanceof VectorLayer
        ? [{ layerKey: node.id, layer: layer as SelectionTarget['layer'] }] : []
    })
  }
  function allowedSelection(refs: FeatureRef[]): FeatureRef[] {
    const visible = new Set(targets().filter(target => target.layer.isVisible(runtime.getNativeMap().getView())).map(target => target.layerKey))
    const ids = new Map<string, Set<string | number | undefined>>()
    return refs.filter(ref => {
      if (!visible.has(ref.layerKey)) return false
      let values = ids.get(ref.layerKey)
      if (!values) { values = new Set(runtime.getFilteredFeatures(ref.layerKey).map(getSceneFeatureId)); ids.set(ref.layerKey, values) }
      return values.has(ref.featureId)
    })
  }
  const selection = createSelectionController({
    map: runtime.getNativeMap(), targets: targets(), boxSelection: false, getFeatureId: getSceneFeatureId,
    onSelectionRequest(request) {
      accepted = allowedSelection(request.selection)
      selection.setSelection(accepted)
    }
  })
  selection.setActive(true)
  return {
    refresh() {
      accepted = allowedSelection(accepted)
      selection.setTargets(targets())
      selection.setSelection(accepted)
    },
    dispose: () => selection.dispose()
  }
}
