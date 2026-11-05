import { performance } from 'node:perf_hooks'
import { cpus } from 'node:os'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import VectorSource from 'ol/source/Vector.js'
import { fromExtent } from 'ol/geom/Polygon.js'
import { applySelection, intersectsSelectionBox } from '../dist/index.js'
import { getBoxCandidates } from '../dist/hit-test.js'

const results = []
for (const count of [1000, 10000, 100000]) {
  const loadStart = performance.now()
  const features = Array.from({ length: count }, (_, index) => {
    const feature = new Feature(new Point([-20000000 + index % 1000 * 40000, Math.floor(index / 1000) * 40000]))
    feature.setId(index)
    return feature
  })
  const source = new VectorSource({ features })
  const loadMs = performance.now() - loadStart
  const box = fromExtent([-19200000, -1, -18800000, 400001])
  const hitStart = performance.now()
  const candidates = getBoxCandidates(source, box, 40075016.68557849)
  const hits = candidates.filter(feature => intersectsSelectionBox(feature.getGeometry(), box, 40075016.68557849))
  const hitMs = performance.now() - hitStart
  const refs = features.map(feature => ({ layerKey: 'points', featureId: feature.getId() }))
  const mergeStart = performance.now()
  const selection = applySelection(refs, hits.map(feature => ({ layerKey: 'points', featureId: feature.getId() })), 'remove')
  const mergeMs = performance.now() - mergeStart
  results.push({ count, candidates: candidates.length, hits: hits.length, remaining: selection.length,
    loadMs: Number(loadMs.toFixed(2)), hitMs: Number(hitMs.toFixed(2)), mergeMs: Number(mergeMs.toFixed(2)) })
  source.dispose()
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  scope: 'Node point source/index/geometry/set baseline; excludes browser rendering, complex geometry and highlight latency', results }, null, 2))
