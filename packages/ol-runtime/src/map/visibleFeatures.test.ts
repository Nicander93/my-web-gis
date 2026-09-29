import { describe, expect, it } from 'vitest'
import { applyFieldFilter, type GisFeature, type Layer } from '@desktop-webgis/gis-core'
import { createDefaultLayerStyle } from '@desktop-webgis/gis-core'

/**
 * Map↔table linkage contract: ol-runtime syncLayers uses the same applyFieldFilter
 * as the attribute table (F). This unit test locks that shared helper path.
 */
describe('visible feature filter linkage', () => {
  it('layer.filter yields the same F for map sync and table', () => {
    const features: GisFeature[] = [
      {
        id: 'f-1',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { cls: 'A', v: 1 }
      },
      {
        id: 'f-2',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: { cls: 'B', v: 2 }
      },
      {
        id: 'f-3',
        geometry: { type: 'Point', coordinates: [2, 2] },
        properties: { cls: 'A', v: 3 }
      }
    ]

    const layer: Layer = {
      id: 'layer-1',
      datasetId: 'ds-1',
      name: 'demo',
      visible: true,
      opacity: 1,
      editable: false,
      style: createDefaultLayerStyle('point'),
      filter: [{ field: 'cls', op: 'eq', value: 'A' }]
    }

    const visible = applyFieldFilter(features, layer.filter)
    expect(visible.map((f) => f.id)).toEqual(['f-1', 'f-3'])

    // Selection must drop IDs outside F (hidden ⇒ not highlightable after sync)
    const selectionBefore = ['f-1', 'f-2']
    const selectionAfter = selectionBefore.filter((id) => visible.some((f) => f.id === id))
    expect(selectionAfter).toEqual(['f-1'])
  })
})
