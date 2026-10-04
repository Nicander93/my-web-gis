import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { isCityResourceUrl } from '@desktop-webgis/cesium-scene-schema'
import type { CityNode, CityScene, GeoPosition, GraphicNode, PopupDefinition, Transform, WaterNode } from '@desktop-webgis/cesium-scene-schema'
import { GraphicAttributes } from './GraphicAttributes'

export type CityInspectorSection = 'object' | 'popup' | 'source' | 'style' | 'properties'

interface CityInspectorProps {
  node: CityNode
  section?: CityInspectorSection
  pickedProperties?: Record<string, unknown>
  assetUrl?: string
  error?: string
  onPatch(patch: Partial<CityNode>, label?: string): void
  onResource(url: string): void
  onReload(): void
  onDrawBoundary(): void
  onEditGeometry(): void
  geometryDisabled?: boolean
  onDelete(): void
}

export function CityInspector({ node, section = 'object', pickedProperties = {}, assetUrl, error, onPatch, onResource, onReload, onDrawBoundary, onEditGeometry, geometryDisabled, onDelete }: CityInspectorProps) {
  const properties = node.type === 'graphic' ? { name: node.name, ...node.properties } : pickedProperties
  return <fieldset className="city-properties city-properties--fields" disabled={node.locked}>
    <section className="city-property-section">
      <label className="editor-field">对象名称<input key={`${node.id}:${node.name}`} name="object-name" defaultValue={node.name} onBlur={event => { if (event.target.value.trim()) onPatch({ name: event.target.value.trim() }, '重命名三维对象'); else event.target.value = node.name }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = node.name; event.currentTarget.blur() } }} /></label>
      <span className="city-type-label">{node.type === '3dtiles' ? '3D Tiles' : node.type === 'model' ? 'GLB 模型' : node.type === 'geojson' ? 'GeoJSON' : node.type === 'graphic' ? `标绘 · ${node.geometry.type}` : '水面'}{node.locked ? ' · 已锁定' : ''}</span>
    </section>
    {error && <section className="city-property-section"><p className="editor-error" role="alert">{error}</p><button className="button-secondary" onClick={onReload}>重试加载</button></section>}
    {section === 'object' && node.type === 'model' && <PositionFields key={`${node.id}:${JSON.stringify(node.position)}`} position={node.position} onApply={position => onPatch({ position } as Partial<CityNode>, '设置模型地理位置')} />}
    {section === 'object' && (node.type === 'model' || node.type === '3dtiles') && <TransformFields key={`${node.id}:${JSON.stringify(node.transform)}`} transform={node.transform} onApply={transform => onPatch({ transform } as Partial<CityNode>, '输入模型变换')} />}
    {section === 'object' && node.type === 'water' && <WaterFields key={`${node.id}:${JSON.stringify(node)}`} node={node} onApply={patch => onPatch(patch, '修改水面材质')} onDrawBoundary={onDrawBoundary} />}
    {section === 'object' && node.type === 'graphic' && <section className="city-property-section"><h3>几何</h3><p className="editor-help">{node.geometry.positions.length} 个顶点 · {node.geometry.heightMode === 'ground' ? '贴地' : '绝对高度'}</p><button className="button-secondary" disabled={geometryDisabled} onClick={onEditGeometry}>编辑顶点与坐标</button></section>}
    {node.type === 'graphic' && (section === 'style' || section === 'object') && <GraphicFields key={`${node.id}:${JSON.stringify(node.style)}`} node={node} onPatch={onPatch} />}
    {node.type === 'geojson' && section === 'style' && <section className="city-property-section"><h3>矢量样式</h3><label className="editor-field">颜色<input type="color" value={node.color ?? '#55a6ff'} onChange={event => onPatch({ color: event.target.value }, '设置矢量颜色')} /></label></section>}
    {node.type === 'graphic' && section === 'properties' && <GraphicAttributes key={`${node.id}:${JSON.stringify(node.properties)}`} node={node} onApply={properties => onPatch({ properties }, '设置图形属性')} />}
    {section === 'properties' && node.type !== 'graphic' && <section className="city-property-section"><h3>拾取对象属性</h3>{Object.keys(properties).length ? <dl className="city-attribute-list">{Object.entries(properties).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{displayValue(value)}</dd></div>)}</dl> : <p className="editor-help">在三维视图中单击构件，查看实际属性。</p>}</section>}
    <PopupFields properties={properties} open={section === 'popup'} key={`${node.id}:${JSON.stringify(node.popup)}`} node={node} onApply={popup => onPatch({ popup }, '设置属性弹窗')} />
    {assetUrl && <ResourceFields open={section === 'source'} key={`${node.id}:${assetUrl}`} url={assetUrl} onApply={onResource} onReload={onReload} />}
    <section className="city-property-section city-object-actions"><button className="city-danger-action" onClick={onDelete}><Trash2 size={14} aria-hidden="true" />删除对象</button><span>删除后可撤销恢复</span></section>
  </fieldset>
}

function GraphicFields({ node, onPatch }: { node: GraphicNode; onPatch: CityInspectorProps['onPatch'] }) {
  const [style, setStyle] = useState(node.style)
  const [error, setError] = useState('')
  return <form className="city-property-section" onSubmit={event => { event.preventDefault(); try { onPatch({ style }, '设置图形样式'); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '样式无效') } }}>
    <h3>样式与标注</h3><p className="editor-help">{node.geometry.positions.length} 个顶点 · {node.geometry.heightMode === 'ground' ? '贴地' : '绝对高度'}</p>
    <label className="editor-field">颜色<input type="color" value={style.color.slice(0,7)} onChange={event => setStyle({ ...style, color: event.target.value })} /></label>
    <label className="editor-field">{node.geometry.type === 'point' ? '点大小（像素）' : '线宽（像素）'}<input type="number" required min="1" max={node.geometry.type === 'point' ? 128 : 64} value={node.geometry.type === 'point' ? style.pointSize : style.width} onChange={event => setStyle({ ...style, [node.geometry.type === 'point' ? 'pointSize' : 'width']: Number(event.target.value) })} /></label>
    <label className="editor-field">标注字段<select value={style.labelField ?? ''} onChange={event => setStyle({ ...style, labelField: event.target.value || undefined })}><option value="">固定文字</option>{[...new Set(['name', ...Object.keys(node.properties), ...(style.labelField ? [style.labelField] : [])])].map(field => <option key={field} value={field}>{field}{field in node.properties || field === 'name' ? '' : '（字段已移除）'}</option>)}</select></label>
    <label className="editor-field">{style.labelField ? '字段缺失时的文字' : '标注文字'}<input value={style.label ?? ''} onChange={event => setStyle({ ...style, label: event.target.value })} /></label>
    {style.labelField && <p className="editor-help">标注随文本、数字和布尔属性自动更新。</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}<button type="submit" className="button-primary">应用样式</button>
  </form>
}

function TransformFields({ transform, onApply }: { transform: Transform; onApply(value: Transform): void }) {
  const [translation, setTranslation] = useState(transform.translation.map(String))
  const [rotation, setRotation] = useState(transform.rotation.map(String))
  const [scale, setScale] = useState(String(transform.scale))
  const [error, setError] = useState('')
  const changed = JSON.stringify([translation, rotation, scale]) !== JSON.stringify([transform.translation.map(String), transform.rotation.map(String), String(transform.scale)])
  return <form className="city-property-section" onSubmit={event => {
    event.preventDefault(); setError('')
    try { onApply({ translation: translation.map(Number) as Transform['translation'], rotation: rotation.map(Number) as Transform['rotation'], scale: Number(scale) }) } catch (reason) { setError(reason instanceof Error ? reason.message : '变换参数无效') }
  }}>
    <h3>变换</h3>
    <fieldset className="city-axis-fields"><legend>平移偏移 <span>米 · 相对原始位置</span></legend><div className="city-triple">{['东向','北向','高度'].map((label, i) => <label key={label}>{label}<input type="number" step="any" required value={translation[i]} onChange={event => setTranslation(translation.map((value, index) => index === i ? event.target.value : value))} /></label>)}</div></fieldset>
    <fieldset className="city-axis-fields"><legend>旋转 <span>度</span></legend><div className="city-triple">{['航向','俯仰','翻滚'].map((label, i) => <label key={label}>{label}<input type="number" step="any" required value={rotation[i]} onChange={event => setRotation(rotation.map((value, index) => index === i ? event.target.value : value))} /></label>)}</div></fieldset>
    <label className="editor-field">等比缩放<input type="number" min=".001" max="10000" step="any" required value={scale} onChange={event => setScale(event.target.value)} /></label>
    {error && <p className="editor-error" role="alert">{error}</p>}
    <div className="city-form-actions"><button className="button-primary" type="submit" disabled={!changed}>应用变换</button>{changed && <span className="city-draft-state">尚未应用</span>}</div>
  </form>
}

function PositionFields({ position, onApply }: { position: GeoPosition; onApply(value: GeoPosition): void }) {
  const [draft, setDraft] = useState(position.map(String))
  const [error, setError] = useState('')
  return <form className="city-property-section" onSubmit={event => { event.preventDefault(); try { onApply(draft.map(Number) as GeoPosition); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '位置无效') } }}>
    <h3>地理位置</h3><p className="editor-help">WGS84 经纬度 · 椭球高度</p><div className="city-triple">{['经度','纬度','高度（米）'].map((label,i) => <label key={label}>{label}<input type="number" step="any" min={i === 0 ? -180 : i === 1 ? -90 : undefined} max={i === 0 ? 180 : i === 1 ? 90 : undefined} required value={draft[i]} onChange={event => setDraft(draft.map((value,index) => i === index ? event.target.value : value))} /></label>)}</div>
    {error && <p className="editor-error" role="alert">{error}</p>}<button className="button-secondary" type="submit">应用位置</button>
  </form>
}

function WaterFields({ node, onApply, onDrawBoundary }: { node: WaterNode; onApply(value: Partial<WaterNode>): void; onDrawBoundary(): void }) {
  const [draft, setDraft] = useState({ height: String(node.height), amplitude: String(node.amplitude), frequency: String(node.frequency), speed: String(node.speed), color: node.color.slice(0,7) })
  const [boundary, setBoundary] = useState(JSON.stringify(node.boundary))
  const [error, setError] = useState('')
  return <form className="city-property-section" onSubmit={event => { event.preventDefault(); setError(''); try { const parsed: unknown = JSON.parse(boundary); if (!Array.isArray(parsed)) throw new Error('边界须为坐标数组'); onApply({ height: Number(draft.height), amplitude: Number(draft.amplitude), frequency: Number(draft.frequency), speed: Number(draft.speed), color: `${draft.color}${node.color.length === 9 ? node.color.slice(7) : 'cc'}`, boundary: parsed }) } catch (reason) { setError(reason instanceof Error ? reason.message : '材质参数无效') } }}>
    <h3>水面</h3><div className="city-boundary-summary"><span>{node.boundary.length} 个边界顶点</span><button type="button" className="button-secondary" onClick={onDrawBoundary}>重新绘制边界</button></div>
    <div className="city-pair-fields">{(['height','amplitude','frequency','speed'] as const).map((field,i) => <label key={field}>{['水位（米）','波幅','波纹频率','流动速度'][i]}<input type="number" step="any" min={field === 'height' || field === 'speed' ? undefined : 0} required value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></label>)}</div>
    <label className="editor-field city-color-field">水面颜色<input type="color" value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value })} /></label>
    <details className="city-advanced"><summary>高级：精确边界坐标</summary><label className="editor-field">WGS84 坐标数组<textarea value={boundary} spellCheck={false} onChange={event => setBoundary(event.target.value)} /></label></details>
    {error && <p className="editor-error" role="alert">{error}</p>}<button type="submit" className="button-primary">应用材质</button>
  </form>
}

function displayValue(value: unknown): string { return value === undefined ? '—' : value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value) }

function PopupFields({ node, properties, open, onApply }: { node: CityNode; properties: Record<string, unknown>; open?: boolean; onApply(value: PopupDefinition | undefined): void }) {
  const [title, setTitle] = useState(node.popup?.title ?? node.name)
  const [titleField, setTitleField] = useState(node.popup?.titleField ?? '')
  const [fields, setFields] = useState(node.popup?.fields ?? [])
  const [error, setError] = useState('')
  return <details open={open || undefined} className="city-property-section city-advanced"><summary>属性弹窗 <span>{fields.length ? `${fields.length} 个字段` : '未设置'}</span></summary>
    <form onSubmit={event => { event.preventDefault(); try { const valid = fields.filter(field => field.field.trim()).map(field => ({ field: field.field.trim(), label: field.label?.trim() || field.field.trim() })); onApply(valid.length ? { title, titleField: titleField.trim() || undefined, fields: valid } : undefined); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '弹窗设置无效') } }}>
      <label className="editor-field">弹窗标题<input value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label className="editor-field">标题属性<input value={titleField} placeholder="留空使用固定标题" onChange={event => setTitleField(event.target.value)} /></label>
      {fields.map((field,i) => <div className="city-popup-field" key={i}><label>属性字段<input aria-label={`属性字段 ${i+1}`} value={field.field} placeholder="name" onChange={event => setFields(fields.map((value,index) => i === index ? { ...value, field: event.target.value } : value))} /></label><label>显示名称<input aria-label={`字段显示名称 ${i+1}`} value={field.label ?? ''} placeholder="名称" onChange={event => setFields(fields.map((value,index) => i === index ? { ...value, label: event.target.value } : value))} /></label><button type="button" aria-label={`移除字段 ${i+1}`} onClick={() => setFields(fields.filter((_,index) => i !== index))}><Trash2 size={14} aria-hidden="true" /></button></div>)}
      <button className="city-text-action" type="button" onClick={() => setFields([...fields,{ field: '', label: '' }])}><Plus size={14} aria-hidden="true" />添加字段</button><p className="editor-help">字段名须与资源属性一致；留空并应用可关闭弹窗。</p>
      {Object.keys(properties).length > 0 && <div className="city-popup-preview"><strong>{titleField && properties[titleField] !== undefined ? displayValue(properties[titleField]) : title}</strong><dl className="city-attribute-list">{fields.filter(field => field.field.trim()).map((field,index) => <div key={index}><dt>{field.label || field.field}</dt><dd>{displayValue(properties[field.field])}</dd></div>)}</dl></div>}
      {error && <p role="alert" className="editor-error">{error}</p>}<button type="submit" className="button-secondary">应用弹窗</button>
    </form>
  </details>
}

function ResourceFields({ url, open, onApply, onReload }: { url: string; open?: boolean; onApply(url: string): void; onReload(): void }) {
  const [draft, setDraft] = useState(url)
  const [error, setError] = useState('')
  return <details open={open || undefined} className="city-property-section city-advanced"><summary>数据源</summary><form onSubmit={event => { event.preventDefault(); if (!isCityResourceUrl(draft.trim())) { setError('请输入有效的 HTTP(S) 地址或项目相对路径。'); return }; try { onApply(draft.trim()); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '数据源无效') } }}><label className="editor-field">资源地址<input value={draft} autoComplete="off" spellCheck={false} onChange={event => setDraft(event.target.value)} /></label>{error && <p role="alert" className="editor-error">{error}</p>}<div className="city-form-actions"><button className="button-secondary" type="submit">更新地址</button><button className="city-text-action" type="button" onClick={onReload}>重新加载</button></div></form></details>
}

interface SceneSettingsProps { city: CityScene; onApply(value: Pick<CityScene,'effects'|'basemap'|'terrain'|'lighting'>): void; onSaveCamera(): void }

export function SceneSettings({ city, onApply, onSaveCamera }: SceneSettingsProps) {
  const [fog, setFog] = useState(String(city.effects.fog))
  const [bloom, setBloom] = useState(city.effects.bloom)
  const [basemap, setBasemap] = useState(city.basemap?.url ?? '')
  const [terrain, setTerrain] = useState(city.terrain?.url ?? '')
  const [sunlight, setSunlight] = useState(city.lighting?.sunlight ?? false)
  const [shadows, setShadows] = useState(city.lighting?.shadows ?? false)
  const [time, setTime] = useState(new Date(city.lighting?.time ?? Date.now()).toISOString().slice(0,16))
  const [error, setError] = useState('')
  return <div className="city-properties">
    <section className="city-property-section"><h3>初始视角</h3><p className="editor-help">场景打开时使用此视角。</p><button className="button-secondary" onClick={onSaveCamera}>使用当前视角</button></section>
    <form onSubmit={event => { event.preventDefault(); try { onApply({ effects: { fog: Number(fog), bloom }, lighting: { sunlight, shadows, time: new Date(time + 'Z').toISOString() }, basemap: basemap.trim() ? { url: basemap.trim() } : undefined, terrain: terrain.trim() ? { url: terrain.trim() } : undefined }); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '场景参数无效') } }}>
      <section className="city-property-section"><h3>光照与时间</h3><label className="city-check"><input type="checkbox" checked={sunlight} onChange={event => setSunlight(event.target.checked)} />太阳光照</label><label className="city-check"><input type="checkbox" checked={shadows} onChange={event => setShadows(event.target.checked)} />模型阴影</label><label className="editor-field">场景时间（UTC）<input type="datetime-local" required value={time} onChange={event => setTime(event.target.value)} /></label></section>
      <section className="city-property-section"><h3>环境效果</h3><label className="editor-field">雾浓度<input type="number" min="0" max="1" step=".01" required value={fog} onChange={event => setFog(event.target.value)} /></label><label className="city-check"><input type="checkbox" checked={bloom} onChange={event => setBloom(event.target.checked)} />启用辉光</label></section>
      <section className="city-property-section"><h3>底图与地形</h3><label className="editor-field">影像模板地址<input value={basemap} spellCheck={false} placeholder="留空使用内置世界影像" onChange={event => setBasemap(event.target.value)} /></label><label className="editor-field">地形服务地址<input value={terrain} spellCheck={false} placeholder="留空使用椭球地表" onChange={event => setTerrain(event.target.value)} /></label><p className="editor-help">支持 HTTP(S) 服务或项目相对路径。</p></section>
      <section className="city-property-section">{error && <p className="editor-error" role="alert">{error}</p>}<button type="submit" className="button-primary">应用场景设置</button></section>
    </form>
  </div>
}
