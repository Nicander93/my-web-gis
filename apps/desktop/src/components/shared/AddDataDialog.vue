<script setup lang="ts">
import { ref } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const importing = ref(false)

async function importData(): Promise<void> {
  importing.value = true
  try {
    const layer = await projectStore.importGeoJson()
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
          <button type="button" disabled>Shapefile</button>
          <button type="button" disabled>CSV</button>
          <button type="button" disabled>GeoPackage</button>
        </div>
        <small>V0.1 当前仅支持 GeoJSON 文件导入。</small>
      </div>

      <label class="dialog-field">
        <span>文件路径</span>
        <div class="file-picker-proxy">
          <span>点击“导入”后选择 .geojson 或 .json 文件</span>
          <button type="button" @click="importData">浏览...</button>
        </div>
      </label>

      <label class="dialog-field">
        <span>图层名称</span>
        <input value="自动使用文件名" disabled />
      </label>

      <div class="dialog-options">
        <label><input type="checkbox" checked disabled /> 自动检测字段类型</label>
        <label><input type="checkbox" checked disabled /> 导入默认样式</label>
        <label><input type="checkbox" disabled /> 合并到现有图层</label>
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
