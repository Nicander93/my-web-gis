import { describe, expect, it } from 'vitest'
import { localStyleSuggestion, parseSuggestedStyle, suggestLayerStyle } from './index.js'

describe('style assistant', () => {
  it('creates deterministic offline suggestions', () => {
    const profile = { layerName: '规划地块', geometry: 'polygon' as const, featureCount: 120 }
    expect(localStyleSuggestion(profile)).toEqual(localStyleSuggestion(profile))
  })

  it('validates model output before applying it', async () => {
    const suggestion = await suggestLayerStyle(
      { layerName: '站点', geometry: 'point', featureCount: 20 },
      {
        generate: async () => ({
          stroke: '#123456',
          fill: '#abcdef88',
          width: 2,
          pointRadius: 6,
          rationale: '突出站点。'
        })
      }
    )
    expect(suggestion.source).toBe('model')
    expect(suggestion.style.pointRadius).toBe(6)
    expect(() => parseSuggestedStyle({ stroke: 'red' })).toThrow()
  })
})
