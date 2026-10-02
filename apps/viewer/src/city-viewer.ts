import { createCityRuntime } from '@desktop-webgis/cesium-scene-runtime'
import type { SceneManifest } from '@desktop-webgis/scene-schema'
import 'cesium/Build/Cesium/Widgets/widgets.css'

/** Read-only city viewer; no editor application or React dependency. */
export async function renderCityViewer(scene: SceneManifest, sceneUrl: string): Promise<void> {
  if (!scene.city) return
  const target = document.getElementById('map')
  if (!target) throw new Error('Viewer 缺少地图容器')
  target.setAttribute('aria-label', '城市三维场景')
  const runtime = createCityRuntime({ target, scene: scene.city, sceneUrl: new URL(sceneUrl, document.baseURI).href, cesiumBaseUrl: new URL('cesium/', document.baseURI).href })
  window.addEventListener('pagehide', () => runtime.destroy(), { once: true })
  const list = document.getElementById('layer-list'), panel = document.getElementById('layer-panel')
  if (list && panel) {
    panel.hidden = false
    list.replaceChildren(...scene.city.nodes.map(node => {
      const label = document.createElement('label'); label.className = 'layer-row'
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = node.visible
      checkbox.addEventListener('change', () => { const layer = runtime.layers.getLayer(node.id); if (layer) layer.show = checkbox.checked })
      const name = document.createElement('span'); name.textContent = node.name
      label.append(checkbox,name); return label
    }))
  }
  await runtime.updateScene(scene.city)
  const switchView = document.createElement('a')
  const url = new URL(window.location.href); url.searchParams.set('mode','2d')
  switchView.href = url.href; switchView.textContent = '查看二维地图'
  switchView.style.cssText = 'position:absolute;right:16px;top:16px;z-index:20;padding:8px 12px;background:white;border-radius:5px;color:#245487'
  target.append(switchView)
  const status = document.getElementById('scene-status')
  if (status) { status.textContent = '三维场景已加载'; setTimeout(() => status.classList.add('scene-status--quiet'),1800) }
}
