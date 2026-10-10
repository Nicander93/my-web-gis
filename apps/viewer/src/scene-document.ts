import { migrateSceneDocument, parseSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'
import { resolveSceneResourceReferences } from '@desktop-webgis/scene-core'

/** Resolve resources against the response URL, including redirects, rather than the Viewer page. */
export async function loadViewerDocument(url: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<SceneDocument> {
  const response = await fetcher(url, { signal })
  if (!response.ok) throw new Error(`场景加载失败：HTTP ${response.status}`)
  const input: unknown = await response.json()
  signal?.throwIfAborted()
  const canonical = input && typeof input === 'object' && 'version' in input && input.version === 3
  const document = canonical
    ? parseSceneDocument(input) : migrateSceneDocument(input)
  // Old mixed manifests opened in 3D by default; canonical documents use their declared active view.
  if (!canonical && input && typeof input === 'object' && 'city' in input) {
    const cityView = Object.entries(document.views).find(([, view]) => view.type === '3d')?.[0]
    if (cityView) document.activeView = cityView
  }
  return resolveSceneResourceReferences(document, response.url || url)
}
