import { createProject } from '@desktop-webgis/project'
import type { Project } from '@desktop-webgis/project'

export type ProjectType = '2d' | '3d'

/** Runtime workspace identity comes only from the domain content discriminator. */
export function getProjectType(project: Project): ProjectType {
  return project.content.kind === 'scene3d' ? '3d' : '2d'
}

export function createEditorProject(type: ProjectType, name: string): Project {
  return createProject(name.trim() || (type === '3d' ? '未命名三维场景' : '未命名二维地图'), type === '3d' ? 'scene3d' : 'map2d')
}
