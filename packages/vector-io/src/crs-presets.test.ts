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
    expect(chinaProjected).toHaveLength(21)
    expect(isGeographicCrsCode('EPSG:4490')).toBe(true)
    expect(isGeographicCrsCode('EPSG:4547')).toBe(false)
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
