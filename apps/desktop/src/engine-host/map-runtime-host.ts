import { projectSession } from '@/project/project-session'
import { getFilteredFeatures, getLayerFeatures } from '@/project/feature-query'
import { projectEdits } from '@/project/project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { intersectSelectionIds, requireMapContent } from '@desktop-webgis/project'
import { openActivityPanel } from '@/stores/activity-panel.store'
import type {
  BasemapConfig,
  EditCommand,
  EditTool,
  MapState,
  Layer,
  SelectionState
} from '@desktop-webgis/project'
import { capabilitiesForDataset, getEffectiveLocked, isDatasetLocked, getEffectiveVisible, isLegacyStyle } from '@desktop-webgis/project'
import {
  OlMapRuntime,
  OlSelectionRuntime,
  OlToolRuntime,
  type ToolCallbacks
} from '@desktop-webgis/ol-runtime'
import { transform, transformExtent } from 'ol/proj'
import type { StyleFunction } from 'ol/style/Style'
import { getSessionCredential } from '@/platform/credentials'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useSnappingStore } from '@/stores/snapping.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { createProjectSceneDocument } from '@/io/project-scene-document'
import { configureMapServiceLayer } from './map-service-requests'
import { registerMapProjections } from './map-projections'
import { assertValidGeometryEdits } from './geometry-edit-validation'

registerMapProjections()

function applyMapSelection(selection: SelectionState): void {
  const { layerId } = selection
  if (!layerId) {
    useLayerViewStore.getState().setSelectionState({ layerId: null, featureIds: [] })
    return
  }
  const featureIds = intersectSelectionIds(selection.featureIds, getFilteredFeatures(layerId))
  useLayerViewStore.getState().setSelectionState({ layerId, featureIds })
}

function clearMapStoreSelection(): void {
  useLayerViewStore.getState().setSelectionState({ layerId: null, featureIds: [] })
}

// 二维地图运行时单例状态（OpenLayers 地图、选择交互、几何绘制/编辑工具）
let runtime: OlMapRuntime | null = null
let selectionRuntime: OlSelectionRuntime | null = null
let toolRuntime: OlToolRuntime | null = null
let mounted = false
let selectionMounted = false
let toolMounted = false
let activeTool: EditTool = 'none'
let moveEndKey: (() => void) | null = null
let storeUnsub: (() => void) | null = null
let sessionUnsub: (() => void) | null = null
let snappingUnsub: (() => void) | null = null
/** 防止地图的选择和 Store 里的选择相互触发，形成死循环。 */
let applyingStoreSelection = false
let viewOwner: { epoch: number; id: string; preset: string } | null = null
const propertyPreviews = new Map<string, { owner: object; epoch: number; base: string; draft: Layer; native: object | undefined; originalStyle: StyleFunction | undefined }>()

function refreshPropertyPreviews(): void {
  const state = useProjectStore.getState()
  for (const [id, preview] of propertyPreviews) {
    const current = requireMapContent(state.project).layers.find(layer => layer.id === id)
    const valid = preview.epoch === state.projectEpoch && current && JSON.stringify(current) === preview.base && !getEffectiveLocked(state.project, id)
    if (!valid) propertyPreviews.delete(id)
    const layer = valid ? preview.draft : current
    if (!layer) continue
    const project = { ...state.project, content: { ...requireMapContent(state.project), layers: requireMapContent(state.project).layers.map(item => item.id === id ? layer : item) } }
    const styleChanged = valid && JSON.stringify(layer.style) !== JSON.stringify(current.style)
    const native = runtime?.registry.getVector(id)
    if (!styleChanged && native === preview.native) native?.setStyle(preview.originalStyle)
    runtime?.previewLayer({ ...layer, visible: getEffectiveVisible(project, id) }, { style: styleChanged })
  }
}

/** 属于单个属性窗口和某一次项目修订的临时预览，可以随时丢弃。 */
export function createMapPropertyPreview(base: Layer, epoch: number) {
  const owner = {}, id = base.id
  const native = runtime?.registry.getVector(id), originalStyle = native?.getStyleFunction()
  return {
    update(draft: Layer): boolean {
      const state = useProjectStore.getState(), current = requireMapContent(state.project).layers.find(layer => layer.id === id)
      if (!mounted || !runtime || epoch !== state.projectEpoch || !current || JSON.stringify(current) !== JSON.stringify(base) || getEffectiveLocked(state.project, id)) return false
      if (draft.id !== id || draft.datasetId !== base.datasetId || !Number.isFinite(draft.opacity) || draft.opacity < 0 || draft.opacity > 1 || (draft.minZoom ?? -Infinity) > (draft.maxZoom ?? Infinity)) return false
      propertyPreviews.set(id, { owner, epoch, base: JSON.stringify(base), draft: structuredClone(draft), native, originalStyle })
      refreshPropertyPreviews()
      return true
    },
    dispose(): void {
      if (propertyPreviews.get(id)?.owner !== owner) return
      propertyPreviews.delete(id)
      const state = useProjectStore.getState(), current = requireMapContent(state.project).layers.find(layer => layer.id === id)
      if (mounted && epoch === state.projectEpoch && current) {
        if (runtime?.registry.getVector(id) === native) native?.setStyle(originalStyle)
        runtime?.previewLayer({ ...current, visible: getEffectiveVisible(state.project, id) }, { style: false })
      }
    }
  }
}

export function getMapRuntime(): OlMapRuntime | null {
  return runtime
}

export function getSelectionRuntime(): OlSelectionRuntime | null {
  return selectionRuntime
}

export function getToolRuntime(): OlToolRuntime | null {
  return toolRuntime
}

export function isMapRuntimeMounted(): boolean {
  return mounted && runtime !== null
}

export function isSelectionRuntimeMounted(): boolean {
  return selectionMounted && selectionRuntime !== null && isMapRuntimeMounted()
}

export function isToolRuntimeMounted(): boolean {
  return toolMounted && toolRuntime !== null && isMapRuntimeMounted()
}

export function getActiveEditTool(): EditTool {
  return activeTool
}

/** Esc 先取消正在进行的草图或顶点手势，编辑目标保持不变。 */
export function cancelMapOperation(): boolean {
  if (selectionRuntime?.cancelGesture()) return true
  if (toolRuntime?.cancelSketch()) {
    if (activeTool === 'modify') setActiveEditTool('modify')
    return true
  }
  return setActiveEditTool('pan')
}

export function getLiveMapState(): MapState | null {
  if (!isMapRuntimeMounted() || !runtime) return null
  const state = useProjectStore.getState()
  if (!viewOwner || viewOwner.epoch !== state.projectEpoch || viewOwner.id !== state.project.metadata.id || viewOwner.preset !== JSON.stringify(requireMapContent(state.project).initialView)) return null
  return runtime.getMapState()
}

export function mountMapRuntime(
  target: HTMLElement,
  mapState: MapState
): OlMapRuntime {
  if (runtime && mounted) {
    unmountMapRuntime()
  }

  runtime = new OlMapRuntime()
  runtime.mount(target, mapState)
  const owner = useProjectStore.getState()
  viewOwner = { epoch: owner.projectEpoch, id: owner.project.metadata.id, preset: JSON.stringify(mapState) }
  selectionRuntime = new OlSelectionRuntime(runtime)
  toolRuntime = new OlToolRuntime(runtime)
  toolRuntime.setSnapping(useSnappingStore.getState().options, (snapped) =>
    useSnappingStore.getState().setSnapped(snapped)
  )
  snappingUnsub = useSnappingStore.subscribe((state, previous) => {
    if (state.options !== previous.options)
      toolRuntime?.setSnapping(state.options)
  })
  mounted = true
  selectionMounted = true
  toolMounted = true
  activeTool = 'none'

  const map = runtime.getMap()
  const onMoveEnd = (): void => {
    syncSessionViewExtent()
    toolRuntime?.refreshSnapping()
  }
  map.on('moveend', onMoveEnd)
  moveEndKey = () => map.un('moveend', onMoveEnd)

  storeUnsub?.()
  storeUnsub = useProjectStore.subscribe((state, previous) => {
    if (!isMapRuntimeMounted() || state.project.content.kind !== 'map2d') return

    const target = useWorkbenchStore.getState().editLayerId
    if (
      state.project.metadata.id !== previous.project.metadata.id ||
      ((isDrawTool(activeTool) ||
        activeTool === 'modify' ||
        activeTool === 'delete') &&
        (!target || !requireMapContent(state.project).layers.some((layer) => layer.id === target)))
    ) {
      useWorkbenchStore.getState().setEditLayer(null)
      setActiveEditTool('select')
    }

  })
  sessionUnsub?.()
  sessionUnsub = useLayerViewStore.subscribe((state, previous) => {
    if (!isMapRuntimeMounted() || useProjectStore.getState().project.content.kind !== 'map2d') return
    if (state.selection !== previous.selection) {
      syncSelectionHighlight(state.selection)
    }

    if (
      state.selectedLayerId !== previous.selectedLayerId &&
      activeTool === 'select'
    ) {
      // 浏览只重绑选择工具；几何编辑保持锁定目标。
      setActiveEditTool(activeTool)
    }
  })

  syncSessionViewExtent()
  // 默认的交互模式是选择，对应场景 E 的路径。
  setActiveEditTool('select')
  return runtime
}

export function unmountMapRuntime(): void {
  propertyPreviews.clear()
  viewOwner = null
  snappingUnsub?.()
  snappingUnsub = null
  storeUnsub?.()
  storeUnsub = null
  sessionUnsub?.()
  sessionUnsub = null
  moveEndKey?.()
  moveEndKey = null
  selectionRuntime?.dispose()
  toolRuntime?.deactivate()
  selectionRuntime = null
  toolRuntime = null
  selectionMounted = false
  toolMounted = false
  activeTool = 'none'
  useWorkbenchStore.getState().setEditLayer(null)
  useWorkbenchStore.getState().setActiveTool('none')
  runtime?.unmount()
  runtime = null
  mounted = false
}

/** 把项目 store 里的图层、视图和底图同步到已挂载的运行时。 */
export function syncMapFromProject(): void {
  if (!runtime || !mounted) return

  const state = useProjectStore.getState()
  const { project } = state, featuresByDataset = featureData.readSnapshot()
  if (project.content.kind !== 'map2d') return

  const current = runtime
  const target = useWorkbenchStore.getState().editLayerId
  const targetLayer = requireMapContent(project).layers.find(layer => layer.id === target)
  if (targetLayer && isDatasetLocked(project, targetLayer.datasetId)) {
    toolRuntime?.deactivate()
    useWorkbenchStore.getState().setEditLayer(null)
    setActiveEditTool('select')
  }
  const previousSource = target ? current.registry.getVector(target)?.getSource() : undefined
  void current.syncDocument(createProjectSceneDocument(projectSession.getSnapshot()), featuresByDataset, {
    credentials: collectBasemapCredentials(requireMapContent(project).basemap), configureServiceLayer: (layer, resource) => configureMapServiceLayer(layer, resource)
  }).then(applied => {
    if (!applied || runtime !== current) return
    refreshPropertyPreviews()
    viewOwner = { epoch: state.projectEpoch, id: state.project.metadata.id, preset: JSON.stringify(requireMapContent(state.project).initialView) }
    const nextSource = target ? current.registry.getVector(target)?.getSource() : undefined
    if (previousSource !== nextSource && activeTool !== 'select') setActiveEditTool(activeTool)
    toolRuntime?.refreshSnapping()
    syncSessionViewExtent()
    syncSelectionHighlight(useLayerViewStore.getState().selection)
  }).catch(() => {
    if (runtime !== current) return
    window.dispatchEvent(new CustomEvent('desktop-webgis:command-status', { detail: '地图资源加载失败，已显示的内容保留。' }))
  })
}

export function zoomMapBy(delta: number): boolean {
  if (!runtime || !mounted) return false
  const view = runtime.getMap().getView()
  const zoom = view.getZoom()
  if (zoom == null) return false
  view.animate({ zoom: zoom + delta, duration: 150 })
  return true
}

export function zoomMapToAll(): boolean {
  if (!runtime || !mounted) return false
  runtime.zoomToAll()
  return true
}

export function zoomMapToLayer(layerId: string): boolean {
  if (!runtime || !mounted) return false
  runtime.zoomToLayer(layerId)
  return true
}

/** 定位到诊断坐标，或它来源要素的有效范围。 */
export function zoomMapToFeature(
  layerId: string,
  featureId: string,
  location: [number, number] | null
): boolean {
  if (!runtime || !mounted) return false
  const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
  const layer = requireMapContent(state.project).layers.find((item) => item.id === layerId)
  const feature =
    layer &&
    stateFeatureData[layer.datasetId]?.find(
      (item) => item.id === featureId
    )
  if (!feature) return false
  const view = runtime.getMap().getView()
  if (location) {
    view.animate({
      center: transform(location, 'EPSG:4326', view.getProjection()),
      zoom: Math.max(view.getZoom() ?? 0, 16),
      duration: 150
    })
    return true
  }
  return zoomMapToFeatures(layerId, [featureId])
}

/** 按完整的选择集定位，不受属性表分页或搜索的影响。 */
export function zoomMapToSelected(): boolean {
  const selection = useLayerViewStore.getState().selection
  return selection.layerId ? zoomMapToFeatures(selection.layerId, selection.featureIds) : false
}

export function zoomMapToFeatures(layerId: string, featureIds: readonly string[]): boolean {
  if (!runtime || !mounted) return false
  const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
  const layer = requireMapContent(state.project).layers.find(item => item.id === layerId)
  if (!layer) return false
  const ids = new Set(featureIds)
  const features = (stateFeatureData[layer.datasetId] ?? []).filter(feature => ids.has(feature.id))
  const view = runtime.getMap().getView()
  const extent = [Infinity, Infinity, -Infinity, -Infinity]
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number') {
      const [x, y] = value
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        Math.abs(x) > 180 ||
        Math.abs(y) > 90
      )
        return
      extent[0] = Math.min(extent[0], x)
      extent[1] = Math.min(extent[1], y)
      extent[2] = Math.max(extent[2], x)
      extent[3] = Math.max(extent[3], y)
    } else value.forEach(visit)
  }
  features.forEach(feature => visit(feature.geometry.coordinates))
  if (!extent.every(Number.isFinite)) return false
  view.fit(transformExtent(extent, 'EPSG:4326', view.getProjection()), {
    padding: [60, 60, 60, 60],
    maxZoom: 16,
    duration: 150
  })
  return true
}

export function retryMapServiceLayer(layerId: string): boolean {
  if (!runtime || !mounted) return false
  return runtime.retryWmsLayer(layerId) || runtime.retryWmtsLayer(layerId)
}

export function syncSessionViewExtent(): void {
  if (!runtime || !mounted) return
  const map = runtime.getMap()
  const size = map.getSize()
  if (!size || size[0] === 0 || size[1] === 0) return
  const view = map.getView()
  const extent = view.calculateExtent(size)
  const wgs84 = transformExtent(extent, view.getProjection(), 'EPSG:4326')
  if (wgs84.some((value) => !Number.isFinite(value))) return
  useLayerViewStore
    .getState()
    .setMapViewExtentWgs84([wgs84[0], wgs84[1], wgs84[2], wgs84[3]])
}

/**
 * 切换到编辑或查看工具。选择走 OlSelectionRuntime，绘制、修改和删除走 OlToolRuntime。
 * 地图、选择或工具运行时没有挂载，或工具无法运行时返回 false。
 */
export function setActiveEditTool(tool: EditTool): boolean {
  if (!isMapRuntimeMounted() || !selectionRuntime || !toolRuntime) return false

  activeTool = tool
  useWorkbenchStore.getState().setIdentifyActive(false)
  useWorkbenchStore.getState().setActiveTool(tool)

  if (tool === 'none' || tool === 'pan') {
    selectionRuntime.deactivate()
    toolRuntime.deactivate()
    return true
  }

  if (tool === 'select') {
    toolRuntime.deactivate()
    const layerId = useLayerViewStore.getState().selectedLayerId
    selectionRuntime.activate(layerId, (state, request) => {
      applyingStoreSelection = true
      try {
        applyMapSelection(state)
      } finally {
        applyingStoreSelection = false
      }
      selectionRuntime?.syncSelection(useLayerViewStore.getState().selection)
      if (request.source === 'box' && state.layerId) {
        useWorkbenchStore.getState().bindTable(state.layerId)
        useLayerViewStore.getState().setAttributeTableState(state.layerId, {
          selectedOnly: true, searchQuery: '', currentPage: 1
        })
        openActivityPanel('attributes')
      }
    })
    syncSelectionHighlight(useLayerViewStore.getState().selection)
    return true
  }

  // 绘制、修改和删除都要求当前矢量图层支持几何编辑。
  selectionRuntime.deactivate()
  const layerId =
    useWorkbenchStore.getState().editLayerId ??
    useLayerViewStore.getState().selectedLayerId
  if (!layerId) {
    toolRuntime.deactivate()
    activeTool = 'none'
    useWorkbenchStore.getState().setActiveTool('none')
    return false
  }
  const project = useProjectStore.getState().project
  const layer = requireMapContent(project).layers.find((item) => item.id === layerId)
  const dataset = layer
    ? requireMapContent(project).datasets.find((item) => item.id === layer.datasetId)
    : undefined
  if (!layer || !capabilitiesForDataset(dataset).editGeometry || isDatasetLocked(project, layer.datasetId)) {
    toolRuntime.deactivate()
    activeTool = 'none'
    useWorkbenchStore.getState().setActiveTool('none')
    return false
  }

  const resolved: EditTool = isDrawTool(tool) ? resolveDrawTool(layerId) : tool
  useWorkbenchStore.getState().setEditLayer(layerId)
  activeTool = resolved
  useWorkbenchStore.getState().setActiveTool(resolved)
  toolRuntime.activate(resolved, createToolCallbacks())
  return true
}

export function clearMapSelection(): boolean {
  if (!isMapRuntimeMounted()) {
    clearMapStoreSelection()
    return false
  }
  selectionRuntime?.clear()
  clearMapStoreSelection()
  return true
}

function createToolCallbacks(): ToolCallbacks {
  return {
    getActiveLayerId: () => useWorkbenchStore.getState().editLayerId,
    getSelectedFeatureIds: () => {
      const selection = useLayerViewStore.getState().selection
      return selection.layerId === useWorkbenchStore.getState().editLayerId ? selection.featureIds : []
    },
    getFeatureGeometry: (datasetId, featureId) => featureData.readSnapshot()[datasetId]?.find(feature => feature.id === featureId)?.geometry,
    validateGeometries: (datasetId, features) => {
      try {
        const state = useProjectStore.getState(), layerId = useWorkbenchStore.getState().editLayerId
        const layer = requireMapContent(state.project).layers.find(layer => layer.id === layerId && layer.datasetId === datasetId)
        if (!layer || isDatasetLocked(state.project, layer.datasetId) || !capabilitiesForDataset(requireMapContent(state.project).datasets.find(dataset => dataset.id === datasetId)).editGeometry) throw new Error('编辑目标已删除或锁定，未提交本次修改。')
        assertValidGeometryEdits(features)
        return true
      } catch (error) {
        window.dispatchEvent(new CustomEvent('desktop-webgis:command-status', { detail: error instanceof Error ? error.message : '几何校验失败，未提交本次修改。' }))
        return false
      }
    },
    onUpdateGeometries: command => {
      try {
        projectEdits.execute(command)
        syncMapFromProject()
        return true
      } catch (error) {
        window.dispatchEvent(new CustomEvent('desktop-webgis:command-status', { detail: error instanceof Error ? error.message : '顶点修改失败，已恢复几何。' }))
        return false
      }
    },
    onAddFeature: (_datasetId, _feature, command) => {
      projectEdits.execute(command)
      syncMapFromProject()
      return true
    },
    onDeleteFeatures: (_datasetId, _features, commands) => {
      projectEdits.executeMany(commands)
      clearMapStoreSelection()
      syncMapFromProject()
    },
    onUpdateGeometry: (_datasetId, _featureId, _before, _after, command) => {
      projectEdits.execute(command)
      syncMapFromProject()
    },
    onSelectionChange: (featureIds) => {
      const layerId = useWorkbenchStore.getState().editLayerId
      if (!layerId) return
      applyingStoreSelection = true
      try {
        applyMapSelection({ layerId, featureIds })
      } finally {
        applyingStoreSelection = false
      }
    }
  }
}

function syncSelectionHighlight(selection: SelectionState): void {
  toolRuntime?.syncSelection(selection.layerId === useWorkbenchStore.getState().editLayerId ? selection.featureIds : [])
  if (!selectionRuntime || applyingStoreSelection) return
  selectionRuntime.syncSelection(selection)
}

function isDrawTool(tool: EditTool): boolean {
  return (
    tool === 'draw-point' || tool === 'draw-line' || tool === 'draw-polygon'
  )
}

/** 根据图层的样式类型和符号决定绘制几何，取不到时回退到已有要素的几何。 */
function resolveDrawTool(layerId: string): EditTool {
  const state = useProjectStore.getState()
  const layer = requireMapContent(state.project).layers.find((item) => item.id === layerId)
  if (!layer) return 'draw-point'

  if (isLegacyStyle(layer.style)) {
    if (layer.style.kind === 'line') return 'draw-line'
    if (layer.style.kind === 'polygon') return 'draw-polygon'
    if (layer.style.kind === 'point') return 'draw-point'
  } else {
    const symbol =
      layer.style.mode === 'single'
        ? layer.style.symbol
        : 'fallback' in layer.style
          ? layer.style.fallback
          : null
    if (symbol?.type === 'circle') return 'draw-point'
    if (symbol?.type === 'solid' && 'color' in symbol && !('fill' in symbol))
      return 'draw-line'
    if (symbol?.type === 'solid' && 'fill' in symbol) return 'draw-polygon'
  }

  const features = getLayerFeatures(layerId)
  const geom = features[0]?.geometry?.type
  if (geom === 'LineString' || geom === 'MultiLineString') return 'draw-line'
  if (geom === 'Polygon' || geom === 'MultiPolygon') return 'draw-polygon'
  return 'draw-point'
}

function collectBasemapCredentials(
  basemap: BasemapConfig
): Record<string, string> {
  if (basemap.type !== 'tianditu' && basemap.type !== 'google-map-tiles')
    return {}
  const key = basemap.credential
  const stored = getSessionCredential(key)
  if (!stored) return {}
  return { [key]: stored.value }
}

/** 测试辅助：注入一个已经挂载好的运行时，或者清空。 */
export function _setMapRuntimeForTests(
  next: OlMapRuntime | null,
  isMounted = Boolean(next),
  options?: { selection?: boolean; tool?: boolean; activeTool?: EditTool }
): void {
  snappingUnsub?.()
  snappingUnsub = null
  storeUnsub?.()
  storeUnsub = null
  sessionUnsub?.()
  sessionUnsub = null
  moveEndKey?.()
  moveEndKey = null
  selectionRuntime?.dispose()
  toolRuntime?.deactivate()
  selectionRuntime = null
  toolRuntime = null
  runtime = next
  mounted = isMounted
  selectionMounted = Boolean(options?.selection ?? (isMounted && next))
  toolMounted = Boolean(options?.tool ?? (isMounted && next))
  activeTool = options?.activeTool ?? (isMounted ? 'select' : 'none')

  if (next && isMounted) {
    // 轻量的占位实现，让单元测试里的 getSelectionRuntime 和 getToolRuntime 不为空。
    selectionRuntime = {
      activate: () => undefined,
      deactivate: () => undefined,
      syncSelection: () => undefined,
      clear: () => undefined,
      dispose: () => undefined,
      cancelGesture: () => false
    } as unknown as OlSelectionRuntime
    toolRuntime = {
      activate: () => undefined,
      syncSelection: () => undefined,
      refreshSnapping: () => undefined,
      deactivate: () => undefined
    } as unknown as OlToolRuntime
  }
}
