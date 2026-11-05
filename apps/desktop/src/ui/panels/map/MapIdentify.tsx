import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { useEffect } from 'react'
import Feature from 'ol/Feature'
import { getMapRuntime } from '@/engine-host/map-runtime-host'
import { useProjectStore } from '@/project/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useInformationStore } from '@/stores/information.store'

/** 用现有运行时识别可见且已加载的记录，不改变选择。 */
export function MapIdentify() {
  useEffect(() => {
    const runtime = getMapRuntime()
    if (!runtime) return
    const map = runtime.getMap()
    const identify = (event: { pixel: number[] }) => {
      if (!useWorkbenchStore.getState().identifyActive) return
      const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
      const results: Array<{ layerId: string; featureId: string }> = []
      const seen = new Set<string>()
      map.forEachFeatureAtPixel(event.pixel, (native, nativeLayer) => {
        if (!(native instanceof Feature)) return
        const entry = runtime.registry.entries().find(([, candidate]) => candidate === nativeLayer)
        if (!entry || !runtime.isLayerVisible(entry[0]) || !runtime.isFeatureIncluded(entry[0], native)) return
        const layer = requireMapContent(state.project).layers.find(item => item.id === entry[0])
        const featureId = String(native.get('domainFeatureId') ?? native.getId() ?? '')
        const key = `${entry[0]}:${featureId}`
        if (!layer || seen.has(key) || !stateFeatureData[layer.datasetId]?.some(feature => feature.id === featureId)) return
        seen.add(key)
        results.push({ layerId: layer.id, featureId })
      }, { hitTolerance: 6 })
      useInformationStore.getState().setResults(state.projectEpoch, results)
      useWorkbenchStore.getState().setRightTask('information')
      useWorkspaceStore.getState().setRightOpen(true)
    }
    map.on('singleclick', identify)
    return () => map.un('singleclick', identify)
  }, [])
  return null
}
