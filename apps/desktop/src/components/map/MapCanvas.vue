<script setup lang="ts">
import { OlMapRuntime, OlSelectionRuntime, OlToolRuntime } from '@desktop-webgis/ol-runtime'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const mapEl = ref<HTMLElement | null>(null)
const coordinateText = ref('0.0000, 0.0000')
const scaleText = ref('1:0')
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
    coordinateText.value = `${info.coordinate[0].toFixed(4)}, ${info.coordinate[1].toFixed(4)}`
    scaleText.value = info.scaleText
  })
  mapRuntime.getMap().on('moveend', () => {
    const state = mapRuntime.getMapState()
    projectStore.updateMapState(state.center, state.zoom, state.rotation)
  })
  syncMap()
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
  () => syncLayers(),
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

defineExpose({
  zoomToLayer: (layerId: string) => mapRuntime.zoomToLayer(layerId),
  zoomToAll: () => mapRuntime.zoomToAll(),
  coordinateText,
  scaleText
})
</script>

<template>
  <section class="map-shell">
    <div ref="mapEl" class="map-canvas"></div>
    <div class="map-tool-hint">{{ hint }}</div>
    <div class="map-readout">{{ coordinateText }} - {{ scaleText }}</div>
  </section>
</template>
