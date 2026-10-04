import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, parseProjectSnapshot, processFeatures, serializeProjectSnapshot, type GisFeature, type ProcessingOptions } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { addProcessingResult, processingInput, runProcessing } from '@/services/processing'
import { processingCommands } from '@/app/commands/processing.commands'
import { executeProcessing } from '@/features/processing/executeProcessing'

const features: GisFeature[] = [1, 2, 3].map(value => ({ id: `f${value}`, geometry: { type: 'Point', coordinates: [116 + value / 10, 40] }, properties: { value } }))

describe('processing workflow', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    useProjectStore.getState()._resetProjectHistoryForTests()
    useProjectStore.setState({ project: createProject('处理测试'), featuresByDataset: {}, dirty: false, selectedLayerId: null, selection: { layerId: null, featureIds: [] } })
    useProjectStore.getState().addLayer('source', '站点', features, 'point')
    useProjectStore.setState({ dirty: false })
  })
  it('resolves all, filtered and selected input consistently', () => {
    const id = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setLayerFilter(id, [{ field: 'value', op: 'gte', value: 2 }])
    useProjectStore.getState().setSelection({ layerId: id, featureIds: ['f1', 'f3'] })
    expect(processingInput(id, 'all')).toHaveLength(3)
    expect(processingInput(id, 'filtered').map(f => f.id)).toEqual(['f2', 'f3'])
    expect(processingInput(id, 'selected').map(f => f.id)).toEqual(['f3'])
    expect(() => processingInput('missing', 'all')).toThrow('矢量')
  })
  it('commits an independent result that is included in project snapshots', () => {
    const state = useProjectStore.getState()
    const result = processFeatures(features, { tool: 'buffer', distance: 100, unit: 'meters' })
    const id = addProcessingResult(state.project.id, '站点缓冲区', result)
    const after = useProjectStore.getState()
    const layer = after.project.layers.find(l => l.id === id)!
    expect(layer.datasetId).not.toBe('source')
    expect(after.featuresByDataset[layer.datasetId]).toHaveLength(3)
    expect(after.dirty).toBe(true)
    expect(after.getSnapshot().featuresByDataset[layer.datasetId]).toHaveLength(3)
    result.features[0].properties.value = 99
    expect(after.featuresByDataset[layer.datasetId][0].properties.value).toBe(1)
    expect(after.featuresByDataset.source[0].geometry.type).toBe('Point')
  })
  it('rejects empty results and results from a project that has been replaced', () => {
    const state = useProjectStore.getState()
    const result = processFeatures(features, { tool: 'centroid' })
    expect(() => addProcessingResult('old-project', '结果', result)).toThrow('项目已切换')
    expect(() => addProcessingResult(state.project.id, '结果', { features: [], inputCount: 0 })).toThrow('为空')
    expect(useProjectStore.getState().project.layers).toHaveLength(1)
    expect(useProjectStore.getState().dirty).toBe(false)
  })
  it('already cancelled work never starts a worker or writes project state', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runProcessing(features, { tool: 'centroid' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  function fakeWorker() {
    class TestWorker {
      static current: TestWorker
      onmessage: ((event: { data: unknown }) => void) | null = null
      onerror: (() => void) | null = null
      payload!: { features: GisFeature[]; options: ProcessingOptions; overlay: GisFeature[] }
      terminated = false
      constructor() { TestWorker.current = this }
      postMessage(payload: typeof this.payload) { this.payload = structuredClone(payload) }
      terminate() { this.terminated = true }
    }
    vi.stubGlobal('Worker', TestWorker)
    return TestWorker
  }

  it('command commits worker output and processing provenance survives save/reopen', async () => {
    const workerClass = fakeWorker()
    const sourceId = useProjectStore.getState().selectedLayerId!
    const pending = processingCommands.run({ layerId: sourceId, scope: 'all', options: { tool: 'buffer', distance: 100, unit: 'meters' }, name: '缓冲结果', signal: new AbortController().signal })
    const worker = workerClass.current
    const result = executeProcessing(worker.payload.features, worker.payload.options)
    worker.onmessage!({ data: { result } })
    const completed = await pending
    expect(worker.terminated).toBe(true)
    const snapshot = parseProjectSnapshot(serializeProjectSnapshot(useProjectStore.getState().getSnapshot()))
    useProjectStore.getState().loadSnapshot(snapshot)
    const layer = snapshot.project.layers.find(l => l.id === completed.layerId)!
    const dataset = snapshot.project.datasets.find(d => d.id === layer.datasetId)!
    expect(dataset.kind === 'vector' && dataset.processing).toMatchObject({ sourceLayerId: sourceId, sourceLayerName: '站点', inputCount: 3, outputCount: 3, options: { tool: 'buffer', distance: 100, unit: 'meters' } })
    expect(useProjectStore.getState().featuresByDataset[layer.datasetId][0].geometry.type).toBe('Polygon')
  })

  it('cancellation terminates a running worker and never commits its late response', async () => {
    const workerClass = fakeWorker()
    const controller = new AbortController()
    const pending = processingCommands.run({ layerId: useProjectStore.getState().selectedLayerId!, scope: 'all', options: { tool: 'centroid' }, name: '结果', signal: controller.signal })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const lateResponse = workerClass.current.onmessage!
    controller.abort()
    const worker = workerClass.current
    expect(worker.terminated).toBe(true)
    lateResponse({ data: { result: processFeatures(features, { tool: 'centroid' }) } })
    await rejection
    expect(useProjectStore.getState().project.layers).toHaveLength(1)
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('worker failure leaves source data and project unchanged', async () => {
    const workerClass = fakeWorker()
    const pending = processingCommands.run({ layerId: useProjectStore.getState().selectedLayerId!, scope: 'all', options: { tool: 'centroid' }, name: '结果', signal: new AbortController().signal })
    workerClass.current.onmessage!({ data: { error: '要素 f2 无效' } })
    await expect(pending).rejects.toThrow('f2')
    expect(workerClass.current.terminated).toBe(true)
    expect(useProjectStore.getState().project.layers).toHaveLength(1)
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('a project switch while processing prevents result insertion', async () => {
    const workerClass = fakeWorker()
    const pending = processingCommands.run({ layerId: useProjectStore.getState().selectedLayerId!, scope: 'all', options: { tool: 'centroid' }, name: '结果', signal: new AbortController().signal })
    useProjectStore.getState().loadSnapshot({ project: createProject('另一个项目'), featuresByDataset: {} })
    workerClass.current.onmessage!({ data: { result: processFeatures(features, { tool: 'centroid' }) } })
    await expect(pending).rejects.toThrow('项目已切换')
    expect(useProjectStore.getState().project.layers).toHaveLength(0)
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('uses the second layer filter snapshot and persists both input descriptions', async () => {
    const polygon = (id: string, west: number): GisFeature => ({ id, properties: { keep: id === 'b1' }, geometry: { type: 'Polygon', coordinates: [[[west, 0], [west + 2, 0], [west + 2, 2], [west, 2], [west, 0]]] } })
    useProjectStore.getState().addLayer('area', '区域', [polygon('a', 0)], 'polygon')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().addLayer('masks', '掩膜', [polygon('b1', 1), polygon('b2', 10)], 'polygon')
    const overlayId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setLayerFilter(overlayId, [{ field: 'keep', op: 'eq', value: true }])
    const workerClass = fakeWorker()
    const pending = processingCommands.run({ layerId, scope: 'all', overlay: { layerId: overlayId, scope: 'filtered' }, options: { tool: 'clip' }, name: '裁剪结果', signal: new AbortController().signal })
    const worker = workerClass.current
    expect(worker.payload.overlay.map(f => f.id)).toEqual(['b1'])
    useProjectStore.getState().setLayerFilter(overlayId, [])
    expect(worker.payload.overlay).toHaveLength(1)
    worker.onmessage!({ data: { result: executeProcessing(worker.payload.features, worker.payload.options, worker.payload.overlay) } })
    const completed = await pending
    const snapshot = parseProjectSnapshot(serializeProjectSnapshot(useProjectStore.getState().getSnapshot()))
    const resultLayer = snapshot.project.layers.find(l => l.id === completed.layerId)!
    const dataset = snapshot.project.datasets.find(d => d.id === resultLayer.datasetId)!
    expect(dataset.kind === 'vector' && dataset.processing?.overlay).toEqual({ layerId: overlayId, layerName: '掩膜', scope: 'filtered', inputCount: 1 })
    expect(completed.outputCount).toBe(1)
  })

  it('empty overlay results do not create layers or mark the project dirty', async () => {
    const workerClass = fakeWorker()
    const id = useProjectStore.getState().selectedLayerId!
    const pending = processingCommands.run({ layerId: id, scope: 'all', overlay: { layerId: id, scope: 'all' }, options: { tool: 'intersect' }, name: '空结果', signal: new AbortController().signal })
    workerClass.current.onmessage!({ data: { result: { features: [], inputCount: 3, overlayCount: 3 } } })
    await expect(pending).rejects.toThrow('没有符合条件')
    expect(useProjectStore.getState().project.layers).toHaveLength(1)
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('location extraction captures selection and preserves geometry and provenance after reopen', async () => {
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setSelection({ layerId, featureIds: ['f2'] })
    useProjectStore.getState().addLayer('mask', '提取范围', [{ id: 'mask', properties: {}, geometry: { type: 'Polygon', coordinates: [[[116, 39], [117, 39], [117, 41], [116, 41], [116, 39]]] } }], 'polygon')
    const overlayId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setSelection({ layerId, featureIds: ['f2'] })
    const workerClass = fakeWorker()
    const pending = processingCommands.run({ layerId, scope: 'selected', overlay: { layerId: overlayId, scope: 'all' }, options: { tool: 'extract-location', predicate: 'within' }, name: '范围内站点', signal: new AbortController().signal })
    const worker = workerClass.current
    expect(worker.payload.features.map(f => f.id)).toEqual(['f2'])
    useProjectStore.getState().setSelection({ layerId, featureIds: ['f1'] })
    worker.onmessage!({ data: { result: executeProcessing(worker.payload.features, worker.payload.options, worker.payload.overlay) } })
    const completed = await pending
    const snapshot = parseProjectSnapshot(serializeProjectSnapshot(useProjectStore.getState().getSnapshot()))
    useProjectStore.getState().loadSnapshot(snapshot)
    const resultLayer = snapshot.project.layers.find(l => l.id === completed.layerId)!
    const dataset = snapshot.project.datasets.find(d => d.id === resultLayer.datasetId)!
    expect(dataset.kind === 'vector' && dataset.processing).toMatchObject({ scope: 'selected', inputCount: 1, outputCount: 1, options: { tool: 'extract-location', predicate: 'within' }, overlay: { layerId: overlayId, inputCount: 1 } })
    expect(snapshot.featuresByDataset[resultLayer.datasetId][0].geometry).toEqual(features[1].geometry)
    expect(snapshot.featuresByDataset.source).toEqual(features)
    expect(worker.terminated).toBe(true)
  })

  it('unmatched location extraction leaves the project unchanged', async () => {
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().addLayer('mask', '远处范围', [{ id: 'mask', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }], 'polygon')
    const overlayId = useProjectStore.getState().selectedLayerId!
    useProjectStore.setState({ dirty: false })
    const before = useProjectStore.getState().getSnapshot()
    const workerClass = fakeWorker()
    const pending = processingCommands.run({ layerId, scope: 'all', overlay: { layerId: overlayId, scope: 'all' }, options: { tool: 'extract-location', predicate: 'intersects' }, name: '空结果', signal: new AbortController().signal })
    const worker = workerClass.current
    worker.onmessage!({ data: { result: executeProcessing(worker.payload.features, worker.payload.options, worker.payload.overlay) } })
    await expect(pending).rejects.toThrow('没有符合空间关系')
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('missing or empty second input is rejected before starting work', async () => {
    const workerClass = fakeWorker()
    const args = { layerId: useProjectStore.getState().selectedLayerId!, scope: 'all' as const, options: { tool: 'clip' as const }, name: '结果', signal: new AbortController().signal }
    await expect(processingCommands.run(args)).rejects.toThrow('请选择第二输入')
    await expect(processingCommands.run({ ...args, overlay: { layerId: args.layerId, scope: 'selected' } })).rejects.toThrow('第二输入范围')
    expect(workerClass.current).toBeUndefined()
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('summary results preserve empty regions, provenance and a complete undo/redo step', async () => {
    const sourceLayer = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setSelection({ layerId: sourceLayer, featureIds: ['f2'] })
    const area: GisFeature = { id: 'area', properties: { code: 'a' }, geometry: { type: 'Polygon', coordinates: [[[116, 39], [117, 39], [117, 41], [116, 41], [116, 39]]] } }
    const empty: GisFeature = { id: 'empty', properties: { code: 'b' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }
    useProjectStore.getState().addLayer('areas', '行政区', [area, empty], 'polygon')
    const layerId = useProjectStore.getState().selectedLayerId!
    const before = useProjectStore.getState().getSnapshot()
    const workerClass = fakeWorker()
    const pending = processingCommands.run({ layerId, scope: 'all', overlay: { layerId: sourceLayer, scope: 'selected' }, options: { tool: 'summarize-location', predicate: 'intersects', field: 'value', prefix: 'stats_' }, name: '区域统计', signal: new AbortController().signal })
    const worker = workerClass.current
    worker.onmessage!({ data: { result: executeProcessing(worker.payload.features, worker.payload.options, worker.payload.overlay) } })
    const completed = await pending
    const snapshot = useProjectStore.getState().getSnapshot()
    const resultLayer = snapshot.project.layers.find(layer => layer.id === completed.layerId)!
    expect(snapshot.featuresByDataset[resultLayer.datasetId].map(row => [row.properties.stats_count, row.properties.stats_sum, row.properties.stats_mean])).toEqual([[1, 2, 2], [0, 0, null]])
    const reopened = parseProjectSnapshot(serializeProjectSnapshot(snapshot))
    const dataset = reopened.project.datasets.find(dataset => dataset.id === resultLayer.datasetId)!
    expect(dataset.kind === 'vector' && dataset.processing?.options).toEqual({ tool: 'summarize-location', predicate: 'intersects', field: 'value', prefix: 'stats_' })
    expect(useProjectStore.getState().undoEdit()).toBe(true)
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().selectedLayerId).toBe(layerId)
    expect(useProjectStore.getState().redoEdit()).toBe(true)
    expect(useProjectStore.getState().getSnapshot()).toEqual(snapshot)
    expect(useProjectStore.getState().selectedLayerId).toBe(completed.layerId)
  })

  it('attribute join captures second-input filters and saves independent result attributes', async () => {
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().addLayer('lookup', '业务表', features.map((feature, index) => ({ ...feature, id: `lookup${index}`, properties: { key: feature.properties.value, label: `站点${index}`, keep: index === 1 } })), 'point')
    const overlayId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setLayerFilter(overlayId, [{ field: 'keep', op: 'eq', value: true }])
    const workerClass = fakeWorker()
    const options = { tool: 'attribute-join' as const, inputKey: 'value', joinKey: 'key', fields: ['label'], prefix: 'business_', mode: 'left' as const }
    const pending = processingCommands.run({ layerId, scope: 'all', overlay: { layerId: overlayId, scope: 'filtered' }, options, name: '关联结果', signal: new AbortController().signal })
    const worker = workerClass.current
    worker.onmessage!({ data: { result: executeProcessing(worker.payload.features, worker.payload.options, worker.payload.overlay) } })
    const completed = await pending
    const snapshot = parseProjectSnapshot(serializeProjectSnapshot(useProjectStore.getState().getSnapshot()))
    const layer = snapshot.project.layers.find(layer => layer.id === completed.layerId)!
    expect(snapshot.featuresByDataset[layer.datasetId].map(feature => feature.properties.business_label)).toEqual([null, '站点1', null])
    expect(snapshot.featuresByDataset.source).toEqual(features)
    expect(snapshot.project.datasets.find(dataset => dataset.id === layer.datasetId)).toMatchObject({ processing: { options, overlay: { scope: 'filtered', inputCount: 1 } } })
  })

  it('line clipping uses selected inputs, preserves multipart results and supports undo/save', async () => {
    const road: GisFeature = { id: 'road', properties: { name: '道路', value: 7 }, geometry: { type: 'LineString', coordinates: [[-2, 5], [12, 5]] } }
    const area: GisFeature = { id: 'area', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]]] } }
    useProjectStore.getState().addLayer('roads', '道路', [road, { ...road, id: 'unselected' }], 'line')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().addLayer('areas', '范围', [area], 'polygon')
    const overlayId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setSelection({ layerId, featureIds: ['road'] })
    const before = useProjectStore.getState().getSnapshot()
    const workerClass = fakeWorker()
    const pending = processingCommands.run({ layerId, scope: 'selected', overlay: { layerId: overlayId, scope: 'all' }, options: { tool: 'clip-lines' }, name: '道路裁剪', signal: new AbortController().signal })
    const worker = workerClass.current
    worker.onmessage!({ data: { result: executeProcessing(worker.payload.features, worker.payload.options, worker.payload.overlay) } })
    const completed = await pending
    const snapshot = useProjectStore.getState().getSnapshot()
    const resultLayer = snapshot.project.layers.find(layer => layer.id === completed.layerId)!
    expect(snapshot.featuresByDataset[resultLayer.datasetId]).toHaveLength(1)
    expect(snapshot.featuresByDataset[resultLayer.datasetId][0]).toMatchObject({ geometry: { type: 'MultiLineString' }, properties: road.properties, metadata: { sourceId: 'road' } })
    const saved = parseProjectSnapshot(serializeProjectSnapshot(snapshot))
    expect(saved.project.datasets.find(dataset => dataset.id === resultLayer.datasetId)).toMatchObject({ processing: { options: { tool: 'clip-lines' }, scope: 'selected', inputCount: 1, outputCount: 1 } })
    expect(useProjectStore.getState().undoEdit()).toBe(true)
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().redoEdit()).toBe(true)
    expect(useProjectStore.getState().getSnapshot()).toEqual(snapshot)
  })

  it('empty line clipping reports no segments without changing project state', async () => {
    useProjectStore.getState().addLayer('roads', '道路', [{ id: 'outside', properties: {}, geometry: { type: 'LineString', coordinates: [[-2, -2], [-1, -1]] } }], 'line')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().addLayer('areas', '范围', [{ id: 'area', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } }], 'polygon')
    const overlayId = useProjectStore.getState().selectedLayerId!
    useProjectStore.setState({ dirty: false })
    const before = useProjectStore.getState().getSnapshot()
    const workerClass = fakeWorker()
    const pending = processingCommands.run({ layerId, scope: 'all', overlay: { layerId: overlayId, scope: 'all' }, options: { tool: 'clip-lines' }, name: '空裁剪', signal: new AbortController().signal })
    const worker = workerClass.current
    worker.onmessage!({ data: { result: executeProcessing(worker.payload.features, worker.payload.options, worker.payload.overlay) } })
    await expect(pending).rejects.toThrow('没有裁剪后的线段')
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('spatial join preserves pair provenance and multiple matches through save/reopen', async () => {
    const layerId = useProjectStore.getState().selectedLayerId!
    const area: GisFeature = { id: 'area', properties: { name: '区域' }, geometry: { type: 'Polygon', coordinates: [[[116, 39], [117, 39], [117, 41], [116, 41], [116, 39]]] } }
    useProjectStore.getState().addLayer('join-areas', '区域', [area, { ...area, id: 'area-2', properties: { name: '重叠区域' } }], 'polygon')
    const overlayId = useProjectStore.getState().selectedLayerId!
    const workerClass = fakeWorker()
    const options = { tool: 'spatial-join' as const, predicate: 'within' as const, fields: ['name'], prefix: 'region_', mode: 'inner' as const }
    const pending = processingCommands.run({ layerId, scope: 'all', overlay: { layerId: overlayId, scope: 'all' }, options, name: '点区连接', signal: new AbortController().signal })
    const worker = workerClass.current
    worker.onmessage!({ data: { result: executeProcessing(worker.payload.features, worker.payload.options, worker.payload.overlay) } })
    const completed = await pending
    const snapshot = parseProjectSnapshot(serializeProjectSnapshot(useProjectStore.getState().getSnapshot()))
    const layer = snapshot.project.layers.find(layer => layer.id === completed.layerId)!
    expect(snapshot.featuresByDataset[layer.datasetId]).toHaveLength(6)
    expect(snapshot.featuresByDataset[layer.datasetId].slice(0, 2).map(feature => feature.metadata?.overlaySourceId)).toEqual(['area', 'area-2'])
    expect(snapshot.project.datasets.find(dataset => dataset.id === layer.datasetId)).toMatchObject({ processing: { options, outputCount: 6 } })
  })
})
