import { createProject } from '@desktop-webgis/project'
import type { Project } from '@desktop-webgis/project'

export type ProjectType = '2d' | '3d'

/** 运行时的工作区类型只由内容上的类型判别字段决定。 */
export function getProjectType(project: Project): ProjectType {
  return project.content.kind === 'scene3d' ? '3d' : '2d'
}

export function createEditorProject(type: ProjectType, name: string): Project {
  return createProject(name.trim() || (type === '3d' ? '未命名三维场景' : '未命名二维地图'), type === '3d' ? 'scene3d' : 'map2d')
}
