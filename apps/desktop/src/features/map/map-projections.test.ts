import { describe, expect, it } from 'vitest'
import View from 'ol/View'
import { getPointResolution, transform } from 'ol/proj'
import { projectedMapView, registerMapProjections } from './map-projections'

registerMapProjections()

describe('map projection switching', () => {
  it('preserves local center, scale and rotation for a matching domestic zone', () => {
    const center = transform([116.4, 39.9], 'EPSG:4490', 'EPSG:3857')
    const original = new View({ center, zoom: 12, rotation: .3 })
    const projected = projectedMapView(original, 'EPSG:4527')
    const view = new View(projected)
    const geographic = transform(view.getCenter()!, view.getProjection(), 'EPSG:4490')
    expect(geographic[0]).toBeCloseTo(116.4, 6)
    expect(geographic[1]).toBeCloseTo(39.9, 6)
    expect(projected.center[0]).toBeGreaterThan(39_000_000)
    expect(projected.rotation).toBe(.3)
    const a = getPointResolution(original.getProjection(), original.getResolution()!, center, 'm')
    const b = getPointResolution(view.getProjection(), view.getResolution()!, projected.center, 'm')
    expect(b).toBeCloseTo(a, 5)
  })

  it('refuses an unrelated zone and unknown definition before touching the view', () => {
    const view = new View({ center: transform([116.4, 39.9], 'EPSG:4326', 'EPSG:3857'), zoom: 12 })
    expect(() => projectedMapView(view, 'EPSG:4513')).toThrow('分带')
    expect(() => projectedMapView(view, 'EPSG:999999')).toThrow('不支持')
    expect(view.getProjection().getCode()).toBe('EPSG:3857')
  })

  it('transforms declared extent constraints and preserves zoom limits', () => {
    const view = new View({ projection: 'EPSG:4326', center: [116.4, 39.9], zoom: 12 })
    const next = projectedMapView(view, 'EPSG:4527', { extent: [116, 39, 117, 40], minZoom: 3, maxZoom: 18 })
    expect(next).toMatchObject({ minZoom: 3, maxZoom: 18 })
    expect(next.extent![0]).toBeGreaterThan(39_000_000)
    expect(next.extent![1]).toBeGreaterThan(4_000_000)
  })
})
