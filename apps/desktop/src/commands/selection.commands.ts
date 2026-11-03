import { getFilteredFeatures } from '@/session/feature-query'
import { intersectSelectionIds, type SelectionState } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { useLayerViewStore } from '@/view-state/layer-view.store'

/** Selection uses the same effective filtered rows as tables and map interactions. */
export const selectionCommands = {
  setSelection(selection: SelectionState): void {
    const { layerId } = selection
    if (!layerId) { selectionCommands.clearSelection(); return }
    const filtered = getFilteredFeatures(layerId)
    const featureIds = intersectSelectionIds(selection.featureIds, filtered)
    useLayerViewStore.getState().setSelectionState({ layerId, featureIds })
  },
  toggleFeatureSelection(layerId: string, featureId: string, additive = true): void {
    const filtered = getFilteredFeatures(layerId)
    if (!filtered.some(feature => feature.id === featureId)) return
    const current = useLayerViewStore.getState().selection
    const existing = current.layerId === layerId ? current.featureIds : []
    const featureIds = existing.includes(featureId) ? existing.filter(id => id !== featureId)
      : additive ? [...existing, featureId] : [featureId]
    useLayerViewStore.getState().setSelectionState({ layerId, featureIds })
  },
  selectMatching(layerId: string): void {
    const features = getFilteredFeatures(layerId)
    useLayerViewStore.getState().setSelectionState({ layerId, featureIds: features.map(feature => feature.id) })
  },
  clearSelection(): void {
    useLayerViewStore.getState().setSelectionState({ layerId: null, featureIds: [] })
  }
}
