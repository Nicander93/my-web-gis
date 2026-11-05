import type { Project } from '@desktop-webgis/project'

function createTopic<T>() {
  const listeners = new Set<(payload: T) => void>()
  return {
    subscribe(listener: (payload: T) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    emit(payload: T) {
      for (const listener of [...listeners]) listener(payload)
    }
  }
}

const projectReplaced = createTopic<void>()
const layersRemoved = createTopic<readonly string[]>()
const datasetFieldsChanged = createTopic<{ datasetId: string; from: string; to: string | undefined; project: Project }>()
const snapshotApplied = createTopic<{ removedLayers: string[]; dataChangedLayers: string[]; project: Project }>()
const selectionFilter = createTopic<{ project: Project; before: Project; scope: 'configuration' | 'data' }>()

export function onProjectReplaced(listener: () => void) {
  return projectReplaced.subscribe(() => listener())
}
export function notifyProjectReplaced() {
  projectReplaced.emit(undefined)
}

export function onLayersRemoved(listener: (layerIds: readonly string[]) => void) {
  return layersRemoved.subscribe(listener)
}
export function notifyLayersRemoved(layerIds: readonly string[]) {
  layersRemoved.emit(layerIds)
}

export function onDatasetFieldsChanged(listener: (payload: { datasetId: string; from: string; to: string | undefined; project: Project }) => void) {
  return datasetFieldsChanged.subscribe(listener)
}
export function notifyDatasetFieldsChanged(payload: { datasetId: string; from: string; to: string | undefined; project: Project }) {
  datasetFieldsChanged.emit(payload)
}

export function onSnapshotApplied(listener: (payload: { removedLayers: string[]; dataChangedLayers: string[]; project: Project }) => void) {
  return snapshotApplied.subscribe(listener)
}
export function notifySnapshotApplied(payload: { removedLayers: string[]; dataChangedLayers: string[]; project: Project }) {
  snapshotApplied.emit(payload)
}

export function onSelectionFilter(listener: (payload: { project: Project; before: Project; scope: 'configuration' | 'data' }) => void) {
  return selectionFilter.subscribe(listener)
}
export function notifySelectionFilter(payload: { project: Project; before: Project; scope: 'configuration' | 'data' }) {
  selectionFilter.emit(payload)
}
