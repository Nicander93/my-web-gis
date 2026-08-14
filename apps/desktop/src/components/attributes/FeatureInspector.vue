<script setup lang="ts">
import { ref } from 'vue'
import { useProjectStore } from '@/stores/project.store'

const projectStore = useProjectStore()
const editingKey = ref<string | null>(null)
const draft = ref('')

function startEdit(key: string, value: unknown): void {
  editingKey.value = key
  draft.value = value == null ? '' : String(value)
}

function commitEdit(featureId: string): void {
  if (!editingKey.value) return
  projectStore.updateFeatureProperty(featureId, editingKey.value, draft.value)
  editingKey.value = null
}
</script>

<template>
  <div class="feature-inspector">
    <div v-if="projectStore.selectedFeatures.length !== 1" class="panel-empty">
      请选择单个要素查看属性。
    </div>
    <section v-else>
      <h3>要素</h3>
      <dl class="metadata-list">
        <div><dt>ID</dt><dd>{{ projectStore.selectedFeatures[0].id }}</dd></div>
        <div><dt>几何</dt><dd>{{ projectStore.selectedFeatures[0].geometry.type }}</dd></div>
      </dl>
      <h3>属性</h3>
      <div class="property-list">
        <div v-for="(value, key) in projectStore.selectedFeatures[0].properties" :key="key" class="property-row">
          <span>{{ key }}</span>
          <input
            v-if="editingKey === key"
            v-model="draft"
            @keydown.enter="commitEdit(projectStore.selectedFeatures[0].id)"
            @keydown.esc="editingKey = null"
            @blur="commitEdit(projectStore.selectedFeatures[0].id)"
          />
          <button v-else @click="startEdit(String(key), value)">{{ value }}</button>
        </div>
      </div>
    </section>
  </div>
</template>
