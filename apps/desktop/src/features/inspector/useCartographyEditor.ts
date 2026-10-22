import { useEffect, useState } from 'react'
import { getEffectiveLocked, getLayerCartography, isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'
import { migrateLayerStyle } from '@desktop-webgis/ol-style/cartography-model'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { useProjectStore } from '@/stores/project.store'
import { beginStyleInteraction, finishStyleInteraction } from './style-interaction'

/** Restricts compatibility controls to fragments they can round trip exactly. */
export function useCartographyEditor(layerId: string) {
  const [error, setError] = useState<string | null>(null)
  const project = useProjectStore(state => state.project)
  const rows = useProjectStore(state => state.featuresByDataset)
  const layer = project.layers.find(layer => layer.id === layerId)
  const style = layer ? isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : layer.style : undefined
  const fragment = getLayerCartography(project, layerId)
  const expected = style && layer ? migrateLayerStyle(style, layerId, layer.datasetId) : undefined
  const sourceId = fragment?.binding.styleSourceId
  const expectedLayers = expected?.styleLayers.map(layer => 'source' in layer ? { ...layer, source: sourceId } : layer)
  const locked = getEffectiveLocked(project, layerId)
  const editable = !locked && Boolean(fragment && JSON.stringify(fragment.styleLayers) === JSON.stringify(expectedLayers))
  useEffect(() => () => finishStyleInteraction(layerId), [layerId])
  useEffect(() => setError(null), [layerId])

  function updateStyle(next: LayerStyle, property?: string) {
    const current = useProjectStore.getState().project
    if (!editable || getEffectiveLocked(current, layerId) || JSON.stringify(getLayerCartography(current, layerId)) !== JSON.stringify(fragment)) return
    try {
      useProjectStore.getState().setLayerStyle(layerId, next, property ? beginStyleInteraction(layerId, property) : undefined)
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  return { layer, style, fragment, editable, locked, error, features: layer ? rows[layer.datasetId] ?? [] : [], updateStyle,
    finish: () => finishStyleInteraction(layerId) }
}
