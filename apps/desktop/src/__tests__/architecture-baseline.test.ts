import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { requireMapContent } from '@desktop-webgis/project'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLayerStyle, createProject, MemoryFeatureStore, UpdateGeometryCommand, type GisFeature } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { featureData } from '@/data/feature-data'
import { createProjectSceneDocument } from '@/exchange/project-scene-document'

afterEach(() => vi.restoreAllMocks())

/** Characterization probe: report legacy costs without making those costs a required behavior. */
describe('architecture refactor baseline', () => {
  it.each([100, 10_000])('measures configuration and single-feature operations with %i features', count => {
    const project = createProject('Baseline')
    requireMapContent(project).datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
    requireMapContent(project).layers = [{ id: 'layer', datasetId: 'data', name: 'Layer', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
    const features: GisFeature[] = Array.from({ length: count }, (_, index) => ({
      id: `f-${index}`, geometry: { type: 'Point', coordinates: [index / count, 0] }, properties: { value: index }
    }))
    projectSession.loadSnapshot({ project, featuresByDataset: { data: features } })
    const setAll = vi.spyOn(MemoryFeatureStore.prototype, 'setAll')
    const snapshot = vi.spyOn(MemoryFeatureStore.prototype, 'snapshot')
    let syncEligiblePublications = 0
    const unsubscribe = useProjectStore.subscribe((next, previous) => {
      if (next.project !== previous.project) syncEligiblePublications++
    })
    const unsubscribeData = featureData.subscribe(() => { syncEligiblePublications++ })
    function measure(operation: string, execute: () => void) {
      setAll.mockClear(); snapshot.mockClear(); syncEligiblePublications = 0
      const started = performance.now()
      execute()
      const elapsedMs = performance.now() - started
      const copiedIntoStore = setAll.mock.calls.reduce((sum, [, values]) => sum + values.length, 0)
      const copiedOutOfStore = snapshot.mock.results.reduce((sum, result) => result.type === 'return'
        ? sum + Object.values(result.value as Record<string, GisFeature[]>).reduce((total, values) => total + values.length, 0) : sum, 0)
      console.info(JSON.stringify({ operation, count, elapsedMs, copiedIntoStore, copiedOutOfStore, syncEligiblePublications }))
    }
    try {
      measure('visibility', () => layerConfigurationCommands.setLayerVisible('layer', false))
      expect(requireMapContent(useProjectStore.getState().project).layers[0].visible).toBe(false)
      const beforeStyle = requireMapContent(useProjectStore.getState().project).layers[0].style
      measure('style', () => layerConfigurationCommands.setLayerStyle('layer', {
        mode: 'single', symbol: { type: 'circle', radius: 9, fill: { r: 255, g: 0, b: 0, a: 1 } }
      }))
      expect(projectEdits.undo()).toBe(true)
      expect(requireMapContent(useProjectStore.getState().project).layers[0].style).toEqual(beforeStyle)
      const before = features[0].geometry
      const after = { type: 'Point' as const, coordinates: [2, 3] as [number, number] }
      measure('geometry', () => projectEdits.execute(new UpdateGeometryCommand('baseline', 'data', 'f-0', before, after)))
      const viewStarted = performance.now(), rows = featureData.readSnapshot().data
      console.info(JSON.stringify({ operation: 'data-view', count, elapsedMs: performance.now() - viewStarted, materializedRowReferences: rows.length }))
      expect(rows[0].geometry).toEqual(after)
      expect(features[0].geometry).toEqual(before)
      expect(projectEdits.undo()).toBe(true)
      expect(featureData.readSnapshot().data[0].geometry).toEqual(before)
      const started = performance.now()
      const document = createProjectSceneDocument(projectSession.getSnapshot())
      const resource = document.resources.data
      if (resource.type !== 'geojson' || !resource.data) throw new Error('Expected embedded GeoJSON')
      expect(resource.data.features).toHaveLength(count)
      console.info(JSON.stringify({ operation: 'scene-projection', count, elapsedMs: performance.now() - started, convertedFeatures: resource.data.features.length }))
    } finally { unsubscribe(); unsubscribeData() }
  })

  it('measures 100_000-feature configuration, overlay and session capture without scene projection', () => {
    const count = 100_000
    const project = createProject('Baseline100k')
    requireMapContent(project).datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
    requireMapContent(project).layers = [{ id: 'layer', datasetId: 'data', name: 'Layer', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
    const features: GisFeature[] = Array.from({ length: count }, (_, index) => ({
      id: `f-${index}`, geometry: { type: 'Point', coordinates: [index / count, 0] }, properties: { value: index }
    }))
    projectSession.loadSnapshot({ project, featuresByDataset: { data: features } })
    const setAll = vi.spyOn(MemoryFeatureStore.prototype, 'setAll')
    function measure(operation: string, execute: () => void) {
      setAll.mockClear()
      const started = performance.now()
      execute()
      console.info(JSON.stringify({
        operation, count, elapsedMs: performance.now() - started,
        copiedIntoStore: setAll.mock.calls.reduce((sum, [, values]) => sum + values.length, 0)
      }))
    }
    measure('visibility', () => layerConfigurationCommands.setLayerVisible('layer', false))
    expect(requireMapContent(useProjectStore.getState().project).layers[0].visible).toBe(false)
    measure('geometry', () => projectEdits.execute(new UpdateGeometryCommand('baseline', 'data', 'f-0', features[0].geometry, { type: 'Point', coordinates: [2, 3] })))
    expect(featureData.pendingCount('data')).toBe(1)
    measure('edit-state', () => { expect(featureData.getEditState().unsavedCount).toBe(1) })
    measure('capture-sessions', () => { expect(featureData.captureActiveSessions().data.pending).toBeDefined() })
    expect(features[0].geometry).toEqual({ type: 'Point', coordinates: [0, 0] })
  }, 60_000)

  it('records 1_000_000-feature overlay metadata cost without materializing a scene document', () => {
    const count = 1_000_000
    const project = createProject('Baseline1m')
    requireMapContent(project).datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
    requireMapContent(project).layers = [{ id: 'layer', datasetId: 'data', name: 'Layer', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
    const features: GisFeature[] = Array.from({ length: count }, (_, index) => ({
      id: `f-${index}`, geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: index }
    }))
    const loadStarted = performance.now()
    projectSession.loadSnapshot({ project, featuresByDataset: { data: features } })
    console.info(JSON.stringify({ operation: 'load-snapshot', count, elapsedMs: performance.now() - loadStarted }))
    const started = performance.now()
    layerConfigurationCommands.setLayerVisible('layer', false)
    expect(requireMapContent(useProjectStore.getState().project).layers[0].visible).toBe(false)
    expect(featureData.getEditState().pendingCount).toBe(0)
    console.info(JSON.stringify({ operation: 'visibility-and-edit-state', count, elapsedMs: performance.now() - started }))
  }, 180_000)
})
