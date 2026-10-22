import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec'
import { validateCartographyState } from './cartography-model.js'
import { verifyStyleAssets, type ProjectStyleAsset } from './style-assets.js'

export interface SymbolPreset {
  id: string
  name: string
  category: 'point' | 'line' | 'polygon'
  tags: string[]
  attribution: { source: string; license: string }
  layers: LayerSpecification[]
  assets: ProjectStyleAsset[]
}

const attribution = { source: 'my-web-gis 原创通用制图示例（非行业认证）', license: 'CC0-1.0' }
function preset(id: string, name: string, category: SymbolPreset['category'], tags: string[], layers: LayerSpecification[]): SymbolPreset {
  return { id: `builtin:${id}`, name, category, tags, attribution, layers, assets: [] }
}
function line(id: string, color: string, width: number, extra: Record<string, unknown> = {}): LayerSpecification {
  return { id, source: 'preset', type: 'line', paint: { 'line-color': color, 'line-width': width, ...extra }, layout: { 'line-cap': 'round', 'line-join': 'round' } } as LayerSpecification
}
function fill(id: string, color: string): LayerSpecification { return { id, source: 'preset', type: 'fill', paint: { 'fill-color': color } } }

/** Versioned readonly examples retain standard drawing layers and explicit provenance. */
export const BUILTIN_SYMBOL_PRESETS: readonly SymbolPreset[] = [
  preset('road-primary-v1', '主干道路', 'line', ['交通', '道路', '双层'], [line('casing', '#ad7c55', 8), line('surface', '#ffe6a3', 5)]),
  preset('road-local-v1', '一般道路', 'line', ['交通', '道路'], [line('casing', '#a9adb3', 5), line('surface', '#ffffff', 3)]),
  preset('railway-v1', '铁路示意', 'line', ['交通', '铁路'], [line('bed', '#4c535d', 5), line('ties', '#ffffff', 3, { 'line-dasharray': [2, 2] })]),
  preset('river-v1', '河流', 'line', ['水系', '河流'], [line('river', '#4b99c7', 3)]),
  preset('boundary-v1', '行政区边界', 'line', ['行政', '边界'], [line('boundary', '#95799c', 2, { 'line-dasharray': [5, 2, 1, 2] })]),
  preset('water-v1', '水域', 'polygon', ['水系', '湖泊'], [fill('water', '#b4d9ee'), line('shore', '#75b3d6', 1)]),
  preset('park-v1', '绿地', 'polygon', ['土地利用', '公园'], [fill('park', '#d5e6b9'), line('edge', '#91b574', 1)]),
  preset('residential-v1', '居住用地', 'polygon', ['土地利用', '居住'], [fill('residential', '#eadfcb'), line('edge', '#b8aa91', 0.75)]),
  preset('poi-v1', '兴趣点', 'point', ['地点', 'POI'], [{ id: 'poi', source: 'preset', type: 'circle', paint: { 'circle-radius': 6, 'circle-color': '#3b79b5', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } }]),
]

export function validateSymbolPreset(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['符号预设必须是对象']
  const candidate = value as SymbolPreset
  if (typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 256 || typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 160 || !['point', 'line', 'polygon'].includes(candidate.category) || !Array.isArray(candidate.tags) || candidate.tags.length > 32 || candidate.tags.some(tag => typeof tag !== 'string' || tag.length > 80) || !candidate.attribution?.source || !candidate.attribution.license || !Array.isArray(candidate.layers) || !candidate.layers.length || candidate.layers.length > 128 || !Array.isArray(candidate.assets)) return ['符号预设名称、分类、来源或结构无效']
  return validateCartographyState({ specVersion: 8, assets: candidate.assets, styleLayers: candidate.layers,
    bindings: [{ gisLayerId: 'preset', datasetId: 'preset', styleSourceId: 'preset', styleLayerIds: candidate.layers.map(layer => layer?.id) }] })
}

export async function parseSymbolPreset(text: string): Promise<SymbolPreset> {
  if (text.length > 34 * 1024 * 1024) throw new Error('符号包超过大小限制')
  const value: unknown = JSON.parse(text)
  const errors = validateSymbolPreset(value)
  if (errors.length) throw new Error(errors.join('; '))
  const result = value as SymbolPreset
  await verifyStyleAssets(result.assets)
  return structuredClone(result)
}

/** Copies the actual definitions; subsequent library edits cannot alter the project. */
export function instantiateSymbolPreset(preset: SymbolPreset, sourceId: string, allocateId: () => string): LayerSpecification[] {
  const errors = validateSymbolPreset(preset)
  if (errors.length) throw new Error(errors.join('; '))
  return preset.layers.map(layer => ({ ...structuredClone(layer), id: allocateId(), ...('source' in layer ? { source: sourceId } : {}) }))
}
