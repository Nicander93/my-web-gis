import { requireMapContent } from './project-content'
import {
  assembleCartographyStyle,
  createCartographyState,
  migrateLayerStyle,
  validateCartographyState,
  type CartographyState,
  type GisStyleBinding,
} from '@desktop-webgis/ol-style/cartography-model'
import { cloneValue } from '../clone'
import { rebaseCartographyFieldReferences, remapCartographyFieldReferences, remapLayerFieldReferences, type FieldNameMap } from './field-references'
import { flattenLayerIds } from './layer-tree'
import { isLegacyStyle, migrateLegacyStyle } from './layer-style'
import type { Layer, Project } from './types'
import type { LayerStyle } from '@desktop-webgis/ol-style'

export const PROJECT_VERSION = 3
export type { CartographyState, GisStyleBinding }

function vectorLayers(project: Project): Layer[] {
  const datasets = new Map(requireMapContent(project).datasets.map(dataset => [dataset.id, dataset]))
  if (datasets.size !== requireMapContent(project).datasets.length || new Set(requireMapContent(project).layers.map(layer => layer.id)).size !== requireMapContent(project).layers.length) {
    throw new Error('工程图层或数据集 ID 重复')
  }
  return requireMapContent(project).layers.filter(layer => {
    const dataset = datasets.get(layer.datasetId)
    if (!dataset) throw new Error(`图层 ${layer.id} 的数据集 ${layer.datasetId} 不存在`)
    return dataset.kind === 'vector' || dataset.kind === 'wfs'
  })
}

/** 只返回选中 GIS 图层的标准绘制片段。 */
export function getLayerCartography(project: Project, layerId: string): {
  binding: GisStyleBinding; styleLayers: CartographyState['styleLayers']
} | undefined {
  if (project.content.kind !== 'map2d') return undefined
  const state = requireMapContent(project).cartography
  const binding = state?.bindings.find(binding => binding.gisLayerId === layerId)
  if (!state || !binding) return undefined
  const layers = new Map(state.styleLayers.map(layer => [layer.id, layer]))
  return { binding, styleLayers: binding.styleLayerIds.flatMap(id => {
    const layer = layers.get(id)
    return layer ? [layer] : []
  }) }
}

/** 同时校验样式文档，以及由项目持有的数据集和图层身份。 */
export function assertProjectCartography(project: Project): asserts project is Project & { content: { cartography: CartographyState } } {
  const state = requireMapContent(project).cartography
  if (!state) throw new Error('cartography 缺失，请使用旧工程迁移入口')
  const errors = validateCartographyState(state)
  if (errors.length) throw new Error(`二维制图结构无效：${errors.join('; ')}`)
  const eligible = new Map(vectorLayers(project).map(layer => [layer.id, layer]))
  for (const [index, binding] of state.bindings.entries()) {
    const layer = eligible.get(binding.gisLayerId)
    if (!layer || layer.datasetId !== binding.datasetId) {
      throw new Error(`cartography.bindings[${index}] 与工程图层/数据集不一致`)
    }
    eligible.delete(layer.id)
  }
  if (eligible.size) throw new Error(`cartography.bindings 缺少矢量图层：${[...eligible.keys()].join(', ')}`)
}

function replaceFragment(state: CartographyState, replacement: {
  binding: GisStyleBinding; styleLayers: CartographyState['styleLayers']
}): CartographyState {
  const index = state.bindings.findIndex(binding => binding.gisLayerId === replacement.binding.gisLayerId)
  const oldIds = new Set(index < 0 ? [] : state.bindings[index].styleLayerIds)
  const first = state.styleLayers.findIndex(layer => oldIds.has(layer.id))
  const layers = state.styleLayers.filter(layer => !oldIds.has(layer.id))
  const insertion = first < 0 ? layers.length : state.styleLayers.slice(0, first).filter(layer => !oldIds.has(layer.id)).length
  layers.splice(insertion, 0, ...replacement.styleLayers)
  const bindings = [...state.bindings]
  if (index < 0) bindings.push(replacement.binding)
  else bindings[index] = replacement.binding
  return { ...state, bindings, styleLayers: layers }
}

function legacyFragment(layer: Pick<Layer, 'id' | 'datasetId' | 'style'>, sourceId?: string) {
  const { binding, styleLayers } = migrateLayerStyle(isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : layer.style, layer.id, layer.datasetId)
  return sourceId ? { binding: { ...binding, styleSourceId: sourceId }, styleLayers: styleLayers.map(style => 'source' in style ? { ...style, source: sourceId } : style) } : { binding, styleLayers }
}

/** 生成的旧格式片段，遵循与编辑器配置相同的回退规则。 */
export function remapLayerCartographyReferences(layer: Pick<Layer, 'id' | 'datasetId' | 'style'>,
  fragment: NonNullable<ReturnType<typeof getLayerCartography>>, fields: FieldNameMap): NonNullable<ReturnType<typeof getLayerCartography>> {
  return JSON.stringify(fragment) === JSON.stringify(legacyFragment(layer, fragment.binding.styleSourceId))
    ? legacyFragment(remapLayerFieldReferences(layer, fields), fragment.binding.styleSourceId)
    : rebaseCartographyFieldReferences(fragment, fields)
}

/** 保证显式的图层操作一致，同时不重新生成未变化或进阶的表达式。 */
export function reconcileProjectCartography(project: Project, previous?: Project): Project {
  if (project.content.kind === 'scene3d') return project
  if (previous?.content.kind === 'scene3d') previous = undefined
  if (project.metadata.formatVersion !== 1 && project.metadata.formatVersion !== PROJECT_VERSION) throw new Error(`不支持工程版本 ${project.metadata.formatVersion}`)
  if (previous && project.metadata.formatVersion === PROJECT_VERSION && requireMapContent(project).cartography === requireMapContent(previous).cartography &&
      requireMapContent(project).layers === requireMapContent(previous).layers && requireMapContent(project).datasets === requireMapContent(previous).datasets) return project

  let state = requireMapContent(project).cartography ?? createCartographyState()
  const errors = validateCartographyState(state)
  if (errors.length) throw new Error(`二维制图结构无效：${errors.join('; ')}`)
  const vectors = vectorLayers(project)
  if (previous) {
    const retainedIds = new Set(vectors.map(layer => layer.id))
    const removed = new Set(requireMapContent(previous).layers.filter(layer => !retainedIds.has(layer.id)).map(layer => layer.id))
    const styleIds = new Set(state.bindings.filter(binding => removed.has(binding.gisLayerId)).flatMap(binding => binding.styleLayerIds))
    if (styleIds.size || state.bindings.some(binding => removed.has(binding.gisLayerId))) state = {
      ...state,
      bindings: state.bindings.filter(binding => !removed.has(binding.gisLayerId)),
      styleLayers: state.styleLayers.filter(layer => !styleIds.has(layer.id)),
    }
  }

  for (const layer of vectors) {
    const existing = state.bindings.find(binding => binding.gisLayerId === layer.id)
    if (!existing) { state = replaceFragment(state, legacyFragment(layer, state.bindings.find(binding => binding.datasetId === layer.datasetId)?.styleSourceId)); continue }
    if (existing.datasetId !== layer.datasetId) {
      const sourceId = state.bindings.find(binding => binding.datasetId === layer.datasetId)?.styleSourceId ?? legacyFragment(layer).binding.styleSourceId
      const ids = new Set(existing.styleLayerIds)
      state = { ...state,
        bindings: state.bindings.map(binding => binding === existing ? { ...binding, datasetId: layer.datasetId, styleSourceId: sourceId } : binding),
        styleLayers: state.styleLayers.map(style => ids.has(style.id) && 'source' in style ? { ...style, source: sourceId } : style),
      }
    }
    const before = previous ? requireMapContent(previous).layers.find(before => before.id === layer.id) : undefined
    if (before && before.style !== layer.style && JSON.stringify(before.style) !== JSON.stringify(layer.style)) {
      // 命令里带了显式的标准片段时，以它为准，优先于旧的 UI 缓存。
      const currentFragment = getLayerCartography({ ...project, content: { ...requireMapContent(project), cartography: state } }, layer.id)
      const previousFragment = previous ? getLayerCartography(previous, layer.id) : undefined
      if (JSON.stringify(currentFragment) === JSON.stringify(previousFragment)) state = replaceFragment(state, legacyFragment(layer, currentFragment?.binding.styleSourceId))
    }
  }
  const metadata = project.metadata.formatVersion === PROJECT_VERSION ? project.metadata : { ...project.metadata, formatVersion: PROJECT_VERSION }
  const content = state === requireMapContent(project).cartography ? project.content : { ...requireMapContent(project), cartography: state }
  const normalized = metadata === project.metadata && content === project.content ? project : { ...project, metadata, content }
  assertProjectCartography(normalized)
  return normalized
}

/** 按实际的 GIS 图层树自下而上组装样式分组，不重复要素。 */
export function getProjectCartographyStyle(project: Project): ReturnType<typeof assembleCartographyStyle> {
  assertProjectCartography(project)
  return assembleCartographyStyle(project.content.cartography, flattenLayerIds(project))
}

/** 把完整的标准片段作为一次内容编辑存储，其它 GIS 图层保持不变。 */
export function setLayerCartography(project: Project, layerId: string, styleLayers: CartographyState['styleLayers']): Project {
  const normalized = reconcileProjectCartography(project)
  assertProjectCartography(normalized)
  const fragment = getLayerCartography(normalized, layerId)
  if (!fragment) throw new Error(`图层 ${layerId} 不支持二维矢量样式`)
  const next = { ...normalized, content: { ...requireMapContent(normalized), cartography: replaceFragment(requireMapContent(normalized).cartography ?? createCartographyState(), {
    binding: { ...fragment.binding, styleLayerIds: styleLayers.map(layer => layer.id) }, styleLayers: cloneValue(styleLayers),
  }) } }
  assertProjectCartography(next)
  return next
}

/** 恢复一个绑定和它的绘制层，不替换其它无关的样式内容。 */
export function setLayerCartographyFragment(project: Project, fragment: {
  binding: GisStyleBinding; styleLayers: CartographyState['styleLayers']
}): Project {
  const normalized = reconcileProjectCartography(project)
  assertProjectCartography(normalized)
  const next = { ...normalized, content: { ...requireMapContent(normalized), cartography: replaceFragment(requireMapContent(normalized).cartography ?? createCartographyState(), cloneValue(fragment)) } }
  assertProjectCartography(next)
  return next
}

/** 过渡期的旧编辑器操作；标准样式层和 UI 缓存会一起变化。 */
export function setLegacyLayerStyle(project: Project, layerId: string, style: LayerStyle): Project {
  const layer = requireMapContent(project).layers.find(layer => layer.id === layerId)
  if (!layer) throw new Error(`图层 ${layerId} 不存在`)
  const nextLayer = { ...layer, style: cloneValue(style) }
  const normalized = reconcileProjectCartography(project)
  const next = { ...normalized, content: { ...requireMapContent(normalized), layers: requireMapContent(normalized).layers.map(layer => layer.id === layerId ? nextLayer : layer) } }
  return getLayerCartography(normalized, layerId)
    ? setLayerCartographyFragment(next, legacyFragment(nextLayer, getLayerCartography(normalized, layerId)?.binding.styleSourceId))
    : reconcileProjectCartography(next)
}

/** 在同一个字段结构事务里更新数据集的标准表达式。 */
export function remapCartographyField(project: Project, next: Project, datasetId: string, from: string, to?: string): Project {
  let result = reconcileProjectCartography(next)
  for (const layer of requireMapContent(project).layers.filter(layer => layer.datasetId === datasetId)) {
    const fragment = getLayerCartography(project, layer.id)
    const nextLayer = requireMapContent(next).layers.find(candidate => candidate.id === layer.id)
    if (!fragment || !nextLayer) continue
    if (JSON.stringify(fragment) === JSON.stringify(legacyFragment(layer, fragment.binding.styleSourceId))) {
      result = setLayerCartographyFragment(result, legacyFragment(nextLayer, fragment.binding.styleSourceId))
      continue
    }
    result = setLayerCartographyFragment(result, remapCartographyFieldReferences(fragment, new Map([[from, to]])))
  }
  return result
}
