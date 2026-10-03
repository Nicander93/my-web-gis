import { useEffect, useRef, useState } from 'react'
import { Box, Building2, Check, Download, Eye, Layers2, LocateFixed, Maximize2, MousePointer2, Move, PanelLeftClose, PanelRightClose, Plus, Redo2, RotateCw, Save, Search, Undo2, Waves } from 'lucide-react'
import { createCityRuntime } from '@desktop-webgis/cesium-scene-runtime'
import type { CitySceneRuntime, EditMode } from '@desktop-webgis/cesium-scene-runtime'
import { createCityScene, parseCityScene } from '@desktop-webgis/cesium-scene-schema'
import type { CityNode, GeoPosition } from '@desktop-webgis/cesium-scene-schema'
import { compileProjectToScene, serializeScene } from '@desktop-webgis/scene-core'
import { Cartesian2, Cartographic, Math as CesiumMath } from 'cesium'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { ToolbarButton } from '@/app/header/ToolbarButton'
import { projectCommands } from '@/app/commands/project.commands'
import { exportCityScene } from '@/services/city-scene-export'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { addCityAsset, loadCitySample, updateCity } from './city-commands'
import { CityResourceDialog } from './CityResourceDialog'
import type { CityResourceType } from './CityResourceDialog'
import { CityInspector, SceneSettings } from './CityInspector'
import type { CityAction } from './city-actions'
import { useWaterDrawing } from './useWaterDrawing'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './city-editor.css'

interface LayerState { state: 'loading' | 'ready' | 'error'; error?: string }
const typeLabels = { '3dtiles': '3D Tiles', model: '模型', geojson: '矢量数据', water: '水面' }
const icons = { '3dtiles': Building2, model: Box, geojson: Layers2, water: Waves }

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
  const [selected, setSelected] = useState<string | null>(null)
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
  const cameraKey = useRef('')
  const node = city.nodes.find(candidate => candidate.id === selected)
  const canEdit = ready && node?.visible && states[node.id]?.state === 'ready' && (node.type === 'model' || node.type === '3dtiles')
  const canUndo = useProjectStore.getState().canUndoEdit()
  const canRedo = useProjectStore.getState().canRedoEdit()

  function report(reason: unknown): void { setError(reason instanceof Error ? reason.message : '操作失败，请检查输入或资源地址。') }
  function notify(text: string): void { setError(''); setStatus(text) }

  useEffect(() => {
    if (!target.current) return
    let active = true
    try {
      runtime.current = createCityRuntime({ target: target.current, scene: city, cesiumBaseUrl: new URL('cesium/', document.baseURI).href,
        onSelect: id => { if (active) { runtime.current?.stopEditing(); setEditing(null); setSelected(id); setInspectorTab('object') } },
        onEdit: event => { updateCity('变换三维模型', current => ({ ...current, nodes: current.nodes.map(n => n.id === event.id && (n.type === '3dtiles' || n.type === 'model') ? { ...n, transform: event.after } : n) })); notify('模型变换已应用，可撤销恢复') },
        onLayerState: (id, state, reason) => {
          if (!active) return
          const next: LayerState = state === 'error' ? { state: 'error', error: '资源加载失败。请检查资源地址、服务响应和跨域设置，然后重试。' } : { state: state === 'ready' ? 'ready' : 'loading' }
          setStates(current => ({ ...current, [id]: next }))
          if (state === 'error') { setError('资源加载失败；选择对象可更新地址或重试。'); console.warn('City resource failed', reason) }
          if (state === 'ready' && pendingFocus.current === id) { pendingFocus.current = undefined; void runtime.current?.flyTo(id).catch(report); notify('资源已加载') }
        }
      })
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

  const water = useWaterDrawing(runtime.current?.viewer, (boundary, id) => {
    try {
      const nextId = id ?? `water-${crypto.randomUUID()}`
      updateCity(id ? '重新绘制水面边界' : '绘制水面', scene => {
        if (id) scene.nodes = scene.nodes.map(item => item.id === id && item.type === 'water' ? { ...item, boundary } : item)
        else scene.nodes.push({ id: nextId, name: `水面 ${scene.nodes.filter(item => item.type === 'water').length + 1}`, type: 'water', visible: true, boundary, height: Number((boundary[0][2] + 2).toFixed(2)), color: '#238bafcc', amplitude: 4, frequency: 1000, speed: .02 })
        return scene
      })
      select(nextId); notify(id ? '水面边界已更新' : '水面已创建，可在属性面板调整材质')
    } catch (reason) { report(reason) }
  }, () => { if (runtime.current) runtime.current.layers.pickingEnabled = true })

  function stopEditing(): void { runtime.current?.stopEditing(); setEditing(null) }
  function select(id: string): void { water.cancel(); stopEditing(); setSelected(id); setInspectorTab('object'); useWorkspaceStore.getState().setRightOpen(true) }
  function startEditing(mode: EditMode): void {
    if (!node || !canEdit || !runtime.current) return
    water.cancel()
    try { runtime.current.startEditing(node.id, mode); setEditing(mode); notify('拖动彩色手柄调整模型；松手应用，Esc 取消当前拖动') } catch (reason) { report(reason) }
  }
  function startWater(id?: string): void {
    if (!ready) return
    stopEditing(); water.start(id)
    if (runtime.current) runtime.current.layers.pickingEnabled = false
    notify('单击添加水面边界顶点，右键或 Enter 完成，Esc 取消')
  }
  function history(redo = false): void {
    water.cancel(); stopEditing()
    const store = useProjectStore.getState()
    if (redo ? store.redoEdit() : store.undoEdit()) notify(redo ? '已重做' : '已撤销')
  }
  function patchNode(patch: Partial<CityNode>, label = '修改三维对象'): void {
    if (!node) return
    stopEditing()
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
    stopEditing(); runtime.current.layers.removeLayer(node.id)
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
      water.cancel(); stopEditing(); updateCity('导入三维场景', () => scene); select(scene.nodes[0]?.id ?? ''); notify('场景已导入，可撤销恢复原场景')
    } catch (reason) { report(reason) }
  }
  function saveCamera(): void {
    const camera = runtime.current?.getCamera()
    if (camera) { updateCity('设置三维初始视角', scene => ({ ...scene, camera })); notify('初始视角已更新') }
  }
  const handleAction = useRef<(action: CityAction) => void>(() => {})
  handleAction.current = action => {
    if (action === 'add-resource') setAdding(true)
    else if (action === 'import-scene') importInput.current?.click()
    else if (action === 'export-scene') void exportScene()
    else if (action === 'sample') sample()
    else if (action === 'draw-water') startWater()
    else if (action === 'undo') history()
    else if (action === 'redo') history(true)
    else if (action === 'delete' && node) setDeleting(true)
    else if (action === 'scene-settings') { setInspectorTab('scene'); useWorkspaceStore.getState().setRightOpen(true) }
    else if (action === 'reset-layout') useWorkspaceStore.getState().resetLayout()
    else if (action === 'initial-view') runtime.current?.setCamera(city.camera)
  }
  useEffect(() => {
    function onAction(event: Event): void { handleAction.current((event as CustomEvent<CityAction>).detail) }
    function onHistory(event: KeyboardEvent): void {
      if (event.target instanceof HTMLElement && (event.target.closest('[role="dialog"]') || event.target.closest('input,textarea,select,[contenteditable="true"]'))) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); handleAction.current(event.shiftKey ? 'redo' : 'undo') }
      if (event.key === 'Delete') { event.preventDefault(); handleAction.current('delete') }
    }
    function onResize(): void { useWorkspaceStore.getState().constrainPanelSizes() }
    function onStatus(event: Event): void { const text = (event as CustomEvent<string>).detail; setStatus(text); setError('') }
    window.addEventListener('desktop-webgis:city-action', onAction); window.addEventListener('keydown', onHistory); window.addEventListener('resize', onResize)
    window.addEventListener('desktop-webgis:command-status', onStatus)
    return () => { window.removeEventListener('desktop-webgis:city-action', onAction); window.removeEventListener('keydown', onHistory); window.removeEventListener('resize', onResize); window.removeEventListener('desktop-webgis:command-status', onStatus) }
  }, [])

  const visibleNodes = city.nodes.filter(n => n.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <main className="city-workspace" aria-label="三维场景编辑器">
    <nav className="city-toolbar" aria-label="三维工具">
      <button className="button-primary city-add-button" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />添加资源</button><span className="toolbar-separator" />
      <ToolbarButton icon={MousePointer2} label="选择对象" active={!editing && !water.drawing} onClick={() => { water.cancel(); stopEditing(); notify('选择对象') }} />
      <ToolbarButton icon={Move} label="移动模型" active={editing === 'translate'} disabled={!canEdit || water.drawing} onClick={() => startEditing('translate')} />
      <ToolbarButton icon={RotateCw} label="旋转模型" active={editing === 'rotate'} disabled={!canEdit || water.drawing} onClick={() => startEditing('rotate')} />
      <ToolbarButton icon={Maximize2} label="缩放模型" active={editing === 'scale'} disabled={!canEdit || water.drawing} onClick={() => startEditing('scale')} /><span className="toolbar-separator" />
      <ToolbarButton icon={Waves} label="绘制水面" active={water.drawing} disabled={!ready} onClick={() => startWater()} />
      <ToolbarButton icon={Undo2} label="撤销" disabled={!canUndo || water.drawing} onClick={() => history()} />
      <ToolbarButton icon={Redo2} label="重做" disabled={!canRedo || water.drawing} onClick={() => history(true)} /><span className="toolbar-separator" />
      <ToolbarButton icon={Save} label="保存项目" onClick={() => { void projectCommands.saveProject() }} />
      <ToolbarButton icon={Eye} label="回到初始视角" disabled={!ready} onClick={() => runtime.current?.setCamera(city.camera)} />
      <span className="city-toolbar__spacer" /><button className="city-text-action" onClick={exportScene}><Download size={14} aria-hidden="true" />导出场景</button>
      <input ref={importInput} className="city-file-input" type="file" accept=".json" aria-label="导入三维场景文件" onChange={event => { void importScene(event.target.files?.[0]); event.target.value = '' }} />
    </nav>
    <div className="city-workspace__body">
      {left.open && <aside className="city-panel city-panel--layers" style={{ width: left.width }} aria-label="场景对象">
        <header className="panel-titlebar"><h2>场景对象 <span className="city-object-count">{city.nodes.length}</span></h2><div className="panel-actions"><button aria-label="搜索对象" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setSearch('') }}><Search size={15} aria-hidden="true" /></button><button aria-label="收起对象面板" onClick={() => useWorkspaceStore.getState().setLeftOpen(false)}><PanelLeftClose size={15} aria-hidden="true" /></button></div></header>
        {searchOpen && <label className="city-search"><Search size={14} aria-hidden="true" /><input aria-label="搜索场景对象" placeholder="搜索对象名称…" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setSearchOpen(false); setSearch('') } }} /></label>}
        <div className="city-panel__scroll">
          {!city.nodes.length && <div className="city-empty"><Layers2 size={28} aria-hidden="true" /><strong>还没有场景对象</strong><p>添加城市模型或地理数据，开始搭建场景。</p><button className="button-secondary" onClick={() => setAdding(true)}>添加资源</button><button className="city-text-action" onClick={sample}>使用城市示例</button></div>}
          {city.nodes.length > 0 && !visibleNodes.length && <p className="city-empty-message">没有匹配的对象</p>}
          <ul className="city-layer-list">{visibleNodes.map(n => {
            const Icon = icons[n.type], state = states[n.id]
            return <li key={n.id} className={`city-layer-row${selected === n.id ? ' city-layer-row--selected' : ''}${!n.visible ? ' city-layer-row--hidden' : ''}`}>
              <input type="checkbox" aria-label={`显示${n.name}`} checked={n.visible} onChange={event => { try { updateCity('设置三维对象显隐', scene => ({ ...scene, nodes: scene.nodes.map(item => item.id === n.id ? { ...item, visible: event.target.checked } : item) })); if (!event.target.checked && selected === n.id) stopEditing() } catch (reason) { report(reason) } }} />
              <button className="city-layer-row__select" draggable={n.type === 'model'} title={n.name} aria-pressed={selected === n.id} onDragStart={event => event.dataTransfer.setData('application/x-city-node', n.id)} onClick={() => select(n.id)} onDoubleClick={() => { void runtime.current?.flyTo(n.id).catch(report) }}><Icon size={17} aria-hidden="true" /><span><strong>{n.name}</strong><small className={state?.state === 'error' ? 'city-load-error' : ''}>{state?.state === 'error' ? '加载失败 · 选择查看' : state?.state === 'loading' ? '加载中…' : typeLabels[n.type]}</small></span></button>
              <button className="city-layer-row__locate" disabled={state?.state !== 'ready'} aria-label={`定位${n.name}`} title="定位对象" onClick={() => { void runtime.current?.flyTo(n.id).catch(report) }}><LocateFixed size={14} aria-hidden="true" /></button>
            </li>
          })}</ul>
        </div>
        <footer className="city-panel-footer">单击选择 · 双击定位</footer><ResizeHandle orientation="horizontal" label="调整对象面板宽度" onResize={delta => useWorkspaceStore.getState().setLeftWidth(useWorkspaceStore.getState().left.width + delta)} />
      </aside>}
      <section className={`city-canvas${water.drawing ? ' city-canvas--drawing' : ''}`} aria-label="三维视图" onDragOver={event => event.preventDefault()} onDrop={event => {
        event.preventDefault(); if (water.drawing) return
        const source = city.nodes.find(n => n.id === event.dataTransfer.getData('application/x-city-node'))
        if (source?.type !== 'model' || !runtime.current) return
        const rect = runtime.current.viewer.canvas.getBoundingClientRect(), position = pickGround(event.clientX - rect.left, event.clientY - rect.top)
        if (!position) { setError('请将模型拖到地表上。'); return }
        try { stopEditing(); updateCity('拖动放置模型', scene => ({ ...scene, nodes: scene.nodes.map(item => item.id === source.id ? { ...source, position } : item) })); select(source.id); notify('模型位置已更新，可撤销恢复') } catch (reason) { report(reason) }
      }}>
        <div className="city-canvas__viewport" ref={target} />
        {!left.open && <button className="city-panel-restore city-panel-restore--left" aria-label="展开对象面板" onClick={() => useWorkspaceStore.getState().setLeftOpen(true)}><Layers2 size={16} aria-hidden="true" /></button>}
        {!right.open && <button className="city-panel-restore city-panel-restore--right" aria-label="展开属性面板" onClick={() => useWorkspaceStore.getState().setRightOpen(true)}><PanelRightClose size={16} aria-hidden="true" /></button>}
        {water.drawing && <div className="city-drawing-bar"><Waves size={16} aria-hidden="true" /><span>水面边界 · {water.count} 个顶点</span><button className="button-primary" disabled={water.count < 3} onClick={water.finish}><Check size={14} aria-hidden="true" />完成</button><button className="button-secondary" onClick={() => { water.cancel(); notify('已取消绘制') }}>取消</button></div>}
      </section>
      {right.open && <aside className="city-panel city-panel--inspector" style={{ width: right.width }} aria-label="三维属性">
        <header className="panel-titlebar"><h2>属性</h2><button aria-label="收起属性面板" onClick={() => useWorkspaceStore.getState().setRightOpen(false)}><PanelRightClose size={15} aria-hidden="true" /></button></header>
        <div className="city-inspector-tabs" role="tablist" aria-label="属性范围"><button role="tab" aria-selected={inspectorTab === 'object'} onClick={() => setInspectorTab('object')}>对象</button><button role="tab" aria-selected={inspectorTab === 'scene'} onClick={() => setInspectorTab('scene')}>场景</button></div>
        <div className="city-panel__scroll" role="tabpanel" aria-label={inspectorTab === 'object' ? '对象属性' : '场景设置'}>
          {inspectorTab === 'scene' ? <SceneSettings key={JSON.stringify([city.effects,city.basemap,city.terrain])} city={city} onSaveCamera={saveCamera} onApply={patch => { stopEditing(); updateCity('设置场景环境', scene => ({ ...scene, ...patch })); notify('场景设置已应用') }} /> : node ? <CityInspector node={node} assetUrl={node.type !== 'water' ? city.assets[node.asset]?.url : undefined} error={states[node.id]?.error} onPatch={patchNode} onReload={reload} onResource={url => { if (node.type === 'water') return; updateCity('更新三维资源地址', scene => ({ ...scene, assets: { ...scene.assets, [node.asset]: { ...scene.assets[node.asset], url } } })); notify('资源地址已更新，正在加载…') }} onDrawBoundary={() => startWater(node.id)} onDelete={() => setDeleting(true)} /> : <div className="city-empty"><MousePointer2 size={24} aria-hidden="true" /><strong>选择一个对象</strong><p>在视图中单击模型，或在左侧对象列表中选择。</p><button className="city-text-action" onClick={() => setInspectorTab('scene')}>编辑场景环境</button></div>}
        </div>
        <ResizeHandle orientation="horizontal" label="调整三维属性面板宽度" onResize={delta => useWorkspaceStore.getState().setRightWidth(useWorkspaceStore.getState().right.width - delta)} />
      </aside>}
    </div>
    <footer className="city-footer"><span className={`city-footer__state${error ? ' city-footer__state--error' : ''}`} role="status">{error || (water.drawing ? '绘制水面：单击添加顶点 · Enter 完成 · Esc 取消' : status)}</span><span>{node?.name ?? '未选择对象'}</span><span>WGS84 · 椭球高度</span></footer>
    {adding && <CityResourceDialog onClose={() => setAdding(false)} onAdd={add} />}
    {deleting && node && <EditorDialog title="删除对象" onClose={() => setDeleting(false)}><div className="dialog-body"><p>删除「{node.name}」？删除后可通过撤销恢复。</p></div><footer className="dialog-footer"><button className="button-secondary" onClick={() => setDeleting(false)}>取消</button><button className="button-danger" onClick={() => { try { water.cancel(); stopEditing(); updateCity('删除三维对象', scene => { scene.nodes = scene.nodes.filter(n => n.id !== node.id); for (const id of Object.keys(scene.assets)) if (!scene.nodes.some(n => n.type !== 'water' && n.asset === id)) delete scene.assets[id]; return scene }); setSelected(null); setDeleting(false); notify('对象已删除，可撤销恢复') } catch (reason) { report(reason) } }}>删除对象</button></footer></EditorDialog>}
  </main>
}
