import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Input, InputNumber, Select, Switch } from 'antd'
import { isSceneResourceUrl } from '@desktop-webgis/cesium-scene-schema'
import type { CesiumSceneGroup, CesiumSceneNode, CesiumScene, GeoPosition, GraphicNode, PopupDefinition, TilesetClipEffect, TilesetFlattenEffect, TilesetNode, Transform, WaterNode } from '@desktop-webgis/cesium-scene-schema'
import { GraphicAttributes } from './GraphicAttributes'
import { SceneRenderSettings } from './SceneRenderSettings'
import { SceneInfo, ScenePropertyGroup } from './ScenePropertyGroup'
import { LivePropertyInput } from './LivePropertyInput'

export type SceneInspectorSection = 'object' | 'popup' | 'source' | 'style' | 'properties'

interface SceneInspectorProps {
  node: CesiumSceneNode
  section?: SceneInspectorSection
  pickedProperties?: Record<string, unknown>
  assetUrl?: string
  error?: string
  onPatch(patch: Partial<CesiumSceneNode>, label?: string): void
  onResource(url: string): void
  onReload(): void
  onDrawBoundary(): void
  onDrawClip(effectId?: string): void
  onDrawFlatten(effectId?: string): void
  onEditGeometry(): void
  geometryDisabled?: boolean
  groups?: CesiumSceneGroup[]
  onMoveGroup(groupId?: string): void
  onDelete(): void
}

export function SceneInspector({ node, section = 'object', pickedProperties = {}, assetUrl, error, onPatch, onResource, onReload, onDrawBoundary, onDrawClip, onDrawFlatten, onEditGeometry, geometryDisabled, groups, onMoveGroup, onDelete }: SceneInspectorProps) {
  const properties = node.type === 'graphic' ? { name: node.name, ...node.properties } : pickedProperties
  return <fieldset className="scene3d-properties scene3d-properties--fields" disabled={node.locked}>
    <section className="scene3d-property-section">
      <label className="editor-field">对象名称<input key={`${node.id}:${node.name}`} name="object-name" defaultValue={node.name} onBlur={event => { if (event.target.value.trim()) onPatch({ name: event.target.value.trim() }, '重命名三维对象'); else event.target.value = node.name }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = node.name; event.currentTarget.blur() } }} /></label>
      <span className="scene3d-type-label">{node.type === '3dtiles' ? '3D Tiles' : node.type === 'model' ? 'GLB 模型' : node.type === 'geojson' ? 'GeoJSON' : node.type === 'graphic' ? `标绘 · ${node.geometry.type}` : '水面'}{node.locked ? ' · 已锁定' : ''}</span>
    </section>
    {section === 'object' && <section className="scene3d-property-section"><label className="editor-field">所属分组<select value={node.groupId ?? ''} onChange={event => onMoveGroup(event.target.value || undefined)}><option value="">未分组</option>{groups?.map(group => <option key={group.id} value={group.id} disabled={group.locked}>{group.name}{group.locked ? '（已锁定）' : ''}</option>)}</select></label></section>}
    {error && <section className="scene3d-property-section"><p className="editor-error" role="alert">{error}</p><button className="button-secondary" onClick={onReload}>重试加载</button></section>}
    {section === 'object' && node.type === 'model' && <PositionFields key={`${node.id}:${JSON.stringify(node.position)}`} position={node.position} onApply={position => onPatch({ position } as Partial<CesiumSceneNode>, '设置模型地理位置')} />}
    {section === 'object' && (node.type === 'model' || node.type === '3dtiles') && <TransformFields key={node.id} transform={node.transform} onApply={transform => onPatch({ transform } as Partial<CesiumSceneNode>, '输入模型变换')} />}
    {section === 'object' && node.type === '3dtiles' && <ScenePropertyGroup title="瓦片质量" hint="屏幕误差越小，模型越精细，加载开销越大。缓存预算不是显存硬上限；可见瓦片可能超出预算。设置随项目保存，可撤销。">
      <label className="editor-field">屏幕误差<select value={node.maximumScreenSpaceError ?? 16} onChange={event => onPatch({ maximumScreenSpaceError: Number(event.target.value) } as Partial<CesiumSceneNode>, '设置瓦片显示精度')}>{[1,2,4,8,16,32].map(value => <option key={value} value={value}>{value}{value === 1 ? ' · 最精细' : value === 16 ? ' · 默认' : value === 32 ? ' · 更流畅' : ''}</option>)}</select></label>
      <label className="editor-field">缓存预算<select value={node.cacheBytes ?? 256 * 1024 * 1024} onChange={event => onPatch({ cacheBytes: Number(event.target.value) } as Partial<CesiumSceneNode>, '设置瓦片缓存预算')}>{[128,256,512,1024].map(value => <option key={value} value={value * 1024 * 1024}>{value} MB</option>)}</select></label>
    </ScenePropertyGroup>}
    {section === 'object' && node.type === '3dtiles' && <TilesetClippingFields key={`${node.id}:${JSON.stringify(node.effects)}`} node={node} disabled={!!node.locked} onPatch={onPatch} onDraw={onDrawClip} />}
    {section === 'object' && node.type === '3dtiles' && <TilesetFlattenFields key={`${node.id}:flatten:${JSON.stringify(node.effects)}`} node={node} disabled={!!node.locked} onPatch={onPatch} onDraw={onDrawFlatten} />}
    {section === 'object' && node.type === 'water' && <WaterFields key={`${node.id}:${JSON.stringify(node)}`} node={node} onApply={patch => onPatch(patch, '修改水面材质')} onDrawBoundary={onDrawBoundary} />}
    {section === 'object' && node.type === 'graphic' && <section className="scene3d-property-section"><h3>几何</h3><p className="editor-help">{node.geometry.positions.length} 个顶点 · {node.geometry.heightMode === 'ground' ? '贴地' : '绝对高度'}</p><button className="button-secondary" disabled={geometryDisabled} onClick={onEditGeometry}>编辑顶点与坐标</button></section>}
    {node.type === 'graphic' && (section === 'style' || section === 'object') && <GraphicFields key={`${node.id}:${JSON.stringify(node.style)}`} node={node} onPatch={onPatch} />}
    {node.type === 'geojson' && section === 'style' && <section className="scene3d-property-section"><h3>矢量样式</h3><label className="editor-field">颜色<input type="color" value={node.color ?? '#55a6ff'} onChange={event => onPatch({ color: event.target.value }, '设置矢量颜色')} /></label></section>}
    {node.type === 'graphic' && section === 'properties' && <GraphicAttributes key={`${node.id}:${JSON.stringify(node.properties)}`} node={node} onApply={properties => onPatch({ properties }, '设置图形属性')} />}
    {section === 'properties' && node.type !== 'graphic' && <section className="scene3d-property-section"><h3>拾取对象属性</h3>{Object.keys(properties).length ? <dl className="scene3d-attribute-list">{Object.entries(properties).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{displayValue(value)}</dd></div>)}</dl> : <p className="editor-help">在三维视图中单击构件，查看实际属性。</p>}</section>}
    <PopupFields properties={properties} open={section === 'popup'} key={`${node.id}:${JSON.stringify(node.popup)}`} node={node} onApply={popup => onPatch({ popup }, '设置属性弹窗')} />
    {assetUrl && <ResourceFields open={section === 'source'} key={`${node.id}:${assetUrl}`} url={assetUrl} onApply={onResource} onReload={onReload} />}
    <section className="scene3d-property-section scene3d-object-actions"><button className="scene3d-danger-action" onClick={onDelete}><Trash2 size={14} aria-hidden="true" />删除对象</button><SceneInfo label="删除对象">删除后可撤销恢复。</SceneInfo></section>
  </fieldset>
}

function TilesetClippingFields({ node, disabled, onPatch, onDraw }: { node: TilesetNode; disabled: boolean; onPatch: SceneInspectorProps['onPatch']; onDraw(effectId?: string): void }) {
  const effects = (node.effects ?? []).filter((effect): effect is TilesetClipEffect => effect.kind === 'clip-polygon')
  function update(id: string, patch: Partial<TilesetClipEffect>, label: string): void {
    onPatch({ effects: (node.effects ?? []).map(effect => effect.kind === 'clip-polygon' && (patch.mode !== undefined || effect.id === id) ? { ...effect, ...patch } : effect) } as Partial<CesiumSceneNode>, label)
  }
  function remove(id: string): void {
    onPatch({ effects: (node.effects ?? []).filter(effect => effect.id !== id) } as Partial<CesiumSceneNode>, '删除裁剪范围')
  }
  return <ScenePropertyGroup title="多边形裁剪" hint="基于 WGS84 坐标使用 Cesium 原生多边形裁剪。一个对象可包含多个范围；同一对象的范围使用统一的保留模式。">
    <div className="scene3d-clip-toolbar"><span>{effects.length ? `${effects.length} 个范围` : '尚未添加范围'}</span><Button type="primary" size="small" icon={<Plus size={13} />} disabled={disabled} onClick={() => onDraw()}>绘制范围</Button></div>
    {effects.map((effect, index) => <ClipEffectEditor key={effect.id} effect={effect} index={index} disabled={disabled} onUpdate={(patch, label) => update(effect.id, patch, label)} onRedraw={() => onDraw(effect.id)} onRemove={() => remove(effect.id)} />)}
  </ScenePropertyGroup>
}

function TilesetFlattenFields({ node, disabled, onPatch, onDraw }: { node: TilesetNode; disabled: boolean; onPatch: SceneInspectorProps['onPatch']; onDraw(effectId?: string): void }) {
  const effects = (node.effects ?? []).filter((effect): effect is TilesetFlattenEffect => effect.kind === 'flatten-polygon')
  function update(id: string, patch: Partial<TilesetFlattenEffect>, label: string): void {
    onPatch({ effects: (node.effects ?? []).map(effect => effect.id === id && effect.kind === 'flatten-polygon' ? { ...effect, ...patch } : effect) } as Partial<CesiumSceneNode>, label)
  }
  function remove(id: string): void { onPatch({ effects: (node.effects ?? []).filter(effect => effect.id !== id) } as Partial<CesiumSceneNode>, '删除压平范围') }
  return <ScenePropertyGroup title="局部压平" hint="使用局部 ENU 遮罩与 Tileset CustomShader。目标值为范围中心处的 WGS84 椭球高程；单个效果集合最大跨度 5 km，纹理受 GPU 上限约束。">
    <div className="scene3d-clip-toolbar"><span>{effects.length ? `${effects.length} 个范围` : '尚未添加范围'}</span><Button type="primary" size="small" icon={<Plus size={13} />} disabled={disabled} onClick={() => onDraw()}>绘制范围</Button></div>
    {effects.map((effect, index) => <FlattenEffectEditor key={effect.id} effect={effect} index={index} disabled={disabled} onUpdate={(patch, label) => update(effect.id, patch, label)} onRedraw={() => onDraw(effect.id)} onRemove={() => remove(effect.id)} />)}
  </ScenePropertyGroup>
}

function FlattenEffectEditor({ effect, index, disabled, onUpdate, onRedraw, onRemove }: { effect: TilesetFlattenEffect; index: number; disabled: boolean; onUpdate(patch: Partial<TilesetFlattenEffect>, label: string): void; onRedraw(): void; onRemove(): void }) {
  const [coordinates, setCoordinates] = useState(JSON.stringify(effect.positions)), [error, setError] = useState('')
  function applyCoordinates(): void {
    try {
      const parsed: unknown = JSON.parse(coordinates)
      if (!Array.isArray(parsed) || parsed.length < 3 || !parsed.every(item => Array.isArray(item) && item.length === 3 && item.every(Number.isFinite))) throw new Error('至少输入三个 [经度, 纬度, 高度] 坐标。')
      onUpdate({ positions: parsed as GeoPosition[] }, '编辑压平控制点'); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '坐标格式无效') }
  }
  return <details className="scene3d-clip-effect" open={index === 0}>
    <summary><span>范围 {index + 1} · {effect.positions.length} 个控制点</span><Switch size="small" checked={effect.enabled} disabled={disabled} aria-label={`启用压平范围 ${index + 1}`} onClick={(_, event) => event.stopPropagation()} onChange={enabled => onUpdate({ enabled }, enabled ? '启用压平范围' : '停用压平范围')} /></summary>
    <div className="scene3d-clip-effect__body">
      <label className="editor-field">目标高程<InputNumber size="small" value={effect.height} disabled={disabled} step="any" addonAfter="m" aria-label={`压平目标高程 ${index + 1}`} onChange={height => { if (height !== null && Number.isFinite(height)) onUpdate({ height: Object.is(height, -0) ? 0 : height }, '设置压平目标高程') }} /></label>
      <label className="scene3d-clip-coordinates">控制点坐标<Input.TextArea value={coordinates} disabled={disabled} autoSize={{ minRows: 3, maxRows: 6 }} spellCheck={false} onChange={event => setCoordinates(event.target.value)} /></label>
      {error && <p className="editor-error" role="alert">{error}</p>}
      <div className="scene3d-form-actions"><Button size="small" disabled={disabled} onClick={applyCoordinates}>应用坐标</Button><Button size="small" disabled={disabled} onClick={onRedraw}>重新绘制</Button><Button size="small" danger icon={<Trash2 size={13} />} disabled={disabled} onClick={onRemove}>删除</Button></div>
    </div>
  </details>
}

function ClipEffectEditor({ effect, index, disabled, onUpdate, onRedraw, onRemove }: { effect: TilesetClipEffect; index: number; disabled: boolean; onUpdate(patch: Partial<TilesetClipEffect>, label: string): void; onRedraw(): void; onRemove(): void }) {
  const [coordinates, setCoordinates] = useState(JSON.stringify(effect.positions))
  const [error, setError] = useState('')
  function applyCoordinates(): void {
    try {
      const parsed: unknown = JSON.parse(coordinates)
      if (!Array.isArray(parsed) || parsed.length < 3 || !parsed.every(item => Array.isArray(item) && item.length === 3 && item.every(Number.isFinite))) throw new Error('至少输入三个 [经度, 纬度, 高度] 坐标。')
      onUpdate({ positions: parsed as GeoPosition[] }, '编辑裁剪控制点'); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '坐标格式无效') }
  }
  return <details className="scene3d-clip-effect" open={index === 0}>
    <summary><span>范围 {index + 1} · {effect.positions.length} 个控制点</span><Switch size="small" checked={effect.enabled} disabled={disabled} aria-label={`启用裁剪范围 ${index + 1}`} onClick={(_, event) => event.stopPropagation()} onChange={enabled => onUpdate({ enabled }, enabled ? '启用裁剪范围' : '停用裁剪范围')} /></summary>
    <div className="scene3d-clip-effect__body">
      <label className="editor-field">保留区域<Select size="small" value={effect.mode} disabled={disabled} options={[{ value: 'keep-inside', label: '范围内部' }, { value: 'keep-outside', label: '范围外部' }]} onChange={mode => onUpdate({ mode }, '设置裁剪模式')} /></label>
      <label className="scene3d-clip-coordinates">控制点坐标<Input.TextArea value={coordinates} disabled={disabled} autoSize={{ minRows: 3, maxRows: 6 }} spellCheck={false} onChange={event => setCoordinates(event.target.value)} /></label>
      {error && <p className="editor-error" role="alert">{error}</p>}
      <div className="scene3d-form-actions"><Button size="small" disabled={disabled} onClick={applyCoordinates}>应用坐标</Button><Button size="small" disabled={disabled} onClick={onRedraw}>重新绘制</Button><Button size="small" danger icon={<Trash2 size={13} />} disabled={disabled} onClick={onRemove}>删除</Button></div>
    </div>
  </details>
}

function GraphicFields({ node, onPatch }: { node: GraphicNode; onPatch: SceneInspectorProps['onPatch'] }) {
  const [style, setStyle] = useState(node.style)
  const [error, setError] = useState('')
  return <form className="scene3d-property-section" onSubmit={event => { event.preventDefault(); try { onPatch({ style }, '设置图形样式'); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '样式无效') } }}>
    <h3>样式与标注<SceneInfo label="图形标注">标注可使用固定文字或属性字段；文本、数字和布尔属性变化时自动更新。</SceneInfo></h3>
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
  return <section className="scene3d-property-section">
    <h3>变换<SceneInfo label="模型变换">平移单位为米，相对模型原始位置；旋转单位为度。有效输入稍作停顿即生效，Enter 或离开输入框可立即确认；修改可撤销。</SceneInfo></h3>
    {(['translation','rotation'] as const).map(field => <div key={field} className="scene3d-axis-fields"><span className="scene3d-axis-title">{field === 'translation' ? '平移 (m)' : '旋转 (°)'}</span><div className="scene3d-triple">{(field === 'translation' ? ['东向','北向','高度'] : ['航向','俯仰','翻滚']).map((label, i) => <LivePropertyInput key={label} label={label[0]} aria-label={label} title={String(transform[field][i])} type="number" step="any" required value={String(transform[field][i])} onCommit={text => {
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
  return <form className="scene3d-property-section" onSubmit={event => { event.preventDefault(); try { onApply(draft.map(Number) as GeoPosition); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '位置无效') } }}>
    <h3>地理位置<SceneInfo label="地理位置">WGS84 经纬度，高度为椭球高度，单位为米。</SceneInfo></h3><div className="scene3d-position-fields">{['经度','纬度','高度（米）'].map((label,i) => <label className="editor-field" key={label}>{label}<input type="number" step="any" min={i === 0 ? -180 : i === 1 ? -90 : undefined} max={i === 0 ? 180 : i === 1 ? 90 : undefined} required value={draft[i]} onChange={event => setDraft(draft.map((value,index) => i === index ? event.target.value : value))} /></label>)}</div>
    {error && <p className="editor-error" role="alert">{error}</p>}<button className="button-secondary" type="submit">应用位置</button>
  </form>
}

function WaterFields({ node, onApply, onDrawBoundary }: { node: WaterNode; onApply(value: Partial<WaterNode>): void; onDrawBoundary(): void }) {
  const [draft, setDraft] = useState({ height: String(node.height), amplitude: String(node.amplitude), frequency: String(node.frequency), speed: String(node.speed), color: node.color.slice(0,7) })
  const [boundary, setBoundary] = useState(JSON.stringify(node.boundary))
  const [error, setError] = useState('')
  return <form className="scene3d-property-section" onSubmit={event => { event.preventDefault(); setError(''); try { const parsed: unknown = JSON.parse(boundary); if (!Array.isArray(parsed)) throw new Error('边界须为坐标数组'); onApply({ height: Number(draft.height), amplitude: Number(draft.amplitude), frequency: Number(draft.frequency), speed: Number(draft.speed), color: `${draft.color}${node.color.length === 9 ? node.color.slice(7) : 'cc'}`, boundary: parsed }) } catch (reason) { setError(reason instanceof Error ? reason.message : '材质参数无效') } }}>
    <h3>水面</h3><div className="scene3d-boundary-summary"><span>{node.boundary.length} 个边界顶点</span><button type="button" className="button-secondary" onClick={onDrawBoundary}>重新绘制边界</button></div>
    <div className="scene3d-pair-fields">{(['height','amplitude','frequency','speed'] as const).map((field,i) => <label key={field}>{['水位（米）','波幅','波纹频率','流动速度'][i]}<input type="number" step="any" min={field === 'height' || field === 'speed' ? undefined : 0} required value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></label>)}</div>
    <label className="editor-field scene3d-color-field">水面颜色<input type="color" value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value })} /></label>
    <details className="scene3d-advanced"><summary>高级：精确边界坐标</summary><label className="editor-field">WGS84 坐标数组<textarea value={boundary} spellCheck={false} onChange={event => setBoundary(event.target.value)} /></label></details>
    {error && <p className="editor-error" role="alert">{error}</p>}<button type="submit" className="button-primary">应用材质</button>
  </form>
}

function displayValue(value: unknown): string { return value === undefined ? '—' : value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value) }

function PopupFields({ node, properties, open, onApply }: { node: CesiumSceneNode; properties: Record<string, unknown>; open?: boolean; onApply(value: PopupDefinition | undefined): void }) {
  const [title, setTitle] = useState(node.popup?.title ?? node.name)
  const [titleField, setTitleField] = useState(node.popup?.titleField ?? '')
  const [fields, setFields] = useState(node.popup?.fields ?? [])
  const [error, setError] = useState('')
  return <details open={open || undefined} className="scene3d-property-section scene3d-advanced"><summary>属性弹窗 <span>{fields.length ? `${fields.length} 个字段` : '未设置'}</span></summary>
    <form onSubmit={event => { event.preventDefault(); try { const valid = fields.filter(field => field.field.trim()).map(field => ({ field: field.field.trim(), label: field.label?.trim() || field.field.trim() })); onApply(valid.length ? { title, titleField: titleField.trim() || undefined, fields: valid } : undefined); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '弹窗设置无效') } }}>
      <label className="editor-field">弹窗标题<input value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label className="editor-field">标题属性<input value={titleField} placeholder="留空使用固定标题" onChange={event => setTitleField(event.target.value)} /></label>
      {fields.map((field,i) => <div className="scene3d-popup-field" key={i}><label>属性字段<input aria-label={`属性字段 ${i+1}`} value={field.field} placeholder="name" onChange={event => setFields(fields.map((value,index) => i === index ? { ...value, field: event.target.value } : value))} /></label><label>显示名称<input aria-label={`字段显示名称 ${i+1}`} value={field.label ?? ''} placeholder="名称" onChange={event => setFields(fields.map((value,index) => i === index ? { ...value, label: event.target.value } : value))} /></label><button type="button" aria-label={`移除字段 ${i+1}`} onClick={() => setFields(fields.filter((_,index) => i !== index))}><Trash2 size={14} aria-hidden="true" /></button></div>)}
      <div className="scene3d-form-actions"><button className="scene3d-text-action" type="button" onClick={() => setFields([...fields,{ field: '', label: '' }])}><Plus size={14} aria-hidden="true" />添加字段</button><SceneInfo label="弹窗字段">字段名须与资源属性一致；留空并应用可关闭弹窗。</SceneInfo></div>
      {Object.keys(properties).length > 0 && <div className="scene3d-popup-preview"><strong>{titleField && properties[titleField] !== undefined ? displayValue(properties[titleField]) : title}</strong><dl className="scene3d-attribute-list">{fields.filter(field => field.field.trim()).map((field,index) => <div key={index}><dt>{field.label || field.field}</dt><dd>{displayValue(properties[field.field])}</dd></div>)}</dl></div>}
      {error && <p role="alert" className="editor-error">{error}</p>}<button type="submit" className="button-secondary">应用弹窗</button>
    </form>
  </details>
}

function ResourceFields({ url, open, onApply, onReload }: { url: string; open?: boolean; onApply(url: string): void; onReload(): void }) {
  const [draft, setDraft] = useState(url)
  const [error, setError] = useState('')
  return <details open={open || undefined} className="scene3d-property-section scene3d-advanced"><summary>数据源</summary><form onSubmit={event => { event.preventDefault(); if (!isSceneResourceUrl(draft.trim())) { setError('请输入有效的 HTTP(S) 地址或项目相对路径。'); return }; try { onApply(draft.trim()); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '数据源无效') } }}><label className="editor-field">资源地址<input value={draft} autoComplete="off" spellCheck={false} onChange={event => setDraft(event.target.value)} /></label>{error && <p role="alert" className="editor-error">{error}</p>}<div className="scene3d-form-actions"><button className="button-secondary" type="submit">更新地址</button><button className="scene3d-text-action" type="button" onClick={onReload}>重新加载</button></div></form></details>
}

interface SceneSettingsProps { scene: CesiumScene; onApply(value: Partial<Pick<CesiumScene,'effects'|'basemap'|'terrain'|'lighting'>>): void; onSaveCamera(): void }

export function SceneSettings({ scene, onApply, onSaveCamera }: SceneSettingsProps) {
  const [initialTime] = useState(() => new Date().toISOString())
  const lighting = scene.lighting ?? { sunlight: false, shadows: false, time: initialTime }
  function resource(type: 'basemap' | 'terrain', text: string): void {
    const url = text.trim()
    if (url && !isSceneResourceUrl(url)) throw new Error('请输入有效的 HTTP(S) 地址或项目相对路径。')
    onApply({ [type]: url ? { url } : undefined })
  }
  return <div className="scene3d-properties">
    <SceneRenderSettings />
    <section className="scene3d-property-section scene3d-property-row"><span>初始视角</span><button className="button-secondary" onClick={onSaveCamera}>使用当前视角</button><SceneInfo label="初始视角">场景打开时使用保存的初始视角。</SceneInfo></section>
    <ScenePropertyGroup title="光照与时间"><label className="scene3d-check">太阳光照<input type="checkbox" checked={lighting.sunlight} onChange={event => onApply({ lighting: { ...lighting, sunlight: event.target.checked } })} /></label><label className="scene3d-check">模型阴影<input type="checkbox" checked={lighting.shadows} onChange={event => onApply({ lighting: { ...lighting, shadows: event.target.checked } })} /></label><LivePropertyInput label="时间 (UTC)" aria-label="场景时间（UTC）" type="datetime-local" required value={new Date(lighting.time).toISOString().slice(0,16)} onCommit={text => {
      const date = new Date(text + 'Z')
      if (!text || !Number.isFinite(date.getTime())) throw new Error('请输入完整有效的 UTC 时间。')
      onApply({ lighting: { ...lighting, time: date.toISOString() } })
    }} /></ScenePropertyGroup>
    <ScenePropertyGroup title="环境效果" open={false}><LivePropertyInput label="雾浓度" type="number" min="0" max="1" step=".01" required value={String(scene.effects.fog)} onCommit={text => {
      const fog = Number(text)
      if (!text.trim() || !Number.isFinite(fog) || fog < 0 || fog > 1) throw new Error('雾浓度必须在 0–1 之间。')
      onApply({ effects: { ...scene.effects, fog } })
    }} /><label className="scene3d-check">辉光<input aria-label="启用辉光" type="checkbox" checked={scene.effects.bloom} onChange={event => onApply({ effects: { ...scene.effects, bloom: event.target.checked } })} /></label></ScenePropertyGroup>
    <ScenePropertyGroup title="底图与地形" open={false} hint="支持 HTTP(S) 服务或项目相对路径。影像留空使用内置世界影像，地形留空使用椭球地表。"><LivePropertyInput label="影像地址" aria-label="影像模板地址" value={scene.basemap?.url ?? ''} spellCheck={false} placeholder="内置世界影像" onCommit={text => resource('basemap', text)} /><LivePropertyInput label="地形地址" aria-label="地形服务地址" value={scene.terrain?.url ?? ''} spellCheck={false} placeholder="椭球地表" onCommit={text => resource('terrain', text)} /></ScenePropertyGroup>
  </div>
}
