<script setup lang="ts">
import { ref } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const importing = ref(false)
const sourceType = ref<'geojson' | 'shapefile' | 'dxf' | 'point' | 'line' | 'polygon'>('geojson')

async function importData(): Promise<void> {
  importing.value = true
  try {
    if (sourceType.value === 'point' || sourceType.value === 'line' || sourceType.value === 'polygon') {
      const layer = projectStore.createDrawingLayer(sourceType.value)
      uiStore.setStatus(`已创建 ${layer.name}，可直接绘制`)
      uiStore.addDataDialogOpen = false
      return
    }
    const layer =
      sourceType.value === 'shapefile'
        ? await projectStore.importShapefile()
        : sourceType.value === 'dxf'
          ? await projectStore.importDxf()
          : await projectStore.importGeoJson()
    if (layer) {
      const warningText = projectStore.lastImportWarnings.length
        ? `；${projectStore.lastImportWarnings.join('；')}`
        : ''
      uiStore.setStatus(`已导入 ${layer.name}${warningText}`)
      uiStore.addDataDialogOpen = false
    }
  } catch (error) {
    uiStore.showError('导入失败', '请选择有效的 GeoJSON、Shapefile ZIP 或 ASCII DXF 文件。', String(error))
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
          <button :class="{ active: sourceType === 'geojson' }" type="button" @click="sourceType = 'geojson'">GeoJSON</button>
          <button :class="{ active: sourceType === 'point' }" type="button" @click="sourceType = 'point'">新建点图层</button>
          <button :class="{ active: sourceType === 'line' }" type="button" @click="sourceType = 'line'">新建线图层</button>
          <button :class="{ active: sourceType === 'polygon' }" type="button" @click="sourceType = 'polygon'">新建面图层</button>
          <button :class="{ active: sourceType === 'shapefile' }" type="button" @click="sourceType = 'shapefile'">Shapefile ZIP</button>
          <button :class="{ active: sourceType === 'dxf' }" type="button" @click="sourceType = 'dxf'">CAD / DXF</button>
        </div>
        <small v-if="sourceType === 'geojson'">导入已有 GeoJSON；也可新建空图层后直接绘制。</small>
        <small v-else-if="sourceType === 'shapefile'">请选择包含 .shp/.dbf/.prj 的 ZIP；有 .prj 时自动转换到 WGS84。</small>
        <small v-else-if="sourceType === 'dxf'">首版支持 ASCII DXF；DWG 与二进制 DXF 不在范围内，DXF 坐标按 WGS84 使用。</small>
        <small v-else>创建内存图层并自动切换到对应绘制工具。</small>
      </div>

      <label v-if="sourceType === 'geojson'" class="dialog-field">
        <span>文件路径</span>
        <div class="file-picker-proxy">
          <span>点击“导入”后选择 .geojson 或 .json 文件</span>
          <button type="button" @click="importData">浏览...</button>
        </div>
      </label>

      <label v-if="sourceType === 'geojson'" class="dialog-field">
        <span>图层名称</span>
        <input value="自动使用文件名" disabled />
      </label>

      <div v-if="sourceType === 'geojson'" class="dialog-options">
        <label><input type="checkbox" checked disabled /> 自动检测字段类型</label>
        <label><input type="checkbox" checked disabled /> 导入默认样式</label>
        <label><input type="checkbox" disabled /> 合并到现有图层</label>
      </div>

      <footer>
        <button class="ghost-button" @click="uiStore.addDataDialogOpen = false">取消</button>
        <button class="primary-button" :disabled="importing" @click="importData">
          {{ importing ? '处理中...' : ['point', 'line', 'polygon'].includes(sourceType) ? '创建图层' : '导入' }}
        </button>
      </footer>
    </section>
  </div>
</template>
