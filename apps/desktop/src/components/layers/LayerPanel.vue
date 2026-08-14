<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const renamingLayerId = ref<string | null>(null)
const renameValue = ref('')
const layerQuery = ref('')

const filteredLayers = computed(() => {
  const needle = layerQuery.value.trim().toLowerCase()
  if (!needle) return projectStore.layers
  return projectStore.layers.filter((layer) => layer.name.toLowerCase().includes(needle))
})

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
</script>

<template>
  <section class="layer-panel">
    <header class="panel-header">
      <h2>图层</h2>
      <div class="panel-actions">
        <button title="搜索图层">⌕</button>
        <button title="过滤">⌯</button>
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
        <input v-model="layerQuery" placeholder="搜索图层..." />
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
        v-for="(layer, index) in filteredLayers"
        :key="layer.id"
        class="layer-row"
        :class="{ active: projectStore.activeLayerId === layer.id, selected: projectStore.selectedLayerId === layer.id }"
        @click="projectStore.selectLayer(layer.id)"
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
        <button title="上移" :disabled="index === 0" @click.stop="projectStore.moveLayer(layer.id, -1)">↑</button>
        <button title="下移" :disabled="index === filteredLayers.length - 1" @click.stop="projectStore.moveLayer(layer.id, 1)">↓</button>
        <button title="重命名" @click.stop="startRename(layer.id, layer.name)">⋯</button>
        <button class="danger-text" title="移除" @click.stop="projectStore.removeLayer(layer.id)">x</button>
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
</template>
