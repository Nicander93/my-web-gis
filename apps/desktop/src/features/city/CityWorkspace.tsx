import { useEffect, useRef, useState } from 'react'
import { createCityRuntime } from '@desktop-webgis/cesium-scene-runtime'
import type { CitySceneRuntime, EditMode } from '@desktop-webgis/cesium-scene-runtime'
import { createCityScene, parseCityScene } from '@desktop-webgis/cesium-scene-schema'
import type { CityNode, CityScene, Transform, WaterNode } from '@desktop-webgis/cesium-scene-schema'
import { compileProjectToScene, serializeScene } from '@desktop-webgis/scene-core'
import { Cartesian2, Math as CesiumMath, Cartographic } from 'cesium'
import { useProjectStore } from '@/stores/project.store'
import { projectCommands } from '@/app/commands/project.commands'
import { addCityAsset, addSampleWater, loadCitySample, updateCity } from './city-commands'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import './city.css'

/** City editing shell; GIS persistence and history remain in the existing project store. */
export function CityWorkspace() {
  const target = useRef<HTMLDivElement>(null)
  const runtime = useRef<CitySceneRuntime | undefined>(undefined)
  const pendingFocus = useRef<string | undefined>(undefined)
  const defaultScene = useRef(createCityScene())
  const project = useProjectStore(state => state.project)
  const city = project.city ?? defaultScene.current
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<EditMode>('translate')
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState('正在启动三维场景…')
  const [states, setStates] = useState<Record<string, string>>({})
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<'3dtiles' | 'model' | 'geojson'>('3dtiles')
  const [ready, setReady] = useState(false)
  const node = city.nodes.find(candidate => candidate.id === selected)
  const cameraKey = useRef('')

  function report(error: unknown): void { setStatus(error instanceof Error ? error.message : String(error)) }

  useEffect(() => {
    if (!target.current) return
    let active = true
    try {
      const scene = useProjectStore.getState().project.city ?? defaultScene.current
      runtime.current = createCityRuntime({
        target: target.current,
        scene,
        cesiumBaseUrl: new URL('cesium/', document.baseURI).href,
        onSelect: id => { if (active) { runtime.current?.stopEditing(); setEditing(false); setSelected(id) } },
        onEdit: event => updateCity('变换三维模型', current => ({ ...current, nodes: current.nodes.map(n => n.id === event.id && (n.type === '3dtiles' || n.type === 'model') ? { ...n, transform: event.after } : n) })),
        onLayerState: (id, state, error) => {
          if (!active) return
          setStates(current => ({ ...current, [id]: state === 'error' ? `加载失败：${error?.message ?? ''}` : state === 'ready' ? '已加载' : '加载中' }))
          if (state === 'error') report(error)
          if (state === 'ready' && pendingFocus.current === id) {
            pendingFocus.current = undefined
            void runtime.current?.flyTo(id)
          }
        }
      })
      setReady(true)
      setStatus('选择图层后开启编辑；Esc 取消当前拖动')
    } catch (error) { report(error) }
    return () => { active = false; runtime.current?.destroy(); runtime.current = undefined }
  }, [])

  useEffect(() => {
    if (!runtime.current) return
    const key = JSON.stringify([project.id, city.camera])
    if (key !== cameraKey.current) { runtime.current.stopEditing(); setEditing(false); runtime.current.setCamera(city.camera); cameraKey.current = key }
    void runtime.current.updateScene(city).catch(report)
  }, [city, project.id, ready])

  useEffect(() => {
    function handleHistory(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      event.preventDefault(); event.stopImmediatePropagation()
      runtime.current?.stopEditing(); setEditing(false)
      const store = useProjectStore.getState()
      if (event.shiftKey) store.redoEdit(); else store.undoEdit()
    }
    window.addEventListener('keydown', handleHistory, true)
    return () => window.removeEventListener('keydown', handleHistory, true)
  }, [])

  function startEditing(): void {
    if (!selected || !runtime.current) return
    try { runtime.current.startEditing(selected, mode); setEditing(true); setStatus('拖动彩色手柄编辑；Esc 取消；松手提交一次修改') }
    catch (error) { report(error) }
  }
  function select(id: string): void { runtime.current?.stopEditing(); setEditing(false); setSelected(id) }
  function add(): void {
    try {
      const id = addCityAsset(type, url.trim(), name || type)
      pendingFocus.current = id; select(id); setUrl(''); setName('')
    } catch (error) { report(error) }
  }
  function patchNode(patch: Partial<CityNode>, label = '修改三维对象'): void {
    if (!node) return
    try { updateCity(label, scene => ({ ...scene, nodes: scene.nodes.map(n => n.id === node.id ? { ...n, ...patch } as CityNode : n) })) }
    catch (error) { report(error) }
  }
  function download(filename: string, text: string): void {
    const objectUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = objectUrl; link.download = filename; link.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }
  function exportScene(): void {
    try {
      const scene = compileProjectToScene(useProjectStore.getState().getSnapshot()).scene
      if (scene.city && runtime.current) scene.city.camera = runtime.current.getCamera()
      download('scene.json', serializeScene(scene)); setStatus('已导出场景；可由独立 Viewer 或 scene-publish 加载')
    } catch (error) { report(error) }
  }
  async function importScene(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      const value: unknown = JSON.parse(await file.text())
      const source = value && typeof value === 'object' && 'city' in value ? value.city : value
      const scene = parseCityScene(source)
      updateCity('导入三维场景', () => scene)
      select(scene.nodes[0]?.id ?? '')
    } catch (error) { report(error) }
  }

  return <main className="city-workspace" aria-label="城市三维工作区">
    <nav className="city-toolbar" aria-label="三维工具">
      <button onClick={() => { try { const id = loadCitySample(); pendingFocus.current = id; select(id) } catch (error) { report(error) } }}>加载城市样例</button>
      <button onClick={() => addSampleWater()}>添加水面</button>
      <span className="city-toolbar__separator" />
      {(['translate','rotate','scale'] as const).map((value,i) => <button key={value} aria-pressed={mode === value} onClick={() => { setMode(value); runtime.current?.setEditMode(value) }}>{['移动','旋转','缩放'][i]}</button>)}
      <button disabled={!ready || !node || !['model','3dtiles'].includes(node.type)} aria-pressed={editing} onClick={() => { if (editing) { runtime.current?.stopEditing(); setEditing(false) } else startEditing() }}>{editing ? '结束编辑' : '开启编辑'}</button>
      <button onClick={() => { runtime.current?.stopEditing(); setEditing(false); useProjectStore.getState().undoEdit() }}>撤销</button>
      <button onClick={() => { runtime.current?.stopEditing(); setEditing(false); useProjectStore.getState().redoEdit() }}>重做</button>
      <span className="city-toolbar__separator" />
      <button onClick={() => { void projectCommands.saveProject().catch(report) }}>保存工程</button>
      <button onClick={() => { const camera = runtime.current?.getCamera(); if (camera) updateCity('设置三维初始视角', scene => ({ ...scene, camera })) }}>保存初始视角</button>
      <button onClick={exportScene}>导出场景</button>
      <label className="city-file-button">导入场景<input type="file" accept=".json" onChange={event => { void importScene(event.target.files?.[0]); event.target.value = '' }} /></label>
    </nav>
    <div className="city-workspace__body">
      <aside className="city-panel" aria-label="三维图层">
        <h2>城市图层</h2>
        <form className="city-add" onSubmit={event => { event.preventDefault(); add() }}>
          <label>资源类型<select value={type} onChange={event => setType(event.target.value as typeof type)}><option value="3dtiles">3D Tiles</option><option value="model">GLB 模型</option><option value="geojson">GeoJSON</option></select></label>
          <label>图层名称<input value={name} onChange={event => setName(event.target.value)} placeholder="例如：中心城区" /></label>
          <label>资源 URL<input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…/tileset.json" required /></label>
          <button type="submit">添加图层</button>
        </form>
        {city.nodes.length === 0 && <p className="city-hint">加载城市样例，或添加自己的城市模型。</p>}
        <ul className="city-layer-list">{city.nodes.map(n => <li key={n.id} className={selected === n.id ? 'city-layer-list__item city-layer-list__item--active' : 'city-layer-list__item'}>
          <input type="checkbox" aria-label={`${n.name}显隐`} checked={n.visible} onChange={event => updateCity('设置三维图层显隐', scene => ({ ...scene, nodes: scene.nodes.map(item => item.id === n.id ? { ...item, visible: event.target.checked } : item) }))} />
          <button draggable={n.type !== 'water'} onDragStart={event => event.dataTransfer.setData('application/x-city-node', n.id)} onClick={() => select(n.id)}><span>{n.name}</span><small>{n.type} · {states[n.id] ?? '等待加载'}</small></button>
          <button aria-label={`定位${n.name}`} onClick={() => { void runtime.current?.flyTo(n.id) }}>⌖</button>
        </li>)}</ul>
        <p className="city-hint">模型图层可拖入地图放置；城市 tileset 默认保留原有地理定位。</p>
      </aside>
      <section className="city-canvas" aria-label="三维地球" onDragOver={event => event.preventDefault()} onDrop={event => {
        event.preventDefault()
        const id = event.dataTransfer.getData('application/x-city-node'), source = city.nodes.find(n => n.id === id)
        if (source?.type !== 'model' || !runtime.current) { setStatus('3D Tiles 使用轴向手柄调整整体定位；GLB 可拖入地图放置'); return }
        const canvas = runtime.current.viewer.canvas, rect = canvas.getBoundingClientRect()
        const cartesian = runtime.current.viewer.camera.pickEllipsoid(new Cartesian2(event.clientX-rect.left,event.clientY-rect.top))
        if (!cartesian) { setStatus('请拖到地球表面'); return }
        const p = Cartographic.fromCartesian(cartesian)
        try { const next = addCityAsset('model', city.assets[source.asset].url, `${source.name} 副本`, [CesiumMath.toDegrees(p.longitude),CesiumMath.toDegrees(p.latitude),0]); select(next) } catch (error) { report(error) }
      }}>
        <div className="city-canvas__viewport" ref={target} />
        <p className="city-status" role="status">{status}</p>
      </section>
      <aside className="city-panel city-panel--inspector" aria-label="三维属性">
        <h2>场景属性</h2>
        {node ? <>
          <label>名称<input key={`${node.id}:${node.name}`} defaultValue={node.name} onBlur={event => patchNode({ name: event.target.value })} /></label>
          {(node.type === 'model' || node.type === '3dtiles') && <TransformFields key={`${node.id}:${JSON.stringify(node.transform)}`} transform={node.transform} onApply={transform => patchNode({ transform }, '输入模型变换')} />}
          {node.type === 'water' && <WaterFields key={`${node.id}:${JSON.stringify(node)}`} node={node} onApply={patch => patchNode(patch, '修改水面参数')} />}
          <PopupFields key={`${node.id}:${JSON.stringify(node.popup)}`} node={node} onApply={popup => patchNode({ popup }, '设置三维 Popup')} />
          {node.type !== 'water' && <button onClick={() => { runtime.current?.stopEditing(); setEditing(false); runtime.current?.layers.removeLayer(node.id); void runtime.current?.updateScene(city).catch(report) }}>重新加载资源</button>}
          <button className="city-delete" onClick={() => { updateCity('删除三维对象', scene => { scene.nodes = scene.nodes.filter(n => n.id !== node.id); for (const id of Object.keys(scene.assets)) if (!scene.nodes.some(n => n.type !== 'water' && n.asset === id)) delete scene.assets[id]; return scene }); select('') }}>删除对象</button>
        </> : <p className="city-hint">选择图层后查看变换、材质和 Popup 字段。</p>}
        <fieldset><legend>环境</legend>
          <label>雾浓度<input type="number" min="0" max="1" step=".05" key={`fog:${city.effects.fog}`} defaultValue={city.effects.fog} onBlur={event => { try { updateCity('设置雾效果', scene => ({ ...scene, effects: { ...scene.effects, fog: Number(event.target.value) } })) } catch (error) { report(error) } }} /></label>
          <label className="city-check"><input type="checkbox" checked={city.effects.bloom} onChange={event => updateCity('设置辉光', scene => ({ ...scene, effects: { ...scene.effects, bloom: event.target.checked } }))} />辉光</label>
          <EnvironmentFields key={JSON.stringify([city.basemap,city.terrain])} city={city} onApply={patch => { try { updateCity('设置三维数据源', scene => ({ ...scene, ...patch })) } catch (error) { report(error) } }} />
        </fieldset>
      </aside>
    </div>
  </main>
}

function TransformFields({ transform, onApply }: { transform: Transform; onApply: (value: Transform) => void }) {
  const [draft, setDraft] = useState(structuredClone(transform))
  return <form onSubmit={event => { event.preventDefault(); onApply(draft) }}><fieldset><legend>模型变换</legend>
    {(['translation','rotation'] as const).map((field,index) => <div key={field}><p>{index === 0 ? '平移 · 东 / 北 / 高（米）' : '旋转 · 航向 / 俯仰 / 翻滚（度）'}</p><div className="city-triple">{draft[field].map((value,i) => <input key={i} aria-label={`${field}${i}`} type="number" step="any" value={value} required onChange={event => { const next = structuredClone(draft); next[field][i] = Number(event.target.value); setDraft(next) }} />)}</div></div>)}
    <label>等比缩放<input type="number" min=".001" max="10000" step=".1" required value={draft.scale} onChange={event => setDraft({ ...draft, scale: Number(event.target.value) })} /></label>
    <button type="submit">应用变换</button>
  </fieldset></form>
}
function WaterFields({ node, onApply }: { node: WaterNode; onApply: (value: Partial<WaterNode>) => void }) {
  const [draft, setDraft] = useState(node)
  const [boundary, setBoundary] = useState(JSON.stringify(node.boundary))
  const [error, setError] = useState('')
  return <form onSubmit={event => { event.preventDefault(); try { const value: unknown = JSON.parse(boundary); if (!Array.isArray(value)) throw new Error('边界须为坐标数组'); onApply({ ...draft, boundary: value }); setError('') } catch { setError('边界格式无效，请输入 [[经度,纬度,高度],…]') } }}><fieldset><legend>水面材质</legend>
    {(['height','amplitude','frequency','speed'] as const).map((field,i) => <label key={field}>{['水位（米）','波幅','频率','速度'][i]}<input type="number" step="any" value={draft[field]} required onChange={event => setDraft({ ...draft, [field]: Number(event.target.value) })} /></label>)}
    <label>水色<input type="color" value={draft.color.slice(0,7)} onChange={event => setDraft({ ...draft, color: `${event.target.value}cc` })} /></label>
    <label>边界坐标（WGS84 JSON）<textarea value={boundary} onChange={event => setBoundary(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit">应用材质</button>
  </fieldset></form>
}
function PopupFields({ node, onApply }: { node: CityNode; onApply: (value: CityNode['popup']) => void }) {
  const [fields, setFields] = useState(node.popup?.fields.map(f => f.field).join(',') ?? '')
  return <form onSubmit={event => { event.preventDefault(); onApply(fields.trim() ? { title: node.name, fields: fields.split(',').map(field => ({ field: field.trim() })).filter(f => f.field) } : undefined) }}><fieldset><legend>Popup</legend><label>属性字段（逗号分隔）<input value={fields} onChange={event => setFields(event.target.value)} placeholder="name,height,type" /></label><button type="submit">应用 Popup</button></fieldset></form>
}
function EnvironmentFields({ city, onApply }: { city: CityScene; onApply: (value: Pick<CityScene,'basemap'|'terrain'>) => void }) {
  const [basemap,setBasemap] = useState(city.basemap?.url ?? ''), [terrain,setTerrain] = useState(city.terrain?.url ?? '')
  return <form onSubmit={event => { event.preventDefault(); onApply({ basemap: basemap.trim() ? { url: basemap.trim() } : undefined, terrain: terrain.trim() ? { url: terrain.trim() } : undefined }) }}><label>影像模板 URL<input value={basemap} onChange={event => setBasemap(event.target.value)} placeholder="留空使用内置世界影像" /></label><label>地形服务 URL<input value={terrain} onChange={event => setTerrain(event.target.value)} placeholder="留空使用椭球" /></label><button type="submit">应用环境</button></form>
}
