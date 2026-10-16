import { useEffect, useRef, useState } from 'react'
import { BottomPanel } from '@/app/BottomPanel'
import { useSceneTaskLog } from './useSceneTaskLog'
import { ResourceRelocationDialog } from './ResourceRelocationDialog'
import { applyResourceRelocation } from '@/services/resource-relocation'
import { ArrowUpDown, Check, Copy, Download, Eye, FolderPlus, Globe, Layers2, LocateFixed, LockKeyhole, Maximize2, MessageSquare, MousePointer2, Move, MoveDown, Palette, PanelLeftClose, PanelRightClose, Plus, RefreshCw, RotateCw, Route, Ruler, Scissors, Search, Shapes, SlidersHorizontal, SquareDashed, Sun, Table2, Trash2, Waves } from 'lucide-react'
import type { CesiumSceneRuntime, EditMode } from '@desktop-webgis/cesium-scene-runtime'
import { createCesiumScene, getCesiumSceneNodeState, getCesiumSceneGroupState, getCesiumSceneDescendantIds } from '@desktop-webgis/cesium-scene-schema'
import type { CesiumSceneNode, GeoPosition, GraphicNode } from '@desktop-webgis/cesium-scene-schema'
import { measureArea, measureGroundDistance, measureHeightDifference, measureSpatialDistance } from '@desktop-webgis/cesium-measure'
import type { SceneMeasurement, SceneMeasurementKind } from '@desktop-webgis/cesium-measure'
import { serializeScene } from '@desktop-webgis/scene-core'
import { registerSceneCameraReader, registerSceneDiagnosticsReader } from './scene3d-runtime-host'
import { createSceneDocumentSession } from './scene3d-document-session'
import { createProjectSceneController } from '../scene/project-scene-controller'
import { Cartesian2, Cartographic, Math as CesiumMath } from 'cesium'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { LayerPopupMenu } from '@/features/layers/LayerPopupMenu'
import { MenuItem } from '@/app/header/menus/MenuItem'
import { LeftPanel } from '@/app/LeftPanel'
import { RightPanel } from '@/app/RightPanel'
import { projectCommands } from '@/app/commands/project.commands'
import { viewCommands } from '@/app/commands/view.commands'
import { exportScene } from '@/services/scene3d-export'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { addSceneAsset, addSceneGroup, copySceneNodes, deleteSceneNodes, dissolveSceneGroup, loadSceneSample, moveSceneSelection, moveSceneFolder, reorderSceneFolder, patchSceneGroup, setSceneNodesLocked, setSceneNodesVisible, updateScene } from './scene3d-commands'
import { SceneResourceDialog } from './SceneResourceDialog'
import type { SceneResourceType } from './SceneResourceDialog'
import { SceneInspector, SceneSettings } from './SceneInspector'
import type { SceneAction } from './scene3d-actions'
import { isContinuousDraw, useSceneDrawing } from './useSceneDrawing'
import { useSceneGraphicEditing } from './useSceneGraphicEditing'
import { GraphicVertexInspector } from './GraphicVertexInspector'
import { SceneTree } from './SceneTree'
import { SceneBatchInspector, SceneGroupInspector } from './SceneOrganizationInspector'
import { SceneCreateGroupDialog } from './SceneCreateGroupDialog'
import { selectSceneIds } from './scene3d-selection'
import type { SceneSelectionMode } from './scene3d-selection'
import type { SceneDrawKind } from './useSceneDrawing'
import { SceneRibbon } from './SceneRibbon'
import type { SceneRibbonCommand } from './SceneRibbon'
import type { LucideIcon } from 'lucide-react'
import { compileSceneObjectExport } from './scene3d-object-export'
import type { SceneInspectorSection } from './SceneInspector'
import { useSceneRenderPreferences } from './SceneRenderSettings'
import { SceneInfo } from './ScenePropertyGroup'
import { ScenePropertyWindow } from './ScenePropertyWindow'
import { applyScenePropertyDraft } from './scene-property-session'
import { FolderPropertyWindow } from '@/features/inspector/FolderPropertyWindow'
import { Button } from '@/components/ui/Button'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './scene3d-editor.css'
import { createLocalResourceSession } from '@/services/local-resource-session'
import { getProjectResourceBasePath } from '@/services/project-io'
import { pickFile } from '@/services/files'
import { localProjectDirectory, normalizeLocalResourcePath } from '@/services/resource-paths'
import { isTauri } from '@tauri-apps/api/core'
import type { ResourceReference } from '@desktop-webgis/cesium-scene-schema'

interface LayerState { state: 'loading' | 'ready' | 'error'; error?: string }
const drawLabels = { rectangle: '矩形', ellipse: '椭圆', billboard: '图标', point: '点', polyline: '线', polygon: '面', water: '水面边界', clip: '裁剪范围', flatten: '压平范围', 'spatial-distance': '空间距离', 'ground-distance': '贴地距离', area: '面积', 'height-difference': '高度差' }
function drawInstruction(kind: SceneDrawKind): string {
  if (isContinuousDraw(kind)) return `连续放置${drawLabels[kind]}：单击创建 · Esc 退出`
  if (kind === 'rectangle' || kind === 'ellipse') return `绘制${drawLabels[kind]}：单击两个对角点自动完成 · Esc 取消`
  return `绘制${drawLabels[kind]}：单击添加顶点 · Enter 完成 · Esc 取消`
}
const measurementKinds: SceneMeasurementKind[] = ['spatial-distance', 'ground-distance', 'area', 'height-difference']
const isMeasurementKind = (kind: SceneDrawKind): kind is SceneMeasurementKind => measurementKinds.includes(kind as SceneMeasurementKind)

interface MeasurementDraft { graphic: GraphicNode; result: SceneMeasurement }

/** General 3D scene editor shell; rendering extensions remain independent of product UI. */
export function SceneWorkspace() {
  const target = useRef<HTMLDivElement>(null)
  const runtime = useRef<CesiumSceneRuntime | undefined>(undefined)
  const propertyPreview = useRef<{ runtime: CesiumSceneRuntime; id: string } | null>(null)
  const documentSession = useRef<ReturnType<typeof createSceneDocumentSession> | undefined>(undefined)
  const resourceSession = useRef<ReturnType<typeof createLocalResourceSession> | undefined>(undefined)
  const pendingFocus = useRef<string | undefined>(undefined)
  const pendingClip = useRef<{ nodeId: string; effectId?: string } | undefined>(undefined)
  const pendingFlatten = useRef<{ nodeId: string; effectId?: string } | undefined>(undefined)
  const measurementRevision = useRef(0)
  const defaultScene = useRef(createCesiumScene())
  const project = useProjectStore(state => state.project)
  const projectEpoch = useProjectStore(state => state.projectEpoch)
  const scene = project.city ?? defaultScene.current
  const left = useWorkspaceStore(state => state.left)
  const right = useWorkspaceStore(state => state.right)
  const renderQuality = useSceneRenderPreferences(state => state.quality)
  const [relocation, setRelocation] = useState<{ assetId: string; scene: typeof scene; epoch: number } | null>(null)
  const [context, setContext] = useState<{ x:number; y:number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const anchor = useRef<string | null>(null)
  const handlePick = useRef<(id: string | null, properties?: Record<string, unknown>, mode?: 'toggle' | 'range') => void>(() => {})
  const [pickedProperties, setPickedProperties] = useState<Record<string, unknown>>({})
  const [editing, setEditing] = useState<EditMode | null>(null)
  const [status, setStatus] = useState('正在启动三维场景…')
  const [error, setError] = useState('')
  const [states, setStates] = useState<Record<string, LayerState>>({})
  useSceneTaskLog(states, scene.nodes, projectEpoch)
  const [ready, setReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [adding, setAdding] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'object' | 'scene'>('object')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [preview, setPreview] = useState(false)
  const [inspectorSection, setInspectorSection] = useState<SceneInspectorSection>('object')
  const [measurement, setMeasurement] = useState<MeasurementDraft | null>(null)
  const [propertyTarget, setPropertyTarget] = useState<{ node: CesiumSceneNode; epoch: number } | null>(null)
  const [folderPropertyTarget, setFolderPropertyTarget] = useState<{ id: string; epoch: number } | null>(null)
  const [pinnedTarget, setPinnedTarget] = useState<{ id: string; epoch: number; properties: Record<string, unknown> } | null>(null)

  const selectedNodes = scene.nodes.filter(candidate => selectedIds.includes(candidate.id))
  const liveIds = selectedNodes.map(node => node.id)
  const definition = selectedNodes.length === 1 ? selectedNodes[0] : undefined
  const node = definition ? { ...definition, ...getCesiumSceneNodeState(scene, definition) } : undefined
  const pinned = pinnedTarget?.epoch === projectEpoch ? pinnedTarget.id : undefined
  const inspectorDefinition = pinned ? scene.nodes.find(candidate => candidate.id === pinned) : definition
  const inspectorNode = inspectorDefinition ? { ...inspectorDefinition, ...getCesiumSceneNodeState(scene, inspectorDefinition) } : undefined
  const inspectorAsset = inspectorNode && 'asset' in inspectorNode ? scene.assets[inspectorNode.asset] : undefined
  const inspectorSource = inspectorAsset?.url ?? (inspectorAsset?.reference?.kind === 'url' ? inspectorAsset.reference.url : inspectorAsset?.reference?.path)
  const group = scene.groups?.find(group => group.id === selectedGroup)
  const hasLocked = selectedNodes.some(node => getCesiumSceneNodeState(scene, node).locked)
  const inheritedLock = selectedNodes.some(node => getCesiumSceneGroupState(scene, node.groupId).locked)
  const allLocked = !!selectedNodes.length && selectedNodes.every(node => getCesiumSceneNodeState(scene, node).locked)
  const highlightKey = JSON.stringify(group ? getCesiumSceneDescendantIds(scene, group.id) : liveIds)
  const canEdit = ready && node?.visible && !node.locked && states[node.id]?.state === 'ready' && (node.type === 'model' || node.type === '3dtiles')
  const canUndo = useProjectStore.getState().canUndoEdit()
  const canRedo = useProjectStore.getState().canRedoEdit()

  function report(reason: unknown): void { setError(reason instanceof Error ? reason.message : '操作失败，请检查输入或资源地址。') }
  function notify(text: string): void { setError(''); setStatus(text) }
  const graphicEditing = useSceneGraphicEditing(runtime.current, result => {
    const id = documentSession.current?.getHostNodeId(result.id)
    if (result.changed && id) updateScene('编辑图形几何', scene => ({ ...scene, nodes: scene.nodes.map(item => item.id === id && item.type === 'graphic' ? { ...item, geometry: result.after } : item) }))
    notify(result.changed ? '几何修改已应用，可一次撤销恢复' : '几何未发生变化')
  }, report, () => notify('已取消几何编辑，原几何已恢复'))

  useEffect(() => {
    if (!target.current) return
    let active = true
    let unregisterCamera: (() => void) | undefined
    let unregisterDiagnostics: (() => void) | undefined
    const controller = createProjectSceneController()
    const localResources = createLocalResourceSession({ projectPath: getProjectResourceBasePath })
    resourceSession.current = localResources
    try {
      documentSession.current = createSceneDocumentSession({ target: target.current, controller, resolveReference: localResources.resolve, readSnapshot: () => useProjectStore.getState().getSnapshot(), renderQuality, cesiumBaseUrl: new URL('cesium/', document.baseURI).href,
        onSelect: (id, properties, mode) => { if (active) handlePick.current(id, properties, mode) },
        onEdit: event => { updateScene('变换三维模型', current => ({ ...current, nodes: current.nodes.map(n => n.id === event.id && (n.type === '3dtiles' || n.type === 'model') ? { ...n, transform: event.after } : n) })); notify('模型变换已应用，可撤销恢复') },
        onState: state => {
          if (!active) return
          setSyncStatus(state.status)
          if (state.runtime && runtime.current !== state.runtime) {
            runtime.current = state.runtime; state.runtime.layers.popupsEnabled = false
          }
          setReady(!!state.runtime); setStates(state.states)
          if (state.status === 'error') { report(state.error); return }
          if (state.status === 'ready') {
            const owner = useProjectStore.getState(), epoch = owner.projectEpoch, projectId = owner.project.id
            const preset = JSON.stringify(owner.project.city?.camera)
            unregisterCamera?.()
            unregisterDiagnostics?.()
            if (state.runtime) {
              const currentRuntime = state.runtime
              unregisterDiagnostics = registerSceneDiagnosticsReader(id => currentRuntime.getDiagnostics(id ? documentSession.current?.getRuntimeNodeId(id) ?? '' : undefined), () => useProjectStore.getState().projectEpoch === epoch)
              unregisterCamera = registerSceneCameraReader(() => currentRuntime.getCamera(), () => {
              const current = useProjectStore.getState()
              return current.projectEpoch === epoch && current.project.id === projectId && JSON.stringify(current.project.city?.camera) === preset
              })
            }
            const id = pendingFocus.current
            if (id && state.states[id]?.state === 'ready') { pendingFocus.current = undefined; locate(id); notify('资源已加载') }
            else setStatus('就绪')
            setError('')
          }
        }
      })
    } catch (reason) { report(reason) }
    return () => { active = false; unregisterCamera?.(); unregisterDiagnostics?.(); documentSession.current?.destroy(); documentSession.current = undefined; controller.dispose(); runtime.current = undefined; resourceSession.current = undefined; void localResources.destroy().catch(reason => console.error('释放本地资源授权失败', reason)) }
  }, [])

  useEffect(() => { if (runtime.current) { try { runtime.current.setRenderQuality(renderQuality) } catch (reason) { report(reason) } } }, [renderQuality, ready])

  useEffect(() => { setEditing(null) }, [project.id, scene.camera])
  useEffect(() => { runtime.current?.setSelected(preview ? [] : (JSON.parse(highlightKey) as string[]).flatMap(id => documentSession.current?.getRuntimeNodeId(id) ?? [])) }, [highlightKey, preview, ready, states])
  useEffect(() => {
    setSelectedIds([]); setSelectedGroup(null); anchor.current = null
    measurementRevision.current++; setMeasurement(null)
    void runtime.current?.setTransientGraphic().catch(report)
  }, [project.id, projectEpoch])

  const drawing = useSceneDrawing(runtime.current, (graphic, kind, id) => {
    try {
      if (isMeasurementKind(kind)) { void completeMeasurement(graphic, kind); return }
      if (kind === 'clip') {
        const pending = pendingClip.current
        pendingClip.current = undefined
        if (!pending) return
        updateScene(pending.effectId ? '重新绘制裁剪范围' : '添加裁剪范围', scene => {
          scene.nodes = scene.nodes.map(item => {
            if (item.id !== pending.nodeId || item.type !== '3dtiles') return item
            const effect = { id: pending.effectId ?? `clip-${crypto.randomUUID()}`, kind: 'clip-polygon' as const, enabled: true, mode: item.effects?.find(current => current.kind === 'clip-polygon')?.mode ?? 'keep-inside' as const, positions: graphic.geometry.positions }
            return { ...item, effects: pending.effectId ? (item.effects ?? []).map(current => current.id === pending.effectId ? effect : current) : [...(item.effects ?? []), effect] }
          })
          return scene
        })
        notify(pending.effectId ? '裁剪范围已重新绘制，可撤销恢复' : '裁剪范围已添加，可在属性面板管理'); return
      }
      if (kind === 'flatten') {
        const pending = pendingFlatten.current; pendingFlatten.current = undefined
        if (!pending) return
        updateScene(pending.effectId ? '重新绘制压平范围' : '添加压平范围', scene => {
          scene.nodes = scene.nodes.map(item => {
            if (item.id !== pending.nodeId || item.type !== '3dtiles') return item
            const found = item.effects?.find(effect => effect.id === pending.effectId)
            const previous = found?.kind === 'flatten-polygon' ? found : undefined
            const averageHeight = Number((graphic.geometry.positions.reduce((sum, position) => sum + position[2], 0) / graphic.geometry.positions.length).toFixed(2))
            const height = previous?.height ?? (Object.is(averageHeight, -0) ? 0 : averageHeight)
            const effect = { id: pending.effectId ?? `flatten-${crypto.randomUUID()}`, kind: 'flatten-polygon' as const, enabled: true, height, positions: graphic.geometry.positions }
            return { ...item, effects: pending.effectId ? (item.effects ?? []).map(current => current.id === pending.effectId ? effect : current) : [...(item.effects ?? []), effect] }
          })
          return scene
        })
        notify(pending.effectId ? '压平范围已重新绘制，可撤销恢复' : '局部压平已应用，可设置目标高程'); return
      }
      if (kind !== 'water') {
        graphic.name = `${drawLabels[kind]} ${scene.nodes.filter(item => item.type === 'graphic').length + 1}`
        graphic.properties.name = graphic.name
        graphic.popup = { fields: [{ field: 'name', label: '名称' }] }
        updateScene('绘制图形', scene => { scene.nodes.push(graphic); return scene })
        if (!isContinuousDraw(kind)) select(graphic.id)
        notify(isContinuousDraw(kind) ? '点已创建；继续单击放置，Esc 退出' : '图形已创建，可配置样式和属性弹窗'); return
      }
      const boundary = graphic.geometry.positions
      const nextId = id ?? `water-${crypto.randomUUID()}`
      updateScene(id ? '重新绘制水面边界' : '绘制水面', scene => {
        if (id) scene.nodes = scene.nodes.map(item => item.id === id && item.type === 'water' ? { ...item, boundary } : item)
        else scene.nodes.push({ id: nextId, name: `水面 ${scene.nodes.filter(item => item.type === 'water').length + 1}`, type: 'water', visible: true, boundary, height: Number((boundary[0][2] + 2).toFixed(2)), color: '#238bafcc', amplitude: 4, frequency: 1000, speed: .02 })
        return scene
      })
      select(nextId); notify(id ? '水面边界已更新' : '水面已创建，可在属性面板调整材质')
    } catch (reason) { report(reason) }
  }, report, () => notify('已取消绘制'))

  useEffect(() => { if (syncStatus === 'ready' && isContinuousDraw(drawing.kind)) drawing.resume() }, [syncStatus, scene.nodes.length])

  async function completeMeasurement(graphic: GraphicNode, kind: SceneMeasurementKind): Promise<void> {
    const currentRuntime = runtime.current
    if (!currentRuntime) return
    const revision = ++measurementRevision.current
    try {
      const positions = graphic.geometry.positions
      const result = kind === 'spatial-distance' ? measureSpatialDistance(positions)
        : kind === 'ground-distance' ? await measureGroundDistance(positions, currentRuntime.viewer.scene)
        : kind === 'area' ? measureArea(positions)
        : measureHeightDifference(positions)
      if (revision !== measurementRevision.current || currentRuntime !== runtime.current) return
      const name = `${drawLabels[kind]} ${scene.nodes.filter(item => item.type === 'graphic' && item.properties.measurementKind === kind).length + 1}`
      const measured: GraphicNode = {
        ...graphic,
        id: `measurement-${crypto.randomUUID()}`,
        name,
        style: { ...graphic.style, color: '#d18b47', width: 4, pointSize: 9 },
        properties: { ...graphic.properties, name, measurementKind: kind, measurementValue: result.value, measurementUnit: result.unit, measurementLabel: result.label },
        popup: { title: name, fields: [{ field: 'measurementLabel', label: '测量结果' }, { field: 'name', label: '名称' }] }
      }
      await currentRuntime.setTransientGraphic(measured)
      if (revision !== measurementRevision.current || currentRuntime !== runtime.current) return
      setMeasurement({ graphic: measured, result }); notify(`${drawLabels[kind]}完成；当前为临时结果`)
    } catch (reason) { if (revision === measurementRevision.current) report(reason) }
  }

  function clearMeasurement(message?: string): void {
    measurementRevision.current++; setMeasurement(null)
    void runtime.current?.setTransientGraphic().catch(report)
    if (message) notify(message)
  }

  function retainMeasurement(): void {
    if (!measurement) return
    const graphic = structuredClone(measurement.graphic)
    clearMeasurement()
    updateScene('保留三维测量', scene => { scene.nodes.push(graphic); return scene })
    select(graphic.id); notify('测量结果已保留到项目，可撤销或保存')
  }

  function stopEditing(): void { graphicEditing.cancel(); runtime.current?.stopEditing(); setEditing(null) }
  function locate(id: string): void {
    const nativeId = documentSession.current?.getRuntimeNodeId(id)
    if (nativeId) void runtime.current?.flyTo(nativeId).catch(report)
  }
  function select(id: string, mode?: SceneSelectionMode, order = scene.nodes.map(node => node.id)): void {
    drawing.cancel(); stopEditing(); setSelectedGroup(null)
    setSelectedIds(selectSceneIds(liveIds, id, mode, order, anchor.current))
    if (mode !== 'range') anchor.current = id
    setPickedProperties({})
  }
  function selectGroup(id: string): void { drawing.cancel(); stopEditing(); setSelectedIds([]); setSelectedGroup(id); setPickedProperties({}) }
  handlePick.current = (id, properties, mode) => { if (id) { select(id, mode === 'range' ? 'add' : mode); setPickedProperties(properties ?? {}) } else { setSelectedIds([]); setSelectedGroup(null); setPickedProperties({}); anchor.current = null } }
  useEffect(() => {
    if ((inspectorSection === 'style' && inspectorNode?.type !== 'graphic' && inspectorNode?.type !== 'geojson') || (inspectorSection === 'source' && (!inspectorNode || inspectorNode.type === 'graphic' || inspectorNode.type === 'water'))) setInspectorSection('object')
  }, [inspectorNode?.id, inspectorNode?.type, inspectorSection])
  function openContext(id: string, x: number, y: number, isGroup = false): void {
    if (isGroup) selectGroup(id)
    else if (!liveIds.includes(id)) select(id)
    setContext({ x, y })
  }
  function organize(action: () => void, message: string): void {
    drawing.cancel(); stopEditing()
    try { action(); notify(message) } catch (reason) { report(reason) }
  }
  function startEditing(mode: EditMode): void {
    if (!node || !canEdit || !runtime.current) return
    drawing.cancel(); graphicEditing.cancel()
    const id = documentSession.current?.getRuntimeNodeId(node.id)
    if (!id) return
    try { runtime.current.startEditing(id, mode); setEditing(mode); notify('拖动彩色手柄调整模型；松手应用，Esc 取消当前拖动') } catch (reason) { report(reason) }
  }
  function startWater(id?: string): void { startDraw('water', id) }
  function startClip(effectId?: string, targetNode = node): void {
    if (!targetNode || targetNode.type !== '3dtiles' || targetNode.locked || !targetNode.visible || states[targetNode.id]?.state !== 'ready') return
    pendingClip.current = { nodeId: targetNode.id, effectId }; startDraw('clip')
  }
  function startFlatten(effectId?: string, targetNode = node): void {
    if (!targetNode || targetNode.type !== '3dtiles' || targetNode.locked || !targetNode.visible || states[targetNode.id]?.state !== 'ready') return
    pendingFlatten.current = { nodeId: targetNode.id, effectId }; startDraw('flatten')
  }
  function startGraphicEditing(targetNode = node): void {
    if (!targetNode || targetNode.type !== 'graphic' || targetNode.locked || !targetNode.visible || states[targetNode.id]?.state !== 'ready') return
    drawing.cancel(); stopEditing(); setInspectorTab('object'); useWorkspaceStore.getState().setRightOpen(true)
    const id = documentSession.current?.getRuntimeNodeId(targetNode.id)
    if (!id) return
    graphicEditing.start(id); notify('编辑顶点：拖动调整 · 白色中点插入 · Enter 应用 · Esc 取消')
  }
  function startDraw(kind: SceneDrawKind, id?: string): void {
    if (!ready) return
    if (measurement) clearMeasurement()
    stopEditing(); drawing.start(kind, id)
    notify(drawInstruction(kind))
  }
  function history(redo = false): void {
    drawing.cancel(); stopEditing()
    const store = useProjectStore.getState()
    if (redo ? store.redoEdit() : store.undoEdit()) notify(redo ? '已重做' : '已撤销')
    else { const reason = store.getHistoryBlockReason(redo ? 'redo' : 'undo'); if (reason) notify(reason) }
  }
  function patchNode(patch: Partial<CesiumSceneNode>, label = '修改三维对象'): void {
    if (!node || node.locked) return
    drawing.cancel()
    if (!Object.keys(patch).every(key => ['transform', 'maximumScreenSpaceError', 'cacheBytes'].includes(key))) stopEditing()
    updateScene(label, scene => ({ ...scene, nodes: scene.nodes.map(n => n.id === node.id ? { ...n, ...patch } as CesiumSceneNode : n) }))
    notify('对象属性已应用')
  }
  function patchInspectorNode(patch: Partial<CesiumSceneNode>, label = '修改三维对象'): void {
    if (!inspectorNode || inspectorNode.locked) return
    drawing.cancel(); stopEditing()
    updateScene(label, current => ({ ...current, nodes: current.nodes.map(item => item.id === inspectorNode.id ? { ...item, ...patch } as CesiumSceneNode : item) }))
    notify('对象属性已应用')
  }
  function previewPropertyNode(draft: CesiumSceneNode | null): void {
    if (!draft) {
      const owner = propertyPreview.current
      propertyPreview.current = null
      owner?.runtime.previewNode(owner.id, null)
      return
    }
    if (!propertyTarget || propertyTarget.epoch !== useProjectStore.getState().projectEpoch) return
    const id = documentSession.current?.getRuntimeNodeId(propertyTarget.node.id)
    if (!id || !runtime.current) return
    drawing.cancel(); stopEditing()
    propertyPreview.current = { runtime: runtime.current, id }
    runtime.current.previewNode(id, draft)
  }
  function pickGround(x: number, y: number): GeoPosition | undefined {
    const viewer = runtime.current?.viewer
    if (!viewer) return
    const point = new Cartesian2(x,y), ray = viewer.camera.getPickRay(point)
    const cartesian = (ray && viewer.scene.globe.pick(ray, viewer.scene)) || viewer.camera.pickEllipsoid(point)
    if (!cartesian) return
    const p = Cartographic.fromCartesian(cartesian)
    return [CesiumMath.toDegrees(p.longitude), CesiumMath.toDegrees(p.latitude), p.height]
  }
  async function chooseLocalResource(type: SceneResourceType): Promise<string | null> {
    const epoch = useProjectStore.getState().projectEpoch, session = resourceSession.current
    if (!session) throw new Error('场景资源会话尚未准备好')
    const path = await pickFile([{ name: type === 'model' ? 'GLB / GLTF 模型' : type === '3dtiles' ? '3D Tiles 主文件' : 'GeoJSON', extensions: type === 'model' ? ['glb', 'gltf'] : type === '3dtiles' ? ['json'] : ['geojson', 'json'] }])
    if (!path) return null
    if (epoch !== useProjectStore.getState().projectEpoch || resourceSession.current !== session) throw new Error('选择期间项目已切换，未添加资源')
    const normalized = normalizeLocalResourcePath(path)
    session.authorizeDirectory(localProjectDirectory(normalized))
    return normalized
  }
  function add(type: SceneResourceType, source: string | ResourceReference, name: string): void {
    const canvas = runtime.current?.viewer.canvas
    const position = canvas ? pickGround(canvas.clientWidth / 2, canvas.clientHeight / 2) : undefined
    const id = addSceneAsset(type, source, name, position)
    pendingFocus.current = id; select(id); notify('正在加载资源…')
  }
  function reload(targetNode = inspectorNode): void {
    if (!targetNode || !documentSession.current) return
    drawing.cancel(); stopEditing()
    notify('正在重新加载资源…'); documentSession.current.refresh()
  }
  function sample(): void {
    try { const id = loadSceneSample(); pendingFocus.current = id; select(id); notify('正在加载三维示例…') } catch (reason) { report(reason) }
  }
  async function exportObjects(): Promise<void> {
    try {
      const scene = compileSceneObjectExport(useProjectStore.getState().getSnapshot(), liveIds)
      const result = await exportScene(serializeScene(scene), node?.name ?? '所选对象')
      notify(result.kind === 'cancelled' ? '已取消导出' : '对象已导出为场景文件，资源地址保留')
    } catch (reason) { report(reason) }
  }
  function saveCamera(): void {
    const camera = runtime.current?.getCamera()
    if (camera) { updateScene('设置三维初始视角', scene => ({ ...scene, camera })); notify('初始视角已更新') }
  }
  function showProperties(section: SceneInspectorSection): void { drawing.cancel(); stopEditing(); setInspectorSection(section); setInspectorTab('object'); useWorkspaceStore.getState().setRightOpen(true) }
  function showScene(): void { drawing.cancel(); stopEditing(); setInspectorTab('scene'); useWorkspaceStore.getState().setRightOpen(true) }
  function togglePreview(): void { setContext(null); drawing.cancel(); stopEditing(); if (measurement) clearMeasurement(); runtime.current?.setPreview(!preview); setPreview(!preview); notify(preview ? '已返回编辑模式' : '预览模式：单击对象查看属性弹窗') }
  function copyNode(): void {
    organize(() => { const ids = copySceneNodes(liveIds); setSelectedIds(ids); setSelectedGroup(null); setPickedProperties({}) }, '所选对象已复制，可撤销恢复')
  }
  function toggleLock(): void {
    organize(() => setSceneNodesLocked(liveIds, !allLocked), allLocked ? '对象已解锁' : '对象已锁定')
  }
  const selectionReason = liveIds.length > 1 ? '此操作需要单独选择一个对象' : !node ? '请先选择一个对象' : node.locked ? '对象或所属分组已锁定，请先解锁' : !node.visible ? '对象或所属分组已隐藏，请先显示' : states[node.id]?.state !== 'ready' ? '对象尚未加载成功' : undefined
  const transformReason = selectionReason ?? (node?.type !== 'model' && node?.type !== '3dtiles' ? '此对象不支持模型变换' : undefined)
  const command = (id: string, label: string, icon: LucideIcon, execute: () => void, disabled?: string, active?: boolean): SceneRibbonCommand => ({ id, label, icon, execute, disabled, active })
  const commands = [
    command('add', '添加数据', Plus, () => setAdding(true)),
    command('select', '选择', MousePointer2, () => { drawing.cancel(); stopEditing(); notify('选择对象') }, undefined, !editing && !drawing.drawing && !graphicEditing.active),
    command('point', '绘制点', MousePointer2, () => startDraw('point'), ready ? undefined : '场景尚未就绪', drawing.kind === 'point'),
    command('billboard', '放置图标', LocateFixed, () => startDraw('billboard'), ready ? undefined : '场景尚未就绪', drawing.kind === 'billboard'),
    command('line', '绘制线', Move, () => startDraw('polyline'), ready ? undefined : '场景尚未就绪', drawing.kind === 'polyline'),
    command('polygon', '绘制面', Shapes, () => startDraw('polygon'), ready ? undefined : '场景尚未就绪', drawing.kind === 'polygon'),
    command('rectangle', '绘制矩形', SquareDashed, () => startDraw('rectangle'), ready ? undefined : '场景尚未就绪', drawing.kind === 'rectangle'),
    command('ellipse', '绘制椭圆', Shapes, () => startDraw('ellipse'), ready ? undefined : '场景尚未就绪', drawing.kind === 'ellipse'),
    command('vertices', '编辑顶点', Shapes, () => startGraphicEditing(), selectionReason ?? (node?.type !== 'graphic' ? '请选择标绘图形' : undefined), graphicEditing.active),
    command('move', '移动', Move, () => startEditing('translate'), transformReason, editing === 'translate'),
    command('rotate', '旋转', RotateCw, () => startEditing('rotate'), transformReason, editing === 'rotate'),
    command('scale', '缩放', Maximize2, () => startEditing('scale'), transformReason, editing === 'scale'),
    command('delete', '删除', Trash2, () => setDeleting(true), !liveIds.length ? '请选择对象' : hasLocked ? '选中对象或分组已锁定，请先解锁' : undefined),
    command('initial', '初始视角', Eye, () => runtime.current?.setCamera(scene.camera)),
    command('lighting', '光照与时间', Sun, showScene),
    command('surface', '底图与地形', Globe, showScene),
    command('environment', '雾与辉光', SlidersHorizontal, showScene),
    command('quality', '画质与性能', SlidersHorizontal, showScene),
    command('clip', '多边形裁剪', Scissors, () => startClip(), selectionReason ?? (node?.type !== '3dtiles' ? '请选择 3D Tiles 对象' : undefined), drawing.kind === 'clip'),
    command('flatten', '局部压平', MoveDown, () => startFlatten(), selectionReason ?? (node?.type !== '3dtiles' ? '请选择 3D Tiles 对象' : undefined), drawing.kind === 'flatten'),
    command('camera', '保存初始视角', Eye, saveCamera, ready ? undefined : '场景尚未就绪'),
    command('water', '水面', Waves, () => startWater(), ready ? undefined : '场景尚未就绪', drawing.kind === 'water'),
    command('measure-space', '空间距离', Ruler, () => startDraw('spatial-distance'), ready ? undefined : '场景尚未就绪', drawing.kind === 'spatial-distance'),
    command('measure-ground', '贴地距离', Route, () => startDraw('ground-distance'), ready ? undefined : '场景尚未就绪', drawing.kind === 'ground-distance'),
    command('measure-area', '面积', SquareDashed, () => startDraw('area'), ready ? undefined : '场景尚未就绪', drawing.kind === 'area'),
    command('measure-height', '高度差', ArrowUpDown, () => startDraw('height-difference'), ready ? undefined : '场景尚未就绪', drawing.kind === 'height-difference'),
    command('new-group', '新建分组', FolderPlus, () => setCreatingGroup(true)),
    command('left', '场景树', Layers2, () => useWorkspaceStore.getState().setLeftOpen(!left.open), undefined, left.open),
    command('right', '属性面板', PanelRightClose, () => useWorkspaceStore.getState().setRightOpen(!right.open), undefined, right.open),
    command('reset', '恢复布局', PanelLeftClose, viewCommands.resetLayout)
  ]
  const handleAction = useRef<(action: SceneAction) => void>(() => {})
  handleAction.current = action => {
    if (preview && action !== 'export-scene') return
    if (action === 'add-resource') setAdding(true)
    else if (action === 'import-scene') void projectCommands.importScene()
    else if (action === 'export-scene') void projectCommands.exportScene()
    else if (action === 'sample') sample()
    else if (action === 'draw-water') startWater()
    else if (action === 'undo') history()
    else if (action === 'redo') history(true)
    else if (action === 'delete' && liveIds.length > 0 && !hasLocked) setDeleting(true)
    else if (action === 'scene-settings') { setInspectorTab('scene'); useWorkspaceStore.getState().setRightOpen(true) }
    else if (action === 'reset-layout') viewCommands.resetLayout()
    else if (action === 'initial-view') runtime.current?.setCamera(scene.camera)
  }
  useEffect(() => {
    function onAction(event: Event): void { handleAction.current((event as CustomEvent<SceneAction>).detail) }
    function onHistory(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) return
      if (event.target instanceof HTMLElement && (event.target.closest('[role="dialog"]') || event.target.closest('input,textarea,select,[contenteditable="true"],[role="menu"]'))) return
      if (event.key === 'Escape') { if (preview) togglePreview(); else { drawing.cancel(); stopEditing(); notify('已退出当前工具') }; return }
      if (preview) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); handleAction.current('redo') }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); handleAction.current(event.shiftKey ? 'redo' : 'undo') }
      if (event.key === 'Delete') { event.preventDefault(); handleAction.current('delete') }
    }
    function onResize(): void { useWorkspaceStore.getState().constrainPanelSizes() }
    function onStatus(event: Event): void { const text = (event as CustomEvent<string>).detail; setStatus(text); setError('') }
    window.addEventListener('desktop-webgis:scene3d-action', onAction); window.addEventListener('keydown', onHistory); window.addEventListener('resize', onResize)
    window.addEventListener('desktop-webgis:command-status', onStatus)
    return () => { window.removeEventListener('desktop-webgis:scene3d-action', onAction); window.removeEventListener('keydown', onHistory); window.removeEventListener('resize', onResize); window.removeEventListener('desktop-webgis:command-status', onStatus) }
  }, [preview])

  const DrawingIcon = drawing.kind === 'water' ? Waves : drawing.kind === 'clip' ? Scissors : drawing.kind === 'flatten' ? MoveDown : drawing.kind && isMeasurementKind(drawing.kind) ? Ruler : Shapes
  return <main className="scene3d-workspace" aria-label="三维场景编辑器">
    <SceneRibbon target={group?.name ?? (liveIds.length > 1 ? `${liveIds.length} 个对象` : node?.name ?? '未设置')} commands={commands} preview={preview} onPreview={togglePreview} onUndo={() => history()} onRedo={() => history(true)} onSave={() => { void projectCommands.saveProject() }} canUndo={canUndo} canRedo={canRedo} />
    <div className="scene3d-workspace__body">
      {!preview && <LeftPanel title="场景对象" actions={<><button aria-label="新建场景分组" onClick={() => setCreatingGroup(true)}><FolderPlus size={15} /></button><button aria-label="搜索对象" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setSearch('') }}><Search size={15} /></button></>} footer={<footer className="scene3d-panel-footer">Ctrl 多选 · Shift 范围 · 拖动整理</footer>}>
        {searchOpen && <label className="scene3d-search"><Search size={14} aria-hidden="true" /><input aria-label="搜索场景对象" placeholder="搜索对象名称…" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setSearchOpen(false); setSearch('') } }} /></label>}
        <div className="scene3d-panel__scroll">
          {!scene.nodes.length && <div className="scene3d-empty"><Layers2 size={28} aria-hidden="true" /><strong>还没有场景对象</strong><p>添加三维模型或地理数据，开始搭建场景。</p><button className="button-secondary" onClick={() => setAdding(true)}>添加资源</button><button className="scene3d-text-action" onClick={sample}>使用三维示例</button></div>}
          <SceneTree onContext={openContext} scene={scene} search={search} selectedIds={liveIds} selectedGroup={group?.id ?? null} states={states} onSelect={select} onGroup={selectGroup} onLocate={locate} onVisible={(ids, visible) => organize(() => setSceneNodesVisible(ids, visible), '对象显隐已应用')} onGroupVisible={(id, visible) => organize(() => patchSceneGroup(id, { visible }), '分组显隐已应用')} onMoveGroup={(id, parentId) => organize(() => moveSceneFolder(id, parentId), '文件夹已移动，可撤销')} onMove={(ids, groupId, beforeId) => organize(() => moveSceneSelection(ids, groupId, beforeId), '对象顺序与分组已更新，可撤销')} />
        </div>
      </LeftPanel>}
      <section className={`scene3d-canvas${drawing.drawing || graphicEditing.active ? ' scene3d-canvas--drawing' : ''}`} aria-label="三维视图" onDragOver={event => event.preventDefault()} onDrop={event => {
        event.preventDefault(); if (drawing.drawing || graphicEditing.active || preview) return
        const source = scene.nodes.find(n => n.id === event.dataTransfer.getData('application/x-scene3d-node'))
        if (source?.type !== 'model' || getCesiumSceneNodeState(scene, source).locked || !runtime.current) return
        const rect = runtime.current.viewer.canvas.getBoundingClientRect(), position = pickGround(event.clientX - rect.left, event.clientY - rect.top)
        if (!position) { setError('请将模型拖到地表上。'); return }
        try { stopEditing(); updateScene('拖动放置模型', scene => ({ ...scene, nodes: scene.nodes.map(item => item.id === source.id ? { ...source, position } : item) })); select(source.id); notify('模型位置已更新，可撤销恢复') } catch (reason) { report(reason) }
      }}>
        <div className="scene3d-canvas__viewport" ref={target} />
        {editing && !preview && <div className="scene3d-drawing-bar"><Move size={16} aria-hidden="true" /><span>{editing === 'translate' ? '移动' : editing === 'rotate' ? '旋转' : '等比缩放'}</span><SceneInfo label="变换工具">{`${editing === 'translate' ? '红：东向，绿：北向，蓝：高度；黄色框：水平移动。' : editing === 'rotate' ? '拖动对象局部轴环。' : '拖动白色箭头等比缩放。'}松开应用，Esc 取消本次拖动。`}</SceneInfo><button className="button-secondary" onClick={() => { stopEditing(); notify('已退出模型编辑') }}>结束编辑</button></div>}
        {graphicEditing.state && <div className="scene3d-drawing-bar"><Shapes size={16} aria-hidden="true" /><span>编辑几何 · {graphicEditing.state.geometry.positions.length} 个顶点</span><button className="button-primary" onClick={graphicEditing.finish}><Check size={14} aria-hidden="true" />应用修改</button><button className="button-secondary" onClick={() => { stopEditing(); notify('已取消几何编辑，原几何已恢复') }}>取消编辑</button></div>}
        {drawing.drawing && <div className="scene3d-drawing-bar"><DrawingIcon size={16} aria-hidden="true" /><span>{isContinuousDraw(drawing.kind) ? `连续放置${drawing.kind === 'billboard' ? '图标' : '点'} · 单击创建，Esc 退出` : `${drawing.kind ? drawLabels[drawing.kind] : '绘制'} · ${drawing.count} 个顶点`}</span>{!isContinuousDraw(drawing.kind) && <Button variant="primary" size="small" disabled={drawing.count < drawing.minimum} onClick={drawing.finish}><Check size={14} aria-hidden="true" />完成</Button>}<Button size="small" onClick={() => { drawing.cancel(); notify(isContinuousDraw(drawing.kind) ? '已退出连续放置' : '已取消绘制') }}>{isContinuousDraw(drawing.kind) ? '结束放置' : '取消'}</Button></div>}
        {measurement && !drawing.drawing && <section className="scene3d-measurement-card" aria-label="三维测量结果">
          <div><span>{drawLabels[measurement.result.kind]}</span><output>{measurement.result.label}</output><small>临时结果，尚未写入项目</small></div>
          <footer><Button variant="primary" size="small" onClick={retainMeasurement}>保留测量</Button><Button size="small" onClick={() => clearMeasurement('已清除临时测量')}>清除</Button></footer>
        </section>}
      </section>
      {!preview && <RightPanel showHeader={false}>
        <header className="scene3d-inspector-header"><span>属性</span><Button size="small" aria-pressed={!!pinned} disabled={!pinned && !node} onClick={() => setPinnedTarget(pinned ? null : node ? { id: node.id, epoch: projectEpoch, properties: structuredClone(pickedProperties) } : null)}>{pinned ? '取消固定' : '固定检查器'}</Button><div className="scene3d-inspector-tabs" role="tablist" aria-label="属性范围"><button role="tab" aria-selected={inspectorTab === 'object'} onClick={() => setInspectorTab('object')}>对象</button><button role="tab" aria-selected={inspectorTab === 'scene'} onClick={() => setInspectorTab('scene')}>场景</button></div><button className="scene3d-inspector-close" aria-label="收起检查器" onClick={() => useWorkspaceStore.getState().setRightOpen(false)}><PanelRightClose size={14} aria-hidden="true" /></button></header>
        <div key={JSON.stringify([inspectorTab, inspectorSection, pinned ?? selectedGroup, pinned ?? liveIds, !!graphicEditing.state])} className="scene3d-panel__scroll" role="tabpanel" aria-label={inspectorTab === 'object' ? '对象属性' : '场景设置'}>
          {inspectorTab === 'scene' ? <SceneSettings scene={scene} onSaveCamera={saveCamera} onApply={patch => { stopEditing(); updateScene('设置场景环境', scene => ({ ...scene, ...patch })); notify('场景设置已应用') }} /> : graphicEditing.state ? <GraphicVertexInspector state={graphicEditing.state} onSelect={graphicEditing.selectVertex} onPosition={graphicEditing.setPosition} onInsert={graphicEditing.insertVertex} onRemove={graphicEditing.removeVertex} /> : !pinned && group ? <SceneGroupInspector key={JSON.stringify(group)} scene={scene} group={group} onPatch={patch => organize(() => patchSceneGroup(group.id, patch), '分组设置已应用')} onSelectMembers={() => { const ids = getCesiumSceneDescendantIds(scene, group.id); setSelectedGroup(null); setSelectedIds(ids); anchor.current = ids[0] ?? null }} onDissolve={() => organize(() => { dissolveSceneGroup(group.id); setSelectedGroup(null) }, '分组已解散，对象保留，可撤销恢复')} onMove={parentId => organize(() => moveSceneFolder(group.id, parentId), '父文件夹已更新')} onReorder={direction => organize(() => reorderSceneFolder(group.id, direction), '文件夹顺序已更新')} /> : !pinned && liveIds.length > 1 ? <SceneBatchInspector scene={scene} nodes={selectedNodes} onVisible={visible => organize(() => setSceneNodesVisible(liveIds, visible), '批量显隐已应用')} onLock={locked => organize(() => setSceneNodesLocked(liveIds, locked), '批量锁定已应用')} onMove={id => organize(() => moveSceneSelection(liveIds, id), '对象分组已更新')} onCopy={copyNode} onDelete={() => setDeleting(true)} /> : inspectorNode ? <SceneInspector groups={scene.groups} onMoveGroup={id => organize(() => moveSceneSelection([inspectorNode.id], id), '对象分组已更新')} pickedProperties={pinned ? pinnedTarget?.properties : pickedProperties} section={inspectorSection} node={inspectorNode} onRelocate={('asset' in inspectorNode && inspectorAsset?.reference && inspectorAsset.reference.kind !== 'url') ? () => { drawing.cancel(); stopEditing(); setRelocation({ assetId: inspectorNode.asset, scene: structuredClone(scene), epoch: projectEpoch }) } : undefined} assetUrl={inspectorSource} error={states[inspectorNode.id]?.error} onPatch={patchInspectorNode} onReload={reload} onResource={url => { if (inspectorNode.type === 'water' || inspectorNode.type === 'graphic') return; updateScene('更新三维资源地址', scene => ({ ...scene, assets: { ...scene.assets, ...('asset' in inspectorNode ? { [inspectorNode.asset]: { ...scene.assets[inspectorNode.asset], reference: undefined, url } } : {}) } })); notify('资源地址已更新，正在加载…') }} onDrawBoundary={() => startWater(inspectorNode.id)} onDrawClip={effectId => startClip(effectId, inspectorNode)} onDrawFlatten={effectId => startFlatten(effectId, inspectorNode)} onEditGeometry={() => startGraphicEditing(inspectorNode)} geometryDisabled={inspectorNode.locked || !inspectorNode.visible} onDelete={() => { setSelectedIds([inspectorNode.id]); setSelectedGroup(null); setDeleting(true) }} /> : <div className="scene3d-empty"><MousePointer2 size={24} aria-hidden="true" /><strong>选择一个对象</strong><p>在视图中单击模型，或在左侧对象列表中选择。</p><button className="scene3d-text-action" onClick={() => setInspectorTab('scene')}>编辑场景环境</button></div>}
        </div>
      </RightPanel>}
      {!preview && <BottomPanel sceneStates={states} onSelectResource={id => { select(id); showProperties('source') }} />}
    </div>
    <footer className="status-bar scene3d-footer"><span className={`scene3d-footer__state${error ? ' scene3d-footer__state--error' : ''}`} role="status">{error || (drawing.kind ? drawInstruction(drawing.kind) : status)}</span><span>{group ? group.name : liveIds.length > 1 ? `已选 ${liveIds.length} 个对象` : node?.name ?? '未选择对象'}</span><span>WGS84 · 椭球高度</span></footer>
    {context && <LayerPopupMenu x={context.x} y={context.y} label="对象菜单" onClose={() => setContext(null)}>
      <div className="scene3d-context-title">{group?.name ?? (liveIds.length > 1 ? `${liveIds.length} 个对象` : node?.name)}</div>
      <MenuItem icon={Table2} label="对象属性" onClick={() => { showProperties('object'); setContext(null) }} />
      {definition && <MenuItem icon={Maximize2} label="完整属性" onClick={() => { drawing.cancel(); stopEditing(); setPropertyTarget({ node: structuredClone(definition), epoch: projectEpoch }); setContext(null) }} />}
      {group && <MenuItem icon={Maximize2} label="完整属性" onClick={() => { drawing.cancel(); stopEditing(); setFolderPropertyTarget({ id: group.id, epoch: projectEpoch }); setContext(null) }} />}
      {node && <>
        <MenuItem icon={LocateFixed} label="定位" disabled={states[node.id]?.state !== 'ready'} onClick={() => { locate(node.id); setContext(null) }} />
        {(node.type === 'graphic' || node.type === 'geojson') && <MenuItem icon={Palette} label="样式与标注" onClick={() => { showProperties('style'); setContext(null) }} />}
        <MenuItem icon={MessageSquare} label="属性弹窗" onClick={() => { showProperties('popup'); setContext(null) }} />
        <MenuItem icon={Table2} label="数据属性" onClick={() => { showProperties('properties'); setContext(null) }} />
        {node.type !== 'graphic' && node.type !== 'water' && <><MenuItem icon={Globe} label="数据源" onClick={() => { showProperties('source'); setContext(null) }} /><MenuItem icon={RefreshCw} label="重新加载" onClick={() => { reload(); setContext(null) }} /></>}
      </>}
      {(node || group) && <MenuItem icon={SlidersHorizontal} label="重命名" disabled={!!group?.locked || hasLocked} onClick={() => { setRenameDraft(node?.name ?? group?.name ?? ''); setRenaming(true); setContext(null) }} />}
      {!!liveIds.length && <><MenuItem icon={Copy} label="复制" onClick={() => { copyNode(); setContext(null) }} /><MenuItem icon={LockKeyhole} label={allLocked ? '解锁' : '锁定'} disabled={allLocked && !!inheritedLock} onClick={() => { toggleLock(); setContext(null) }} /><MenuItem icon={Download} label="导出对象" onClick={() => { void exportObjects(); setContext(null) }} /><MenuItem icon={Trash2} label="删除" disabled={hasLocked} onClick={() => { setDeleting(true); setContext(null) }} /></>}
    </LayerPopupMenu>}
    {folderPropertyTarget && folderPropertyTarget.epoch === projectEpoch && <FolderPropertyWindow key={`${folderPropertyTarget.epoch}:${folderPropertyTarget.id}`} scene3d id={folderPropertyTarget.id} onClose={() => setFolderPropertyTarget(null)} />}
    {relocation && <ResourceRelocationDialog scene={relocation.scene} assetId={relocation.assetId} projectPath={getProjectResourceBasePath()} onClose={() => setRelocation(null)} onApply={(changes, target, directory) => {
      if (useProjectStore.getState().projectEpoch !== relocation.epoch) throw new Error('项目已切换，请重新打开重定位窗口')
      const current = useProjectStore.getState().project.city
      if (!current) throw new Error('场景已关闭')
      const next = applyResourceRelocation(current, changes)
      resourceSession.current?.authorizeDirectory(directory ? normalizeLocalResourcePath(target) : localProjectDirectory(target))
      drawing.cancel(); stopEditing()
      updateScene('重新定位本地资源', () => next)
      notify('资源引用已更新，正在重新加载；可撤销恢复')
    }} />}
    {propertyTarget && propertyTarget.epoch === projectEpoch && <ScenePropertyWindow key={`${propertyTarget.epoch}:${propertyTarget.node.id}`} initial={propertyTarget.node} scene={scene} previewReady={syncStatus === 'ready'} onPreview={previewPropertyNode} onClose={() => setPropertyTarget(null)} onApply={(base, draft) => {
      if (useProjectStore.getState().projectEpoch !== propertyTarget.epoch) throw new Error('项目已切换，请重新打开属性窗口。')
      drawing.cancel(); stopEditing()
      updateScene('应用完整对象属性', current => applyScenePropertyDraft(current, base, draft))
      notify('完整属性已应用，可撤销恢复')
    }} />}
    {renaming && <EditorDialog title="重命名" onClose={() => setRenaming(false)}><div className="dialog-body"><label className="editor-field">名称<input autoFocus value={renameDraft} onChange={event => setRenameDraft(event.target.value)} /></label></div><footer className="dialog-footer"><button className="button-secondary" onClick={() => setRenaming(false)}>取消</button><button className="button-primary" disabled={!renameDraft.trim()} onClick={() => { if (group) organize(() => patchSceneGroup(group.id, { name:renameDraft.trim() }), '已重命名分组'); else patchNode({ name:renameDraft.trim() }); setRenaming(false) }}>应用</button></footer></EditorDialog>}
    {adding && <SceneResourceDialog onClose={() => setAdding(false)} onAdd={add} onChooseLocal={isTauri() ? chooseLocalResource : undefined} />}
    {creatingGroup && <SceneCreateGroupDialog count={liveIds.length} locked={hasLocked} onClose={() => setCreatingGroup(false)} onCreate={(name, include) => { drawing.cancel(); stopEditing(); const id = addSceneGroup(name, include ? liveIds : [], selectedGroup ?? undefined); selectGroup(id); notify('分组已创建，可撤销恢复') }} />}
    {deleting && liveIds.length > 0 && !hasLocked && <EditorDialog title="删除对象" onClose={() => setDeleting(false)}><div className="dialog-body"><p>{liveIds.length === 1 ? `删除「${node?.name}」？` : `删除选中的 ${liveIds.length} 个对象？`}删除后可通过一次撤销全部恢复。</p></div><footer className="dialog-footer"><button className="button-secondary" onClick={() => setDeleting(false)}>取消</button><button className="button-danger" onClick={() => organize(() => { deleteSceneNodes(liveIds); setSelectedIds([]); setDeleting(false) }, '所选对象已删除，可撤销恢复')}>删除对象</button></footer></EditorDialog>}
  </main>
}
