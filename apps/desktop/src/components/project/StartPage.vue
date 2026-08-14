<script setup lang="ts">
import { exampleDatasets } from '@/data/exampleDatasets'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()

async function openProject(): Promise<void> {
  try {
    await projectStore.openProjectFromDialog()
    uiStore.setStatus('项目已打开')
  } catch (error) {
    uiStore.showError('无法打开项目', '请选择有效的项目文件。', String(error))
  }
}

async function openRecentProject(path: string): Promise<void> {
  try {
    await projectStore.openRecentProject(path)
    uiStore.setStatus('项目已打开')
  } catch (error) {
    uiStore.showError('打开最近项目', '请使用“打开项目”重新定位项目文件。', String(error))
  }
}

async function openExample(): Promise<void> {
  try {
    await projectStore.newProject('示例项目')
    if (!projectStore.project) return
    for (const dataset of exampleDatasets) {
      projectStore.importGeoJsonText(dataset.name, dataset.content, dataset.path)
    }
    uiStore.setStatus('已打开示例数据')
  } catch (error) {
    uiStore.showError('无法打开示例', '示例 GeoJSON 无法加载。', String(error))
  }
}

async function dropFiles(event: DragEvent): Promise<void> {
  event.preventDefault()
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length === 0) return
  try {
    await projectStore.newProject('未命名项目')
    if (!projectStore.project) return
    const count = await projectStore.importGeoJsonFiles(files)
    uiStore.setStatus(`已导入 ${count} 个文件`)
  } catch (error) {
    uiStore.showError('导入失败', '请拖入有效的 GeoJSON 文件。', String(error))
  }
}
</script>

<template>
  <main class="start-page" @dragover.prevent @drop="dropFiles">
    <div class="start-content">
      <div class="sketch-mark" aria-hidden="true"></div>
      <h1>桌面 WebGIS</h1>
      <p>轻量二维 GIS 工作台</p>
      <div class="start-actions">
        <button class="primary-button" type="button" @click="projectStore.newProject()">新建项目</button>
        <button class="ghost-button" type="button" @click="openProject">打开项目</button>
        <button class="ghost-button" type="button" @click="openExample">打开示例数据</button>
      </div>
      <section class="recent-list">
        <h2>最近项目</h2>
        <p v-if="projectStore.recentProjects.length === 0" class="empty-recent">还没有最近项目</p>
        <button
          v-for="recent in projectStore.recentProjects"
          :key="recent.path"
          class="recent-row"
          type="button"
          @click="openRecentProject(recent.path)"
        >
          <span>{{ recent.name }}</span>
          <small>{{ recent.path }}</small>
        </button>
      </section>
    </div>
  </main>
</template>
