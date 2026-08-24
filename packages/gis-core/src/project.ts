import { createId } from './id'
import { cloneValue } from './clone'
import type { LayerStyle, Project, ProjectSnapshot } from './types'

export const PROJECT_VERSION = 1

export function createDefaultLayerStyle(kind: LayerStyle['kind'] = 'mixed'): LayerStyle {
  const palette: Record<LayerStyle['kind'], Pick<LayerStyle, 'stroke' | 'fill' | 'width' | 'pointRadius'>> = {
    point: { stroke: '#4f6f58', fill: '#dbe8da', width: 1.5, pointRadius: 5 },
    line: { stroke: '#5c7185', fill: '#5c718522', width: 2, pointRadius: 4 },
    polygon: { stroke: '#76604f', fill: '#76604f24', width: 1.5, pointRadius: 4 },
    mixed: { stroke: '#586b5d', fill: '#586b5d20', width: 1.5, pointRadius: 4 }
  }

  return {
    kind,
    ...palette[kind]
  }
}

export function createProject(name = 'Untitled Project'): Project {
  return {
    id: createId('project'),
    version: PROJECT_VERSION,
    name,
    crs: 'EPSG:3857',
    datasets: [],
    layers: [],
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
  return JSON.stringify(project, null, 2)
}

export function serializeProjectSnapshot(snapshot: ProjectSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

export function parseProject(json: string): Project {
  return parseProjectSnapshot(json).project
}

export function parseProjectSnapshot(json: string): ProjectSnapshot {
  const parsed = JSON.parse(json) as Project | ProjectSnapshot
  const project = 'project' in parsed ? parsed.project : parsed
  if (!project || project.version !== PROJECT_VERSION || !Array.isArray(project.layers)) {
    throw new Error('Unsupported or invalid project file.')
  }
  project.basemap ??= { type: 'osm' }
  return {
    project,
    featuresByDataset: 'featuresByDataset' in parsed ? parsed.featuresByDataset : {}
  }
}
