import { create } from 'zustand'
import { createProject, createDefaultLayerStyle, createId, cloneValue } from '@desktop-webgis/gis-core'
import type { Project, Dataset, Layer, GisFeature } from '@desktop-webgis/gis-core'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'

interface ProjectState {
  project: Project
  featuresByDataset: Record<string, GisFeature[]>
  dirty: boolean
  selectedLayerId: string | null

  addLayer(datasetId: string, name: string, features: GisFeature[], styleKind: 'point' | 'line' | 'polygon' | 'mixed'): void
  setSelectedLayer(layerId: string | null): void
  setDirty(dirty: boolean): void
  /** 写入已应用样式（不入历史；由 command 包装成可撤销操作） */
  setLayerStyle(layerId: string, style: LayerStyle): void
  getNormalizedLayerStyle(layerId: string): LayerStyle | null
}

export const useProjectStore = create<ProjectState>((set, get) => ({
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
  setDirty: (dirty) => set({ dirty }),

  setLayerStyle: (layerId, style) =>
    set((state) => ({
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id === layerId ? { ...layer, style: cloneValue(style) } : layer
        )
      },
      dirty: true
    })),

  getNormalizedLayerStyle: (layerId) => {
    const layer = get().project.layers.find((item) => item.id === layerId)
    if (!layer) return null
    return isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : cloneValue(layer.style)
  }
}))
