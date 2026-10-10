import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { isCityResourceUrl } from '@desktop-webgis/cesium-scene-schema'
import type { CityGroup, CityNode, CityScene, GeoPosition, GraphicNode, PopupDefinition, Transform, WaterNode } from '@desktop-webgis/cesium-scene-schema'
import { GraphicAttributes } from './GraphicAttributes'
import { CityRenderSettings } from './CityRenderSettings'
import { CityInfo, CityPropertyGroup } from './CityPropertyGroup'
import { LivePropertyInput } from './LivePropertyInput'

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
  groups?: CityGroup[]
  onMoveGroup(groupId?: string): void
  onDelete(): void
}

export function CityInspector({ node, section = 'object', pickedProperties = {}, assetUrl, error, onPatch, onResource, onReload, onDrawBoundary, onEditGeometry, geometryDisabled, groups, onMoveGroup, onDelete }: CityInspectorProps) {
  const properties = node.type === 'graphic' ? { name: node.name, ...node.properties } : pickedProperties
  return <fieldset className="city-properties city-properties--fields" disabled={node.locked}>
    <section className="city-property-section">
      <label className="editor-field">对象名称<input key={`${node.id}:${node.name}`} name="object-name" defaultValue={node.name} onBlur={event => { if (event.target.value.trim()) onPatch({ name: event.target.value.trim() }, '重命名三维对象'); else event.target.value = node.name }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = node.name; event.currentTarget.blur() } }} /></label>
      <span className="city-type-label">{node.type === '3dtiles' ? '3D Tiles' : node.type === 'model' ? 'GLB 模型' : node.type === 'geojson' ? 'GeoJSON' : node.type === 'graphic' ? `标绘 · ${node.geometry.type}` : '水面'}{node.locked ? ' · 已锁定' : ''}</span>
    </section>
    {section === 'object' && <section className="city-property-section"><label className="editor-field">所属分组<select value={node.groupId ?? ''} onChange={event => onMoveGroup(event.target.value || undefined)}><option value="">未分组</option>{groups?.map(group => <option key={group.id} value={group.id} disabled={group.locked}>{group.name}{group.locked ? '（已锁定）' : ''}</option>)}</select></label></section>}
    {error && <section className="city-property-section"><p className="editor-error" role="alert">{error}</p><button className="button-secondary" onClick={onReload}>重试加载</button></section>}
    {section === 'object' && node.type === 'model' && <PositionFields key={`${node.id}:${JSON.stringify(node.position)}`} position={node.position} onApply={position => onPatch({ position } as Partial<CityNode>, '设置模型地理位置')} />}
    {section === 'object' && (node.type === 'model' || node.type === '3dtiles') && <TransformFields key={node.id} transform={node.transform} onApply={transform => onPatch({ transform } as Partial<CityNode>, '输入模型变换')} />}
    {section === 'object' && node.type === '3dtiles' && <CityPropertyGroup title="瓦片质量" hint="屏幕误差越小，模型越精细，加载开销越大。缓存预算不是显存硬上限；可见瓦片可能超出预算。设置随项目保存，可撤销。">
      <label className="editor-field">屏幕误差<select value={node.maximumScreenSpaceError ?? 16} onChange={event => onPatch({ maximumScreenSpaceError: Number(event.target.value) } as Partial<CityNode>, '设置瓦片显示精度')}>{[1,2,4,8,16,32].map(value => <option key={value} value={value}>{value}{value === 1 ? ' · 最精细' : value === 16 ? ' · 默认' : value === 32 ? ' · 更流畅' : ''}</option>)}</select></label>
      <label className="editor-field">缓存预算<select value={node.cacheBytes ?? 256 * 1024 * 1024} onChange={event => onPatch({ cacheBytes: Number(event.target.value) } as Partial<CityNode>, '设置瓦片缓存预算')}>{[128,256,512,1024].map(value => <option key={value} value={value * 1024 * 1024}>{value} MB</option>)}</select></label>
    </CityPropertyGroup>}
    {section === 'object' && node.type === 'water' && <WaterFields key={`${node.id}:${JSON.stringify(node)}`} node={node} onApply={patch => onPatch(patch, '修改水面材质')} onDrawBoundary={onDrawBoundary} />}
    {section === 'object' && node.type === 'graphic' && <section className="city-property-section"><h3>几何</h3><p className="editor-help">{node.geometry.positions.length} 个顶点 · {node.geometry.heightMode === 'ground' ? '贴地' : '绝对高度'}</p><button className="button-secondary" disabled={geometryDisabled} onClick={onEditGeometry}>编辑顶点与坐标</button></section>}
    {node.type === 'graphic' && (section === 'style' || section === 'object') && <GraphicFields key={`${node.id}:${JSON.stringify(node.style)}`} node={node} onPatch={onPatch} />}
    {node.type === 'geojson' && section === 'style' && <section className="city-property-section"><h3>矢量样式</h3><label className="editor-field">颜色<input type="color" value={node.color ?? '#55a6ff'} onChange={event => onPatch({ color: event.target.value }, '设置矢量颜色')} /></label></section>}
    {node.type === 'graphic' && section === 'properties' && <GraphicAttributes key={`${node.id}:${JSON.stringify(node.properties)}`} node={node} onApply={properties => onPatch({ properties }, '设置图形属性')} />}
    {section === 'properties' && node.type !== 'graphic' && <section className="city-property-section"><h3>拾取对象属性</h3>{Object.keys(properties).length ? <dl className="city-attribute-list">{Object.entries(properties).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{displayValue(value)}</dd></div>)}</dl> : <p className="editor-help">在三维视图中单击构件，查看实际属性。</p>}</section>}
    <PopupFields properties={properties} open={section === 'popup'} key={`${node.id}:${JSON.stringify(node.popup)}`} node={node} onApply={popup => onPatch({ popup }, '设置属性弹窗')} />
    {assetUrl && <ResourceFields open={section === 'source'} key={`${node.id}:${assetUrl}`} url={assetUrl} onApply={onResource} onReload={onReload} />}
    <section className="city-property-section city-object-actions"><button className="city-danger-action" onClick={onDelete}><Trash2 size={14} aria-hidden="true" />删除对象</button><CityInfo label="删除对象">删除后可撤销恢复。</CityInfo></section>
  </fieldset>
}

function GraphicFields({ node, onPatch }: { node: GraphicNode; onPatch: CityInspectorProps['onPatch'] }) {
  const [style, setStyle] = useState(node.style)
  const [error, setError] = useState('')
  return <form className="city-property-section" onSubmit={event => { event.preventDefault(); try { onPatch({ style }, '设置图形样式'); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '样式无效') } }}>
    <h3>样式与标注<CityInfo label="图形标注">标注可使用固定文字或属性字段；文本、数字和布尔属性变化时自动更新。</CityInfo></h3>
    <label className="editor-field">颜色<input type="color" value={style.color.slice(0,7)} onChange={event => setStyle({ ...style, color: event.target.value })} /></label>
    <label className="editor-field">{node.geometry.type === 'point' ? '点大小（像素）' : '线宽（像素）'}<input type="number" required min="1" max={node.geometry.type === 'point' ? 128 : 64} value={node.geometry.type === 'point' ? style.pointSize : style.width} onChange={event => setStyle({ ...style, [node.geometry.type === 'point' ? 'pointSize' : 'width']: Number(event.target.value) })} /></label>
    <label className="editor-field">标注字段<select value={style.labelField ?? ''} onChange={event => setStyle({ ...style, labelField: event.target.value || undefined })}><option value="">固定文字</option>{[...new Set(['name', ...Object.keys(node.properties), ...(style.labelField ? [style.labelField] : [])])].map(field => <option key={field} value={field}>{field}{field in node.properties || field === 'name' ? '' : '（字段已移除）'}</option>)}</select></label>
    <label className="editor-field">{style.labelField ? '字段缺失时的文字' : '标注文字'}<input value={style.label ?? ''} onChange={event => setStyle({ ...style, label: event.target.value })} /></label>
    {error && <p className="editor-error" role="alert">{error}</p>}<button type="submit" className="button-primary">应用样式</button>
  </form>
}

function TransformFields({ transform, onApply }: { transform: Transform; onApply(value: Transform): void }) {
  function number(text: string): number {
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('请输入有效数值。')
    return Number(text)
  }
  return <section className="city-property-section">
    <h3>变换<CityInfo label="模型变换">平移单位为米，相对模型原始位置；旋转单位为度。有效输入稍作停顿即生效，Enter 或离开输入框可立即确认；修改可撤销。</CityInfo></h3>
    {(['translation','rotation'] as const).map(field => <div key={field} className="city-axis-fields"><span className="city-axis-title">{field === 'translation' ? '平移 (m)' : '旋转 (°)'}</span><div className="city-triple">{(field === 'translation' ? ['东向','北向','高度'] : ['航向','俯仰','翻滚']).map((label, i) => <LivePropertyInput key={label} label={label[0]} aria-label={label} title={String(transform[field][i])} type="number" step="any" required value={String(transform[field][i])} onCommit={text => {
      const vector = [...transform[field]] as Transform['translation']
      vector[i] = number(text)
      onApply({ ...transform, [field]: vector })
    }} />)}</div></div>)}
    <LivePropertyInput label="等比缩放" type="number" min=".001" max="10000" step="any" required value={String(transform.scale)} onCommit={text => {
      const scale = number(text)
      if (scale < .001 || scale > 10000) throw new Error('缩放须在 0.001–10000 之间。')
      onApply({ ...transform, scale })
    }} />
  </section>
}

function PositionFields({ position, onApply }: { position: GeoPosition; onApply(value: GeoPosition): void }) {
  const [draft, setDraft] = useState(position.map(String))
  const [error, setError] = useState('')
  return <form className="city-property-section" onSubmit={event => { event.preventDefault(); try { onApply(draft.map(Number) as GeoPosition); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '位置无效') } }}>
    <h3>地理位置<CityInfo label="地理位置">WGS84 经纬度，高度为椭球高度，单位为米。</CityInfo></h3><div className="city-position-fields">{['经度','纬度','高度（米）'].map((label,i) => <label className="editor-field" key={label}>{label}<input type="number" step="any" min={i === 0 ? -180 : i === 1 ? -90 : undefined} max={i === 0 ? 180 : i === 1 ? 90 : undefined} required value={draft[i]} onChange={event => setDraft(draft.map((value,index) => i === index ? event.target.value : value))} /></label>)}</div>
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
      <div className="city-form-actions"><button className="city-text-action" type="button" onClick={() => setFields([...fields,{ field: '', label: '' }])}><Plus size={14} aria-hidden="true" />添加字段</button><CityInfo label="弹窗字段">字段名须与资源属性一致；留空并应用可关闭弹窗。</CityInfo></div>
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

interface SceneSettingsProps { city: CityScene; onApply(value: Partial<Pick<CityScene,'effects'|'basemap'|'terrain'|'lighting'>>): void; onSaveCamera(): void }

export function SceneSettings({ city, onApply, onSaveCamera }: SceneSettingsProps) {
  const [initialTime] = useState(() => new Date().toISOString())
  const lighting = city.lighting ?? { sunlight: false, shadows: false, time: initialTime }
  function resource(type: 'basemap' | 'terrain', text: string): void {
    const url = text.trim()
    if (url && !isCityResourceUrl(url)) throw new Error('请输入有效的 HTTP(S) 地址或项目相对路径。')
    onApply({ [type]: url ? { url } : undefined })
  }
  return <div className="city-properties">
    <CityRenderSettings />
    <section className="city-property-section city-property-row"><span>初始视角</span><button className="button-secondary" onClick={onSaveCamera}>使用当前视角</button><CityInfo label="初始视角">场景打开时使用保存的初始视角。</CityInfo></section>
    <CityPropertyGroup title="光照与时间"><label className="city-check">太阳光照<input type="checkbox" checked={lighting.sunlight} onChange={event => onApply({ lighting: { ...lighting, sunlight: event.target.checked } })} /></label><label className="city-check">模型阴影<input type="checkbox" checked={lighting.shadows} onChange={event => onApply({ lighting: { ...lighting, shadows: event.target.checked } })} /></label><LivePropertyInput label="时间 (UTC)" aria-label="场景时间（UTC）" type="datetime-local" required value={new Date(lighting.time).toISOString().slice(0,16)} onCommit={text => {
      const date = new Date(text + 'Z')
      if (!text || !Number.isFinite(date.getTime())) throw new Error('请输入完整有效的 UTC 时间。')
      onApply({ lighting: { ...lighting, time: date.toISOString() } })
    }} /></CityPropertyGroup>
    <CityPropertyGroup title="环境效果" open={false}><LivePropertyInput label="雾浓度" type="number" min="0" max="1" step=".01" required value={String(city.effects.fog)} onCommit={text => {
      const fog = Number(text)
      if (!text.trim() || !Number.isFinite(fog) || fog < 0 || fog > 1) throw new Error('雾浓度必须在 0–1 之间。')
      onApply({ effects: { ...city.effects, fog } })
    }} /><label className="city-check">辉光<input aria-label="启用辉光" type="checkbox" checked={city.effects.bloom} onChange={event => onApply({ effects: { ...city.effects, bloom: event.target.checked } })} /></label></CityPropertyGroup>
    <CityPropertyGroup title="底图与地形" open={false} hint="支持 HTTP(S) 服务或项目相对路径。影像留空使用内置世界影像，地形留空使用椭球地表。"><LivePropertyInput label="影像地址" aria-label="影像模板地址" value={city.basemap?.url ?? ''} spellCheck={false} placeholder="内置世界影像" onCommit={text => resource('basemap', text)} /><LivePropertyInput label="地形地址" aria-label="地形服务地址" value={city.terrain?.url ?? ''} spellCheck={false} placeholder="椭球地表" onCommit={text => resource('terrain', text)} /></CityPropertyGroup>
  </div>
}
