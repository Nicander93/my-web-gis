<script setup lang="ts">
import LayerPanel from '../layers/LayerPanel.vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
</script>

<template>
  <aside class="sidebar" :style="{ width: `${uiStore.sidebarWidth}px` }">
    <div class="sidebar-tabs">
      <button :class="{ active: uiStore.activeSidebarTab === 'project' }" @click="uiStore.activeSidebarTab = 'project'">
        项目
      </button>
      <button :class="{ active: uiStore.activeSidebarTab === 'layers' }" @click="uiStore.activeSidebarTab = 'layers'">
        图层
      </button>
      <button :class="{ active: uiStore.activeSidebarTab === 'data' }" @click="uiStore.activeSidebarTab = 'data'">
        数据源
      </button>
    </div>

    <LayerPanel v-if="uiStore.activeSidebarTab === 'layers'" />

    <section v-else-if="uiStore.activeSidebarTab === 'project'" class="side-section">
      <h2>项目</h2>
      <dl class="metadata-list">
        <div><dt>名称</dt><dd>{{ projectStore.project?.name }}</dd></div>
        <div><dt>坐标系</dt><dd>{{ projectStore.project?.crs }}</dd></div>
        <div><dt>图层</dt><dd>{{ projectStore.layers.length }}</dd></div>
        <div><dt>路径</dt><dd>{{ projectStore.projectPath ?? '未保存' }}</dd></div>
      </dl>
    </section>

    <section v-else class="side-section">
      <h2>数据源</h2>
      <div v-for="dataset in projectStore.datasets" :key="dataset.id" class="dataset-row">
        <span>{{ dataset.name }}</span>
        <small>{{ dataset.source.type }}</small>
      </div>
      <div v-if="projectStore.datasets.length === 0" class="panel-empty">暂无数据源</div>
    </section>
  </aside>
</template>
