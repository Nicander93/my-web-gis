import { createProject } from '@desktop-webgis/gis-core'
import type { Project } from '@desktop-webgis/gis-core'
import { createCityScene } from '@desktop-webgis/cesium-scene-schema'

export type ProjectType = '2d' | '3d'

/** Older projects infer their workspace from the presence of a city scene. */
export function getProjectType(project: Project): ProjectType {
  const type = project.settings?.workspaceType
  return type === '2d' || type === '3d' ? type : project.city ? '3d' : '2d'
}

export function createEditorProject(type: ProjectType, name: string): Project {
  const project = createProject(name.trim() || (type === '3d' ? '未命名三维场景' : '未命名二维地图'))
  project.settings.workspaceType = type
  if (type === '3d') project.city = createCityScene()
  return project
}
