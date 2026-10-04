import { useEffect, useRef, useState } from 'react'
import { Box, Check, Copy, Download, Eye, FileInput, FolderPlus, Globe, Layers2, LocateFixed, LockKeyhole, Maximize2, MessageSquare, MousePointer2, Move, Palette, PanelLeftClose, PanelRightClose, Plus, RefreshCw, RotateCw, Search, Shapes, SlidersHorizontal, Sun, Table2, Trash2, Waves } from 'lucide-react'
import { createCityRuntime } from '@desktop-webgis/cesium-scene-runtime'
import type { CitySceneRuntime, EditMode } from '@desktop-webgis/cesium-scene-runtime'
import { createCityScene, getCityNodeState, parseCityScene } from '@desktop-webgis/cesium-scene-schema'
import type { CityNode, GeoPosition } from '@desktop-webgis/cesium-scene-schema'
import { compileProjectToScene, serializeScene } from '@desktop-webgis/scene-core'
import { Cartesian2, Cartographic, Math as CesiumMath } from 'cesium'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { projectCommands } from '@/app/commands/project.commands'
import { exportCityScene } from '@/services/city-scene-export'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { addCityAsset, addCityGroup, copyCityNodes, deleteCityNodes, dissolveCityGroup, loadCitySample, moveCitySelection, patchCityGroup, setCityNodesLocked, setCityNodesVisible, updateCity } from './city-commands'
import { CityResourceDialog } from './CityResourceDialog'
import type { CityResourceType } from './CityResourceDialog'
import { CityInspector, SceneSettings } from './CityInspector'
import type { CityAction } from './city-actions'
import { useCityDrawing } from './useCityDrawing'
import { useCityGraphicEditing } from './useCityGraphicEditing'
import { GraphicVertexInspector } from './GraphicVertexInspector'
import { CitySceneTree } from './CitySceneTree'
import { CityBatchInspector, CityGroupInspector } from './CityOrganizationInspector'
import { CityCreateGroupDialog } from './CityCreateGroupDialog'
import { selectCityIds } from './city-selection'
import type { CitySelectionMode } from './city-selection'
import type { CityDrawKind } from './useCityDrawing'
import { CityRibbon } from './CityRibbon'
import type { CityRibbonGroup } from './CityRibbon'
import type { CityCategory } from './city-layout.store'
import type { CityInspectorSection } from './CityInspector'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './city-editor.css'

interface LayerState { state: 'loading' | 'ready' | 'error'; error?: string }
const drawLabels = { point: '点', polyline: '线', polygon: '面', water: '水面边界' }

/** City editor shell; rendering extensions remain independent of product UI. */
export function CityWorkspace() {
  const target = useRef<HTMLDivElement>(null)
  const runtime = useRef<CitySceneRuntime | undefined>(undefined)
  const pendingFocus = useRef<string | undefined>(undefined)
  const importInput = useRef<HTMLInputElement>(null)
  const defaultScene = useRef(createCityScene())
  const project = useProjectStore(state => state.project)
  const city = project.city ?? defaultScene.current
  const left = useWorkspaceStore(state => state.left)
  const right = useWorkspaceStore(state => state.right)
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
  const [ready, setReady] = useState(false)
  const [adding, setAdding] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'object' | 'scene'>('object')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [preview, setPreview] = useState(false)
  const [inspectorSection, setInspectorSection] = useState<CityInspectorSection>('object')
  const leftVisible = left.open && !preview, rightVisible = right.open && !preview
  const cameraKey = useRef('')
  const selectedNodes = city.nodes.filter(candidate => selectedIds.includes(candidate.id))
  const liveIds = selectedNodes.map(node => node.id)
  const definition = selectedNodes.length === 1 ? selectedNodes[0] : undefined
  const node = definition ? { ...definition, ...getCityNodeState(city, definition) } : undefined
  const group = city.groups?.find(group => group.id === selectedGroup)
  const hasLocked = selectedNodes.some(node => getCityNodeState(city, node).locked)
  const inheritedLock = selectedNodes.some(node => city.groups?.find(group => group.id === node.groupId)?.locked)
  const allLocked = !!selectedNodes.length && selectedNodes.every(node => getCityNodeState(city, node).locked)
  const highlightKey = JSON.stringify(group ? city.nodes.filter(node => node.groupId === group.id).map(node => node.id) : liveIds)
  const canEdit = ready && node?.visible && !node.locked && states[node.id]?.state === 'ready' && (node.type === 'model' || node.type === '3dtiles')
  const canUndo = useProjectStore.getState().canUndoEdit()
  const canRedo = useProjectStore.getState().canRedoEdit()

  function report(reason: unknown): void { setError(reason instanceof Error ? reason.message : '操作失败，请检查输入或资源地址。') }
  function notify(text: string): void { setError(''); setStatus(text) }
  const graphicEditing = useCityGraphicEditing(runtime.current, result => {
    if (result.changed) updateCity('编辑图形几何', scene => ({ ...scene, nodes: scene.nodes.map(item => item.id === result.id && item.type === 'graphic' ? { ...item, geometry: result.after } : item) }))
    notify(result.changed ? '几何修改已应用，可一次撤销恢复' : '几何未发生变化')
  }, report, () => notify('已取消几何编辑，原几何已恢复'))

  useEffect(() => {
    if (!target.current) return
    let active = true
    try {
      runtime.current = createCityRuntime({ target: target.current, scene: city, cesiumBaseUrl: new URL('cesium/', document.baseURI).href,
        onSelect: (id, properties, mode) => { if (active) handlePick.current(id, properties, mode) },
        onEdit: event => { updateCity('变换三维模型', current => ({ ...current, nodes: current.nodes.map(n => n.id === event.id && (n.type === '3dtiles' || n.type === 'model') ? { ...n, transform: event.after } : n) })); notify('模型变换已应用，可撤销恢复') },
        onLayerState: (id, state, reason) => {
          if (!active) return
          const next: LayerState = state === 'error' ? { state: 'error', error: '资源加载失败。请检查资源地址、服务响应和跨域设置，然后重试。' } : { state: state === 'ready' ? 'ready' : 'loading' }
          setStates(current => ({ ...current, [id]: next }))
          if (state === 'error') { setError('资源加载失败；选择对象可更新地址或重试。'); console.warn('City resource failed', reason) }
          if (state === 'ready' && pendingFocus.current === id) { pendingFocus.current = undefined; void runtime.current?.flyTo(id).catch(report); notify('资源已加载') }
        }
      })
      runtime.current.layers.popupsEnabled = false
      setReady(true); notify('就绪')
    } catch (reason) { report(reason) }
    return () => { active = false; runtime.current?.destroy(); runtime.current = undefined }
  }, [])

  useEffect(() => {
    if (!runtime.current) return
    const key = JSON.stringify([project.id, city.camera])
    if (key !== cameraKey.current) { runtime.current.stopEditing(); setEditing(null); runtime.current.setCamera(city.camera); cameraKey.current = key }
    void runtime.current.updateScene(city).catch(() => { setError('部分资源未能加载，其他对象仍可使用。请选择失败对象检查数据源。') })
  }, [city, project.id, ready])
  useEffect(() => { runtime.current?.setSelected(preview ? [] : JSON.parse(highlightKey) as string[]) }, [highlightKey, preview, ready])
  useEffect(() => { setSelectedIds([]); setSelectedGroup(null); anchor.current = null }, [project.id])

  const drawing = useCityDrawing(runtime.current, (graphic, kind, id) => {
    try {
      if (kind !== 'water') {
        graphic.name = `${drawLabels[kind]} ${city.nodes.filter(item => item.type === 'graphic').length + 1}`
        graphic.properties.name = graphic.name
        graphic.popup = { fields: [{ field: 'name', label: '名称' }] }
        updateCity('绘制图形', scene => { scene.nodes.push(graphic); return scene })
        select(graphic.id); notify('图形已创建，可配置样式和属性弹窗'); return
      }
      const boundary = graphic.geometry.positions
      const nextId = id ?? `water-${crypto.randomUUID()}`
      updateCity(id ? '重新绘制水面边界' : '绘制水面', scene => {
        if (id) scene.nodes = scene.nodes.map(item => item.id === id && item.type === 'water' ? { ...item, boundary } : item)
        else scene.nodes.push({ id: nextId, name: `水面 ${scene.nodes.filter(item => item.type === 'water').length + 1}`, type: 'water', visible: true, boundary, height: Number((boundary[0][2] + 2).toFixed(2)), color: '#238bafcc', amplitude: 4, frequency: 1000, speed: .02 })
        return scene
      })
      select(nextId); notify(id ? '水面边界已更新' : '水面已创建，可在属性面板调整材质')
    } catch (reason) { report(reason) }
  }, report, () => notify('已取消绘制'))

  function stopEditing(): void { graphicEditing.cancel(); runtime.current?.stopEditing(); setEditing(null) }
  function select(id: string, mode?: CitySelectionMode, order = city.nodes.map(node => node.id)): void {
    drawing.cancel(); stopEditing(); setSelectedGroup(null)
    setSelectedIds(selectCityIds(liveIds, id, mode, order, anchor.current))
    if (mode !== 'range') anchor.current = id
    setPickedProperties({}); setInspectorTab('object'); useWorkspaceStore.getState().setRightOpen(true)
  }
  function selectGroup(id: string): void { drawing.cancel(); stopEditing(); setSelectedIds([]); setSelectedGroup(id); setInspectorTab('object'); setPickedProperties({}); useWorkspaceStore.getState().setRightOpen(true) }
  handlePick.current = (id, properties, mode) => { if (id) { select(id, mode === 'range' ? 'add' : mode); setPickedProperties(properties ?? {}) } }
  function organize(action: () => void, message: string): void {
    drawing.cancel(); stopEditing()
    try { action(); notify(message) } catch (reason) { report(reason) }
  }
  function startEditing(mode: EditMode): void {
    if (!node || !canEdit || !runtime.current) return
    drawing.cancel(); graphicEditing.cancel()
    try { runtime.current.startEditing(node.id, mode); setEditing(mode); notify('拖动彩色手柄调整模型；松手应用，Esc 取消当前拖动') } catch (reason) { report(reason) }
  }
  function startWater(id?: string): void { startDraw('water', id) }
  function startGraphicEditing(): void {
    if (!node || node.type !== 'graphic' || node.locked || !node.visible || states[node.id]?.state !== 'ready') return
    drawing.cancel(); stopEditing(); setInspectorTab('object'); useWorkspaceStore.getState().setRightOpen(true)
    graphicEditing.start(node.id); notify('编辑顶点：拖动调整 · 白色中点插入 · Enter 应用 · Esc 取消')
  }
  function startDraw(kind: CityDrawKind, id?: string): void {
    if (!ready) return
    stopEditing(); drawing.start(kind, id)
    notify(`绘制${drawLabels[kind]}：单击添加顶点，右键或 Enter 完成，Esc 取消`)
  }
  function history(redo = false): void {
    drawing.cancel(); stopEditing()
    const store = useProjectStore.getState()
    if (redo ? store.redoEdit() : store.undoEdit()) notify(redo ? '已重做' : '已撤销')
  }
  function patchNode(patch: Partial<CityNode>, label = '修改三维对象'): void {
    if (!node || node.locked) return
    drawing.cancel(); stopEditing()
    updateCity(label, scene => ({ ...scene, nodes: scene.nodes.map(n => n.id === node.id ? { ...n, ...patch } as CityNode : n) }))
    notify('对象属性已应用')
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
  function add(type: CityResourceType, url: string, name: string): void {
    const canvas = runtime.current?.viewer.canvas
    const position = canvas ? pickGround(canvas.clientWidth / 2, canvas.clientHeight / 2) : undefined
    const id = addCityAsset(type, url, name, position)
    pendingFocus.current = id; select(id); notify('正在加载资源…')
  }
  function reload(): void {
    if (!node || !runtime.current) return
    drawing.cancel(); stopEditing(); runtime.current.layers.removeLayer(node.id)
    setStates(current => ({ ...current, [node.id]: { state: 'loading' } }))
    notify('正在重新加载资源…'); void runtime.current.updateScene(city).catch(() => setError('资源仍未能加载，请更新数据源地址后重试。'))
  }
  function sample(): void {
    try { const id = loadCitySample(); pendingFocus.current = id; select(id); notify('正在加载城市示例…') } catch (reason) { report(reason) }
  }
  async function exportScene(): Promise<void> {
    try {
      const scene = compileProjectToScene(useProjectStore.getState().getSnapshot()).scene
      if (scene.city && runtime.current) scene.city.camera = runtime.current.getCamera()
      const result = await exportCityScene(serializeScene(scene), project.name)
      notify(result.kind === 'saved' ? `场景已导出：${result.path}` : result.kind === 'cancelled' ? '已取消场景导出' : '场景导出已发起；资源地址保留在文件中')
    } catch (reason) { report(reason) }
  }
  async function importScene(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      const value: unknown = JSON.parse(await file.text())
      const scene = parseCityScene(value && typeof value === 'object' && 'city' in value ? value.city : value)
      drawing.cancel(); stopEditing(); updateCity('导入三维场景', () => scene); select(scene.nodes[0]?.id ?? ''); notify('场景已导入，可撤销恢复原场景')
    } catch (reason) { report(reason) }
  }
  function saveCamera(): void {
    const camera = runtime.current?.getCamera()
    if (camera) { updateCity('设置三维初始视角', scene => ({ ...scene, camera })); notify('初始视角已更新') }
  }
  function showProperties(section: CityInspectorSection): void { drawing.cancel(); stopEditing(); setInspectorSection(section); setInspectorTab('object'); useWorkspaceStore.getState().setRightOpen(true) }
  function showScene(): void { drawing.cancel(); stopEditing(); setInspectorTab('scene'); useWorkspaceStore.getState().setRightOpen(true) }
  function togglePreview(): void { drawing.cancel(); stopEditing(); runtime.current?.setPreview(!preview); setPreview(!preview); notify(preview ? '已返回编辑模式' : '预览模式：单击对象查看属性弹窗') }
  function copyNode(): void {
    organize(() => { const ids = copyCityNodes(liveIds); setSelectedIds(ids); setSelectedGroup(null); setPickedProperties({}); setInspectorTab('object'); useWorkspaceStore.getState().setRightOpen(true) }, '所选对象已复制，可撤销恢复')
  }
  function toggleLock(): void {
    organize(() => setCityNodesLocked(liveIds, !allLocked), allLocked ? '对象已解锁' : '对象已锁定')
  }
  const selectionReason = liveIds.length > 1 ? '此操作需要单独选择一个对象' : !node ? '请先选择一个对象' : node.locked ? '对象或所属分组已锁定，请先解锁' : !node.visible ? '对象或所属分组已隐藏，请先显示' : states[node.id]?.state !== 'ready' ? '对象尚未加载成功' : undefined
  const transformReason = selectionReason ?? (node?.type !== 'model' && node?.type !== '3dtiles' ? '此对象不支持模型变换' : undefined)
  const styleReason = selectionReason ?? (node?.type !== 'graphic' && node?.type !== 'geojson' ? '请选择标绘图形或 GeoJSON 图层' : undefined)
  const command = (id: string, label: string, icon: typeof Box, execute: () => void, disabled?: string, active?: boolean) => ({ id, label, icon, execute, disabled, active })
  const groups: Record<CityCategory, CityRibbonGroup[]> = {
    data: [
      { label: '加载', commands: [command('add','添加数据',Plus,() => setAdding(true)),command('import','导入场景',FileInput,() => importInput.current?.click())] },
      { label: '创建', commands: [command('point','绘制点',MousePointer2,() => startDraw('point'),ready ? undefined : '场景尚未就绪',drawing.kind === 'point'),command('line','绘制线',Move,() => startDraw('polyline'),ready ? undefined : '场景尚未就绪',drawing.kind === 'polyline'),command('polygon','绘制面',Shapes,() => startDraw('polygon'),ready ? undefined : '场景尚未就绪',drawing.kind === 'polygon')] },
      { label: '显示与交互', commands: [command('style','样式与标注',Palette,() => showProperties('style'),styleReason),command('popup','属性弹窗',MessageSquare,() => showProperties('popup'),selectionReason)] },
      { label: '管理', commands: [command('properties','属性',Table2,() => showProperties('properties'),!liveIds.length && !group ? '请选择对象或分组' : undefined),command('reload','刷新',RefreshCw,reload,!node ? '请先选择一个对象' : undefined),command('source','数据源',Globe,() => showProperties('source'),!node || node.type === 'water' || node.type === 'graphic' ? '此对象没有外部数据源' : undefined)] }
    ],
    scene: [{ label: '环境与地表', commands: [command('lighting','光照与时间',Sun,showScene),command('surface','底图与地形',Globe,showScene)] },{ label: '视角', commands: [command('camera','保存初始视角',Eye,saveCamera,ready ? undefined : '场景尚未就绪')] }],
    edit: [{ label: '选择', commands: [command('select','选择',MousePointer2,() => { drawing.cancel(); stopEditing(); notify('选择对象') },undefined,!editing && !drawing.drawing && !graphicEditing.active)] },{ label: '图形几何', commands: [command('vertices','编辑顶点',Shapes,startGraphicEditing,selectionReason ?? (node?.type !== 'graphic' ? '请选择标绘图形' : undefined),graphicEditing.active)] },{ label: '模型变换', commands: [command('move','移动',Move,() => startEditing('translate'),transformReason,editing === 'translate'),command('rotate','旋转',RotateCw,() => startEditing('rotate'),transformReason,editing === 'rotate'),command('scale','缩放',Maximize2,() => startEditing('scale'),transformReason,editing === 'scale'),command('precise','精确定位',LocateFixed,() => showProperties('object'),transformReason)] },{ label: '整理', commands: [command('new-group','新建分组',FolderPlus,() => setCreatingGroup(true)),command('copy','复制',Copy,copyNode,!liveIds.length ? '请选择对象' : undefined),command('lock',allLocked ? '解锁' : '锁定',LockKeyhole,toggleLock,!liveIds.length ? '请选择对象' : allLocked && inheritedLock ? '请先解锁所属分组' : undefined,allLocked),command('delete','删除',Trash2,() => setDeleting(true),!liveIds.length ? '请选择对象' : hasLocked ? '选中对象或分组已锁定，请先解锁' : undefined)] }],
    effects: [{ label: '全局效果', commands: [command('environment','雾与辉光',SlidersHorizontal,showScene)] },{ label: '局部效果', commands: [command('water','水面',Waves,() => startWater(),ready ? undefined : '场景尚未就绪',drawing.kind === 'water')] }],
    view: [{ label: '导航', commands: [command('fit','定位对象',LocateFixed,() => { if (node) void runtime.current?.flyTo(node.id).catch(report) },!node || states[node.id]?.state !== 'ready' ? '请选择已加载的对象' : undefined),command('initial','初始视角',Eye,() => runtime.current?.setCamera(city.camera))] },{ label: '工作区', commands: [command('left','场景树',Layers2,() => useWorkspaceStore.getState().setLeftOpen(!left.open),undefined,left.open),command('right','属性面板',PanelRightClose,() => useWorkspaceStore.getState().setRightOpen(!right.open),undefined,right.open),command('reset','恢复布局',PanelLeftClose,() => useWorkspaceStore.getState().resetLayout())] },{ label: '交付', commands: [command('export','导出场景',Download,() => { void exportScene() })] }]
  }
  const handleAction = useRef<(action: CityAction) => void>(() => {})
  handleAction.current = action => {
    if (preview && action !== 'export-scene') return
    if (action === 'add-resource') setAdding(true)
    else if (action === 'import-scene') importInput.current?.click()
    else if (action === 'export-scene') void exportScene()
    else if (action === 'sample') sample()
    else if (action === 'draw-water') startWater()
    else if (action === 'undo') history()
    else if (action === 'redo') history(true)
    else if (action === 'delete' && liveIds.length > 0 && !hasLocked) setDeleting(true)
    else if (action === 'scene-settings') { setInspectorTab('scene'); useWorkspaceStore.getState().setRightOpen(true) }
    else if (action === 'reset-layout') useWorkspaceStore.getState().resetLayout()
    else if (action === 'initial-view') runtime.current?.setCamera(city.camera)
  }
  useEffect(() => {
    function onAction(event: Event): void { handleAction.current((event as CustomEvent<CityAction>).detail) }
    function onHistory(event: KeyboardEvent): void {
      if (event.defaultPrevented) return
      if (event.target instanceof HTMLElement && (event.target.closest('[role="dialog"]') || event.target.closest('input,textarea,select,[contenteditable="true"]'))) return
      if (event.key === 'Escape') { if (preview) togglePreview(); else { drawing.cancel(); stopEditing(); notify('已退出当前工具') }; return }
      if (preview) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); handleAction.current(event.shiftKey ? 'redo' : 'undo') }
      if (event.key === 'Delete') { event.preventDefault(); handleAction.current('delete') }
    }
    function onResize(): void { useWorkspaceStore.getState().constrainPanelSizes() }
    function onStatus(event: Event): void { const text = (event as CustomEvent<string>).detail; setStatus(text); setError('') }
    window.addEventListener('desktop-webgis:city-action', onAction); window.addEventListener('keydown', onHistory); window.addEventListener('resize', onResize)
    window.addEventListener('desktop-webgis:command-status', onStatus)
    return () => { window.removeEventListener('desktop-webgis:city-action', onAction); window.removeEventListener('keydown', onHistory); window.removeEventListener('resize', onResize); window.removeEventListener('desktop-webgis:command-status', onStatus) }
  }, [preview])

  const DrawingIcon = drawing.kind === 'water' ? Waves : Shapes
  return <main className="city-workspace" aria-label="三维场景编辑器">
    <CityRibbon groups={groups} preview={preview} onPreview={togglePreview} onUndo={() => history()} onRedo={() => history(true)} onSave={() => { void projectCommands.saveProject() }} canUndo={canUndo} canRedo={canRedo} />
      <input ref={importInput} className="city-file-input" type="file" accept=".json" aria-label="导入三维场景文件" onChange={event => { void importScene(event.target.files?.[0]); event.target.value = '' }} />
    <div className="city-workspace__body">
      {leftVisible && <aside className="city-panel city-panel--layers" style={{ width: left.width }} aria-label="场景对象">
        <header className="panel-titlebar"><h2>场景对象 <span className="city-object-count">{city.nodes.length}</span></h2><div className="panel-actions"><button aria-label="新建场景分组" onClick={() => setCreatingGroup(true)}><FolderPlus size={15} aria-hidden="true" /></button><button aria-label="搜索对象" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setSearch('') }}><Search size={15} aria-hidden="true" /></button><button aria-label="收起对象面板" onClick={() => useWorkspaceStore.getState().setLeftOpen(false)}><PanelLeftClose size={15} aria-hidden="true" /></button></div></header>
        {searchOpen && <label className="city-search"><Search size={14} aria-hidden="true" /><input aria-label="搜索场景对象" placeholder="搜索对象名称…" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setSearchOpen(false); setSearch('') } }} /></label>}
        <div className="city-panel__scroll">
          {!city.nodes.length && <div className="city-empty"><Layers2 size={28} aria-hidden="true" /><strong>还没有场景对象</strong><p>添加城市模型或地理数据，开始搭建场景。</p><button className="button-secondary" onClick={() => setAdding(true)}>添加资源</button><button className="city-text-action" onClick={sample}>使用城市示例</button></div>}
          <CitySceneTree city={city} search={search} selectedIds={liveIds} selectedGroup={group?.id ?? null} states={states} onSelect={select} onGroup={selectGroup} onLocate={id => { void runtime.current?.flyTo(id).catch(report) }} onVisible={(ids, visible) => organize(() => setCityNodesVisible(ids, visible), '对象显隐已应用')} onGroupVisible={(id, visible) => organize(() => patchCityGroup(id, { visible }), '分组显隐已应用')} onMove={(ids, groupId, beforeId) => organize(() => moveCitySelection(ids, groupId, beforeId), '对象顺序与分组已更新，可撤销')} />
        </div>
        <footer className="city-panel-footer">Ctrl 多选 · Shift 范围 · 拖动整理</footer><ResizeHandle orientation="horizontal" label="调整对象面板宽度" onResize={delta => useWorkspaceStore.getState().setLeftWidth(useWorkspaceStore.getState().left.width + delta)} />
      </aside>}
      <section className={`city-canvas${drawing.drawing || graphicEditing.active ? ' city-canvas--drawing' : ''}`} aria-label="三维视图" onDragOver={event => event.preventDefault()} onDrop={event => {
        event.preventDefault(); if (drawing.drawing || graphicEditing.active || preview) return
        const source = city.nodes.find(n => n.id === event.dataTransfer.getData('application/x-city-node'))
        if (source?.type !== 'model' || getCityNodeState(city, source).locked || !runtime.current) return
        const rect = runtime.current.viewer.canvas.getBoundingClientRect(), position = pickGround(event.clientX - rect.left, event.clientY - rect.top)
        if (!position) { setError('请将模型拖到地表上。'); return }
        try { stopEditing(); updateCity('拖动放置模型', scene => ({ ...scene, nodes: scene.nodes.map(item => item.id === source.id ? { ...source, position } : item) })); select(source.id); notify('模型位置已更新，可撤销恢复') } catch (reason) { report(reason) }
      }}>
        <div className="city-canvas__viewport" ref={target} />
        {graphicEditing.state && <div className="city-drawing-bar"><Shapes size={16} aria-hidden="true" /><span>编辑几何 · {graphicEditing.state.geometry.positions.length} 个顶点</span><button className="button-primary" onClick={graphicEditing.finish}><Check size={14} aria-hidden="true" />应用修改</button><button className="button-secondary" onClick={() => { stopEditing(); notify('已取消几何编辑，原几何已恢复') }}>取消编辑</button></div>}
        {!leftVisible && !preview && <button className="city-panel-restore city-panel-restore--left" aria-label="展开对象面板" onClick={() => useWorkspaceStore.getState().setLeftOpen(true)}><Layers2 size={16} aria-hidden="true" /></button>}
        {!rightVisible && !preview && <button className="city-panel-restore city-panel-restore--right" aria-label="展开属性面板" onClick={() => useWorkspaceStore.getState().setRightOpen(true)}><PanelRightClose size={16} aria-hidden="true" /></button>}
        {drawing.drawing && <div className="city-drawing-bar"><DrawingIcon size={16} aria-hidden="true" /><span>{drawing.kind ? drawLabels[drawing.kind] : "绘制"} · {drawing.count} 个顶点</span><button className="button-primary" disabled={drawing.count < drawing.minimum} onClick={drawing.finish}><Check size={14} aria-hidden="true" />完成</button><button className="button-secondary" onClick={() => { drawing.cancel(); notify('已取消绘制') }}>取消</button></div>}
      </section>
      {rightVisible && <aside className="city-panel city-panel--inspector" style={{ width: right.width }} aria-label="三维属性">
        <header className="panel-titlebar"><h2>属性</h2><button aria-label="收起属性面板" onClick={() => useWorkspaceStore.getState().setRightOpen(false)}><PanelRightClose size={15} aria-hidden="true" /></button></header>
        <div className="city-inspector-tabs" role="tablist" aria-label="属性范围"><button role="tab" aria-selected={inspectorTab === 'object'} onClick={() => setInspectorTab('object')}>对象</button><button role="tab" aria-selected={inspectorTab === 'scene'} onClick={() => setInspectorTab('scene')}>场景</button></div>
        <div key={JSON.stringify([inspectorTab, inspectorSection, selectedGroup, liveIds, !!graphicEditing.state])} className="city-panel__scroll" role="tabpanel" aria-label={inspectorTab === 'object' ? '对象属性' : '场景设置'}>
          {inspectorTab === 'scene' ? <SceneSettings key={JSON.stringify([city.effects,city.basemap,city.terrain,city.lighting])} city={city} onSaveCamera={saveCamera} onApply={patch => { stopEditing(); updateCity('设置场景环境', scene => ({ ...scene, ...patch })); notify('场景设置已应用') }} /> : graphicEditing.state ? <GraphicVertexInspector state={graphicEditing.state} onSelect={graphicEditing.selectVertex} onPosition={graphicEditing.setPosition} onInsert={graphicEditing.insertVertex} onRemove={graphicEditing.removeVertex} /> : group ? <CityGroupInspector key={JSON.stringify(group)} city={city} group={group} onPatch={patch => organize(() => patchCityGroup(group.id, patch), '分组设置已应用')} onSelectMembers={() => { const ids = city.nodes.filter(node => node.groupId === group.id).map(node => node.id); setSelectedGroup(null); setSelectedIds(ids); anchor.current = ids[0] ?? null }} onDissolve={() => organize(() => { dissolveCityGroup(group.id); setSelectedGroup(null) }, '分组已解散，对象保留，可撤销恢复')} onReorder={direction => organize(() => updateCity('调整分组顺序', scene => { const index = scene.groups?.findIndex(item => item.id === group.id) ?? -1; if (!scene.groups || index < 0 || index + direction < 0 || index + direction >= scene.groups.length) return scene; const [moved] = scene.groups.splice(index, 1); scene.groups.splice(index + direction, 0, moved); return scene }), '分组顺序已更新')} /> : liveIds.length > 1 ? <CityBatchInspector city={city} nodes={selectedNodes} onVisible={visible => organize(() => setCityNodesVisible(liveIds, visible), '批量显隐已应用')} onLock={locked => organize(() => setCityNodesLocked(liveIds, locked), '批量锁定已应用')} onMove={id => organize(() => moveCitySelection(liveIds, id), '对象分组已更新')} onCopy={copyNode} onDelete={() => setDeleting(true)} /> : node ? <CityInspector groups={city.groups} onMoveGroup={id => organize(() => moveCitySelection(liveIds, id), '对象分组已更新')} pickedProperties={pickedProperties} section={inspectorSection} node={node} assetUrl={node.type !== 'water' && node.type !== 'graphic' ? city.assets[node.asset]?.url : undefined} error={states[node.id]?.error} onPatch={patchNode} onReload={reload} onResource={url => { if (node.type === 'water' || node.type === 'graphic') return; updateCity('更新三维资源地址', scene => ({ ...scene, assets: { ...scene.assets, [node.asset]: { ...scene.assets[node.asset], url } } })); notify('资源地址已更新，正在加载…') }} onDrawBoundary={() => startWater(node.id)} onEditGeometry={startGraphicEditing} geometryDisabled={!!selectionReason} onDelete={() => setDeleting(true)} /> : <div className="city-empty"><MousePointer2 size={24} aria-hidden="true" /><strong>选择一个对象</strong><p>在视图中单击模型，或在左侧对象列表中选择。</p><button className="city-text-action" onClick={() => setInspectorTab('scene')}>编辑场景环境</button></div>}
        </div>
        <ResizeHandle orientation="horizontal" label="调整三维属性面板宽度" onResize={delta => useWorkspaceStore.getState().setRightWidth(useWorkspaceStore.getState().right.width - delta)} />
      </aside>}
    </div>
    <footer className="city-footer"><span className={`city-footer__state${error ? ' city-footer__state--error' : ''}`} role="status">{error || (drawing.drawing ? `绘制${drawing.kind ? drawLabels[drawing.kind] : '图形'}：单击添加顶点 · Enter 完成 · Esc 取消` : status)}</span><span>{group ? group.name : liveIds.length > 1 ? `已选 ${liveIds.length} 个对象` : node?.name ?? '未选择对象'}</span><span>WGS84 · 椭球高度</span></footer>
    {adding && <CityResourceDialog onClose={() => setAdding(false)} onAdd={add} />}
    {creatingGroup && <CityCreateGroupDialog count={liveIds.length} locked={hasLocked} onClose={() => setCreatingGroup(false)} onCreate={(name, include) => { drawing.cancel(); stopEditing(); const id = addCityGroup(name, include ? liveIds : []); selectGroup(id); notify('分组已创建，可撤销恢复') }} />}
    {deleting && liveIds.length > 0 && !hasLocked && <EditorDialog title="删除对象" onClose={() => setDeleting(false)}><div className="dialog-body"><p>{liveIds.length === 1 ? `删除「${node?.name}」？` : `删除选中的 ${liveIds.length} 个对象？`}删除后可通过一次撤销全部恢复。</p></div><footer className="dialog-footer"><button className="button-secondary" onClick={() => setDeleting(false)}>取消</button><button className="button-danger" onClick={() => organize(() => { deleteCityNodes(liveIds); setSelectedIds([]); setDeleting(false) }, '所选对象已删除，可撤销恢复')}>删除对象</button></footer></EditorDialog>}
  </main>
}
