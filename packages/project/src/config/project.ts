import { createId } from '../id'
import { createCesiumScene, parseCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { cloneValue } from '../clone'
import type { LegacyProject, Project, ProjectSnapshot } from './types'
import { normalizeLayerTree } from './layer-tree'
import { isLegacyStyle, migrateLegacyStyle } from './layer-style'
import { PROJECT_VERSION, assertProjectCartography, reconcileProjectCartography } from './cartography'
import { createCartographyState } from '@desktop-webgis/ol-style/cartography-model'
import { migrateProjectFile, parseProjectFileSnapshot, serializeProjectFile } from './project-format'
import { assertProjectWorkspace } from './project-content'

export { createDefaultLayerStyle, isLegacyStyle, migrateLegacyStyle } from './layer-style'
export { PROJECT_VERSION } from './cartography'

export function createProject(name = 'Untitled Project', kind: Project['content']['kind'] = 'map2d'): Project {
  return {
    metadata: { id: createId('project'), name, formatVersion: PROJECT_VERSION },
    content: kind === 'scene3d'
      ? { kind, scene: createCesiumScene(), settings: {} }
      : { kind, cartography: createCartographyState(), crs: 'EPSG:3857', datasets: [], layers: [], groups: [], rootOrder: [],
        initialView: { center: [0, 0], zoom: 2, rotation: 0 }, basemap: { type: 'osm' }, settings: {} }
  }
}

export function cloneProject(project: Project): Project { return cloneValue(project) }

export function serializeProject(project: Project): string {
  return JSON.stringify(migrateProjectFile({ project, featuresByDataset: {} }).project, null, 2)
}

export function serializeProjectSnapshot(snapshot: ProjectSnapshot): string { return serializeProjectFile(snapshot) }

export function parseProject(json: string): Project { return parseProjectSnapshot(json).project }

export interface ProjectFormatMigration { fromVersion: number; toVersion: number }
export interface ProjectParseOptions { onMigration?: (migration: ProjectFormatMigration) => void }

/** Normalizes detached domain data; neither the caller nor any renderer owns this copy. */
export function prepareProjectContent(input: Project): Project {
  const project = cloneValue(input), content = project.content
  assertProjectWorkspace(project)
  if (content.kind === 'scene3d') {
    if (Object.keys(content).some(key => !['kind', 'scene', 'settings', 'display'].includes(key))) throw new Error('工程同时包含二维与三维内容，请保留原文件并分别导出')
    content.scene = parseCesiumScene(content.scene)
    return project
  }
  if (content.scene !== undefined) throw new Error('工程同时包含二维与三维内容，请保留原文件并分别导出')
  content.basemap ??= { type: 'osm' }
  content.groups ??= []
  content.rootOrder ??= content.layers.map(layer => ({ type: 'layer' as const, id: layer.id }))
  content.layers = content.layers.map(layer => isLegacyStyle(layer.style) ? { ...layer, style: migrateLegacyStyle(layer.style) } : layer)
  return reconcileProjectCartography(normalizeLayerTree(project))
}

/** Only this read boundary understands the old flat shape and workspaceType marker. */
export function parseLegacyProjectSnapshot(json: string): ProjectSnapshot {
  const parsed: LegacyProject | { project: LegacyProject; featuresByDataset?: ProjectSnapshot['featuresByDataset'] } = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Unsupported or invalid project file.')
  const old = 'project' in parsed ? parsed.project : parsed
  if (!old || ![1, 2].includes(old.version) || !Array.isArray(old.layers) || !Array.isArray(old.datasets)) throw new Error('Unsupported or invalid project file.')
  const declared = old.settings?.workspaceType
  if (declared !== undefined && declared !== '2d' && declared !== '3d') throw new Error('旧工程工作区类型无效')
  const kind = declared === '3d' || declared === undefined && old.city ? 'scene3d' : 'map2d'
  const featuresByDataset = 'featuresByDataset' in parsed ? parsed.featuresByDataset ?? {} : {}
  const mapData = old.datasets.length || old.layers.length || old.groups?.length || old.rootOrder?.length || old.mapViewConstraints ||
    old.crs !== 'EPSG:3857' || old.basemap && (old.basemap.type !== 'osm' || Object.keys(old.basemap).length !== 1) ||
    old.mapState?.center[0] !== 0 || old.mapState?.center[1] !== 0 || old.mapState?.zoom !== 2 || old.mapState?.rotation !== 0 ||
    old.cartography && Object.entries(old.cartography).some(([key, value]) => key === 'specVersion' ? value !== 8 : Array.isArray(value) ? value.length > 0 : value !== undefined)
  if (kind === 'map2d' && old.city !== undefined || kind === 'scene3d' && (mapData || Object.values(featuresByDataset).some(features => features.length))) {
    throw new Error('旧工程同时包含二维与三维内容，无法无损迁移；请保留原文件，分别导出两个工作区后再打开')
  }
  const { workspaceType: _workspaceType, ...settings } = old.settings ?? {}
  const project: Project = {
    metadata: { id: old.id, name: old.name, formatVersion: PROJECT_VERSION,
      ...(old.description === undefined ? {} : { description: old.description }),
      ...(old.metadata === undefined ? {} : { sceneMetadata: old.metadata }) },
    content: kind === 'scene3d' ? { kind, settings, scene: parseCesiumScene(old.city ?? createCesiumScene()),
      ...(old.sceneDisplay === undefined ? {} : { display: old.sceneDisplay }) }
      : { kind, crs: old.crs, datasets: old.datasets, layers: old.layers, groups: old.groups ?? [],
      rootOrder: old.rootOrder ?? old.layers.map(layer => ({ type: 'layer', id: layer.id })),
      cartography: old.cartography, initialView: old.mapState, basemap: old.basemap ?? { type: 'osm' }, settings,
      ...(old.sceneDisplay === undefined ? {} : { display: old.sceneDisplay }),
      ...(old.mapViewConstraints === undefined ? {} : { viewConstraints: old.mapViewConstraints }) }
  }
  if (old.version === 2 && kind === 'map2d') assertProjectCartography(project)
  return { project: prepareProjectContent(project), featuresByDataset }
}

export function parseProjectSnapshot(json: string, options: ProjectParseOptions = {}): ProjectSnapshot {
  return parseProjectFileSnapshot(json, options)
}
