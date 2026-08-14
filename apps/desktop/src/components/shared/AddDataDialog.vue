<script setup lang="ts">
import { ref, watch } from 'vue'
import { pickTextFile, type PickedTextFile } from '@/services/file.service'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const importing = ref(false)
const picked = ref<PickedTextFile | null>(null)
const layerName = ref('')

watch(
  () => uiStore.addDataDialogOpen,
  (open) => {
    if (!open) {
      picked.value = null
      layerName.value = ''
      importing.value = false
    }
  }
)

async function browse(): Promise<void> {
  const file = await pickTextFile(['geojson', 'json'])
  if (!file) return
  picked.value = file
  layerName.value = file.name.replace(/\.(geojson|json)$/i, '')
}

async function importData(): Promise<void> {
  if (!picked.value) {
    await browse()
    if (!picked.value) return
  }
  importing.value = true
  try {
    const layer = projectStore.importGeoJsonText(
      picked.value.name,
      picked.value.content,
      picked.value.path,
      layerName.value
    )
    if (layer) {
      uiStore.setStatus(`已导入 ${layer.name}`)
      uiStore.addDataDialogOpen = false
    }
  } catch (error) {
    uiStore.showError('导入失败', '请选择有效的 GeoJSON 文件。', String(error))
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div v-if="uiStore.addDataDialogOpen" class="dialog-backdrop" @click.self="uiStore.addDataDialogOpen = false">
    <section class="add-data-dialog" role="dialog" aria-modal="true" aria-labelledby="add-data-title">
      <header>
        <h2 id="add-data-title">添加数据</h2>
        <button title="关闭" @click="uiStore.addDataDialogOpen = false">x</button>
      </header>

      <div class="dialog-field">
        <span>数据源类型</span>
        <div class="data-type-row" aria-label="数据源类型">
          <button class="active" type="button">GeoJSON</button>
          <button type="button" disabled title="后续版本">Shapefile</button>
          <button type="button" disabled title="后续版本">CSV</button>
          <button type="button" disabled title="后续版本">GeoPackage</button>
        </div>
        <small>当前仅支持 GeoJSON 文件导入。</small>
      </div>

      <label class="dialog-field">
        <span>文件路径</span>
        <div class="file-picker-proxy">
          <span>{{ picked?.path || '选择 .geojson 或 .json 文件' }}</span>
          <button type="button" @click="browse">浏览...</button>
        </div>
      </label>

      <label class="dialog-field">
        <span>图层名称</span>
        <input v-model="layerName" :disabled="!picked" placeholder="选择文件后可修改" />
      </label>

      <div class="dialog-options">
        <label><input type="checkbox" checked disabled /> 自动检测字段类型</label>
        <label><input type="checkbox" checked disabled /> 导入默认样式</label>
        <label><input type="checkbox" disabled title="后续版本" /> 合并到现有图层</label>
      </div>

      <footer>
        <button class="ghost-button" @click="uiStore.addDataDialogOpen = false">取消</button>
        <button class="primary-button" :disabled="importing" @click="importData">
          {{ importing ? '导入中...' : '导入' }}
        </button>
      </footer>
    </section>
  </div>
</template>
