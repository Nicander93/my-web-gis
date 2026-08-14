<script setup lang="ts">
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()

async function run(action: () => Promise<unknown> | unknown, message: string): Promise<void> {
  try {
    await action()
    uiStore.setStatus(message)
  } catch (error) {
    uiStore.showError('Command failed', message, String(error))
  }
}
</script>

<template>
  <nav class="menu-bar" aria-label="Application menu">
    <button @click="projectStore.newProject()">项目(P)</button>
    <button @click="run(projectStore.openProjectFromDialog, '项目已打开')">打开</button>
    <button @click="run(projectStore.saveProject, '已保存')">保存</button>
    <button @click="uiStore.addDataDialogOpen = true">添加数据</button>
    <button @click="run(() => projectStore.exportActiveLayer(false), '图层已导出')">导出</button>
    <span class="menu-spacer"></span>
    <span class="window-title">
      {{ projectStore.project?.name }}
      <strong v-if="projectStore.dirty">*</strong>
    </span>
  </nav>
</template>
