import { beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/gis-core'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { compileProjectToScene } from '@desktop-webgis/scene-core'
import { useProjectStore } from '@/stores/project.store'
import { addCityGroup, copyCityNodes, deleteCityNodes, dissolveCityGroup, loadCitySample, moveCitySelection, patchCityGroup, setCityNodesLocked, setCityNodesVisible, updateCity } from './city-commands'

beforeEach(() => useProjectStore.getState().loadSnapshot({project:createProject(),featuresByDataset:{}}))
describe('city workflow in the existing project store',() => {
  it('groups and batch-edits one selection per command, preserving saved/published state', () => {
    const first = loadCitySample(), second = loadCitySample(), store = useProjectStore.getState()
    const before = store.getSnapshot(), id = addCityGroup('城市模型', [first, second])
    const grouped = store.getSnapshot()
    expect(grouped.project.city?.groups?.[0].name).toBe('城市模型')
    expect(grouped.project.city?.nodes.every(node => node.groupId === id)).toBe(true)
    store.undoEdit(); expect(store.getSnapshot()).toEqual(before)
    store.redoEdit(); expect(store.getSnapshot()).toEqual(grouped)
    setCityNodesVisible([first, second], false)
    expect(store.getSnapshot().project.city?.nodes.every(node => !node.visible)).toBe(true)
    store.undoEdit(); expect(store.getSnapshot()).toEqual(grouped)
    setCityNodesLocked([first, second], true)
    expect(() => deleteCityNodes([first, second])).toThrow('锁定')
    store.undoEdit(); expect(store.getSnapshot()).toEqual(grouped)
    const copies = copyCityNodes([first, second]); expect(copies).toHaveLength(2)
    expect(new Set(store.getSnapshot().project.city?.nodes.filter(node => copies.includes(node.id)).map(node => node.name)).size).toBe(2)
    expect(store.getSnapshot().project.city?.nodes).toHaveLength(4); store.undoEdit(); expect(store.getSnapshot()).toEqual(grouped)
    deleteCityNodes([first, second]); expect(store.getSnapshot().project.city?.nodes).toHaveLength(0)
    expect(store.getSnapshot().project.city?.assets).toEqual({}); store.undoEdit(); expect(store.getSnapshot()).toEqual(grouped)
    const reopened = parseProjectSnapshot(serializeProjectSnapshot(grouped))
    expect(compileProjectToScene(reopened).scene.city).toEqual(grouped.project.city)
    store.loadSnapshot(reopened); expect(store.getSnapshot()).toEqual(grouped)
  })
  it('rejects a whole move when any member is locked and preserves effective visibility on dissolve', () => {
    const first = loadCitySample(), second = loadCitySample(), id = addCityGroup('模型', [first]), store = useProjectStore.getState()
    patchCityGroup(id, { locked: true })
    const locked = store.getSnapshot()
    expect(() => moveCitySelection([first, second])).toThrow('锁定'); expect(store.getSnapshot()).toEqual(locked)
    expect(() => setCityNodesLocked([first], false)).toThrow('所属分组')
    const copies = copyCityNodes([first]); expect(store.getSnapshot().project.city?.nodes.find(node => node.id === copies[0])?.groupId).toBeUndefined(); store.undoEdit()
    patchCityGroup(id, { locked: false, visible: false }); dissolveCityGroup(id)
    expect(store.getSnapshot().project.city?.nodes.find(node => node.id === first)?.visible).toBe(false)
    expect(store.getSnapshot().project.city?.nodes.find(node => node.id === first)?.groupId).toBeUndefined()
    store.undoEdit(); expect(store.getSnapshot().project.city?.groups?.[0].id).toBe(id)
  })
  it('commits geometry once, undoes/redoes the entire change and reopens attributes/field labels unchanged', () => {
    updateCity('绘制面', city => { city.nodes.push({ id: 'area', name: 'Area', type: 'graphic', visible: true, geometry: { type: 'polygon', heightMode: 'ground', positions: [[116,39,0],[116.1,39,0],[116,39.1,0]] }, style: { color: '#336699', width: 3, pointSize: 10, labelField: 'zone' }, properties: { zone: '住宅区', height: 0, enabled: false }, popup: { fields: [{ field: 'zone', label: '用途' }] } }); return city })
    const store = useProjectStore.getState(), before = store.getSnapshot()
    updateCity('编辑图形几何', city => { const node = city.nodes[0]; if (node.type === 'graphic') node.geometry.positions = [[115.99,39,0],[116.05,39,0],[116.1,39,0],[116,39.1,0]]; return city })
    const after = store.getSnapshot()
    expect(store.undoEdit()).toBe(true); expect(store.getSnapshot()).toEqual(before)
    expect(store.redoEdit()).toBe(true); expect(store.getSnapshot()).toEqual(after)
    const reopened = parseProjectSnapshot(serializeProjectSnapshot(after))
    store.loadSnapshot(reopened); expect(store.getSnapshot()).toEqual(after)
    expect(compileProjectToScene(reopened).scene.city).toEqual(after.project.city)
    expect(store.undoEdit()).toBe(false)
  })
  it('commits one graphic, persists style and popup, and keeps ribbon preferences outside history',() => {
    const store = useProjectStore.getState()
    updateCity('绘制面', city => { city.nodes.push({ id: 'area', name: 'Area', type: 'graphic', visible: true, geometry: { type: 'polygon', heightMode: 'ground', positions: [[116,39,0],[116.1,39,0],[116,39.1,0]] }, style: { color: '#336699', width: 3, pointSize: 10, label: 'Zone' }, properties: { name: 'Area' }, popup: { fields: [{ field: 'name', label: '名称' }] } }); return city })
    const snapshot = store.getSnapshot()
    expect(parseProjectSnapshot(serializeProjectSnapshot(snapshot)).project.city).toEqual(snapshot.project.city)
    const layout = useWorkspaceStore.getState(); layout.setRibbonCategory('edit'); layout.toggleRibbon()
    expect(store.getSnapshot()).toEqual(snapshot)
    expect(store.undoEdit()).toBe(true)
    expect(useProjectStore.getState().project.city).toBeUndefined()
    expect(store.undoEdit()).toBe(false)
    expect(store.redoEdit()).toBe(true)
    expect(useProjectStore.getState().project.city?.nodes).toHaveLength(1)
  })
  it('adds a city, commits one drag, and undoes in the shared history',() => {
    const id=loadCitySample(),store=useProjectStore.getState()
    updateCity('变换三维模型',scene => ({...scene,nodes:scene.nodes.map(n => n.id === id && n.type === '3dtiles' ? {...n,transform:{...n.transform,translation:[30,20,0]}} : n)}))
    const scene=compileProjectToScene(useProjectStore.getState().getSnapshot()).scene
    const node=scene.city?.nodes[0]
    expect(node?.type === '3dtiles' && node.transform.translation).toEqual([30,20,0])
    store.undoEdit()
    const original=useProjectStore.getState().project.city?.nodes[0]
    expect(original?.type === '3dtiles' && original.transform.translation).toEqual([0,0,0])
    store.undoEdit();expect(useProjectStore.getState().project.city).toBeUndefined()
    store.redoEdit();expect(useProjectStore.getState().project.city?.nodes).toHaveLength(1)
  })
})
