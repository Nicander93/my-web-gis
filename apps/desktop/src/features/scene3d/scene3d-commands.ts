import { createId, SetCesiumSceneCommand } from '@desktop-webgis/gis-core'
import { createCesiumScene, createTransform, getCesiumSceneNodeState, getCesiumSceneGroupState, moveCesiumSceneNodes, moveCesiumSceneGroup, removeCesiumSceneGroup, validateResourceReference, isSceneResourceUrl } from '@desktop-webgis/cesium-scene-schema'
import type { CesiumSceneGroup, CesiumSceneNode, CesiumScene, GeoPosition, ResourceReference } from '@desktop-webgis/cesium-scene-schema'
import { useProjectStore } from '@/stores/project.store'

export function updateScene(label: string, update: (scene: CesiumScene) => CesiumScene): void {
  const state = useProjectStore.getState()
  const before = state.project.city
  const after = update(structuredClone(before ?? createCesiumScene()))
  after.version = 2
  if (JSON.stringify(before) === JSON.stringify(after)) return
  state.executeEditCommand(new SetCesiumSceneCommand(createId('cmd'), label, before, after))
}

export function addSceneAsset(type: '3dtiles' | 'model' | 'geojson', source: string | ResourceReference, name: string, position: GeoPosition = [116.391,39.907,0]): string {
  if (typeof source === 'string' ? !isSceneResourceUrl(source) : !validateResourceReference(source)) throw new Error('资源地址或引用无效')
  const id = createId('scene3d'), asset = createId('asset')
  updateScene('添加三维图层', scene => {
    scene.assets[asset] = { type: type === 'model' ? 'glb' : type, ...(typeof source === 'string' ? { url: source } : { reference: structuredClone(source) }) }
    const base = { id, name: name.trim() || type, visible: true, asset, popup: { fields: [{ field: 'name', label: '名称' }] } }
    const node: CesiumSceneNode = type === 'model' ? { ...base, type, position, transform: createTransform() } : type === '3dtiles' ? { ...base, type, transform: createTransform() } : { ...base, type }
    scene.nodes.push(node)
    return scene
  })
  return id
}

export function loadSceneSample(): string {
  const id = createId('scene3d')
  updateScene('加载三维示例', scene => {
    const asset = createId('asset')
    scene.assets[asset] = { type: '3dtiles', url: './city-sample/tileset.json' }
    scene.nodes.push({ id, name: '建筑场景 · 16 栋建筑', type: '3dtiles', asset, visible: true, transform: createTransform(), popup: { title: '三维示例', fields: [{ field: 'name', label: '名称' }] } })
    scene.camera = { position: [116.391,39.902,850], heading: 0, pitch: -48, roll: 0 }
    return scene
  })
  return id
}

export function addSampleWater(): void {
  updateScene('添加水面', scene => {
    const [lon,lat] = scene.camera.position
    scene.nodes.push({ id: createId('water'), name: '水面', type: 'water', visible: true, boundary: [[lon-.001,lat+.002,0],[lon+.001,lat+.002,0],[lon+.001,lat+.003,0],[lon-.001,lat+.003,0]], height: 2, color: '#238bafcc', amplitude: 4, frequency: 1000, speed: .02 })
    return scene
  })
}

function selectedNodes(scene: CesiumScene, ids: readonly string[], editable = false): CesiumSceneNode[] {
  const selected = new Set(ids), nodes = scene.nodes.filter(node => selected.has(node.id))
  if (!nodes.length || nodes.length !== selected.size) throw new Error('请选择存在的对象')
  if (editable && nodes.some(node => getCesiumSceneNodeState(scene, node).locked)) throw new Error('选中对象或其分组已锁定，请先解锁')
  return nodes
}

export function setSceneNodesVisible(ids: readonly string[], visible: boolean): void {
  updateScene('批量设置对象显隐', scene => { selectedNodes(scene, ids).forEach(node => { node.visible = visible }); return scene })
}
export function setSceneNodesLocked(ids: readonly string[], locked: boolean): void {
  updateScene('批量设置对象锁定', scene => {
    const nodes = selectedNodes(scene, ids)
    if (!locked && nodes.some(node => getCesiumSceneGroupState(scene, node.groupId).locked)) throw new Error('请先解锁对象所属分组（文件夹）及其父级')
    nodes.forEach(node => { node.locked = locked }); return scene
  })
}
export function deleteSceneNodes(ids: readonly string[]): void {
  updateScene('删除三维对象', scene => {
    selectedNodes(scene, ids, true)
    scene.nodes = scene.nodes.filter(node => !ids.includes(node.id))
    for (const id of Object.keys(scene.assets)) if (!scene.nodes.some(node => 'asset' in node && node.asset === id)) delete scene.assets[id]
    return scene
  })
}
export function copySceneNodes(ids: readonly string[]): string[] {
  const copied: string[] = []
  updateScene('复制三维对象', scene => {
    const names = new Set(scene.nodes.map(node => node.name))
    const copies = selectedNodes(scene, ids).map(node => {
      const copy = structuredClone(node)
      const base = `${node.name} 副本`
      let name = base, suffix = 2
      while (names.has(name)) name = `${base} ${suffix++}`
      names.add(name)
      copy.id = createId('scene3d'); copy.name = name; copy.locked = false
      if (getCesiumSceneGroupState(scene, copy.groupId).locked) { copy.visible = getCesiumSceneNodeState(scene, node).visible; delete copy.groupId }
      copied.push(copy.id); return copy
    })
    scene.nodes.push(...copies); return scene
  })
  return copied
}
export function addSceneGroup(name: string, ids: readonly string[] = [], parentId?: string): string {
  if (!name.trim()) throw new Error('分组名称不能为空')
  const id = createId('scene3d-group')
  updateScene('创建场景分组', scene => {
    const nodes = ids.length ? selectedNodes(scene, ids, true) : []
    if (getCesiumSceneGroupState(scene, parentId).locked) throw new Error('目标文件夹或其父级已锁定')
    scene.groups ??= []; scene.groups.push({ id, name: name.trim(), visible: true, ...(parentId ? { parentId } : {}) })
    nodes.forEach(node => { node.groupId = id }); return scene
  })
  return id
}
export function patchSceneGroup(id: string, patch: Partial<Pick<CesiumSceneGroup, 'name' | 'visible' | 'locked'>>): void {
  updateScene('设置场景分组', scene => {
    const group = scene.groups?.find(group => group.id === id)
    if (!group) throw new Error('分组不存在')
    if (getCesiumSceneGroupState(scene, group.parentId).locked) throw new Error('请先解锁父文件夹')
    if (patch.name !== undefined && (group.locked || !patch.name.trim())) throw new Error(group.locked ? '请先解锁分组' : '分组名称不能为空')
    Object.assign(group, patch); return scene
  })
}
export function moveSceneSelection(ids: readonly string[], groupId?: string, beforeId?: string): void {
  updateScene('移动场景对象', scene => moveCesiumSceneNodes(scene, ids, groupId, beforeId))
}
export function dissolveSceneGroup(id: string): void { updateScene('解散场景分组', scene => removeCesiumSceneGroup(scene, id)) }
export function moveSceneFolder(id: string, parentId?: string, beforeId?: string): void {
  updateScene('移动场景文件夹', scene => moveCesiumSceneGroup(scene, id, parentId, beforeId))
}
export function reorderSceneFolder(id: string, direction: -1 | 1): void {
  updateScene('调整文件夹顺序', scene => {
    const group = scene.groups?.find(group => group.id === id)
    if (!group) throw new Error('文件夹不存在')
    const siblings = scene.groups?.filter(item => item.parentId === group.parentId) ?? []
    const index = siblings.findIndex(item => item.id === id)
    if (index + direction < 0 || index + direction >= siblings.length) return scene
    return moveCesiumSceneGroup(scene, id, group.parentId, direction < 0 ? siblings[index - 1].id : siblings[index + 2]?.id)
  })
}
