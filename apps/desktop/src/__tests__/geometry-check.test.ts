import { featureData } from '@/data/feature-data'
import { useLayerViewStore } from '@/view-state/layer-view.store'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, expect, it, vi } from 'vitest'
import { createProject, createDefaultLayerStyle, type GisFeature } from '@desktop-webgis/project'
import { checkGeometries } from '@desktop-webgis/spatial-analysis'
import { useProjectStore } from '@/session/project.store'
import { checkLayerGeometry, selectGeometryIssues } from '@/commands/geometry-check.commands'
import { runProcessingWorker } from '@/commands/processing-run'
import { zoomMapToFeature } from '@/runtime/map-runtime-host'

vi.mock('@/runtime/map-runtime-host', () => ({ zoomMapToFeature: vi.fn(() => true) }))
vi.mock('@/commands/processing-run', async importOriginal => ({ ...await importOriginal<typeof import('@/commands/processing-run')>(), runProcessingWorker: vi.fn() }))
const features: GisFeature[] = [
  { id: 'bad', geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]]] }, properties: { amount: 1 } },
  { id: 'ok', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { amount: 2 } }
]

beforeEach(() => {
  vi.clearAllMocks()
  const project = createProject('diagnostics')
  requireMapContent(project).datasets = [{ id: 'dataset', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  requireMapContent(project).layers = [{ id: 'layer', name: 'Data', datasetId: 'dataset', visible: true, opacity: 1, editable: false, style: createDefaultLayerStyle('polygon'), filter: [] }]
  useProjectStore.setState({ project, dirty: false }); featureData.replaceAll({ dataset: structuredClone(features) }); useLayerViewStore.setState({ selection: { layerId: 'layer', featureIds: ['bad'] } })
  vi.mocked(runProcessingWorker).mockImplementation(async request => checkGeometries((request as { features: GisFeature[] }).features) as never)
})

it('checks a selection snapshot and leaves data, dirty state and history unchanged', async () => {
  const before = useProjectStore.getState(), beforeFeatureData = featureData.readSnapshot()
  const result = await checkLayerGeometry('layer', 'selected', new AbortController().signal)
  expect(result.report).toMatchObject({ checked: 1, invalid: 1, valid: 0 })
  expect(useProjectStore.getState().project).toBe(before.project)
  expect(featureData.readSnapshot()).toBe(beforeFeatureData)
  expect(useProjectStore.getState().dirty).toBe(false)
  selectGeometryIssues(result, result.report.issues[0])
  expect(zoomMapToFeature).toHaveBeenCalledWith('layer', 'bad', [2, 2])
  expect(useLayerViewStore.getState().selection.featureIds).toEqual(['bad'])
  expect(useProjectStore.getState().dirty).toBe(false)
})

it('rejects late reports after project or source data changes', async () => {
  vi.mocked(runProcessingWorker).mockImplementationOnce(async () => {
    useProjectStore.setState({ project: createProject('other') })
    return checkGeometries(features) as never
  })
  await expect(checkLayerGeometry('layer', 'all', new AbortController().signal)).rejects.toThrow('已变化')
})

it('does not select stale reports and checks cancellation after completion', async () => {
  const result = await checkLayerGeometry('layer', 'all', new AbortController().signal)
  featureData.replaceAll({ dataset: structuredClone(features) })
  expect(() => selectGeometryIssues(result)).toThrow('已变化')
  const controller = new AbortController()
  vi.mocked(runProcessingWorker).mockImplementationOnce(async () => { controller.abort(); return checkGeometries(features) as never })
  await expect(checkLayerGeometry('layer', 'all', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
