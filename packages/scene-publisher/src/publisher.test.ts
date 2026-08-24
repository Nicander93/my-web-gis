import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SceneManifest } from '@desktop-webgis/scene-schema'
import { buildStaticScene } from './index.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'scene-publisher-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createViewer(root: string): Promise<string> {
  const viewer = path.join(root, 'viewer')
  await mkdir(path.join(viewer, 'assets'), { recursive: true })
  await writeFile(path.join(viewer, 'index.html'), '<main id="map"></main>', 'utf8')
  await writeFile(path.join(viewer, 'assets', 'viewer.js'), 'console.log("viewer")', 'utf8')
  await writeFile(path.join(viewer, 'scene.json'), '{"old":true}', 'utf8')
  return viewer
}

function createScene(): SceneManifest {
  return {
    version: 1,
    id: 'report',
    title: 'Report',
    view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
    sources: {
      places: { type: 'geojson', url: './data/places.geojson' }
    },
    layers: [
      {
        id: 'places',
        type: 'vector',
        name: 'Places',
        source: 'places',
        style: { type: 'point', radius: 6, fill: '#2563eb' }
      }
    ]
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('static scene publisher', () => {
  it('builds a portable artifact and replaces the viewer sample scene', async () => {
    const root = await temporaryDirectory()
    const viewer = await createViewer(root)
    const data = path.join(root, 'places.geojson')
    const output = path.join(root, 'published')
    await writeFile(data, '{"type":"FeatureCollection","features":[]}', 'utf8')

    const result = await buildStaticScene({
      scene: createScene(),
      viewerDirectory: viewer,
      outputDirectory: output,
      resources: { './data/places.geojson': data }
    })

    expect(JSON.parse(await readFile(path.join(output, 'scene.json'), 'utf8')).id).toBe('report')
    expect(await readFile(path.join(output, 'data', 'places.geojson'), 'utf8')).toContain('FeatureCollection')
    expect(result.manifest.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['assets/viewer.js', 'data/places.geojson', 'index.html', 'scene.json'])
    )
    expect(result.manifest.files.every((file) => file.sha256.length === 64)).toBe(true)
  })

  it('refuses unsafe resource targets before writing output', async () => {
    const root = await temporaryDirectory()
    const viewer = await createViewer(root)
    const data = path.join(root, 'places.geojson')
    await writeFile(data, '{}', 'utf8')
    const scene = createScene()
    scene.sources.places = { type: 'geojson', url: '../private.geojson' }

    await expect(
      buildStaticScene({
        scene,
        viewerDirectory: viewer,
        outputDirectory: path.join(root, 'published'),
        resources: { '../private.geojson': data }
      })
    ).rejects.toThrow('不安全的发布资源路径')
  })

  it('never overwrites a non-empty target directory', async () => {
    const root = await temporaryDirectory()
    const viewer = await createViewer(root)
    const output = path.join(root, 'published')
    await mkdir(output)
    await writeFile(path.join(output, 'keep.txt'), 'keep', 'utf8')

    await expect(
      buildStaticScene({ scene: { ...createScene(), sources: {}, layers: [] }, viewerDirectory: viewer, outputDirectory: output })
    ).rejects.toThrow('必须不存在或为空目录')
    expect(await readFile(path.join(output, 'keep.txt'), 'utf8')).toBe('keep')
  })
})
