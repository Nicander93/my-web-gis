<script setup lang="ts">
import type { EditTool } from '@desktop-webgis/gis-core'
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()

const tools: Array<{ id: EditTool; label: string; icon: string; status: string }> = [
  { id: 'select', label: '选择', icon: '↖', status: '选择要素' },
  { id: 'pan', label: '平移', icon: '✋', status: '平移地图' },
  { id: 'draw-point', label: '点', icon: '●', status: '绘制点' },
  { id: 'draw-line', label: '线', icon: '╱', status: '绘制线' },
  { id: 'draw-polygon', label: '多边形', icon: '⬠', status: '绘制多边形' },
  { id: 'modify', label: '修改', icon: '✎', status: '修改要素' },
  { id: 'delete', label: '删除', icon: '⌫', status: '删除要素' }
]

const canUndo = computed(() => projectStore.editHistory.canUndo)
const canRedo = computed(() => projectStore.editHistory.canRedo)

function setTool(tool: EditTool): void {
  const item = tools.find((entry) => entry.id === tool)
  projectStore.setActiveTool(tool)
  uiStore.setStatus(item?.status ?? '就绪')
}
</script>

<template>
  <div class="primary-toolbar" role="toolbar" aria-label="GIS tools">
    <button
      v-for="tool in tools"
      :key="tool.id"
      class="tool-button"
      :class="{ active: projectStore.activeTool === tool.id }"
      :title="tool.label"
      @click="setTool(tool.id)"
    >
      <span>{{ tool.icon }}</span>
      <small>{{ tool.label }}</small>
    </button>
    <span class="toolbar-divider"></span>
    <button class="tool-button" title="撤销" :disabled="!canUndo" @click="projectStore.undo()">↶</button>
    <button class="tool-button" title="重做" :disabled="!canRedo" @click="projectStore.redo()">↷</button>
    <span class="toolbar-divider"></span>
    <button class="toolbar-action" @click="uiStore.addDataDialogOpen = true">添加数据</button>
    <button class="toolbar-action" @click="projectStore.saveProject()">保存</button>
    <button class="toolbar-action" @click="projectStore.exportActiveLayer(false)">导出</button>
    <span class="active-tool-text">{{ projectStore.activeLayer?.name ?? '无活动图层' }}</span>
  </div>
</template>
