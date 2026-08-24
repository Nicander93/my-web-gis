<script setup lang="ts">
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
const nextTheme = { system: 'light', light: 'dark', dark: 'system' } as const

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
    <button @click="run(projectStore.openSceneFromDialog, '场景已打开')">打开场景</button>
    <button @click="run(projectStore.saveProject, '已保存')">保存</button>
    <button @click="uiStore.addDataDialogOpen = true">添加数据</button>
    <button @click="run(() => projectStore.exportActiveLayer(false), '图层已导出')">导出</button>
    <button @click="run(() => projectStore.exportScene(uiStore.theme), '场景 JSON 已导出')">导出场景</button>
    <button @click="run(() => projectStore.exportOpenLayersCode(uiStore.theme), 'OpenLayers 代码已导出')">导出代码</button>
    <span class="menu-spacer"></span>
    <button title="切换浅色、深色或跟随系统" @click="uiStore.setTheme(nextTheme[uiStore.theme])">
      主题: {{ uiStore.theme === 'system' ? '系统' : uiStore.theme === 'light' ? '浅色' : '深色' }}
    </button>
    <span class="window-title">
      {{ projectStore.project?.name }}
      <strong v-if="projectStore.dirty">*</strong>
    </span>
  </nav>
</template>
