import {
  AddFeatureCommand,
  DeleteFeatureCommand,
  EditHistory,
  MemoryFeatureStore,
  UpdateGeometryCommand,
  UpdatePropertiesCommand,
  createDefaultLayerStyle,
  createId,
  createProject,
  featuresToGeoJson,
  inferLayerStyleKind,
  parseGeoJsonFeatures,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  stringifyGeoJson,
  type EditTool,
  type BasemapConfig,
  type DataSource,
  type GisFeature,
  type Layer,
  type LayerStyle,
  type Project,
  type SelectionState
} from '@desktop-webgis/gis-core'
import type { GeoJsonFeatureCollection } from '@desktop-webgis/scene-schema'
import type { StyleModelAdapter } from '@desktop-webgis/style-assistant'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  pickBinaryFile,
  pickTextFile,
  readTextFromPath,
  saveBinaryFile,
  saveTextFile,
  writeTextToPath,
  type PickedTextFile
} from '@/services/file.service'
import { projectToScene, sceneToProjectSnapshot, serializeProjectScene } from '@/services/scene.service'

interface RecentProject {
  name: string
  path: string
  openedAt: string
}

export const useProjectStore = defineStore('project', () => {
  const project = ref<Project | null>(null)
  const projectPath = ref<string | null>(null)
  const featureStore = ref(new MemoryFeatureStore())
  const editHistory = ref(new EditHistory())
  const activeLayerId = ref<string | null>(null)
  const selectedLayerId = ref<string | null>(null)
  const selection = ref<SelectionState>({ layerId: null, featureIds: [] })
  const activeTool = ref<EditTool>('select')
  const dirty = ref(false)
  const runtimeCredentials = ref<Record<string, string>>({})
  const lastImportWarnings = ref<string[]>([])
  const recentProjects = ref<RecentProject[]>(loadRecentProjects())

  const layers = computed(() => project.value?.layers ?? [])
  const datasets = computed(() => project.value?.datasets ?? [])
  const activeLayer = computed(() => layers.value.find((layer) => layer.id === activeLayerId.value) ?? null)
  const selectedLayer = computed(() => layers.value.find((layer) => layer.id === selectedLayerId.value) ?? activeLayer.value)
  const activeDatasetId = computed(() => activeLayer.value?.datasetId ?? null)
  const featuresByDataset = computed(() => featureStore.value.snapshot())
  const activeFeatures = computed(() => (activeDatasetId.value ? featureStore.value.getAll(activeDatasetId.value) : []))
  const selectedFeatures = computed(() => {
    if (!selection.value.layerId) return []
    const layer = layers.value.find((item) => item.id === selection.value.layerId)
    if (!layer) return []
    const ids = new Set(selection.value.featureIds)
    return featureStore.value.getAll(layer.datasetId).filter((feature) => ids.has(feature.id))
  })
  const attributeColumns = computed(() => {
    const keys = new Set<string>(['id'])
    for (const feature of activeFeatures.value) {
      Object.keys(feature.properties).forEach((key) => keys.add(key))
    }
    return Array.from(keys).slice(0, 12)
  })

  function newProject(name = '未命名项目'): void {
    project.value = createProject(name)
    projectPath.value = null
    featureStore.value = new MemoryFeatureStore()
    editHistory.value = new EditHistory()
    activeLayerId.value = null
    selectedLayerId.value = null
    selection.value = { layerId: null, featureIds: [] }
    activeTool.value = 'select'
    dirty.value = false
  }

  async function openProjectFromDialog(): Promise<void> {
    const file = await pickTextFile(['dwgis', 'json'])
    if (!file) return
    openProjectFile(file)
  }

  async function openRecentProject(path: string): Promise<void> {
    openProjectFile(await readTextFromPath(path))
  }

  async function openSceneFromDialog(): Promise<void> {
    const file = await pickTextFile(['scene.json', 'json'])
    if (!file) return
    const snapshot = await sceneToProjectSnapshot(file.content)
    applySnapshot(snapshot, null)
  }

  function openProjectFile(file: PickedTextFile): void {
    const snapshot = parseProjectSnapshot(file.content)
    applySnapshot(snapshot, file.path)
    addRecentProject(snapshot.project.name, file.path)
  }

  function applySnapshot(snapshot: ReturnType<typeof parseProjectSnapshot>, path: string | null): void {
    const nextProject = snapshot.project
    project.value = nextProject
    projectPath.value = path
    featureStore.value = new MemoryFeatureStore()
    for (const [datasetId, features] of Object.entries(snapshot.featuresByDataset)) {
      featureStore.value.setAll(datasetId, features)
    }
    editHistory.value = new EditHistory()
    activeLayerId.value = nextProject.layers[0]?.id ?? null
    selectedLayerId.value = activeLayerId.value
    selection.value = { layerId: activeLayerId.value, featureIds: [] }
    dirty.value = false
  }

  async function saveProject(): Promise<string | null> {
    if (!project.value) return null
    const content = createSnapshotText()
    if (projectPath.value) {
      await writeTextToPath(projectPath.value, content)
      dirty.value = false
      addRecentProject(project.value.name, projectPath.value)
      return projectPath.value
    }
    return saveProjectAs()
  }

  async function saveProjectAs(): Promise<string | null> {
    if (!project.value) return null
    const path = await saveTextFile(createSnapshotText(), `${project.value.name}.dwgis.json`, ['dwgis', 'json'])
    if (path) {
      projectPath.value = path
      dirty.value = false
      addRecentProject(project.value.name, path)
    }
    return path
  }

  async function importGeoJson(): Promise<Layer | null> {
    ensureProject()
    lastImportWarnings.value = []
    const file = await pickTextFile(['geojson', 'json'])
    if (!file || !project.value) return null
    const features = parseGeoJsonFeatures(file.content)
    const datasetId = createId('dataset')
    const layerId = createId('layer')
    const layerName = file.name.replace(/\.(geojson|json)$/i, '')
    const styleKind = inferLayerStyleKind(features)

    project.value.datasets.push({
      id: datasetId,
      name: layerName,
      kind: 'vector',
      source: {
        type: 'geojson-file',
        path: file.path
      }
    })
    const layer: Layer = {
      id: layerId,
      datasetId,
      name: layerName,
      visible: true,
      opacity: 1,
      editable: true,
      style: createDefaultLayerStyle(styleKind)
    }
    project.value.layers.push(layer)
    featureStore.value.setAll(datasetId, features)
    activeLayerId.value = layerId
    selectedLayerId.value = layerId
    selection.value = { layerId, featureIds: [] }
    markDirty()
    return layer
  }

  async function importShapefile(): Promise<Layer | null> {
    ensureProject()
    const file = await pickBinaryFile(['zip'])
    if (!file) return null
    const { importShapefile: readShapefile } = await import('@desktop-webgis/vector-io')
    const result = await readShapefile(file.content)
    lastImportWarnings.value = result.warnings.map((warning) =>
      warning.count ? `${warning.message}（${warning.count}）` : warning.message
    )
    return addImportedVectorLayer(
      file.name.replace(/\.zip$/i, ''),
      parseGeoJsonFeatures(result.featureCollection),
      { type: 'shapefile-file', path: file.path }
    )
  }

  async function importDxf(): Promise<Layer | null> {
    ensureProject()
    const file = await pickTextFile(['dxf'])
    if (!file) return null
    const { importDxf: readDxf } = await import('@desktop-webgis/vector-io')
    const result = readDxf(file.content)
    lastImportWarnings.value = result.warnings.map((warning) =>
      warning.count ? `${warning.message}（${warning.count}）` : warning.message
    )
    return addImportedVectorLayer(
      file.name.replace(/\.dxf$/i, ''),
      parseGeoJsonFeatures(result.featureCollection),
      { type: 'dxf-file', path: file.path }
    )
  }

  function addImportedVectorLayer(name: string, features: GisFeature[], source: DataSource): Layer {
    if (!project.value) throw new Error('项目未打开。')
    const datasetId = createId('dataset')
    const layerId = createId('layer')
    project.value.datasets.push({ id: datasetId, name, kind: 'vector', source })
    const layer: Layer = {
      id: layerId,
      datasetId,
      name,
      visible: true,
      opacity: 1,
      editable: true,
      style: createDefaultLayerStyle(inferLayerStyleKind(features))
    }
    project.value.layers.push(layer)
    featureStore.value.setAll(datasetId, features)
    activeLayerId.value = layerId
    selectedLayerId.value = layerId
    selection.value = { layerId, featureIds: [] }
    markDirty()
    return layer
  }

  function createDrawingLayer(kind: LayerStyle['kind'] = 'polygon', name?: string): Layer {
    ensureProject()
    lastImportWarnings.value = []
    if (!project.value) throw new Error('项目未打开。')
    const datasetId = createId('dataset')
    const layerId = createId('layer')
    const layerName = name?.trim() || `新建${kind === 'point' ? '点' : kind === 'line' ? '线' : '面'}图层`
    project.value.datasets.push({
      id: datasetId,
      name: layerName,
      kind: 'vector',
      source: { type: 'memory', label: layerName }
    })
    const layer: Layer = {
      id: layerId,
      datasetId,
      name: layerName,
      visible: true,
      opacity: 1,
      editable: true,
      style: createDefaultLayerStyle(kind)
    }
    project.value.layers.push(layer)
    featureStore.value.setAll(datasetId, [])
    activeLayerId.value = layerId
    selectedLayerId.value = layerId
    selection.value = { layerId, featureIds: [] }
    activeTool.value = kind === 'point' ? 'draw-point' : kind === 'line' ? 'draw-line' : 'draw-polygon'
    markDirty()
    return layer
  }

  function setBasemap(config: BasemapConfig): void {
    ensureProject()
    if (!project.value) return
    project.value.basemap = config
    markDirty()
  }

  function setRuntimeCredential(id: string, value: string): void {
    runtimeCredentials.value = { ...runtimeCredentials.value, [id]: value }
  }

  async function exportScene(colorScheme: 'light' | 'dark' | 'system' = 'system'): Promise<string | null> {
    if (!project.value) return null
    const content = serializeProjectScene(project.value, featureStore.value.snapshot(), colorScheme)
    return saveTextFile(content, `${project.value.name}.scene.json`, ['scene.json', 'json'])
  }

  async function exportOpenLayersCode(
    colorScheme: 'light' | 'dark' | 'system' = 'system'
  ): Promise<string | null> {
    if (!project.value) return null
    const { generateOpenLayersModule } = await import('@desktop-webgis/scene-codegen')
    const scene = projectToScene(project.value, featureStore.value.snapshot(), colorScheme)
    const content = generateOpenLayersModule(scene)
    return saveTextFile(content, `${project.value.name}.openlayers.mjs`, ['mjs', 'js'])
  }

  async function applySmartStyle(): Promise<string | null> {
    const layer = activeLayer.value
    if (!layer) return null
    const { suggestLayerStyle } = await import('@desktop-webgis/style-assistant')
    const adapter = (
      globalThis as typeof globalThis & { __DESKTOP_WEBGIS_STYLE_MODEL__?: StyleModelAdapter }
    ).__DESKTOP_WEBGIS_STYLE_MODEL__
    const suggestion = await suggestLayerStyle(
      {
        layerName: layer.name,
        geometry: layer.style.kind,
        featureCount: featureStore.value.getAll(layer.datasetId).length
      },
      adapter
    )
    updateLayerStyle(layer.id, suggestion.style)
    return `${suggestion.source === 'model' ? 'AI' : '本地规则'}：${suggestion.rationale}`
  }

  async function exportActiveLayer(selectedOnly = false): Promise<string | null> {
    const layer = activeLayer.value
    if (!layer) return null
    const ids = new Set(selection.value.featureIds)
    const features = featureStore.value
      .getAll(layer.datasetId)
      .filter((feature) => !selectedOnly || ids.has(feature.id))
    return saveTextFile(stringifyGeoJson(features), `${layer.name}.geojson`, ['geojson', 'json'])
  }

  async function exportActiveLayerAsShapefile(selectedOnly = false): Promise<string | null> {
    const layer = activeLayer.value
    if (!layer) return null
    const ids = new Set(selection.value.featureIds)
    const features = featureStore.value
      .getAll(layer.datasetId)
      .filter((feature) => !selectedOnly || ids.has(feature.id))
    const { exportShapefile: writeShapefile } = await import('@desktop-webgis/vector-io')
    const bytes = await writeShapefile(
      featuresToGeoJson(features) as unknown as GeoJsonFeatureCollection,
      { folder: layer.name, filename: layer.name }
    )
    return saveBinaryFile(bytes, `${layer.name}.shp.zip`, ['zip'])
  }

  function selectLayer(layerId: string): void {
    selectedLayerId.value = layerId
    activeLayerId.value = layerId
    selection.value = { layerId, featureIds: [] }
  }

  function setLayerVisible(layerId: string, visible: boolean): void {
    const layer = layers.value.find((item) => item.id === layerId)
    if (!layer) return
    layer.visible = visible
    markDirty()
  }

  function setLayerOpacity(layerId: string, opacity: number): void {
    const layer = layers.value.find((item) => item.id === layerId)
    if (!layer) return
    layer.opacity = opacity
    markDirty()
  }

  function updateLayerStyle(layerId: string, patch: Partial<LayerStyle>): void {
    const layer = layers.value.find((item) => item.id === layerId)
    if (!layer) return
    layer.style = { ...layer.style, ...patch }
    markDirty()
  }

  function renameLayer(layerId: string, name: string): void {
    const layer = layers.value.find((item) => item.id === layerId)
    if (!layer || !name.trim()) return
    layer.name = name.trim()
    markDirty()
  }

  function removeLayer(layerId: string): void {
    if (!project.value) return
    const layer = project.value.layers.find((item) => item.id === layerId)
    project.value.layers = project.value.layers.filter((item) => item.id !== layerId)
    if (layer && !project.value.layers.some((item) => item.datasetId === layer.datasetId)) {
      project.value.datasets = project.value.datasets.filter((dataset) => dataset.id !== layer.datasetId)
      featureStore.value.clear(layer.datasetId)
    }
    activeLayerId.value = project.value.layers[0]?.id ?? null
    selectedLayerId.value = activeLayerId.value
    selection.value = { layerId: activeLayerId.value, featureIds: [] }
    markDirty()
  }

  function moveLayer(layerId: string, direction: -1 | 1): void {
    if (!project.value) return
    const index = project.value.layers.findIndex((layer) => layer.id === layerId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= project.value.layers.length) return
    const [layer] = project.value.layers.splice(index, 1)
    project.value.layers.splice(nextIndex, 0, layer)
    markDirty()
  }

  function setSelection(nextSelection: SelectionState): void {
    selection.value = {
      layerId: nextSelection.layerId,
      featureIds: Array.from(new Set(nextSelection.featureIds))
    }
  }

  function selectFeature(featureId: string, append = false): void {
    const layerId = activeLayerId.value
    if (!layerId) return
    const current = append ? selection.value.featureIds : []
    const ids = new Set(current)
    if (ids.has(featureId) && append) ids.delete(featureId)
    else ids.add(featureId)
    selection.value = { layerId, featureIds: Array.from(ids) }
  }

  function clearSelection(): void {
    selection.value = { layerId: activeLayerId.value, featureIds: [] }
  }

  function executeAddFeature(datasetId: string, feature: GisFeature, command: AddFeatureCommand): void {
    editHistory.value.execute(command, { featureStore: featureStore.value })
    selection.value = { layerId: activeLayerId.value, featureIds: [feature.id] }
    markDirty()
  }

  function executeDeleteFeatures(datasetId: string, features: GisFeature[], commands: DeleteFeatureCommand[]): void {
    for (const command of commands) {
      editHistory.value.execute(command, { featureStore: featureStore.value })
    }
    selection.value = { layerId: activeLayerId.value, featureIds: [] }
    markDirty()
  }

  function deleteSelectedFeatures(): void {
    const layer = activeLayer.value
    if (!layer || selection.value.featureIds.length === 0) return
    const ids = new Set(selection.value.featureIds)
    const features = featureStore.value.getAll(layer.datasetId).filter((feature) => ids.has(feature.id))
    const commands = features.map((feature) => new DeleteFeatureCommand(createId('cmd'), layer.datasetId, feature))
    executeDeleteFeatures(layer.datasetId, features, commands)
  }

  function executeUpdateGeometry(command: UpdateGeometryCommand): void {
    editHistory.value.execute(command, { featureStore: featureStore.value })
    markDirty()
  }

  function updateFeatureProperty(featureId: string, key: string, value: unknown): void {
    const layer = activeLayer.value
    if (!layer) return
    const feature = featureStore.value.getById(layer.datasetId, featureId)
    if (!feature) return
    const before = structuredClone(feature.properties)
    const after = { ...before, [key]: coerceValue(value) }
    const command = new UpdatePropertiesCommand(createId('cmd'), layer.datasetId, featureId, before, after)
    editHistory.value.execute(command, { featureStore: featureStore.value })
    markDirty()
  }

  function undo(): void {
    editHistory.value.undo({ featureStore: featureStore.value })
    markDirty()
  }

  function redo(): void {
    editHistory.value.redo({ featureStore: featureStore.value })
    markDirty()
  }

  function setActiveTool(tool: EditTool): void {
    activeTool.value = tool
  }

  function updateMapState(center: [number, number], zoom: number, rotation: number): void {
    if (!project.value) return
    project.value.mapState = { center, zoom, rotation }
    markDirty()
  }

  function ensureProject(): void {
    if (!project.value) newProject()
  }

  function createSnapshotText(): string {
    if (!project.value) throw new Error('No project is open.')
    return serializeProjectSnapshot({
      project: project.value,
      featuresByDataset: featureStore.value.snapshot()
    })
  }

  function markDirty(): void {
    dirty.value = true
  }

  function addRecentProject(name: string, path: string): void {
    const recent = { name, path, openedAt: new Date().toISOString() }
    recentProjects.value = [recent, ...recentProjects.value.filter((item) => item.path !== path)].slice(0, 8)
    localStorage.setItem('desktop-webgis.recentProjects', JSON.stringify(recentProjects.value))
  }

  return {
    project,
    projectPath,
    featureStore,
    editHistory,
    activeLayerId,
    selectedLayerId,
    selection,
    activeTool,
    dirty,
    runtimeCredentials,
    lastImportWarnings,
    recentProjects,
    layers,
    datasets,
    activeLayer,
    selectedLayer,
    activeDatasetId,
    featuresByDataset,
    activeFeatures,
    selectedFeatures,
    attributeColumns,
    newProject,
    openProjectFromDialog,
    openSceneFromDialog,
    openRecentProject,
    saveProject,
    saveProjectAs,
    importGeoJson,
    importShapefile,
    importDxf,
    createDrawingLayer,
    setBasemap,
    setRuntimeCredential,
    exportScene,
    exportOpenLayersCode,
    applySmartStyle,
    exportActiveLayer,
    exportActiveLayerAsShapefile,
    selectLayer,
    setLayerVisible,
    setLayerOpacity,
    updateLayerStyle,
    renameLayer,
    removeLayer,
    moveLayer,
    setSelection,
    selectFeature,
    clearSelection,
    executeAddFeature,
    executeDeleteFeatures,
    deleteSelectedFeatures,
    executeUpdateGeometry,
    updateFeatureProperty,
    undo,
    redo,
    setActiveTool,
    updateMapState
  }
})

function loadRecentProjects(): RecentProject[] {
  try {
    return JSON.parse(localStorage.getItem('desktop-webgis.recentProjects') ?? '[]') as RecentProject[]
  } catch {
    return []
  }
}

function coerceValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return value
}
