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
  inferLayerStyleKind,
  parseGeoJsonFeatures,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  stringifyGeoJson,
  type EditTool,
  type GisFeature,
  type Layer,
  type LayerStyle,
  type Project,
  type SelectionState
} from '@desktop-webgis/gis-core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { pickTextFile, readTextFromPath, saveTextFile, writeTextToPath, type PickedTextFile } from '@/services/file.service'

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

  function openProjectFile(file: PickedTextFile): void {
    const snapshot = parseProjectSnapshot(file.content)
    const nextProject = snapshot.project
    project.value = nextProject
    projectPath.value = file.path
    featureStore.value = new MemoryFeatureStore()
    for (const [datasetId, features] of Object.entries(snapshot.featuresByDataset)) {
      featureStore.value.setAll(datasetId, features)
    }
    editHistory.value = new EditHistory()
    activeLayerId.value = nextProject.layers[0]?.id ?? null
    selectedLayerId.value = activeLayerId.value
    selection.value = { layerId: activeLayerId.value, featureIds: [] }
    dirty.value = false
    addRecentProject(nextProject.name, file.path)
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

  async function exportActiveLayer(selectedOnly = false): Promise<string | null> {
    const layer = activeLayer.value
    if (!layer) return null
    const ids = new Set(selection.value.featureIds)
    const features = featureStore.value
      .getAll(layer.datasetId)
      .filter((feature) => !selectedOnly || ids.has(feature.id))
    return saveTextFile(stringifyGeoJson(features), `${layer.name}.geojson`, ['geojson', 'json'])
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
    openRecentProject,
    saveProject,
    saveProjectAs,
    importGeoJson,
    exportActiveLayer,
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
