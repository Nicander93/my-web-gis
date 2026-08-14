<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const renamingLayerId = ref<string | null>(null)
const renameValue = ref('')
const layerQuery = ref('')
const menu = ref<{ x: number; y: number; layerId: string } | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const draggingId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)

const filteredLayers = computed(() => {
  const needle = layerQuery.value.trim().toLowerCase()
  if (!needle) return projectStore.layers
  return projectStore.layers.filter((layer) => layer.name.toLowerCase().includes(needle))
})

const menuLayerIndex = computed(() => {
  if (!menu.value) return -1
  return projectStore.layers.findIndex((layer) => layer.id === menu.value?.layerId)
})

onMounted(() => {
  document.addEventListener('click', closeMenu)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenu)
  document.removeEventListener('keydown', onKey)
})

function closeMenu(): void {
  menu.value = null
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu()
}

function openMenu(event: MouseEvent, layerId: string, fromButton = false): void {
  event.preventDefault()
  event.stopPropagation()
  projectStore.selectLayer(layerId)
  if (fromButton) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    menu.value = { x: rect.left, y: rect.bottom + 2, layerId }
    return
  }
  menu.value = { x: event.clientX, y: event.clientY, layerId }
}

function startRename(layerId: string, name: string): void {
  renamingLayerId.value = layerId
  renameValue.value = name
}

function commitRename(layerId: string): void {
  projectStore.renameLayer(layerId, renameValue.value)
  renamingLayerId.value = null
}

function zoomToLayer(layerId: string): void {
  window.dispatchEvent(new CustomEvent('desktop-webgis:zoom-to-layer', { detail: layerId }))
  uiStore.setStatus('已缩放到图层')
}

function openAttributeTable(layerId: string): void {
  projectStore.selectLayer(layerId)
  uiStore.openAttributeTable()
}

async function exportLayer(layerId: string): Promise<void> {
  projectStore.selectLayer(layerId)
  await projectStore.exportActiveLayer(false)
  uiStore.setStatus('图层已导出')
}

function runMenu(action: () => void | Promise<void>): void {
  closeMenu()
  void action()
}

function focusSearch(): void {
  if (projectStore.layers.length === 0) {
    uiStore.addDataDialogOpen = true
    return
  }
  searchInput.value?.focus()
}

function onDragStart(event: DragEvent, layerId: string): void {
  draggingId.value = layerId
  event.dataTransfer?.setData('text/plain', layerId)
}

function onDragOver(event: DragEvent, layerId: string): void {
  event.preventDefault()
  dropTargetId.value = layerId
}

function onDropLayer(event: DragEvent, targetId: string): void {
  event.preventDefault()
  const sourceId = draggingId.value
  draggingId.value = null
  dropTargetId.value = null
  if (!sourceId || sourceId === targetId) return
  const targetIndex = projectStore.layers.findIndex((layer) => layer.id === targetId)
  projectStore.moveLayerTo(sourceId, targetIndex)
}

function onDragEnd(): void {
  draggingId.value = null
  dropTargetId.value = null
}
</script>

<template>
  <section class="layer-panel">
    <header class="panel-header">
      <h2>图层</h2>
      <div class="panel-actions">
        <button title="搜索图层" @click="focusSearch">⌕</button>
        <button title="后续版本" disabled>⌯</button>
        <button title="添加数据" @click="uiStore.addDataDialogOpen = true">+</button>
      </div>
    </header>

    <div v-if="projectStore.layers.length === 0" class="panel-empty">
      <div class="mini-map-mark" aria-hidden="true"></div>
      <strong>暂无图层</strong>
      <span>导入 GeoJSON 后开始编辑。</span>
      <button class="small-button" @click="uiStore.addDataDialogOpen = true">添加数据</button>
    </div>

    <div v-else class="layer-list">
      <label class="layer-search">
        <span>⌕</span>
        <input ref="searchInput" v-model="layerQuery" placeholder="搜索图层..." />
      </label>

      <div class="tree-section">
        <button class="tree-heading" type="button">
          <span>⌄</span>
          <strong>{{ projectStore.project?.name }}</strong>
        </button>
        <div class="tree-indent">
          <button class="tree-heading" type="button">
            <span>⌄</span>
            <strong>数据</strong>
          </button>
          <div class="tree-indent data-source-list">
            <div v-for="dataset in projectStore.datasets" :key="dataset.id" class="source-row">
              <span class="source-icon">□</span>
              <span>{{ dataset.name }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="tree-heading layer-group-title">
        <span>⌄</span>
        <strong>图层</strong>
      </div>

      <div
        v-for="layer in filteredLayers"
        :key="layer.id"
        class="layer-row"
        :class="{
          active: projectStore.activeLayerId === layer.id,
          selected: projectStore.selectedLayerId === layer.id,
          'drop-target': dropTargetId === layer.id && draggingId !== layer.id
        }"
        :draggable="renamingLayerId !== layer.id"
        @click="projectStore.selectLayer(layer.id)"
        @contextmenu="openMenu($event, layer.id)"
        @dragstart="onDragStart($event, layer.id)"
        @dragover="onDragOver($event, layer.id)"
        @drop="onDropLayer($event, layer.id)"
        @dragend="onDragEnd"
      >
        <input
          type="checkbox"
          :checked="layer.visible"
          title="显示/隐藏"
          @click.stop
          @change="projectStore.setLayerVisible(layer.id, ($event.target as HTMLInputElement).checked)"
        />
        <span class="layer-symbol" :style="{ borderColor: layer.style.stroke, background: layer.style.fill }"></span>
        <input
          v-if="renamingLayerId === layer.id"
          v-model="renameValue"
          class="rename-input"
          @keydown.enter="commitRename(layer.id)"
          @keydown.esc="renamingLayerId = null"
          @blur="commitRename(layer.id)"
        />
        <span v-else class="layer-name">{{ layer.name }}</span>
        <span class="active-marker" title="当前图层">●</span>
        <button class="layer-more" title="更多" @click="openMenu($event, layer.id, true)">⋯</button>
      </div>
    </div>

    <footer v-if="projectStore.activeLayer" class="layer-details">
      <label>
        透明度
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="projectStore.activeLayer.opacity"
          @input="projectStore.setLayerOpacity(projectStore.activeLayer!.id, Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <button class="small-button" @click="zoomToLayer(projectStore.activeLayer.id)">缩放到图层</button>
    </footer>
  </section>

  <Teleport to="body">
    <div
      v-if="menu"
      class="menu-dropdown layer-context-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <button type="button" @click="runMenu(() => zoomToLayer(menu!.layerId))">缩放到图层</button>
      <button type="button" @click="runMenu(() => openAttributeTable(menu!.layerId))">打开属性表</button>
      <button type="button" @click="runMenu(() => projectStore.selectLayer(menu!.layerId))">设为当前图层</button>
      <div class="menu-sep"></div>
      <button type="button" @click="runMenu(() => startRename(menu!.layerId, projectStore.layers.find((layer) => layer.id === menu!.layerId)?.name ?? ''))">重命名</button>
      <button type="button" :disabled="menuLayerIndex <= 0" @click="runMenu(() => projectStore.moveLayer(menu!.layerId, -1))">上移</button>
      <button type="button" :disabled="menuLayerIndex < 0 || menuLayerIndex >= projectStore.layers.length - 1" @click="runMenu(() => projectStore.moveLayer(menu!.layerId, 1))">下移</button>
      <button type="button" @click="runMenu(() => exportLayer(menu!.layerId))">导出 GeoJSON</button>
      <button type="button" disabled title="后续版本">样式</button>
      <div class="menu-sep"></div>
      <button type="button" class="danger-text" @click="runMenu(() => projectStore.removeLayer(menu!.layerId))">移除</button>
    </div>
  </Teleport>
</template>
