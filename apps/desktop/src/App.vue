<script setup lang="ts">
import AppDialog from './components/shared/AppDialog.vue'
import UnsavedDialog from './components/shared/UnsavedDialog.vue'
import AddDataDialog from './components/shared/AddDataDialog.vue'
import StartPage from './components/project/StartPage.vue'
import MainWorkspace from './components/shell/MainWorkspace.vue'
import { useProjectStore } from './stores/project.store'

const projectStore = useProjectStore()
</script>

<template>
  <StartPage v-if="!projectStore.project" />
  <MainWorkspace v-else />
  <AddDataDialog />
  <UnsavedDialog />
  <AppDialog />
</template>
