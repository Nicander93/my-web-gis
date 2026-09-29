import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultLayerStyle } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { layerCommands } from './layer.commands'

describe('layerCommands.applyStyle undo', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      dispatchEvent: () => true
    }
    layerCommands._resetStyleHistoryForTests()
    useProjectStore.setState({
      project: {
        id: 'p',
        version: 1,
        name: 'test',
        crs: 'EPSG:3857',
        datasets: [{ id: 'd1', name: 'd', kind: 'vector', source: { type: 'memory', label: 'd' } }],
        layers: [
          {
            id: 'l1',
            datasetId: 'd1',
            name: 'layer',
            visible: true,
            opacity: 1,
            editable: false,
            style: createDefaultLayerStyle('point')
          }
        ],
        groups: [],
    rootOrder: [{ type: 'layer', id: 'layer-1' }],
    mapState: { center: [0, 0], zoom: 2, rotation: 0 },
        basemap: { type: 'osm' },
        settings: {}
      },
      featuresByDataset: {
        d1: [
          {
            id: 'f1',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { name: 'a' }
          }
        ]
      },
      dirty: false,
      selectedLayerId: 'l1'
    })
    useSessionStore.setState({ sessions: {} })
  })

  it('apply is one undoable config op', () => {
    const before = useProjectStore.getState().getNormalizedLayerStyle('l1')!
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
    const applied = useProjectStore.getState().getNormalizedLayerStyle('l1')!
    expect(applied.mode).toBe('single')
    if (applied.mode === 'single' && applied.symbol.type === 'circle') {
      expect(applied.symbol.radius).toBe(9)
    }

    expect(layerCommands.undoStyle()).toBe(true)
    const undone = useProjectStore.getState().getNormalizedLayerStyle('l1')!
    expect(undone).toEqual(before)

    expect(layerCommands.redoStyle()).toBe(true)
    const redone = useProjectStore.getState().getNormalizedLayerStyle('l1')!
    if (redone.mode === 'single' && redone.symbol.type === 'circle') {
      expect(redone.symbol.radius).toBe(9)
    }
  })
})
