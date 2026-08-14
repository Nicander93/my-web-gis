<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AppMenuBar from './AppMenuBar.vue'
import PrimaryToolbar from './PrimaryToolbar.vue'
import WorkspaceSidebar from './WorkspaceSidebar.vue'
import WorkspaceInspector from './WorkspaceInspector.vue'
import BottomPanel from './BottomPanel.vue'
import StatusBar from './StatusBar.vue'
import CommandPalette from './CommandPalette.vue'
import MapCanvas from '../map/MapCanvas.vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()

onMounted(() => window.addEventListener('keydown', handleShortcut))
onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShortcut)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

async function handleShortcut(event: KeyboardEvent): Promise<void> {
  const mod = event.ctrlKey || event.metaKey
  if (mod && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    projectStore.newProject()
  } else if (mod && event.key.toLowerCase() === 'o') {
    event.preventDefault()
    await projectStore.openProjectFromDialog()
  } else if (mod && event.key.toLowerCase() === 's' && event.shiftKey) {
    event.preventDefault()
    await projectStore.saveProjectAs()
  } else if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault()
    await projectStore.saveProject()
  } else if (mod && event.key.toLowerCase() === 'z' && event.shiftKey) {
    event.preventDefault()
    projectStore.redo()
  } else if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    projectStore.undo()
  } else if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault()
    uiStore.commandPaletteOpen = true
  } else if (event.key === 'Delete') {
    event.preventDefault()
    projectStore.deleteSelectedFeatures()
  } else if (event.key === 'Escape') {
    projectStore.setActiveTool('select')
    projectStore.clearSelection()
    uiStore.setStatus('选择要素')
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!projectStore.dirty) return
  event.preventDefault()
  event.returnValue = ''
}
</script>

<template>
  <main class="workspace-shell">
    <AppMenuBar />
    <PrimaryToolbar />
    <div class="workspace-main">
      <WorkspaceSidebar />
      <MapCanvas />
      <WorkspaceInspector />
    </div>
    <BottomPanel />
    <StatusBar />
    <CommandPalette />
  </main>
</template>
