import { createCesiumScene, type CesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { cloneValue } from '../clone'
import { createProject, parseLegacyProjectSnapshot, prepareProjectContent, type ProjectParseOptions } from './project'
import { PROJECT_VERSION, assertProjectCartography } from './cartography'
import type { CartographyState } from './cartography'
import type { MapContent, Project, ProjectSnapshot } from './types'
import { assertNoSecretValues } from './project-share'

export const PROJECT_FILE_VERSION = 3

export interface ProjectFileMetadata {
  id: string
  name: string
  formatVersion: typeof PROJECT_FILE_VERSION
  description?: string
  /** 已有的可移植场景元数据，与项目的身份是两回事。 */
  sceneMetadata?: Project['metadata']['sceneMetadata']
}

interface ProjectFileContent {
  settings: Record<string, unknown>
  display?: Project['content']['display']
}

export interface MapProjectContent extends ProjectFileContent {
  kind: 'map2d'
  crs: MapContent['crs']
  datasets: MapContent['datasets']
  layers: MapContent['layers']
  groups: MapContent['groups']
  rootOrder: MapContent['rootOrder']
  cartography: CartographyState
  basemap: MapContent['basemap']
  initialView: MapContent['initialView']
  viewConstraints?: MapContent['viewConstraints']
}

export interface SceneProjectContent extends ProjectFileContent {
  kind: 'scene3d'
  scene: CesiumScene
}

/** 紧凑的磁盘结构；只在运行时存在的空地图集合，三维不会写进去。 */
export interface ProjectFile {
  metadata: ProjectFileMetadata
  content: MapProjectContent | SceneProjectContent
}

export interface ProjectFileSnapshot {
  project: ProjectFile
  /** 在嵌入的数据拥有由 Provider 持久管理的目标之前，一直保留。 */
  featuresByDataset: ProjectSnapshot['featuresByDataset']
}

const legacyKeys = ['id', 'version', 'name', 'crs', 'description', 'metadata', 'sceneDisplay', 'datasets', 'layers', 'groups', 'rootOrder', 'mapState', 'mapViewConstraints', 'basemap', 'settings', 'city', 'cartography']
const mapKeys = ['kind', 'settings', 'display', 'crs', 'datasets', 'layers', 'groups', 'rootOrder', 'cartography', 'basemap', 'initialView', 'viewConstraints']

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error(`${label} 含无法迁移的字段：${unknown.join(', ')}；请保留原文件并使用兼容版本导出`)
}

function assertFeatures(value: unknown): asserts value is ProjectSnapshot['featuresByDataset'] {
  if (!record(value) || Object.values(value).some(features => !Array.isArray(features) || features.some(feature =>
    !record(feature) || typeof feature.id !== 'string' || !record(feature.geometry) || !record(feature.properties)))) {
    throw new Error('工程嵌入要素无效，未丢弃或覆盖原始数据')
  }
}

/** 转换时不会修改输入；混合的工作区会在丢弃任何内容之前就失败。 */
export function migrateProjectFile(snapshot: ProjectSnapshot): ProjectFileSnapshot {
  assertKeys(snapshot.project as unknown as Record<string, unknown>, ['metadata', 'content'], '工程')
  assertKeys(snapshot.project.metadata as unknown as Record<string, unknown>, ['id', 'name', 'formatVersion', 'description', 'sceneMetadata'], '工程元数据')
  assertKeys(snapshot.project.content as unknown as Record<string, unknown>, snapshot.project.content.kind === 'map2d' ? mapKeys : ['kind', 'scene', 'settings', 'display'], '工作区内容')
  assertFeatures(snapshot.featuresByDataset)
  const project = prepareProjectContent(snapshot.project)
  if (project.content.kind === 'map2d') assertProjectCartography(project)
  const state = project.content, kind = state.kind
  if (!record(state.settings) || 'workspaceType' in state.settings || kind !== 'map2d' && kind !== 'scene3d') throw new Error('工程工作区类型或设置无效')
  if (kind === 'scene3d' && Object.values(snapshot.featuresByDataset).some(features => features.length)) {
    throw new Error('旧工程同时包含二维与三维内容，无法无损迁移；请保留原文件，分别导出两个工作区后再打开')
  }
  const metadata: ProjectFileMetadata = {
    ...project.metadata, formatVersion: PROJECT_FILE_VERSION
  }
  const common = { settings: state.settings, ...(state.display === undefined ? {} : { display: state.display }) }
  let content: ProjectFile['content']
  if (state.kind === 'scene3d') content = { ...common, kind: 'scene3d', scene: state.scene }
  else {
    if (!state.cartography) throw new Error('cartography 缺失')
    content = { ...state, cartography: state.cartography }
  }
  return { project: { metadata, content }, featuresByDataset: cloneValue(snapshot.featuresByDataset) }
}

/** 可以读取旧的快照，也可以读取新的互斥存储格式。 */
export function parseProjectFile(json: string): ProjectFileSnapshot {
  const snapshot = parseProjectFileSnapshot(json)
  assertNoSecretValues(snapshot)
  return migrateProjectFile(snapshot)
}

/** 项目文件的写入器；为了运行时兼容，旧的快照序列化仍然保留。 */
export function serializeProjectFile(snapshot: ProjectSnapshot): string {
  assertNoSecretValues(snapshot)
  return JSON.stringify(migrateProjectFile(snapshot), null, 2)
}

/** 校验磁盘边界，并构造唯一的一种元数据与内容运行时结构。 */
export function parseProjectFileSnapshot(json: string, options: ProjectParseOptions = {}): ProjectSnapshot {
  const parsed: unknown = JSON.parse(json)
  if (!record(parsed)) throw new Error('工程文件必须是对象')
  if ('project' in parsed) assertKeys(parsed, ['project', 'featuresByDataset'], '工程快照')
  const input = 'project' in parsed ? parsed.project : parsed
  if (!record(input)) throw new Error('工程内容无效')
  if (!('content' in input)) {
    assertKeys(input, legacyKeys, '旧工程')
    const snapshot = parseLegacyProjectSnapshot(json)
    migrateProjectFile(snapshot)
    if (typeof input.version === 'number') options.onMigration?.({ fromVersion: input.version, toVersion: PROJECT_FILE_VERSION })
    return snapshot
  }
  assertKeys(input, ['metadata', 'content'], '工程')
  const { metadata, content } = input
  if (!record(metadata) || metadata.formatVersion !== PROJECT_FILE_VERSION || typeof metadata.id !== 'string' ||
    typeof metadata.name !== 'string' || metadata.description !== undefined && typeof metadata.description !== 'string' ||
    metadata.sceneMetadata !== undefined && !record(metadata.sceneMetadata)) throw new Error('工程元数据或格式版本无效')
  assertKeys(metadata, ['id', 'name', 'formatVersion', 'description', 'sceneMetadata'], '工程元数据')
  if (!record(content) || content.kind !== 'map2d' && content.kind !== 'scene3d' || !record(content.settings) ||
    'workspaceType' in content.settings) throw new Error('工程 content.kind 或设置无效')
  assertKeys(content, content.kind === 'map2d' ? mapKeys : ['kind', 'settings', 'display', 'scene'], '工作区内容')
  const features = 'project' in parsed && 'featuresByDataset' in parsed ? parsed.featuresByDataset : {}
  assertFeatures(features)
  const project = createProject(metadata.name, content.kind)
  Object.assign(project.metadata, metadata)
  Object.assign(project.content, content)
  if (content.kind === 'map2d') {
    const view = content.initialView
    if (typeof content.crs !== 'string' || !Array.isArray(content.datasets) || !Array.isArray(content.layers) || !Array.isArray(content.groups) || !Array.isArray(content.rootOrder) ||
      !record(content.basemap) || !record(view) || !Array.isArray(view.center) || view.center.length !== 2 ||
      ![...view.center, view.zoom, view.rotation].every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error('二维工程配置或初始视角无效')
    }
    if (!content.cartography) throw new Error('cartography 缺失')
    assertProjectCartography(project)
  } else {
    if (!record(content.scene)) throw new Error('三维工程缺少 scene')
    if (Object.values(features).some(values => values.length)) throw new Error('三维工程不能包含二维嵌入要素，请保留原文件并分别导出')
  }
  return { project: prepareProjectContent(project), featuresByDataset: cloneValue(features) }
}
