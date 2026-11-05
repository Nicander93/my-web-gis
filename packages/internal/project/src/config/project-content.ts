import type { MapContent, Project, ProjectSnapshot, SceneContent } from './types'
import { validateResourceReference } from '@desktop-webgis/cesium-scene-schema'

/** 混合的运行时内容要在 Store 发布之前就拒绝。 */
export function assertProjectWorkspace(project: Project): void {
  const content = project.content
  if (content.kind === 'map2d') {
    if (content.scene !== undefined) throw new Error('工程同时包含二维与三维内容')
    for (const dataset of content.datasets) if ('storage' in dataset && dataset.storage !== undefined) {
      const storage = dataset.storage
      const reference: unknown = storage && typeof storage === 'object' ? storage.reference : undefined
      if (dataset.kind !== 'vector' || !storage || typeof storage !== 'object' || storage.type !== 'managed-geojson' ||
        Object.keys(storage).some(key => key !== 'type' && key !== 'reference') || !validateResourceReference(reference) || reference.kind === 'url') throw new Error('数据保存目标引用无效')
    }
  } else if (content.kind === 'scene3d') {
    if (!content.scene || Object.keys(content).some(key => !['kind', 'scene', 'settings', 'display'].includes(key))) throw new Error('三维工程包含无效或二维内容')
  } else throw new Error('工程工作区类型无效')
}

export function assertProjectSnapshotWorkspace(snapshot: ProjectSnapshot): void {
  assertProjectWorkspace(snapshot.project)
  if (snapshot.project.content.kind === 'scene3d' && Object.values(snapshot.featuresByDataset).some(features => features.length)) throw new Error('三维工程不能包含二维要素')
}

/** 领域操作必须指明它作用在哪个工作区上。 */
export function requireMapContent(project: Project): MapContent {
  if (project.content.kind !== 'map2d') throw new Error('当前工程不是二维地图')
  return project.content
}

export function requireSceneContent(project: Project): SceneContent {
  if (project.content.kind !== 'scene3d') throw new Error('当前工程不是三维场景')
  return project.content
}

export const requireContent2D = requireMapContent
export const requireContent3D = requireSceneContent
