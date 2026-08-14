<script setup lang="ts">
import AttributeTable from '../attributes/AttributeTable.vue'
import FeatureInspector from '../attributes/FeatureInspector.vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()
</script>

<template>
  <section v-if="uiStore.bottomPanelOpen" class="bottom-panel" :style="{ height: `${uiStore.bottomPanelHeight}px` }">
    <header class="bottom-header">
      <div class="panel-tabs">
        <button :class="{ active: uiStore.bottomPanelTab === 'table' }" @click="uiStore.bottomPanelTab = 'table'">
          属性表
        </button>
        <button :class="{ active: uiStore.bottomPanelTab === 'feature' }" @click="uiStore.bottomPanelTab = 'feature'">
          要素
        </button>
      </div>
      <span>属性表 - {{ projectStore.activeLayer?.name ?? '无图层' }}</span>
      <strong>已选择 {{ projectStore.selection.featureIds.length }} / {{ projectStore.activeFeatures.length }}</strong>
      <button title="关闭属性表" @click="uiStore.bottomPanelOpen = false">x</button>
    </header>
    <AttributeTable v-if="uiStore.bottomPanelTab === 'table'" />
    <FeatureInspector v-else />
  </section>
</template>
