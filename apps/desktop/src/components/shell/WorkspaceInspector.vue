<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const activeTab = ref<'layer' | 'feature'>('layer')
const editingKey = ref<string | null>(null)
const draft = ref('')

const selectedFeature = computed(() => projectStore.selectedFeatures.length === 1 ? projectStore.selectedFeatures[0] : null)
const inspectedLayer = computed(() => projectStore.selectedLayer ?? projectStore.activeLayer)
const inspectedDataset = computed(() => {
  const layer = inspectedLayer.value
  return layer ? projectStore.datasets.find((dataset) => dataset.id === layer.datasetId) ?? null : null
})
const featureCount = computed(() => {
  const layer = inspectedLayer.value
  return layer ? projectStore.featureStore.getAll(layer.datasetId).length : 0
})

watch(selectedFeature, (feature) => {
  if (feature) activeTab.value = 'feature'
})

function startEdit(key: string, value: unknown): void {
  editingKey.value = key
  draft.value = value == null ? '' : String(value)
}

function commitEdit(): void {
  if (!selectedFeature.value || !editingKey.value) return
  projectStore.updateFeatureProperty(selectedFeature.value.id, editingKey.value, draft.value)
  editingKey.value = null
}

function zoomToLayer(layerId: string): void {
  window.dispatchEvent(new CustomEvent('desktop-webgis:zoom-to-layer', { detail: layerId }))
  uiStore.setStatus('已缩放到图层')
}

async function smartStyle(): Promise<void> {
  try {
    const message = await projectStore.applySmartStyle()
    if (message) uiStore.setStatus(message)
  } catch (error) {
    uiStore.showError('智能配图失败', '模型输出未通过样式校验。', String(error))
  }
}
</script>

<template>
  <aside class="inspector-panel">
    <div class="inspector-tabs">
      <button :class="{ active: activeTab === 'layer' }" @click="activeTab = 'layer'">图层属性</button>
      <button :class="{ active: activeTab === 'feature' }" @click="activeTab = 'feature'">要素属性</button>
    </div>

    <section v-if="activeTab === 'layer'" class="inspector-section">
      <div v-if="!inspectedLayer" class="panel-empty">暂无图层</div>
      <template v-else>
        <details open>
          <summary>基本信息</summary>
          <label class="field-row">
            <span>图层名称</span>
            <input :value="inspectedLayer.name" @change="projectStore.renameLayer(inspectedLayer.id, ($event.target as HTMLInputElement).value)" />
          </label>
          <label class="field-row">
            <span>显示名称</span>
            <input :value="inspectedLayer.name" @change="projectStore.renameLayer(inspectedLayer.id, ($event.target as HTMLInputElement).value)" />
          </label>
          <div class="readonly-row"><span>数据源</span><strong>{{ inspectedDataset?.source.type ?? '-' }}</strong></div>
          <div class="readonly-row"><span>几何类型</span><strong>{{ inspectedLayer.style.kind }}</strong></div>
          <div class="readonly-row"><span>要素数量</span><strong>{{ featureCount }}</strong></div>
        </details>

        <details open>
          <summary>样式</summary>
          <div class="button-grid">
            <button class="ghost-button" @click="smartStyle">智能配图</button>
          </div>
          <label class="field-row">
            <span>线颜色</span>
            <input
              type="color"
              :value="inspectedLayer.style.stroke"
              @input="projectStore.updateLayerStyle(inspectedLayer.id, { stroke: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="field-row">
            <span>填充色</span>
            <input
              type="color"
              :value="inspectedLayer.style.fill.slice(0, 7)"
              @input="projectStore.updateLayerStyle(inspectedLayer.id, { fill: `${($event.target as HTMLInputElement).value}44` })"
            />
          </label>
          <label class="field-row">
            <span>线宽</span>
            <input
              type="number"
              min="1"
              max="12"
              step="0.5"
              :value="inspectedLayer.style.width"
              @input="projectStore.updateLayerStyle(inspectedLayer.id, { width: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <label v-if="inspectedLayer.style.kind === 'point' || inspectedLayer.style.kind === 'mixed'" class="field-row">
            <span>点半径</span>
            <input
              type="number"
              min="1"
              max="32"
              step="1"
              :value="inspectedLayer.style.pointRadius"
              @input="projectStore.updateLayerStyle(inspectedLayer.id, { pointRadius: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <label class="field-row">
            <span>透明度</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="inspectedLayer.opacity"
              @input="projectStore.setLayerOpacity(inspectedLayer.id, Number(($event.target as HTMLInputElement).value))"
            />
          </label>
        </details>

        <details open>
          <summary>图层操作</summary>
          <div class="button-grid">
            <button class="ghost-button" @click="zoomToLayer(inspectedLayer.id)">缩放到图层</button>
            <button class="ghost-button" @click="projectStore.exportActiveLayer(false)">导出 GeoJSON</button>
            <button class="ghost-button" @click="projectStore.exportActiveLayerAsShapefile(false)">导出 Shapefile</button>
          </div>
        </details>
      </template>
    </section>

    <section v-else class="inspector-section">
      <div v-if="!selectedFeature" class="panel-empty">请选择单个要素查看属性。</div>
      <template v-else>
        <details open>
          <summary>基本信息</summary>
          <div class="readonly-row"><span>图层名称</span><strong>{{ inspectedLayer?.name ?? '-' }}</strong></div>
          <div class="readonly-row"><span>要素 ID</span><strong>{{ selectedFeature.id }}</strong></div>
          <div class="readonly-row"><span>几何类型</span><strong>{{ selectedFeature.geometry.type }}</strong></div>
        </details>

        <details open>
          <summary>字段信息</summary>
          <div v-if="Object.keys(selectedFeature.properties).length === 0" class="panel-empty">暂无属性字段</div>
          <div v-for="(value, key) in selectedFeature.properties" :key="key" class="property-row">
            <span>{{ key }}</span>
            <input
              v-if="editingKey === key"
              v-model="draft"
              @keydown.enter="commitEdit"
              @keydown.esc="editingKey = null"
              @blur="commitEdit"
            />
            <button v-else @click="startEdit(String(key), value)">{{ value }}</button>
          </div>
        </details>
      </template>
    </section>
  </aside>
</template>
