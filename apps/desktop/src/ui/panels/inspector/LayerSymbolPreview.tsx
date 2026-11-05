import { useFeaturesByDataset } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { useMemo } from 'react'
import { getLayerCartography } from '@desktop-webgis/project'
import type { SymbolPreset } from '@desktop-webgis/ol-style/symbol-library'
import { useProjectStore } from '@/project/project.store'
import { SymbolPreview } from './SymbolPreview'

export function LayerSymbolPreview({ layerId }: { layerId: string }) {
  const project = useProjectStore(state => state.project)
  const features = useFeaturesByDataset()
  const preset = useMemo<SymbolPreset | undefined>(() => {
    const layer = requireMapContent(project).layers.find(item => item.id === layerId)
    const fragment = getLayerCartography(project, layerId)
    if (!layer || !fragment) return undefined
    const geometry = features[layer.datasetId]?.[0]?.geometry.type ?? ''
    return { id: layerId, name: layer.name, category: geometry.includes('Line') ? 'line' : geometry.includes('Polygon') ? 'polygon' : 'point', tags: [], attribution: { source: '当前图层', license: '' }, layers: fragment.styleLayers, assets: requireMapContent(project).cartography?.assets ?? [] }
  }, [project, features, layerId])
  return preset ? <SymbolPreview preset={preset} /> : null
}
