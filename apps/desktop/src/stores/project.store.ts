import { create } from 'zustand'
import { createProject, createDefaultLayerStyle, createId } from '@desktop-webgis/gis-core'
import type { Project, Dataset, Layer, GisFeature } from '@desktop-webgis/gis-core'

interface ProjectState {
  project: Project
  featuresByDataset: Record<string, GisFeature[]>
  dirty: boolean
  selectedLayerId: string | null
  
  addLayer(datasetId: string, name: string, features: GisFeature[], styleKind: 'point' | 'line' | 'polygon' | 'mixed'): void
  setSelectedLayer(layerId: string | null): void
  setDirty(dirty: boolean): void
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: createProject(),
  featuresByDataset: {},
  dirty: false,
  selectedLayerId: null,

  addLayer: (datasetId, name, features, styleKind) =>
    set((state) => {
      const dataset: Dataset = {
        id: datasetId,
        name,
        kind: 'vector',
        source: { type: 'memory', label: name }
      }

      const layer: Layer = {
        id: createId('layer'),
        datasetId,
        name,
        visible: true,
        opacity: 1,
        editable: false,
        style: createDefaultLayerStyle(styleKind)
      }

      return {
        project: {
          ...state.project,
          datasets: [...state.project.datasets, dataset],
          layers: [...state.project.layers, layer]
        },
        featuresByDataset: {
          ...state.featuresByDataset,
          [datasetId]: features
        },
        dirty: true,
        selectedLayerId: layer.id
      }
    }),

  setSelectedLayer: (layerId) => set({ selectedLayerId: layerId }),
  setDirty: (dirty) => set({ dirty })
}))
