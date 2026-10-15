import { describe, expect, it } from 'vitest'
import { EllipsoidTerrainProvider } from 'cesium'
import type { Scene } from 'cesium'
import { measureArea, measureGroundDistance, measureHeightDifference, measureSpatialDistance } from './index'

describe('Cesium scene measurements', () => {
  it('measures 3D distance and signed height difference', () => {
    const positions = [[116.39,39.9,10],[116.391,39.9,30]] as const
    expect(measureSpatialDistance(positions).value).toBeGreaterThan(80)
    expect(measureHeightDifference(positions)).toMatchObject({ value: 20, label: '+20.00 m' })
    expect(measureHeightDifference([...positions].reverse())).toMatchObject({ value: -20, label: '-20.00 m' })
  })

  it('measures a bounded horizontal polygon independently of winding', () => {
    const polygon = [[116.39,39.9,0],[116.391,39.9,0],[116.391,39.901,20],[116.39,39.901,10]] as const
    const area = measureArea(polygon).value
    expect(area).toBeGreaterThan(9_000); expect(area).toBeLessThan(10_000)
    expect(measureArea([...polygon].reverse()).value).toBeCloseTo(area, 5)
  })

  it('uses ellipsoid geodesics when no terrain availability exists and bounds sampling', async () => {
    const scene = { terrainProvider: new EllipsoidTerrainProvider() } as unknown as Scene
    const result = await measureGroundDistance([[116.39,39.9,0],[116.391,39.9,0]], scene)
    expect(result.value).toBeGreaterThan(80); expect(result.value).toBeLessThan(90)
    await expect(measureGroundDistance([[0,0,0],[2,0,0]], scene)).rejects.toThrow('范围过大')
  })

  it('rejects incomplete and degenerate input', async () => {
    expect(() => measureSpatialDistance([[0,0,0]])).toThrow('2')
    expect(() => measureHeightDifference([[0,0,0]])).toThrow('2')
    expect(() => measureArea([[0,0,0],[1,0,0],[2,0,0]])).toThrow('面积无效')
  })
})
