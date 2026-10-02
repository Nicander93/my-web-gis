import { createId } from './id'
import { parseCityScene } from '@desktop-webgis/cesium-scene-schema'
import { cloneValue } from './clone'
import type { LegacyLayerStyle, Project, ProjectSnapshot, Layer, LayerStyleKind } from './types'
import { normalizeLayerTree } from './layer-tree'
import type { LayerStyle, SingleStyle, Symbol } from '@desktop-webgis/ol-style'

export const PROJECT_VERSION = 1

/**
 * 解析 CSS 颜色为 RGBA 分量
 */
function parseCssColor(cssColor: string): { r: number; g: number; b: number; a: number } {
  if (cssColor.startsWith('rgba(')) {
    const match = cssColor.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: parseFloat(match[4])
      }
    }
  }

  if (cssColor.startsWith('rgb(')) {
    const match = cssColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: 1
      }
    }
  }

  if (cssColor.startsWith('#')) {
    const hex = cssColor.slice(1)
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1
      }
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1
      }
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255
      }
    }
  }

  return { r: 0, g: 0, b: 0, a: 1 }
}

/**
 * 迁移旧样式为新样式
 */
export function migrateLegacyStyle(legacy: LegacyLayerStyle): SingleStyle {
  const strokeColor = parseCssColor(legacy.stroke)
  const fillColor = parseCssColor(legacy.fill)

  let symbol: Symbol

  if (legacy.kind === 'point') {
    symbol = {
      type: 'circle',
      radius: legacy.pointRadius,
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: legacy.width
    }
  } else if (legacy.kind === 'line') {
    symbol = {
      type: 'solid',
      color: strokeColor,
      width: legacy.width
    }
  } else if (legacy.kind === 'polygon') {
    symbol = {
      type: 'solid',
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: legacy.width
    }
  } else {
    symbol = {
      type: 'mixed',
      point: {
        type: 'circle',
        radius: legacy.pointRadius,
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: legacy.width
      },
      line: {
        type: 'solid',
        color: strokeColor,
        width: legacy.width
      },
      polygon: {
        type: 'solid',
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: legacy.width
      }
    }
  }

  return {
    mode: 'single',
    symbol
  }
}

/**
 * 判断是否为旧样式
 */
export function isLegacyStyle(style: LegacyLayerStyle | LayerStyle): style is LegacyLayerStyle {
  return 'kind' in style && !('mode' in style)
}

/**
 * 创建默认新样式
 */
export function createDefaultLayerStyle(kind: LayerStyleKind = 'mixed'): SingleStyle {
  const palette: Record<LayerStyleKind, { stroke: string; fill: string; width: number; pointRadius: number }> = {
    point: { stroke: '#4f6f58', fill: '#dbe8da', width: 1.5, pointRadius: 5 },
    line: { stroke: '#5c7185', fill: '#5c718522', width: 2, pointRadius: 4 },
    polygon: { stroke: '#76604f', fill: '#76604f24', width: 1.5, pointRadius: 4 },
    mixed: { stroke: '#586b5d', fill: '#586b5d20', width: 1.5, pointRadius: 4 }
  }

  const legacy: LegacyLayerStyle = {
    kind,
    ...palette[kind]
  }

  return migrateLegacyStyle(legacy)
}

export function createProject(name = 'Untitled Project'): Project {
  return {
    id: createId('project'),
    version: PROJECT_VERSION,
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
  if (project.city !== undefined) project.city = parseCityScene(project.city)
  project.groups ??= []
  // Legacy projects only had `layers` order — rebuild rootOrder from that array.
  if (!project.rootOrder) {
    project.rootOrder = project.layers.map((layer) => ({ type: 'layer' as const, id: layer.id }))
  }

  for (const layer of project.layers) {
    if (isLegacyStyle(layer.style)) {
      layer.style = migrateLegacyStyle(layer.style)
    }
  }

  const normalized = normalizeLayerTree(project)

  return {
    project: normalized,
    featuresByDataset: 'featuresByDataset' in parsed ? parsed.featuresByDataset : {}
  }
}
