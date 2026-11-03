import { featureData } from '@/data/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { useEffect } from 'react'
import Feature from 'ol/Feature'
import { getMapRuntime } from '@/runtime/map-runtime-host'
import { useProjectStore } from '@/session/project.store'
import { useWorkbenchStore } from '@/view-state/workbench.store'
import { useWorkspaceStore } from '@/view-state/workspace.store'
import { useInformationStore } from '@/view-state/information.store'

/** Identifies visible loaded records using the existing runtime, without changing selection. */
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
