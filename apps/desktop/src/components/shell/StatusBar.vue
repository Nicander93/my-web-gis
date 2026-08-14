<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()

const toolLabel = computed(() => {
  const labels = {
    none: '无',
    pan: '平移',
    select: '选择',
    'draw-point': '点',
    'draw-line': '线',
    'draw-polygon': '多边形',
    modify: '修改',
    delete: '删除'
  } as const
  return labels[projectStore.activeTool]
})
</script>

<template>
  <footer class="status-bar">
    <span>坐标参考系：{{ projectStore.project?.crs ?? 'EPSG:3857' }}</span>
    <span>所选要素：{{ projectStore.selection.featureIds.length }}</span>
    <span>{{ projectStore.dirty ? '已修改' : '已保存' }}</span>
    <span>工具：{{ toolLabel }}</span>
    <strong>{{ uiStore.statusMessage }}</strong>
  </footer>
</template>
