import { createId, SetCitySceneCommand } from '@desktop-webgis/gis-core'
import { createCityScene, createTransform, getCityNodeState, moveCityNodes, removeCityGroup } from '@desktop-webgis/cesium-scene-schema'
import type { CityGroup, CityNode, CityScene, GeoPosition } from '@desktop-webgis/cesium-scene-schema'
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

function selectedNodes(scene: CityScene, ids: readonly string[], editable = false): CityNode[] {
  const selected = new Set(ids), nodes = scene.nodes.filter(node => selected.has(node.id))
  if (!nodes.length || nodes.length !== selected.size) throw new Error('请选择存在的对象')
  if (editable && nodes.some(node => getCityNodeState(scene, node).locked)) throw new Error('选中对象或其分组已锁定，请先解锁')
  return nodes
}

export function setCityNodesVisible(ids: readonly string[], visible: boolean): void {
  updateCity('批量设置对象显隐', scene => { selectedNodes(scene, ids).forEach(node => { node.visible = visible }); return scene })
}
export function setCityNodesLocked(ids: readonly string[], locked: boolean): void {
  updateCity('批量设置对象锁定', scene => {
    const nodes = selectedNodes(scene, ids)
    if (!locked && nodes.some(node => scene.groups?.find(group => group.id === node.groupId)?.locked)) throw new Error('请先解锁对象所属分组')
    nodes.forEach(node => { node.locked = locked }); return scene
  })
}
export function deleteCityNodes(ids: readonly string[]): void {
  updateCity('删除三维对象', scene => {
    selectedNodes(scene, ids, true)
    scene.nodes = scene.nodes.filter(node => !ids.includes(node.id))
    for (const id of Object.keys(scene.assets)) if (!scene.nodes.some(node => 'asset' in node && node.asset === id)) delete scene.assets[id]
    return scene
  })
}
export function copyCityNodes(ids: readonly string[]): string[] {
  const copied: string[] = []
  updateCity('复制三维对象', scene => {
    const names = new Set(scene.nodes.map(node => node.name))
    const copies = selectedNodes(scene, ids).map(node => {
      const copy = structuredClone(node)
      const base = `${node.name} 副本`
      let name = base, suffix = 2
      while (names.has(name)) name = `${base} ${suffix++}`
      names.add(name)
      copy.id = createId('city'); copy.name = name; copy.locked = false
      if (scene.groups?.find(group => group.id === copy.groupId)?.locked) { copy.visible = getCityNodeState(scene, node).visible; delete copy.groupId }
      copied.push(copy.id); return copy
    })
    scene.nodes.push(...copies); return scene
  })
  return copied
}
export function addCityGroup(name: string, ids: readonly string[] = []): string {
  if (!name.trim()) throw new Error('分组名称不能为空')
  const id = createId('city-group')
  updateCity('创建场景分组', scene => {
    const nodes = ids.length ? selectedNodes(scene, ids, true) : []
    scene.groups ??= []; scene.groups.push({ id, name: name.trim(), visible: true })
    nodes.forEach(node => { node.groupId = id }); return scene
  })
  return id
}
export function patchCityGroup(id: string, patch: Partial<Pick<CityGroup, 'name' | 'visible' | 'locked'>>): void {
  updateCity('设置场景分组', scene => {
    const group = scene.groups?.find(group => group.id === id)
    if (!group) throw new Error('分组不存在')
    if (patch.name !== undefined && (group.locked || !patch.name.trim())) throw new Error(group.locked ? '请先解锁分组' : '分组名称不能为空')
    Object.assign(group, patch); return scene
  })
}
export function moveCitySelection(ids: readonly string[], groupId?: string, beforeId?: string): void {
  updateCity('移动场景对象', scene => moveCityNodes(scene, ids, groupId, beforeId))
}
export function dissolveCityGroup(id: string): void { updateCity('解散场景分组', scene => removeCityGroup(scene, id)) }
