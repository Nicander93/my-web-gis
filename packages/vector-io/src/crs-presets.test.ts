import { describe, expect, it } from 'vitest'
import {
  CRS_PRESETS,
  createCoordinateTransform,
  findCrsPreset,
  isGeographicCrsCode,
  registerCrsPresets
} from './index.js'

describe('China CRS presets', () => {
  it('registers 4490 and the CGCS2000 3° CM series 4534–4554', () => {
    registerCrsPresets()
    expect(findCrsPreset('EPSG:4490')?.kind).toBe('geographic')
    expect(findCrsPreset('EPSG:4534')?.name).toContain('75')
    expect(findCrsPreset('EPSG:4554')?.name).toContain('135')
    expect(findCrsPreset('EPSG:4547')?.name).toContain('114')
    const chinaProjected = CRS_PRESETS.filter(
      (preset) => preset.code.startsWith('EPSG:45') && preset.kind === 'projected'
    )
    expect(chinaProjected).toHaveLength(42)
    expect(isGeographicCrsCode('EPSG:4490')).toBe(true)
    expect(isGeographicCrsCode('EPSG:4547')).toBe(false)
  })

  it('zone series adds its million-metre prefix and keeps the CM series distinct', () => {
    expect(findCrsPreset('EPSG:4513')?.name).toContain('25')
    expect(findCrsPreset('EPSG:4533')?.name).toContain('45')
    for (let index = 0; index <= 20; index += 1) {
      const lon = 75 + index * 3, zone = 25 + index
      const a = createCoordinateTransform({ code: 'EPSG:4490' }, `EPSG:${4513 + index}`).transform!([lon, 35])
      const b = createCoordinateTransform({ code: 'EPSG:4490' }, `EPSG:${4534 + index}`).transform!([lon, 35])
      expect(a[0] - b[0]).toBeCloseTo(zone * 1000000, 4)
      expect(a[1]).toBeCloseTo(b[1], 4)
      const back = createCoordinateTransform({ code: `EPSG:${4513 + index}` }, 'EPSG:4490').transform!(a)
      expect(back[0]).toBeCloseTo(lon, 6)
      expect(back[1]).toBeCloseTo(35, 6)
    }
  })

  it('transforms CGCS2000 3° CM 114E (EPSG:4547) to geographic 4490 near Beijing', () => {
    const toProjected = createCoordinateTransform({ code: 'EPSG:4490' }, 'EPSG:4547')
    expect(toProjected.success).toBe(true)
    const [x, y] = toProjected.transform!([116.4, 39.9])
    // CM 114E, false easting 500000 → easting ≈ 500000 + (116.4-114)*m_per_deg
    expect(x).toBeGreaterThan(500000)
    expect(x).toBeLessThan(800000)
    expect(y).toBeGreaterThan(4_000_000)
    expect(y).toBeLessThan(5_000_000)

    const back = createCoordinateTransform({ code: 'EPSG:4547' }, 'EPSG:4490')
    const [lon, lat] = back.transform!([x, y])
    expect(lon).toBeCloseTo(116.4, 6)
    expect(lat).toBeCloseTo(39.9, 6)
  })

  it('keeps 4490↔4326 nearly identical without claiming grid-shift datum QA', () => {
    const result = createCoordinateTransform({ code: 'EPSG:4490' }, 'EPSG:4326')
    expect(result.success).toBe(true)
    const [lon, lat] = result.transform!([116.3974, 39.9093])
    expect(lon).toBeCloseTo(116.3974, 5)
    expect(lat).toBeCloseTo(39.9093, 5)
  })
})
