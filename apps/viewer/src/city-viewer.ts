import { createCesiumDocumentRuntime, projectCesiumDocument, type CesiumDocumentRuntime } from '@desktop-webgis/cesium-scene-runtime'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import 'cesium/Build/Cesium/Widgets/widgets.css'

/** Read-only city viewer; no editor application or React dependency. */
export async function renderCityViewer(scene: SceneDocument, sceneUrl: string, viewId: string): Promise<void> {
  const target = document.getElementById('map')
  if (!target) throw new Error('Viewer 缺少地图容器')
  target.setAttribute('aria-label', '城市三维场景')
  let hidden = false, mounted: CesiumDocumentRuntime | undefined
  const destroy = (): void => { hidden = true; mounted?.destroy() }
  window.addEventListener('pagehide', destroy, { once: true })
  let loaded: CesiumDocumentRuntime
  try { loaded = await createCesiumDocumentRuntime({ target, document: scene, viewId, sceneUrl, cesiumBaseUrl: new URL('cesium/', document.baseURI).href }) }
  catch (error) { window.removeEventListener('pagehide', destroy); throw error }
  mounted = loaded
  if (hidden) { loaded.destroy(); return }
  const runtime = loaded.runtime
  const list = document.getElementById('layer-list'), panel = document.getElementById('layer-panel')
  if (list && panel) {
    panel.hidden = false
    list.replaceChildren(...scene.nodes.filter(node => node.type !== 'tile' && node.type !== 'vector' && !(node.type === 'group' && node.scope === '2d')).map(node => {
      const label = document.createElement('label'); label.className = 'layer-row'
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = node.visible ?? true
      checkbox.addEventListener('change', () => {
        const next = structuredClone(scene)
        const definition = next.nodes.find(candidate => candidate.id === node.id)
        if (!definition) return
        definition.visible = checkbox.checked
        const projection = projectCesiumDocument(next, viewId)
        const previous = scene
        scene = next
        void runtime.updateScene(projection.scene).catch(error => {
          if (scene !== next) return
          scene = previous
          checkbox.checked = !checkbox.checked
          const status = document.getElementById('scene-status')
          if (status) { status.classList.remove('scene-status--quiet'); status.textContent = String(error) }
        })
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
