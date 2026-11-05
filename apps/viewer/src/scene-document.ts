import { migrateSceneDocument, parseSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'
import { resolveSceneResourceReferences } from '@desktop-webgis/scene-core'

/** 以响应 URL（含重定向后的）为基准解析资源，而不是以 Viewer 页面为基准。 */
export async function loadViewerDocument(url: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<SceneDocument> {
  const response = await fetcher(url, { signal })
  if (!response.ok) throw new Error(`场景加载失败：HTTP ${response.status}`)
  const input: unknown = await response.json()
  signal?.throwIfAborted()
  const canonical = input && typeof input === 'object' && 'version' in input && input.version === 3
  const document = canonical
    ? parseSceneDocument(input) : migrateSceneDocument(input)
  // 旧的混合清单默认按三维打开；规范的文档使用自己声明的活动视图。
  if (!canonical && input && typeof input === 'object' && 'city' in input) {
    const cityView = Object.entries(document.views).find(([, view]) => view.type === '3d')?.[0]
    if (cityView) document.activeView = cityView
  }
  return resolveSceneResourceReferences(document, response.url || url)
}
