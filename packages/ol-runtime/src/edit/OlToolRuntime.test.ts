import { describe, expect, it, vi } from 'vitest'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import LineString from 'ol/geom/LineString'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import View from 'ol/View'
import Snap from 'ol/interaction/Snap'
import Select from 'ol/interaction/Select'
import type Interaction from 'ol/interaction/Interaction'
import type Map from 'ol/Map'
import { OlMapRuntime } from '../map/OlMapRuntime'
import { DEFAULT_SNAPPING, OlToolRuntime, type ToolCallbacks } from './OlToolRuntime'

function fixture() {
  const runtime = new OlMapRuntime()
  const interactions: Interaction[] = []
  const view = new View({ center: [0, 0], resolution: 1 })
  const map = {
    getView: () => view,
    getPixelFromCoordinate: (coordinate: number[]) => coordinate,
    addInteraction: (interaction: Interaction) => {
      interactions.push(interaction)
      if (interaction instanceof Snap) interaction.setMap(map as unknown as Map)
    },
    removeInteraction: (interaction: Interaction) => {
      const index = interactions.indexOf(interaction)
      if (index >= 0) interactions.splice(index, 1)
      if (interaction instanceof Snap) {
        // OL accepts null on removal, although Snap's override narrows its declaration.
        (interaction as unknown as { setMap(map: Map | null): void }).setMap(null)
      }
    }
  }
  vi.spyOn(runtime, 'getMap').mockReturnValue(map as unknown as Map)
  const source = new VectorSource({ features: [new Feature(new LineString([[0, 0], [100, 0]]))] })
  const reference = new VectorSource({ features: [new Feature(new Point([200, 0]))] })
  const layer = new VectorLayer({ source })
  const referenceLayer = new VectorLayer({ source: reference })
  runtime.registry.register('active', 'a', layer)
  runtime.registry.register('reference', 'b', referenceLayer)
  const callbacks: ToolCallbacks = { getActiveLayerId: () => 'active', onAddFeature: vi.fn(), onDeleteFeatures: vi.fn(), onUpdateGeometry: vi.fn(), onSelectionChange: vi.fn() }
  const tool = new OlToolRuntime(runtime)
  const snap = () => interactions.find((item): item is Snap => item instanceof Snap)!
  const hit = (coordinate: number[]) => snap().snapTo(coordinate, coordinate, map as unknown as Map)
  return { tool, interactions, callbacks, hit, reference, referenceLayer, layer, source, snap }
}

describe('editing capture', () => {
  it('snaps to vertices and edges within tolerance without replacing an unfinished Draw', () => {
    const f = fixture()
    f.tool.activate('draw-line', f.callbacks)
    const draw = f.interactions[0]
    expect(f.hit([3, 2])?.vertex).toEqual([0, 0])
    expect(f.hit([50, 5])?.vertex).toEqual([50, 0])
    expect(f.hit([50, 11])).toBeNull()
    f.tool.setSnapping({ ...DEFAULT_SNAPPING, edge: false })
    expect(f.interactions[0]).toBe(draw)
    expect(f.hit([50, 5])).toBeNull()
    f.tool.setSnapping({ ...DEFAULT_SNAPPING, vertex: false, pixelTolerance: 3 })
    expect(f.hit([50, 5])).toBeNull()
    expect(f.hit([50, 2])?.vertex).toEqual([50, 0])
    f.tool.setSnapping({ ...DEFAULT_SNAPPING, enabled: false })
    expect(f.interactions).toEqual([draw])
  })

  it('captures visible references and follows target changes and visibility', () => {
    const f = fixture()
    f.tool.activate('draw-point', f.callbacks)
    expect(f.hit([202, 0])).toBeNull()
    f.tool.setSnapping({ ...DEFAULT_SNAPPING, scope: 'visible' })
    expect(f.hit([202, 0])?.vertex).toEqual([200, 0])
    const point = new Feature(new Point([300, 0]))
    f.reference.addFeature(point)
    expect(f.hit([302, 0])?.vertex).toEqual([300, 0])
    point.setGeometry(new Point([400, 0]))
    expect(f.hit([402, 0])?.vertex).toEqual([400, 0])
    f.reference.removeFeature(point)
    expect(f.hit([402, 0])).toBeNull()
    f.referenceLayer.setVisible(false)
    f.tool.refreshSnapping()
    expect(f.hit([202, 0])).toBeNull()
    f.tool.deactivate()
    expect(f.interactions).toHaveLength(0)
    expect(f.reference.hasListener('addfeature')).toBe(false)
  })

  it('restricts editing to the active layer and installs Snap after Modify', () => {
    const f = fixture()
    for (const mode of ['modify', 'delete'] as const) {
      f.tool.activate(mode, f.callbacks)
      const select = f.interactions.find((item): item is Select => item instanceof Select)!
      // Exercise the layer predicate passed to OpenLayers, without browser hit detection.
      const filter = (select as unknown as { layerFilter_: (layer: VectorLayer) => boolean }).layerFilter_
      expect(filter(f.layer)).toBe(true)
      expect(filter(f.referenceLayer)).toBe(false)
      expect(f.interactions.at(-1) instanceof Snap).toBe(mode === 'modify')
    }
  })

  it('clears capture feedback and listeners when capture is disabled', () => {
    const f = fixture()
    const feedback = vi.fn()
    f.tool.setSnapping(DEFAULT_SNAPPING, feedback)
    f.tool.activate('draw-point', f.callbacks)
    f.snap().dispatchEvent('snap')
    expect(feedback).toHaveBeenLastCalledWith(true)
    f.snap().dispatchEvent('unsnap')
    expect(feedback).toHaveBeenLastCalledWith(false)
    f.tool.setSnapping({ ...DEFAULT_SNAPPING, enabled: false })
    expect(feedback).toHaveBeenLastCalledWith(false)
    expect(f.source.hasListener('addfeature')).toBe(false)
  })
})
