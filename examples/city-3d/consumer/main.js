import { Viewer, TileMapServiceImageryProvider } from 'cesium'
import { LayerCollection, TilesetLayer } from '@desktop-webgis/cesium-layer'
import { TilesetEditor } from '@desktop-webgis/cesium-tileset-edit'
import { CityEffects, WaterLayer } from '@desktop-webgis/cesium-effects'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'

globalThis.CESIUM_BASE_URL = new URL('cesium/', document.baseURI).href
const viewer = new Viewer('map', { baseLayer: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, requestRenderMode: true, maximumRenderTimeChange: Infinity })
const layers = new LayerCollection(viewer)
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
  try { editor.setMode(button.dataset.mode); editor.startEditing(city); status.textContent = '拖动彩色手柄；Esc 取消' }
  catch (error) { status.textContent = error.message }
}))
document.getElementById('stop').addEventListener('click', () => editor.stopEditing())
document.getElementById('water').addEventListener('click', () => { water.show = !water.show })
document.getElementById('undo').addEventListener('click', () => { editor.cancel(); const event = history.pop(); if (event) { city.setTransform(event.before); editor.refresh(); status.textContent = '已撤销上次变换' } })
window.addEventListener('pagehide', () => { editor.destroy(); layers.destroy(); effects.destroy(); viewer.destroy() }, { once: true })
try {
  const imagery = await TileMapServiceImageryProvider.fromUrl(new URL('cesium/Assets/Textures/NaturalEarthII', document.baseURI).href)
  viewer.imageryLayers.addImageryProvider(imagery)
  await Promise.all([city.addTo(layers), water.addTo(layers)])
  await city.flyTo()
  status.textContent = '城市已加载；选择移动、旋转或缩放'
} catch (error) { status.textContent = error.message }
