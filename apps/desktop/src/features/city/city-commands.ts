import { createId, SetCitySceneCommand } from '@desktop-webgis/gis-core'
import { createCityScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import type { CityNode, CityScene, GeoPosition } from '@desktop-webgis/cesium-scene-schema'
import { useProjectStore } from '@/stores/project.store'

export function updateCity(label: string, update: (scene: CityScene) => CityScene): void {
  const state = useProjectStore.getState()
  const before = state.project.city
  const after = update(structuredClone(before ?? createCityScene()))
  after.version = 2
  if (JSON.stringify(before) === JSON.stringify(after)) return
  state.executeEditCommand(new SetCitySceneCommand(createId('cmd'), label, before, after))
}

export function addCityAsset(type: '3dtiles' | 'model' | 'geojson', url: string, name: string, position: GeoPosition = [116.391,39.907,0]): string {
  const id = createId('city'), asset = createId('asset')
  updateCity('添加三维图层', scene => {
    scene.assets[asset] = { type: type === 'model' ? 'glb' : type, url }
    const base = { id, name: name.trim() || type, visible: true, asset, popup: { fields: [{ field: 'name', label: '名称' }] } }
    const node: CityNode = type === 'model' ? { ...base, type, position, transform: createTransform() } : type === '3dtiles' ? { ...base, type, transform: createTransform() } : { ...base, type }
    scene.nodes.push(node)
    return scene
  })
  return id
}

export function loadCitySample(): string {
  const id = createId('city')
  updateCity('加载城市样例', scene => {
    const asset = createId('asset')
    scene.assets[asset] = { type: '3dtiles', url: './city-sample/tileset.json' }
    scene.nodes.push({ id, name: '城市街区 · 16 栋建筑', type: '3dtiles', asset, visible: true, transform: createTransform(), popup: { title: '城市样例', fields: [{ field: 'name', label: '名称' }] } })
    scene.camera = { position: [116.391,39.902,850], heading: 0, pitch: -48, roll: 0 }
    return scene
  })
  return id
}

export function addSampleWater(): void {
  updateCity('添加水面', scene => {
    const [lon,lat] = scene.camera.position
    scene.nodes.push({ id: createId('water'), name: '水面', type: 'water', visible: true, boundary: [[lon-.001,lat+.002,0],[lon+.001,lat+.002,0],[lon+.001,lat+.003,0],[lon-.001,lat+.003,0]], height: 2, color: '#238bafcc', amplitude: 4, frequency: 1000, speed: .02 })
    return scene
  })
}
