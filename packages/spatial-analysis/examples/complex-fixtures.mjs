function square(id, west, south, side) {
  return { id, properties: { code: id }, geometry: { type: 'Polygon', coordinates: [[[west, south], [west + side, south], [west + side, south + side], [west, south + side], [west, south]]] } }
}

/** Deterministic workloads shared by Node and the real browser worker harness. */
export function complexCases(size = 1000) {
  if (!Number.isInteger(size) || size < 1 || size > 10000) throw new Error('Complex size must be between 1 and 10000.')
  const points = Array.from({ length: size }, (_, index) => ({ id: `point${index}`, properties: { value: index, payload: 'x'.repeat(256) }, geometry: { type: 'Point', coordinates: [0.5, 0.5] } }))
  const overlapping = Array.from({ length: 12 }, (_, index) => square(`region${index}`, 0, 0, 1))
  const mask = square('mask', 0, 0, 10)
  mask.geometry.coordinates.push([[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]])
  const roads = Array.from({ length: size }, (_, index) => ({ id: `road${index}`, properties: { value: index }, geometry: { type: 'LineString', coordinates: [[-1, 5, 20], [11, 5, 30]] } }))
  const ring = (center, radius, vertices, reversed = false) => {
    const positions = Array.from({ length: vertices }, (_, index) => {
      const angle = (reversed ? -1 : 1) * index * Math.PI * 2 / vertices
      return [center + radius * Math.cos(angle), 1 + radius * Math.sin(angle)]
    })
    return [...positions, [...positions[0]]]
  }
  const polygons = Array.from({ length: Math.min(size, 100) }, (_, index) => ({ id: `dense${index}`, properties: {}, geometry: { type: 'Polygon', coordinates: [ring(1 + index / 1000, 0.1, 512), ring(1 + index / 1000, 0.025, 128, true)] } }))
  return [
    { id: 'overlap-join', features: points, overlay: overlapping, options: { tool: 'spatial-join', predicate: 'within', fields: ['code'], prefix: 'region_', mode: 'inner', maxResults: 200000 }, expectedCount: size * 12 },
    { id: 'hole-clip', features: roads, overlay: [mask], options: { tool: 'clip-lines' }, expectedCount: size },
    { id: 'dense-measure', features: polygons, overlay: [], options: { tool: 'measure-area', field: 'area_m2', unit: 'square-meters' }, expectedCount: polygons.length }
  ]
}

export function verifyComplexResult(testCase, result) {
  if (result.length !== testCase.expectedCount) throw new Error(`${testCase.id}: unexpected output count ${result.length}`)
  if (testCase.id === 'overlap-join') {
    if (result.some(row => !row.properties.region_code || row.metadata?.sourceId == null)) throw new Error('Join provenance missing')
  } else if (testCase.id === 'hole-clip') {
    for (const row of result) {
      if (row.geometry.type !== 'MultiLineString' || row.geometry.coordinates.length !== 2) throw new Error('Expected two segments around hole')
      const spans = row.geometry.coordinates.map(part => {
        if (part.some(position => position.length !== 2 || position[1] !== 5)) throw new Error('Expected XY-only line')
        return [Math.min(...part.map(position => position[0])), Math.max(...part.map(position => position[0]))]
      }).sort((a, b) => a[0] - b[0])
      if (JSON.stringify(spans) !== '[[0,4],[6,10]]') throw new Error('Hole clipping bounds incorrect')
    }
  } else if (result.some(row => !(row.properties.area_m2 > 0))) throw new Error('Expected positive area')
}
