<script setup lang="ts">
import { OlMapRuntime, OlSelectionRuntime, OlToolRuntime } from '@desktop-webgis/ol-runtime'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const mapEl = ref<HTMLElement | null>(null)
const dropping = ref(false)
let dragCount = 0
const mapRuntime = new OlMapRuntime()
const selectionRuntime = new OlSelectionRuntime(mapRuntime)
const toolRuntime = new OlToolRuntime(mapRuntime)

const hint = computed(() => {
  const tool = projectStore.activeTool
  if (tool === 'draw-polygon') return '多边形 - 单击添加顶点，双击完成'
  if (tool === 'draw-line') return '线 - 单击添加顶点，双击完成'
  if (tool === 'draw-point') return '点 - 单击放置要素'
  if (tool === 'modify') return '修改 - 选择并拖拽节点'
  if (tool === 'delete') return '删除 - 单击要素删除'
  if (tool === 'select') return '选择 - 单击选择要素'
  return '平移'
})

onMounted(async () => {
  await nextTick()
  if (!mapEl.value || !projectStore.project) return
  mapRuntime.mount(mapEl.value, projectStore.project.mapState)
  mapRuntime.onPointerMove((info) => {
    uiStore.setPointerInfo(`${info.coordinate[0].toFixed(4)}, ${info.coordinate[1].toFixed(4)}`, info.scaleText)
  })
  mapRuntime.getMap().on('moveend', () => {
    const state = mapRuntime.getMapState()
    projectStore.updateMapState(state.center, state.zoom, state.rotation)
  })
  syncMap()
  fitPendingLayers()
  window.addEventListener('desktop-webgis:zoom-to-layer', handleZoomToLayer)
  window.addEventListener('desktop-webgis:zoom-to-all', handleZoomToAll)
})

onBeforeUnmount(() => {
  window.removeEventListener('desktop-webgis:zoom-to-layer', handleZoomToLayer)
  window.removeEventListener('desktop-webgis:zoom-to-all', handleZoomToAll)
  selectionRuntime.deactivate()
  toolRuntime.deactivate()
  mapRuntime.unmount()
})

watch(
  () => [projectStore.layers, projectStore.featuresByDataset],
  () => {
    syncLayers()
    fitPendingLayers()
  },
  { deep: true }
)

watch(
  () => projectStore.activeTool,
  () => syncTool()
)

watch(
  () => projectStore.selection,
  () => selectionRuntime.syncSelection(projectStore.selection),
  { deep: true }
)

watch(
  () => projectStore.activeLayerId,
  () => syncTool()
)

function syncMap(): void {
  syncLayers()
  selectionRuntime.activate(projectStore.activeLayerId, projectStore.setSelection)
  syncTool()
}

function syncLayers(): void {
  if (!projectStore.project) return
  mapRuntime.syncLayers(projectStore.layers, projectStore.featuresByDataset)
}

function fitPendingLayers(): void {
  if (!projectStore.consumePendingFitToLayers()) return
  mapRuntime.zoomToAll()
}

function syncTool(): void {
  toolRuntime.activate(projectStore.activeTool, {
    getActiveLayerId: () => projectStore.activeLayerId,
    onAddFeature: projectStore.executeAddFeature,
    onDeleteFeatures: projectStore.executeDeleteFeatures,
    onUpdateGeometry: (_datasetId, _featureId, _before, _after, command) => projectStore.executeUpdateGeometry(command),
    onSelectionChange: (featureIds) => projectStore.setSelection({ layerId: projectStore.activeLayerId, featureIds })
  })
  selectionRuntime.deactivate()
  if (projectStore.activeTool === 'select') {
    selectionRuntime.activate(projectStore.activeLayerId, projectStore.setSelection)
  }
  uiStore.setStatus(hint.value)
}

function handleZoomToLayer(event: Event): void {
  const layerId = (event as CustomEvent<string>).detail
  if (layerId) mapRuntime.zoomToLayer(layerId)
}

function handleZoomToAll(): void {
  mapRuntime.zoomToAll()
}

async function importDropped(event: DragEvent): Promise<void> {
  event.preventDefault()
  dragCount = 0
  dropping.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length === 0) return
  try {
    const count = await projectStore.importGeoJsonFiles(files)
    uiStore.setStatus(`已导入 ${count} 个文件`)
  } catch (error) {
    uiStore.showError('导入失败', '请拖入有效的 GeoJSON 文件。', String(error))
  }
}

function onDragEnter(event: DragEvent): void {
  event.preventDefault()
  dragCount += 1
  dropping.value = true
}

function onDragLeave(): void {
  dragCount -= 1
  if (dragCount <= 0) {
    dragCount = 0
    dropping.value = false
  }
}

defineExpose({
  zoomToLayer: (layerId: string) => mapRuntime.zoomToLayer(layerId),
  zoomToAll: () => mapRuntime.zoomToAll()
})
</script>

<template>
  <section
    class="map-shell"
    :class="{ 'drop-active': dropping }"
    @dragenter="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop="importDropped"
  >
    <div ref="mapEl" class="map-canvas"></div>
    <div v-if="projectStore.layers.length === 0" class="map-empty">
      <strong>暂无图层</strong>
      <span>拖入 GeoJSON，或添加数据开始编辑</span>
      <button class="small-button" type="button" @click="uiStore.addDataDialogOpen = true">添加数据</button>
    </div>
    <div v-else class="map-tool-hint">{{ hint }}</div>
  </section>
</template>
