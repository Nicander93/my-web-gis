<script setup lang="ts">
import { useUiStore } from '@/stores/ui.store'

const uiStore = useUiStore()
</script>

<template>
  <div v-if="uiStore.dialog" class="dialog-backdrop" @click.self="uiStore.closeDialog()">
    <section class="app-dialog" role="dialog" aria-modal="true">
      <h2>{{ uiStore.dialog.title }}</h2>
      <p>{{ uiStore.dialog.message }}</p>
      <details v-if="uiStore.dialog.details">
        <summary>Show details</summary>
        <pre>{{ uiStore.dialog.details }}</pre>
      </details>
      <footer>
        <button class="primary-button" @click="uiStore.closeDialog()">Close</button>
      </footer>
    </section>
  </div>
</template>
