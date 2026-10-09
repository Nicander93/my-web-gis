import { createCesiumDocumentRuntime, type CesiumDocumentRuntime } from '@desktop-webgis/cesium-scene-runtime'
import { bindSceneRuntime, SceneController, type SceneRuntimeBinding } from '@desktop-webgis/scene-core'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import 'cesium/Build/Cesium/Widgets/widgets.css'

/** Read-only city viewer; no editor application or React dependency. */
export async function renderCityViewer(scene: SceneDocument, sceneUrl: string, viewId: string): Promise<void> {
  const target = document.getElementById('map')
  if (!target) throw new Error('Viewer 缺少地图容器')
  target.setAttribute('aria-label', '城市三维场景')
  const controller = new SceneController(scene), startup = new AbortController()
  let mounted: CesiumDocumentRuntime | undefined, binding: SceneRuntimeBinding | undefined
  const destroy = (): void => { startup.abort(); binding?.dispose(); mounted?.destroy(); controller.dispose() }
  window.addEventListener('pagehide', destroy, { once: true })
  let loaded: CesiumDocumentRuntime
  try {
    loaded = await createCesiumDocumentRuntime({ target, document: controller.getDocument(), viewId, sceneUrl, signal: startup.signal, cesiumBaseUrl: new URL('cesium/', document.baseURI).href })
    mounted = loaded
    startup.signal.throwIfAborted()
    binding = bindSceneRuntime(controller, loaded)
    const state = await binding.settled()
    startup.signal.throwIfAborted()
    if (state.status === 'error') throw state.error
  } catch (error) { destroy(); window.removeEventListener('pagehide', destroy); throw error }
  const list = document.getElementById('layer-list'), panel = document.getElementById('layer-panel')
  if (list && panel) {
    panel.hidden = false
    list.replaceChildren(...scene.nodes.filter(node => node.type !== 'tile' && node.type !== 'vector' && !(node.type === 'group' && node.scope === '2d')).map(node => {
      const label = document.createElement('label'); label.className = 'layer-row'
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = node.visible ?? true
      checkbox.addEventListener('change', () => {
        const report = (error: unknown): void => {
          const status = document.getElementById('scene-status')
          if (status) { status.classList.remove('scene-status--quiet'); status.textContent = String(error) }
        }
        try { controller.setNodeVisible(node.id, checkbox.checked) }
        catch (error) { report(error); return }
        void binding!.settled().then(state => { if (state.status === 'error') report(state.error) })
      })
      const name = document.createElement('span'); name.textContent = node.name
      label.append(checkbox,name); return label
    }))
  }
  const switchView = document.createElement('a')
  const url = new URL(window.location.href); url.searchParams.set('mode','2d')
  switchView.href = url.href; switchView.textContent = '查看二维地图'
  switchView.style.cssText = 'position:absolute;right:16px;top:16px;z-index:20;padding:8px 12px;background:white;border-radius:5px;color:#245487'
  if (Object.values(scene.views).some(view => view.type === '2d')) target.append(switchView)
  const status = document.getElementById('scene-status')
  if (status) {
    status.textContent = loaded.issues.length ? loaded.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n') : '三维场景已加载'
    if (!loaded.issues.length) setTimeout(() => status.classList.add('scene-status--quiet'),1800)
  }
}
