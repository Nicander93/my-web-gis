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

/** Creates the smallest valid scene (current schema version) with explicit defaults. */
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

/** Adds a source without mutating the original scene. */
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

/** Replaces an existing source and revalidates all scene references. */
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

/** Removes a source. Referencing vector layers must be removed explicitly or through cascade. */
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

/** Appends or inserts a layer while preserving the declared render order. */
export function addSceneLayer(scene: SceneManifest, layer: SceneLayer, index = scene.layers.length): SceneManifest {
  assertUniqueId(scene.layers.some((entry) => entry.id === layer.id), 'Layer', layer.id)
  if (!Number.isInteger(index) || index < 0 || index > scene.layers.length) {
    throw new RangeError(`Layer 插入索引 ${index} 超出范围`)
  }
  const next = structuredClone(scene)
  next.layers.splice(index, 0, structuredClone(layer))
  return parseScene(next)
}

/** Replaces a layer without changing its render position. */
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

/** Removes a layer and removes its ID from presentation chapter visibility lists. */
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

/** Moves a layer to an absolute render index. */
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

/** Updates the initial view and validates projection coordinates and zoom constraints. */
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

/** Produces deterministic, normalized JSON suitable for source control and publishing. */
export function serializeScene(scene: SceneManifest, space = 2): string {
  const normalized = parseScene(scene)
  return `${JSON.stringify(sortJson(normalized), null, space)}\n`
}
