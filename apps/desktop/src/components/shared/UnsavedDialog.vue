<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useUiStore } from '@/stores/ui.store'

const uiStore = useUiStore()

watch(
  () => uiStore.unsavedPrompt,
  (prompt) => {
    if (prompt) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') uiStore.answerUnsaved('cancel')
}
</script>

<template>
  <div
    v-if="uiStore.unsavedPrompt"
    class="dialog-backdrop"
    @click.self="uiStore.answerUnsaved('cancel')"
  >
    <section class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
      <h2 id="unsaved-title">是否保存对“{{ uiStore.unsavedPrompt.name }}”的更改？</h2>
      <p>如果不保存，更改将丢失。</p>
      <footer>
        <button class="ghost-button" type="button" @click="uiStore.answerUnsaved('cancel')">取消</button>
        <button class="ghost-button" type="button" @click="uiStore.answerUnsaved('discard')">不保存</button>
        <button class="primary-button" type="button" @click="uiStore.answerUnsaved('save')">保存</button>
      </footer>
    </section>
  </div>
</template>
