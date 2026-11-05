import type { SceneManifest, SceneView } from './types.js'

function normalizeView(view: SceneView): SceneView {
  return {
    ...view,
    rotation: view.rotation ?? 0
  }
}

/** 返回一份脱离的场景，把所有运行时默认值都显式写出来（规范的 v2）。 */
export function normalizeScene(scene: SceneManifest): SceneManifest {
  const normalized = structuredClone(scene)

  normalized.view = normalizeView(normalized.view)
  normalized.layers = normalized.layers.map((layer) => ({
    ...layer,
    visible: layer.visible ?? true,
    opacity: layer.opacity ?? 1,
    ...(layer.type === 'vector' && layer.interaction
      ? {
          interaction: {
            ...layer.interaction,
            selectable: layer.interaction.selectable ?? false
          }
        }
      : {})
  }))

  if (normalized.presentation?.chapters) {
    normalized.presentation.chapters = normalized.presentation.chapters.map((chapter) => ({
      ...chapter,
      view: normalizeView(chapter.view)
    }))
  }

  return normalized
}