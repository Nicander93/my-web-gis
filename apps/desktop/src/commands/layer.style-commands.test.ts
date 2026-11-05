import { layerConfigurationQueries } from '@/project/layer-configuration-query'
import { featureData } from '@/project/datasets/feature-data'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultLayerStyle } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { layerCommands } from './layer.commands'

describe('layerCommands.applyStyle undo', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      dispatchEvent: () => true
    }
    layerCommands._resetStyleHistoryForTests()
    useProjectStore.setState({ project: { metadata: { id: 'p', formatVersion: 1, name: 'test' }, content: { kind: 'map2d', crs: 'EPSG:3857', datasets: [{ id: 'd1', name: 'd', kind: 'vector', source: { type: 'memory', label: 'd' } }], layers: [
          {
            id: 'l1',
            datasetId: 'd1',
            name: 'layer',
            visible: true,
            opacity: 1,
            editable: false,
            style: createDefaultLayerStyle('point')
          }
        ], groups: [], rootOrder: [{ type: 'layer', id: 'layer-1' }], initialView: { center: [0, 0], zoom: 2, rotation: 0 }, basemap: { type: 'osm' }, settings: {} } }, dirty: false }); featureData.replaceAll({
        d1: [
          {
            id: 'f1',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { name: 'a' }
          }
        ]
      }); useLayerViewStore.setState({ selectedLayerId: 'l1' })
    useLayerViewStore.setState({ sessions: {} })
  })

  it('apply is one undoable config op', () => {
    const before = layerConfigurationQueries.getNormalizedLayerStyle('l1')!
    const after = {
      ...before,
      mode: 'single' as const,
      symbol: {
        type: 'circle' as const,
        radius: 9,
        fill: { r: 1, g: 2, b: 3, a: 1 }
      }
    }

    expect(layerCommands.applyStyle('l1', after)).toBe(true)
    const applied = layerConfigurationQueries.getNormalizedLayerStyle('l1')!
    expect(applied.mode).toBe('single')
    if (applied.mode === 'single' && applied.symbol.type === 'circle') {
      expect(applied.symbol.radius).toBe(9)
    }

    expect(layerCommands.undoStyle()).toBe(true)
    const undone = layerConfigurationQueries.getNormalizedLayerStyle('l1')!
    expect(undone).toEqual(before)

    expect(layerCommands.redoStyle()).toBe(true)
    const redone = layerConfigurationQueries.getNormalizedLayerStyle('l1')!
    if (redone.mode === 'single' && redone.symbol.type === 'circle') {
      expect(redone.symbol.radius).toBe(9)
    }
  })
})
