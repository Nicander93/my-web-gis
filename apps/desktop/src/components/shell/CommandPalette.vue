<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EditTool } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const query = ref('')

type PaletteCommand =
  | { label: string; run: () => Promise<unknown> | unknown; tool?: never }
  | { label: string; tool: EditTool; run?: never }

const commands: PaletteCommand[] = [
  { label: '添加数据', run: () => (uiStore.addDataDialogOpen = true) },
  { label: '打开项目', run: () => projectStore.openProjectFromDialog() },
  { label: '保存项目', run: () => projectStore.saveProject() },
  { label: '另存项目', run: () => projectStore.saveProjectAs() },
  { label: '缩放到全部', run: () => window.dispatchEvent(new CustomEvent('desktop-webgis:zoom-to-all')) },
  { label: '导出图层', run: () => projectStore.exportActiveLayer(false) },
  { label: '导出所选要素', run: () => projectStore.exportActiveLayer(true) },
  { label: '删除所选要素', run: () => projectStore.deleteSelectedFeatures() },
  { label: '绘制点', tool: 'draw-point' as EditTool },
  { label: '绘制线', tool: 'draw-line' as EditTool },
  { label: '绘制多边形', tool: 'draw-polygon' as EditTool },
  { label: '修改要素', tool: 'modify' as EditTool },
  { label: '选择要素', tool: 'select' as EditTool }
]

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return commands
  return commands.filter((command) => command.label.toLowerCase().includes(needle))
})

async function runCommand(command: PaletteCommand): Promise<void> {
  if (command.tool) {
    projectStore.setActiveTool(command.tool)
  } else {
    await command.run()
  }
  uiStore.commandPaletteOpen = false
  query.value = ''
}
</script>

<template>
  <div v-if="uiStore.commandPaletteOpen" class="palette-backdrop" @click.self="uiStore.commandPaletteOpen = false">
    <section class="command-palette">
      <input v-model="query" autofocus placeholder="输入命令" @keydown.esc="uiStore.commandPaletteOpen = false" />
      <button v-for="command in filtered" :key="command.label" @click="runCommand(command)">
        {{ command.label }}
      </button>
    </section>
  </div>
</template>
