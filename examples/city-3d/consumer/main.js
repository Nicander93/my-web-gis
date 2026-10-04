import { Viewer, TileMapServiceImageryProvider } from 'cesium'
import { GraphicLayer, LayerCollection, TilesetLayer } from '@desktop-webgis/cesium-layer'
import { TilesetEditor } from '@desktop-webgis/cesium-tileset-edit'
import { CityEffects, WaterLayer } from '@desktop-webgis/cesium-effects'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'

globalThis.CESIUM_BASE_URL = new URL('cesium/', document.baseURI).href
const viewer = new Viewer('map', { baseLayer: false, infoBox: false, selectionIndicator: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, requestRenderMode: true, maximumRenderTimeChange: Infinity })
const layers = new LayerCollection(viewer)
const annotations = new GraphicLayer({ id: 'annotations', name: '标绘' })
let drawing
function cancelDrawing() { const previous = drawing; drawing = undefined; previous?.cancel(); layers.pickingEnabled = true }
const city = new TilesetLayer({ id: 'blocks', name: '城市街区', url: './city-sample/tileset.json' })
city.bindPopup({ title: '城市样例', fields: [{ field: 'name', label: '名称' }] })
const water = new WaterLayer({ id: 'water', boundary: [[116.394,39.905,0],[116.397,39.905,0],[116.397,39.91,0],[116.394,39.91,0]], height: 2 })
const effects = new CityEffects(viewer)
effects.update({ fog: 0, bloom: false })
const history = []
const status = document.getElementById('status')
const editor = new TilesetEditor(viewer, {
  onStart: () => { layers.pickingEnabled = false },
  onCancel: () => { layers.pickingEnabled = true },
  onCommit: event => { layers.pickingEnabled = true; history.push(event); status.textContent = `已变换 ${event.id}，可撤销` }
})
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  cancelDrawing()
  try { editor.setMode(button.dataset.mode); editor.startEditing(city); status.textContent = '拖动彩色手柄；Esc 取消' }
  catch (error) { status.textContent = error.message }
}))
document.getElementById('stop').addEventListener('click', () => { cancelDrawing(); editor.stopEditing() })
document.querySelectorAll('[data-draw]').forEach(button => button.addEventListener('click', async () => {
  try {
    editor.stopEditing(); cancelDrawing()
    const session = annotations.startDraw({ type: button.dataset.draw, properties: { name: '独立标绘' } })
    drawing = session; layers.pickingEnabled = false
    status.textContent = '单击采集；Enter 或右键完成，Esc 取消'
    const result = await session.result
    if (drawing !== session) return
    drawing = undefined; layers.pickingEnabled = true
    if (result.status === 'completed') {
      annotations.addGraphic(result.graphic).bindPopup({ title: '标绘', fields: [{ field: 'name', label: '名称' }] })
      status.textContent = `已创建图形，共 ${annotations.allGraphics.length} 个；单击查看属性`
    } else status.textContent = '已取消绘制'
  } catch (error) { layers.pickingEnabled = true; status.textContent = error.message }
}))
document.getElementById('water').addEventListener('click', () => { water.show = !water.show })
document.getElementById('undo').addEventListener('click', () => { editor.cancel(); const event = history.pop(); if (event) { city.setTransform(event.before); editor.refresh(); status.textContent = '已撤销上次变换' } })
window.addEventListener('pagehide', () => { cancelDrawing(); editor.destroy(); layers.destroy(); effects.destroy(); viewer.destroy() }, { once: true })
try {
  const imagery = await TileMapServiceImageryProvider.fromUrl(new URL('cesium/Assets/Textures/NaturalEarthII', document.baseURI).href)
  viewer.imageryLayers.addImageryProvider(imagery)
  await Promise.all([city.addTo(layers), water.addTo(layers), annotations.addTo(layers)])
  await city.flyTo()
  status.textContent = '城市已加载；选择移动、旋转或缩放'
} catch (error) { status.textContent = error.message }
