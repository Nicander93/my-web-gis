import type { SceneManifest, SceneView } from './types.js'

function normalizeView(view: SceneView): SceneView {
  return {
    ...view,
    rotation: view.rotation ?? 0
  }
}

/** Returns a detached scene with all runtime defaults made explicit (canonical v2). */
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