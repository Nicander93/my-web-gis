import { describe, expect, it } from 'vitest'
import type { SceneLayer } from '@desktop-webgis/scene-schema'
import {
  addSceneLayer,
  addSceneSource,
  createScene,
  moveSceneLayer,
  removeSceneLayer,
  removeSceneSource,
  replaceSceneLayer,
  serializeScene
} from './index.js'

const baseLayer: SceneLayer = {
  id: 'base',
  type: 'tile',
  name: 'Base',
  source: 'base'
}

const vectorLayer: SceneLayer = {
  id: 'places',
  type: 'vector',
  name: 'Places',
  source: 'places',
  style: { type: 'point', radius: 6, fill: '#2563eb' }
}

describe('scene domain operations', () => {
  it('creates a valid empty scene with stable defaults', () => {
    const scene = createScene({ id: 'report', title: 'Report' })

    expect(scene.view).toEqual({ projection: 'EPSG:3857', center: [0, 0], zoom: 2, rotation: 0 })
    expect(scene.sources).toEqual({})
    expect(scene.layers).toEqual([])
  })

  it('adds sources and layers immutably in declared order', () => {
    const empty = createScene({ id: 'report', title: 'Report' })
    const withBaseSource = addSceneSource(empty, 'base', {
      type: 'xyz',
      url: 'https://example.com/{z}/{x}/{y}.png'
    })
    const withSource = addSceneSource(withBaseSource, 'places', { type: 'geojson', url: './data/places.geojson' })
    const withBase = addSceneLayer(withSource, baseLayer)
    const complete = addSceneLayer(withBase, vectorLayer, 0)

    expect(empty.sources).toEqual({})
    expect(withBase.layers.map((layer) => layer.id)).toEqual(['base'])
    expect(complete.layers.map((layer) => layer.id)).toEqual(['places', 'base'])
  })

  it('moves, replaces and removes layers while maintaining chapter references', () => {
    let scene = createScene({ id: 'report', title: 'Report' })
    scene = addSceneSource(scene, 'base', { type: 'xyz', url: 'https://example.com/{z}/{x}/{y}.png' })
    scene = addSceneSource(scene, 'places', { type: 'geojson', url: './data/places.geojson' })
    scene = addSceneLayer(scene, baseLayer)
    scene = addSceneLayer(scene, vectorLayer)
    scene.presentation = {
      chapters: [
        {
          id: 'overview',
          title: 'Overview',
          view: scene.view,
          visibleLayers: ['base', 'places']
        }
      ]
    }

    scene = moveSceneLayer(scene, 'places', 0)
    scene = replaceSceneLayer(scene, 'places', { ...vectorLayer, id: 'sites', name: 'Sites' })
    expect(scene.layers.map((layer) => layer.id)).toEqual(['sites', 'base'])
    expect(scene.presentation.chapters?.[0]?.visibleLayers).toEqual(['base', 'sites'])

    scene = removeSceneLayer(scene, 'sites')
    expect(scene.presentation.chapters?.[0]?.visibleLayers).toEqual(['base'])
  })

  it('protects source references unless cascade removal is explicit', () => {
    let scene = createScene({ id: 'report', title: 'Report' })
    scene = addSceneSource(scene, 'places', { type: 'geojson', url: './data/places.geojson' })
    scene = addSceneLayer(scene, vectorLayer)

    expect(() => removeSceneSource(scene, 'places')).toThrow('仍被 Layer')
    const removed = removeSceneSource(scene, 'places', { cascade: true })
    expect(removed.sources).toEqual({})
    expect(removed.layers).toEqual([])
  })

  it('serializes normalized scenes deterministically', () => {
    const scene = createScene({ id: 'report', title: 'Report' })
    const first = serializeScene(scene)
    const second = serializeScene(JSON.parse(first))

    expect(second).toBe(first)
    expect(first.endsWith('\n')).toBe(true)
  })
})
