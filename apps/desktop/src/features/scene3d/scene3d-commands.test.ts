import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/project'
import { parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/project'
import { useWorkspaceStore } from '@/view-state/workspace.store'
import { compileProjectToScene } from '@/exchange/compile-project'
import { useProjectStore } from '@/session/project.store'
import { addSceneGroup, copySceneNodes, deleteSceneNodes, dissolveSceneGroup, loadSceneSample, moveSceneSelection, patchSceneGroup, setSceneNodesLocked, setSceneNodesVisible, updateScene } from './scene3d-commands'

beforeEach(() => projectSession.loadSnapshot({project:createProject('Scene', 'scene3d'),featuresByDataset:{}}))
describe('3D scene workflow in the existing project store',() => {
  it('groups and batch-edits one selection per command, preserving saved/published state', () => {
    const first = loadSceneSample(), second = loadSceneSample(), store = useProjectStore.getState()
    const before = projectSession.getSnapshot(), id = addSceneGroup('城市模型', [first, second])
    const grouped = projectSession.getSnapshot()
    expect(grouped.project.content.scene?.groups?.[0].name).toBe('城市模型')
    expect(grouped.project.content.scene?.nodes.every(node => node.groupId === id)).toBe(true)
    projectEdits.undo(); expect(projectSession.getSnapshot()).toEqual(before)
    projectEdits.redo(); expect(projectSession.getSnapshot()).toEqual(grouped)
    setSceneNodesVisible([first, second], false)
    expect(projectSession.getSnapshot().project.content.scene?.nodes.every(node => !node.visible)).toBe(true)
    projectEdits.undo(); expect(projectSession.getSnapshot()).toEqual(grouped)
    setSceneNodesLocked([first, second], true)
    expect(() => deleteSceneNodes([first, second])).toThrow('锁定')
    projectEdits.undo(); expect(projectSession.getSnapshot()).toEqual(grouped)
    const copies = copySceneNodes([first, second]); expect(copies).toHaveLength(2)
    expect(new Set(projectSession.getSnapshot().project.content.scene?.nodes.filter(node => copies.includes(node.id)).map(node => node.name)).size).toBe(2)
    expect(projectSession.getSnapshot().project.content.scene?.nodes).toHaveLength(4); projectEdits.undo(); expect(projectSession.getSnapshot()).toEqual(grouped)
    deleteSceneNodes([first, second]); expect(projectSession.getSnapshot().project.content.scene?.nodes).toHaveLength(0)
    expect(projectSession.getSnapshot().project.content.scene?.assets).toEqual({}); projectEdits.undo(); expect(projectSession.getSnapshot()).toEqual(grouped)
    const reopened = parseProjectSnapshot(serializeProjectSnapshot(grouped))
    expect(compileProjectToScene(reopened).scene.city).toEqual(grouped.project.content.scene)
    projectSession.loadSnapshot(reopened); expect(projectSession.getSnapshot()).toEqual(grouped)
  })
  it('rejects a whole move when any member is locked and preserves effective visibility on dissolve', () => {
    const first = loadSceneSample(), second = loadSceneSample(), id = addSceneGroup('模型', [first]), store = useProjectStore.getState()
    patchSceneGroup(id, { locked: true })
    const locked = projectSession.getSnapshot()
    expect(() => moveSceneSelection([first, second])).toThrow('锁定'); expect(projectSession.getSnapshot()).toEqual(locked)
    expect(() => setSceneNodesLocked([first], false)).toThrow('所属分组')
    const copies = copySceneNodes([first]); expect(projectSession.getSnapshot().project.content.scene?.nodes.find(node => node.id === copies[0])?.groupId).toBeUndefined(); projectEdits.undo()
    patchSceneGroup(id, { locked: false, visible: false }); dissolveSceneGroup(id)
    expect(projectSession.getSnapshot().project.content.scene?.nodes.find(node => node.id === first)?.visible).toBe(false)
    expect(projectSession.getSnapshot().project.content.scene?.nodes.find(node => node.id === first)?.groupId).toBeUndefined()
    projectEdits.undo(); expect(projectSession.getSnapshot().project.content.scene?.groups?.[0].id).toBe(id)
  })
  it('commits geometry once, undoes/redoes the entire change and reopens attributes/field labels unchanged', () => {
    updateScene('绘制面', scene => { scene.nodes.push({ id: 'area', name: 'Area', type: 'graphic', visible: true, geometry: { type: 'polygon', heightMode: 'ground', positions: [[116,39,0],[116.1,39,0],[116,39.1,0]] }, style: { color: '#336699', width: 3, pointSize: 10, labelField: 'zone' }, properties: { zone: '住宅区', height: 0, enabled: false }, popup: { fields: [{ field: 'zone', label: '用途' }] } }); return scene })
    const store = useProjectStore.getState(), before = projectSession.getSnapshot()
    updateScene('编辑图形几何', scene => { const node = scene.nodes[0]; if (node.type === 'graphic') node.geometry.positions = [[115.99,39,0],[116.05,39,0],[116.1,39,0],[116,39.1,0]]; return scene })
    const after = projectSession.getSnapshot()
    expect(projectEdits.undo()).toBe(true); expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.redo()).toBe(true); expect(projectSession.getSnapshot()).toEqual(after)
    const reopened = parseProjectSnapshot(serializeProjectSnapshot(after))
    projectSession.loadSnapshot(reopened); expect(projectSession.getSnapshot()).toEqual(after)
    expect(compileProjectToScene(reopened).scene.city).toEqual(after.project.content.scene)
    expect(projectEdits.undo()).toBe(false)
  })
  it('commits one graphic, persists style and popup, and keeps ribbon preferences outside history',() => {
    const store = useProjectStore.getState()
    updateScene('绘制面', scene => { scene.nodes.push({ id: 'area', name: 'Area', type: 'graphic', visible: true, geometry: { type: 'polygon', heightMode: 'ground', positions: [[116,39,0],[116.1,39,0],[116,39.1,0]] }, style: { color: '#336699', width: 3, pointSize: 10, label: 'Zone' }, properties: { name: 'Area' }, popup: { fields: [{ field: 'name', label: '名称' }] } }); return scene })
    const snapshot = projectSession.getSnapshot()
    expect(parseProjectSnapshot(serializeProjectSnapshot(snapshot)).project.content.scene).toEqual(snapshot.project.content.scene)
    const layout = useWorkspaceStore.getState(); layout.setRibbonCategory('edit'); layout.toggleRibbon()
    expect(projectSession.getSnapshot()).toEqual(snapshot)
    expect(projectEdits.undo()).toBe(true)
    expect(useProjectStore.getState().project.content.scene?.nodes).toEqual([])
    expect(useProjectStore.getState().project.content.kind).toBe('scene3d')
    expect(projectEdits.undo()).toBe(false)
    expect(projectEdits.redo()).toBe(true)
    expect(useProjectStore.getState().project.content.scene?.nodes).toHaveLength(1)
  })
  it('adds a scene object, commits one drag, and undoes in the shared history',() => {
    const id=loadSceneSample(),store=useProjectStore.getState()
    updateScene('变换三维模型',scene => ({...scene,nodes:scene.nodes.map(n => n.id === id && n.type === '3dtiles' ? {...n,transform:{...n.transform,translation:[30,20,0]}} : n)}))
    const scene=compileProjectToScene(projectSession.getSnapshot()).scene
    const node=scene.city?.nodes[0]
    expect(node?.type === '3dtiles' && node.transform.translation).toEqual([30,20,0])
    projectEdits.undo()
    const original=useProjectStore.getState().project.content.scene?.nodes[0]
    expect(original?.type === '3dtiles' && original.transform.translation).toEqual([0,0,0])
    projectEdits.undo();expect(useProjectStore.getState().project.content.scene?.nodes).toEqual([])
    expect(useProjectStore.getState().project.content.kind).toBe('scene3d')
    projectEdits.redo();expect(useProjectStore.getState().project.content.scene?.nodes).toHaveLength(1)
  })
})
