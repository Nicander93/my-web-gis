import { createId } from './id'
import { parseCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { cloneValue } from './clone'
import type { Project, ProjectSnapshot } from './types'
import { normalizeLayerTree } from './layer-tree'
import { isLegacyStyle, migrateLegacyStyle } from './layer-style'
import { PROJECT_VERSION, assertProjectCartography, reconcileProjectCartography } from './cartography'
import { createCartographyState } from '@desktop-webgis/ol-style/cartography-model'

export { createDefaultLayerStyle, isLegacyStyle, migrateLegacyStyle } from './layer-style'
export { PROJECT_VERSION } from './cartography'

export function createProject(name = 'Untitled Project'): Project {
  return {
    id: createId('project'),
    version: PROJECT_VERSION,
    cartography: createCartographyState(),
    name,
    crs: 'EPSG:3857',
    datasets: [],
    layers: [],
    groups: [],
    rootOrder: [],
    mapState: {
      center: [0, 0],
      zoom: 2,
      rotation: 0
    },
    basemap: { type: 'osm' },
    settings: {}
  }
}

export function cloneProject(project: Project): Project {
  return cloneValue(project)
}

export function serializeProject(project: Project): string {
  return JSON.stringify(prepareProjectContent(project), null, 2)
}

export function serializeProjectSnapshot(snapshot: ProjectSnapshot): string {
  return JSON.stringify({ ...snapshot, project: prepareProjectContent(snapshot.project) }, null, 2)
}

export function parseProject(json: string): Project {
  return parseProjectSnapshot(json).project
}

export interface ProjectFormatMigration { fromVersion: number; toVersion: number }
export interface ProjectParseOptions { onMigration?: (migration: ProjectFormatMigration) => void }

/** Migrates a cloned in-memory project; never writes or modifies the source project. */
export function prepareProjectContent(input: Project): Project {
  const project = cloneValue(input)
  project.basemap ??= { type: 'osm' }
  if (project.city !== undefined) project.city = parseCesiumScene(project.city)
  project.groups ??= []
  project.rootOrder ??= project.layers.map(layer => ({ type: 'layer' as const, id: layer.id }))
  project.layers = project.layers.map(layer => isLegacyStyle(layer.style) ? { ...layer, style: migrateLegacyStyle(layer.style) } : layer)
  return reconcileProjectCartography(normalizeLayerTree(project))
}

export function parseProjectSnapshot(json: string, options: ProjectParseOptions = {}): ProjectSnapshot {
  const parsed: Project | ProjectSnapshot = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Unsupported or invalid project file.')
  const project = 'project' in parsed ? parsed.project : parsed
  if (!project || ![1, PROJECT_VERSION].includes(project.version) || !Array.isArray(project.layers) || !Array.isArray(project.datasets)) {
    throw new Error('Unsupported or invalid project file.')
  }
  // A claimed v2 file must be complete. Only v1 is allowed to synthesize missing bindings.
  if (project.version === PROJECT_VERSION) assertProjectCartography(project)
  const normalized = prepareProjectContent(project)
  if (project.version !== PROJECT_VERSION) options.onMigration?.({ fromVersion: project.version, toVersion: PROJECT_VERSION })

  return {
    project: normalized,
    featuresByDataset: 'featuresByDataset' in parsed ? parsed.featuresByDataset : {}
  }
}
