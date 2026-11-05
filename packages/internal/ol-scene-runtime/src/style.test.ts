import { describe, expect, it } from 'vitest'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import { compileStyle } from '@desktop-webgis/ol-style'
import type { SceneLayerStyle } from '@desktop-webgis/scene-schema'
import { createOlStyleFunction, toOlLayerStyle } from './style.js'

function pointFeature(properties: Record<string, unknown>): Feature<Point> {
  const feature = new Feature({ geometry: new Point([0, 0]), ...properties })
  return feature
}

describe('scene style via shared ol-style compiler', () => {
  it('maps SceneLayerStyle to LayerStyle without structural loss', () => {
    const style: SceneLayerStyle = {
      mode: 'categorized',
      field: 'status',
      categories: [
        {
          value: 'open',
          symbol: { type: 'circle', radius: 8, fill: { r: 0, g: 160, b: 0, a: 1 } }
        }
      ],
      fallback: { type: 'circle', radius: 4, fill: { r: 100, g: 100, b: 100, a: 1 } }
    }

    expect(toOlLayerStyle(style)).toEqual(style)
  })

  it('assigns the same category symbols as Desktop compileStyle', () => {
    const style: SceneLayerStyle = {
      mode: 'categorized',
      field: 'status',
      categories: [
        {
          value: 'open',
          symbol: { type: 'circle', radius: 8, fill: { r: 0, g: 160, b: 0, a: 1 } }
        },
        {
          value: 'closed',
          symbol: { type: 'circle', radius: 5, fill: { r: 200, g: 0, b: 0, a: 1 } }
        }
      ],
      fallback: { type: 'circle', radius: 3, fill: { r: 120, g: 120, b: 120, a: 1 } }
    }

    const desktop = compileStyle(toOlLayerStyle(style))
    const viewer = createOlStyleFunction(style)

    for (const status of ['open', 'closed', 'unknown'] as const) {
      const feature = pointFeature({ status })
      const desktopRadius = desktop(feature).getImage()?.getRadius()
      const viewerRadius = viewer(feature, 1)?.getImage()?.getRadius()
      expect(viewerRadius).toBe(desktopRadius)
    }
  })

  it('uses the same graduated break ownership as Desktop (above max → last break)', () => {
    const style: SceneLayerStyle = {
      mode: 'graduated',
      field: 'value',
      method: 'manual',
      breaks: [
        { value: 10, symbol: { type: 'circle', radius: 4, fill: { r: 1, g: 1, b: 1, a: 1 } } },
        { value: 20, symbol: { type: 'circle', radius: 8, fill: { r: 2, g: 2, b: 2, a: 1 } } }
      ],
      fallback: { type: 'circle', radius: 2, fill: { r: 9, g: 9, b: 9, a: 1 } },
      label: { field: 'name', fontSize: 14, offsetY: -12 }
    }

    const desktop = compileStyle(toOlLayerStyle(style))
    const viewer = createOlStyleFunction(style)

    for (const value of [5, 10, 15, 20, 50] as const) {
      const feature = pointFeature({ value, name: 'N' })
      expect(viewer(feature, 1)?.getImage()?.getRadius()).toBe(desktop(feature).getImage()?.getRadius())
      expect(viewer(feature, 1)?.getText()?.getText()).toBe('N')
      expect(viewer(feature, 1)?.getText()?.getOffsetY()).toBe(-12)
    }
  })
})
