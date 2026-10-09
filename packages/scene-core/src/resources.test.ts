import { expect, it } from 'vitest'
import { migrateSceneDocument } from '@desktop-webgis/scene-schema'
import { collectSceneResourceReferences, resolveSceneResourceReferences } from './resources.js'

it('resolves declared resources against the scene file without changing the input or XYZ placeholders', () => {
  const document = migrateSceneDocument({ version: 2, id: 'scene', title: 'Scene', view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }, sources: {
    points: { type: 'geojson', url: './data/points.geojson' },
    tiles: { type: 'xyz', url: './tiles/{z}/{x}/{y}.png?mode=1' },
    remote: { type: 'xyz', url: 'https://remote.test/{z}/{x}/{y}.png' }
  }, layers: [] })
  document.environment = { basemap: { url: 'https://imagery.test/{z}/{x}/{y}.png' }, terrain: { url: './terrain/' } }
  const before = JSON.stringify(document)
  const resolved = resolveSceneResourceReferences(document, 'https://host.test/scenes/project.scene.json')
  expect(resolved.resources.points).toMatchObject({ url: 'https://host.test/scenes/data/points.geojson' })
  expect(resolved.resources.tiles).toMatchObject({ url: 'https://host.test/scenes/tiles/{z}/{x}/{y}.png?mode=1' })
  expect(resolved.resources.remote).toEqual(document.resources.remote)
  expect(resolved.environment?.basemap?.url).toBe('https://imagery.test/{z}/{x}/{y}.png')
  expect(resolved.environment?.terrain?.url).toBe('https://host.test/scenes/terrain/')
  expect(JSON.stringify(document)).toBe(before)
  expect(collectSceneResourceReferences(document)).toHaveLength(5)
  expect(collectSceneResourceReferences(resolved).every(reference => !reference.relative)).toBe(true)
  expect(() => resolveSceneResourceReferences(document, 'file:///C:/private/project.json')).toThrow('HTTP(S)')
})
