import { requireMapContent } from './project-content'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { createProject, parseProjectSnapshot } from './project'
import { migrateProjectFile, parseProjectFile, parseProjectFileSnapshot, serializeProjectFile, PROJECT_FILE_VERSION } from './project-format'

interface InvalidFile {
  project: {
    metadata: Record<string, unknown>
    content: Record<string, unknown> & { initialView: { center: unknown }; settings: Record<string, unknown> }
  }
  featuresByDataset: unknown
  [key: string]: unknown
}

function fixture(kind: string): string {
  return readFileSync(new URL(`../../test-fixtures/legacy-${kind}-v1.webgis.json`, import.meta.url), 'utf8')
}

describe('exclusive project format migration', () => {
  it.each(['map', 'scene'])('migrates and reopens %s without changing the legacy source', kind => {
    const original = fixture(kind)
    const before = parseProjectSnapshot(original)
    const unchanged = structuredClone(before)
    const migrated = migrateProjectFile(before)
    expect(before).toEqual(unchanged)
    expect(migrated.project.metadata).toMatchObject({ id: before.project.metadata.id, name: before.project.metadata.name, formatVersion: PROJECT_FILE_VERSION })
    expect(Object.keys(migrated.project).sort()).toEqual(['content', 'metadata'])
    expect(migrated.featuresByDataset).toEqual(before.featuresByDataset)
    expect(parseProjectFile(JSON.stringify(migrated))).toEqual(migrated)
    expect(parseProjectFile(original)).toEqual(migrated)
    const saved = serializeProjectFile(before)
    expect(JSON.parse(saved)).toEqual(migrated)
    const runtime = parseProjectSnapshot(saved)
    expect(runtime.featuresByDataset).toEqual(before.featuresByDataset)
    expect(runtime.project.content.kind).toBe(kind === 'map' ? 'map2d' : 'scene3d')
    expect(runtime.project.content.settings).not.toHaveProperty('workspaceType')
    expect(runtime.project.content.scene).toEqual(before.project.content.scene)
    if (kind === 'map') expect(requireMapContent(runtime.project).layers).toEqual(requireMapContent(before.project).layers)
    expect(fixture(kind)).toBe(original)
    const content = migrated.project.content
    if (content.kind === 'map2d') {
      expect(content.datasets).toEqual(requireMapContent(before.project).datasets)
      expect(content.layers).toEqual(requireMapContent(before.project).layers)
      expect(content.cartography).toEqual(requireMapContent(before.project).cartography)
      expect(content.groups).toEqual(requireMapContent(before.project).groups)
      expect(content.rootOrder).toEqual(requireMapContent(before.project).rootOrder)
      expect(content.initialView).toEqual(requireMapContent(before.project).initialView)
      expect(content).not.toHaveProperty('scene')
    } else {
      expect(content.scene).toEqual(before.project.content.scene)
      expect(content.display).toEqual(before.project.content.display)
      expect(content).not.toHaveProperty('layers')
    }
  })

  it('keeps portable metadata, view constraints and custom settings separate from identity', () => {
    const snapshot = parseProjectSnapshot(fixture('map'))
    snapshot.project.metadata.sceneMetadata = { author: '河流组', nested: { value: [1, 2] } }
    snapshot.project.content.settings.custom = { level: 2 }
    requireMapContent(snapshot.project).viewConstraints = { minZoom: 2, maxZoom: 18 }
    const migrated = migrateProjectFile(snapshot)
    expect(migrated.project.metadata.sceneMetadata).toEqual(snapshot.project.metadata.sceneMetadata)
    expect(migrated.project.content.settings).toEqual({ custom: { level: 2 } })
    expect(migrated.project.content).toMatchObject({ viewConstraints: { minZoom: 2, maxZoom: 18 } })
    expect(parseProjectFile(JSON.stringify(migrated))).toEqual(migrated)
    migrated.featuresByDataset.local[0].properties.name = 'changed'
    expect(snapshot.featuresByDataset.local[0].properties.name).toBe('已编辑河流')
  })

  it.each(['2d', '3d'])('rejects mixed legacy content even when %s is explicitly selected', workspaceType => {
    const snapshot = JSON.parse(fixture('map'))
    snapshot.project.settings.workspaceType = workspaceType
    snapshot.project.city = createCesiumScene()
    const before = structuredClone(snapshot)
    expect(() => parseProjectSnapshot(JSON.stringify(snapshot))).toThrow('同时包含二维与三维内容')
    expect(snapshot).toEqual(before)
  })

  it('preserves an explicitly empty 3D workspace and infers unmarked legacy scenes', () => {
    const project = createProject('Empty scene', 'scene3d')
    expect(migrateProjectFile({ project, featuresByDataset: {} }).project.content).toMatchObject({ kind: 'scene3d', scene: createCesiumScene() })
    const legacy = JSON.parse(fixture('scene'))
    legacy.project.settings = {}
    expect(parseProjectSnapshot(JSON.stringify(legacy)).project.content.kind).toBe('scene3d')
  })

  it.each(['view', 'data', 'basemap'])('rejects 3D migration that would discard extra 2D %s', extra => {
    const legacy = JSON.parse(fixture('scene'))
    if (extra === 'view') legacy.project.mapState.zoom = 8
    if (extra === 'basemap') legacy.project.basemap = { type: 'xyz', url: 'https://example.invalid/{z}/{x}/{y}.png' }
    if (extra === 'data') legacy.featuresByDataset = { orphan: [{ id: 'f', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] }
    expect(() => parseProjectSnapshot(JSON.stringify(legacy))).toThrow('同时包含二维与三维内容')
  })

  it.each([
    (value: InvalidFile) => { value.project.content.scene = createCesiumScene() },
    (value: InvalidFile) => { value.project.content.kind = 'unknown' },
    (value: InvalidFile) => { value.project.metadata.formatVersion = 999 },
    (value: InvalidFile) => { value.project.content.cartography = undefined },
    (value: InvalidFile) => { value.project.content.initialView.center = [null, 0] },
    (value: InvalidFile) => { value.project.content.settings.workspaceType = '3d' },
    (value: InvalidFile) => { value.featuresByDataset = null },
    (value: InvalidFile) => { value.unknown = { data: 'must not be dropped' } }
  ])('rejects malformed, conflicting or future new-format content %#', change => {
    const value = JSON.parse(JSON.stringify(parseProjectFile(fixture('map'))))
    change(value)
    expect(() => parseProjectFile(JSON.stringify(value))).toThrow()
  })

  it('refuses unknown legacy fields instead of silently stripping them', () => {
    const value = JSON.parse(fixture('map'))
    value.project.futureData = { important: true }
    expect(() => parseProjectFile(JSON.stringify(value))).toThrow('futureData')
  })

  it('preserves credential references but refuses actual secret values before writing', () => {
    const snapshot = parseProjectSnapshot(fixture('map'))
    expect(serializeProjectFile(snapshot)).toContain('fixture-service')
    snapshot.project.content.settings.password = 'do-not-write'
    expect(() => serializeProjectFile(snapshot)).toThrow('疑似密钥字段')
    expect(() => parseProjectFile(JSON.stringify(snapshot))).toThrow('疑似密钥字段')
  })

  it.each([1, 2])('reports legacy format %i migration only after exclusive validation succeeds', version => {
    const snapshot = JSON.parse(fixture('map'))
    const normalized = parseProjectSnapshot(fixture('map'))
    snapshot.project.version = version
    if (version === 2) {
      snapshot.project.layers = requireMapContent(normalized.project).layers
      snapshot.project.cartography = requireMapContent(normalized.project).cartography
    }
    const migrations: unknown[] = []
    const options = { onMigration: (value: unknown) => migrations.push(value) }
    parseProjectFileSnapshot(JSON.stringify(snapshot), options)
    expect(migrations).toEqual([{ fromVersion: version, toVersion: PROJECT_FILE_VERSION }])
    migrations.length = 0
    parseProjectFileSnapshot(serializeProjectFile(normalized), options)
    expect(migrations).toEqual([])
    snapshot.project.city = createCesiumScene()
    expect(() => parseProjectFileSnapshot(JSON.stringify(snapshot), options)).toThrow('同时包含二维与三维内容')
    expect(migrations).toEqual([])
  })
})
