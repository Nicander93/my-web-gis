import { describe, expect, it } from 'vitest'
import { joinByLocation, clipLines, addGeometryMeasurements } from './index.js'
import { complexCases, verifyComplexResult } from '../examples/complex-fixtures.mjs'

describe('complex fixtures and bounded spatial joins', () => {
  it('validates overlap counts, hole segments and dense geometry without modifying inputs', () => {
    for (const testCase of complexCases(3)) {
      const before = structuredClone(testCase.features)
      const result = testCase.id === 'overlap-join' ? joinByLocation(testCase.features, testCase.overlay, testCase.options as Parameters<typeof joinByLocation>[2])
        : testCase.id === 'hole-clip' ? clipLines(testCase.features, testCase.overlay)
        : addGeometryMeasurements(testCase.features, { measurement: 'area', field: 'area_m2', unit: 'square-meters' })
      expect(() => verifyComplexResult(testCase, result)).not.toThrow()
      expect(testCase.features).toEqual(before)
    }
  })

  it('enforces cumulative output bounds across rows and counts unmatched left-join records', () => {
    const testCase = complexCases(2)[0]
    const options = { predicate: 'within' as const, fields: ['code'], prefix: 'region_', mode: 'inner' as const }
    expect(joinByLocation(testCase.features, testCase.overlay, { ...options, maxResults: 24 })).toHaveLength(24)
    expect(() => joinByLocation(testCase.features, testCase.overlay, { ...options, maxResults: 23 })).toThrow('未返回部分结果')
    expect(joinByLocation(testCase.features, [], { ...options, mode: 'left', maxResults: 2 })).toHaveLength(2)
    expect(() => joinByLocation(testCase.features, [], { ...options, mode: 'left', maxResults: 1 })).toThrow('上限')
    for (const maxResults of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => joinByLocation([], [], { ...options, maxResults })).toThrow('正安全整数')
  })
})
