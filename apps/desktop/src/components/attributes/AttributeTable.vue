<script setup lang="ts">
import { ref } from 'vue'
import { useProjectStore } from '@/stores/project.store'

const projectStore = useProjectStore()
const editing = ref<{ featureId: string; key: string } | null>(null)
const draft = ref('')

function startEdit(featureId: string, key: string, value: unknown): void {
  if (key === 'id') return
  editing.value = { featureId, key }
  draft.value = value == null ? '' : String(value)
}

function commitEdit(): void {
  if (!editing.value) return
  projectStore.updateFeatureProperty(editing.value.featureId, editing.value.key, draft.value)
  editing.value = null
}

function isEditing(featureId: string, key: string): boolean {
  return editing.value?.featureId === featureId && editing.value.key === key
}
</script>

<template>
  <div class="attribute-table-wrap">
    <table class="attribute-table">
      <thead>
        <tr>
          <th v-for="column in projectStore.attributeColumns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="feature in projectStore.activeFeatures"
          :key="feature.id"
          :class="{ selected: projectStore.selection.featureIds.includes(feature.id) }"
          @click="projectStore.selectFeature(feature.id, $event.ctrlKey || $event.metaKey)"
        >
          <td
            v-for="column in projectStore.attributeColumns"
            :key="column"
            @dblclick="startEdit(feature.id, column, column === 'id' ? feature.id : feature.properties[column])"
          >
            <input
              v-if="isEditing(feature.id, column)"
              v-model="draft"
              class="cell-input"
              @keydown.enter="commitEdit"
              @keydown.esc="editing = null"
              @blur="commitEdit"
            />
            <span v-else>{{ column === 'id' ? feature.id : feature.properties[column] }}</span>
          </td>
        </tr>
        <tr v-if="projectStore.activeFeatures.length === 0">
          <td :colspan="Math.max(projectStore.attributeColumns.length, 1)" class="table-empty">
            当前活动图层暂无要素。
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
