import {
  normalizeScene,
  parseScene,
  type SceneLayer,
  type SceneManifest,
  type SceneSource,
  type SceneView
} from '@desktop-webgis/scene-schema'

export interface CreateSceneOptions {
  id: string
  title: string
  description?: string
  projection?: string
  center?: [number, number]
  zoom?: number
}

export interface RemoveSourceOptions {
  cascade?: boolean
}

function assertUniqueId(existing: boolean, kind: string, id: string): void {
  if (existing) throw new Error(`${kind} “${id}” 已存在`)
}

function assertLayerIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new RangeError(`Layer 索引 ${index} 超出范围`)
  }
}

/** 用显式默认值创建最小的合法场景（当前 schema 版本）。 */
export function createScene(options: CreateSceneOptions): SceneManifest {
  return parseScene({
    version: 2,
    id: options.id,
    title: options.title,
    ...(options.description === undefined ? {} : { description: options.description }),
    view: {
      projection: options.projection ?? 'EPSG:3857',
      center: options.center ?? [0, 0],
      zoom: options.zoom ?? 2,
      rotation: 0
    },
    sources: {},
    layers: []
  })
}

/** 添加数据源，不修改原始场景。 */
export function addSceneSource(scene: SceneManifest, id: string, source: SceneSource): SceneManifest {
  assertUniqueId(Object.hasOwn(scene.sources, id), 'Source', id)
  return parseScene({
    ...structuredClone(scene),
    sources: {
      ...structuredClone(scene.sources),
      [id]: structuredClone(source)
    }
  })
}

/** 替换已有的数据源，并重新校验场景中的所有引用。 */
export function replaceSceneSource(scene: SceneManifest, id: string, source: SceneSource): SceneManifest {
  if (!Object.hasOwn(scene.sources, id)) throw new Error(`Source “${id}” 不存在`)
  return parseScene({
    ...structuredClone(scene),
    sources: {
      ...structuredClone(scene.sources),
      [id]: structuredClone(source)
    }
  })
}

/** 移除数据源。引用它的矢量图层必须显式删除，或者通过级联删除。 */
export function removeSceneSource(
  scene: SceneManifest,
  id: string,
  options: RemoveSourceOptions = {}
): SceneManifest {
  if (!Object.hasOwn(scene.sources, id)) return normalizeScene(scene)
  const referencingLayers = scene.layers.filter((layer) => layer.source === id)
  if (referencingLayers.length > 0 && !options.cascade) {
    throw new Error(`Source “${id}” 仍被 Layer ${referencingLayers.map((layer) => `“${layer.id}”`).join('、')} 引用`)
  }

  const next = structuredClone(scene)
  delete next.sources[id]
  if (options.cascade) {
    const removedLayerIds = new Set(referencingLayers.map((layer) => layer.id))
    next.layers = next.layers.filter((layer) => !removedLayerIds.has(layer.id))
    if (next.presentation?.chapters) {
      next.presentation.chapters = next.presentation.chapters.map((chapter) => ({
        ...chapter,
        ...(chapter.visibleLayers
          ? { visibleLayers: chapter.visibleLayers.filter((layerId) => !removedLayerIds.has(layerId)) }
          : {})
      }))
    }
  }
  return parseScene(next)
}

/** 追加或插入图层，同时保持声明的渲染顺序。 */
export function addSceneLayer(scene: SceneManifest, layer: SceneLayer, index = scene.layers.length): SceneManifest {
  assertUniqueId(scene.layers.some((entry) => entry.id === layer.id), 'Layer', layer.id)
  if (!Number.isInteger(index) || index < 0 || index > scene.layers.length) {
    throw new RangeError(`Layer 插入索引 ${index} 超出范围`)
  }
  const next = structuredClone(scene)
  next.layers.splice(index, 0, structuredClone(layer))
  return parseScene(next)
}

/** 替换图层，渲染位置保持不变。 */
export function replaceSceneLayer(scene: SceneManifest, id: string, layer: SceneLayer): SceneManifest {
  const index = scene.layers.findIndex((entry) => entry.id === id)
  if (index < 0) throw new Error(`Layer “${id}” 不存在`)
  if (layer.id !== id && scene.layers.some((entry) => entry.id === layer.id)) {
    throw new Error(`Layer “${layer.id}” 已存在`)
  }
  const next = structuredClone(scene)
  next.layers[index] = structuredClone(layer)
  if (layer.id !== id && next.presentation?.chapters) {
    next.presentation.chapters = next.presentation.chapters.map((chapter) => ({
      ...chapter,
      ...(chapter.visibleLayers
        ? { visibleLayers: chapter.visibleLayers.map((layerId) => (layerId === id ? layer.id : layerId)) }
        : {})
    }))
  }
  return parseScene(next)
}

/** 移除图层，并从演示章节的可见性列表里去掉它的 ID。 */
export function removeSceneLayer(scene: SceneManifest, id: string): SceneManifest {
  if (!scene.layers.some((layer) => layer.id === id)) return normalizeScene(scene)
  const next = structuredClone(scene)
  next.layers = next.layers.filter((layer) => layer.id !== id)
  if (next.presentation?.chapters) {
    next.presentation.chapters = next.presentation.chapters.map((chapter) => ({
      ...chapter,
      ...(chapter.visibleLayers ? { visibleLayers: chapter.visibleLayers.filter((layerId) => layerId !== id) } : {})
    }))
  }
  return parseScene(next)
}

/** 把图层移动到指定的绝对渲染位置。 */
export function moveSceneLayer(scene: SceneManifest, id: string, targetIndex: number): SceneManifest {
  const sourceIndex = scene.layers.findIndex((layer) => layer.id === id)
  if (sourceIndex < 0) throw new Error(`Layer “${id}” 不存在`)
  assertLayerIndex(targetIndex, scene.layers.length)
  if (sourceIndex === targetIndex) return normalizeScene(scene)

  const next = structuredClone(scene)
  const [layer] = next.layers.splice(sourceIndex, 1)
  next.layers.splice(targetIndex, 0, layer!)
  return parseScene(next)
}

/** 更新初始视图，并校验投影坐标和缩放约束。 */
export function setSceneView(scene: SceneManifest, view: SceneView): SceneManifest {
  return parseScene({ ...structuredClone(scene), view: structuredClone(view) })
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (typeof value !== 'object' || value === null) return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  )
}

/** 生成确定性的规范化 JSON，适合纳入版本控制和发布。 */
export function serializeScene(scene: SceneManifest, space = 2): string {
  const normalized = parseScene(scene)
  return `${JSON.stringify(sortJson(normalized), null, space)}\n`
}
