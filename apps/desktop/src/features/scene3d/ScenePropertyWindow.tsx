import { useEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { Alert, Button, Input, InputNumber, Menu, Select, Switch } from 'antd'
import { X } from 'lucide-react'
import { attributeRows, parseAttributeRows } from './graphic-attributes'
import type { AttributeRow, AttributeType } from './graphic-attributes'
import { TilesetEffectsDraft } from './TilesetEffectsDraft'
import { BillboardDraftFields } from './BillboardDraftFields'
import type { CesiumScene, CesiumSceneNode, GeoPosition } from '@desktop-webgis/cesium-scene-schema'
import '@/components/ui/property-window.css'

interface Props {
  initial: CesiumSceneNode
  scene: CesiumScene
  onApply(base: CesiumSceneNode, draft: CesiumSceneNode): void
  onClose(): void
  onPreview?(draft: CesiumSceneNode | null): void
  previewReady?: boolean
}

/** A modeless, object-bound draft; browsing the scene never retargets it. */
export function ScenePropertyWindow({ initial, scene, onApply, onClose, onPreview, previewReady = true }: Props) {
  const [base, setBase] = useState(() => structuredClone(initial))
  const [draft, setDraft] = useState(() => structuredClone(initial))
  const [section, setSection] = useState('object')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const [revision, setRevision] = useState(0)
  const [preview, setPreview] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const previewHandler = useRef(onPreview)
  previewHandler.current = onPreview
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const dirty = JSON.stringify(base) !== JSON.stringify(draft)
  const current = scene.nodes.find(node => node.id === initial.id)
  useEffect(() => {
    if (!preview || !previewReady || !current || JSON.stringify(current) !== JSON.stringify(base)) return
    try { previewHandler.current?.(draft); setPreviewError('') }
    catch (reason) { setPreviewError(reason instanceof Error ? reason.message : '预览失败') }
    return () => { previewHandler.current?.(null) }
  }, [preview, previewReady, draft, current, base])
  function patch(value: Partial<CesiumSceneNode>): void { setDraft(node => Object.fromEntries(Object.entries({ ...node, ...value }).filter(([, item]) => item !== undefined)) as unknown as CesiumSceneNode) }
  function apply(close = false): void {
    if (Object.values(invalid).some(Boolean)) { setError('请先修正无效的字段。'); return }
    try { onApply(base, draft); setBase(structuredClone(draft)); setError(''); if (close) onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '属性无效') }
  }
  function move(event: PointerEvent<HTMLElement>): void {
    if (!drag.current) return
    const height = event.currentTarget.parentElement?.getBoundingClientRect().height ?? 560
    setOffset({ x: Math.max(-window.innerWidth / 2 + 180, Math.min(window.innerWidth / 2 - 180, drag.current.left + event.clientX - drag.current.x)), y: Math.max(0, Math.min(Math.max(0, window.innerHeight - height - 161), drag.current.top + event.clientY - drag.current.y)) })
  }
  const categories = [{ key: 'object', label: '常规与位置' }, { key: 'style', label: '样式与参数' }, ...(draft.type === '3dtiles' ? [{ key: 'effects', label: '裁剪与压平' }] : []), { key: 'properties', label: '数据属性' }, { key: 'popup', label: '属性弹窗' }, { key: 'source', label: '数据源' }]
  function field(label: string, alias: string, control: ReactNode) {
    if (query && !`${label} ${alias}`.toLowerCase().includes(query.toLowerCase())) return null
    return <label className="scene-property-window__field"><span>{label}<small>{alias}</small></span>{control}</label>
  }
  const numeric = (label: string, alias: string, value: number, change: (value: number) => void, min?: number, max?: number) => field(label, alias, <InputNumber aria-label={label} value={value} min={min} max={max} onChange={value => { if (value !== null && Number.isFinite(value)) change(value) }} />)
  const transform = 'transform' in draft ? draft.transform : undefined
  function transformVector(key: 'translation' | 'rotation', index: number, value: number): void {
    if (!transform) return
    const next = structuredClone(transform); next[key][index] = value
    patch({ transform: next } as Partial<CesiumSceneNode>)
  }
  return <section className="scene-property-window" role="dialog" aria-modal="false" aria-label={`完整属性：${initial.name}`} style={{ marginLeft: offset.x, top: 145 + offset.y }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <header onPointerDown={event => {
      if (event.button || (event.target as HTMLElement).closest('button')) return
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, left: offset.x, top: offset.y }
    }} onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      <div><strong>对象属性 · {initial.name}</strong><small>{initial.type} · {initial.id}{dirty ? ' · 未应用' : ''}</small></div>
      <Button type="text" size="small" aria-label="关闭完整属性" icon={<X size={15} />} onClick={onClose} />
    </header>
    <div className="scene-property-window__search"><Input.Search aria-label="搜索属性字段" placeholder="搜索字段名称或 API 名称" value={query} onChange={event => setQuery(event.target.value)} allowClear /></div>
    <div className="scene-property-window__body">
      <Menu selectedKeys={[section]} items={categories} onClick={({ key }) => setSection(key)} />
      <div className="scene-property-window__fields">
        {(!current || error) && <Alert type="error" showIcon title={error || '对象已删除，无法应用草稿。'} />}
        {previewError && <Alert type="warning" title={previewError} />}
        {preview && <p className="editor-help">位置、样式、变换、水面参数和瓦片效果正在预览；取消恢复已应用值。资源替换在应用后加载。</p>}
        {section === 'object' && <>
          {field('对象名称', 'name', <Input aria-label="对象名称" value={draft.name} onChange={event => patch({ name: event.target.value })} />)}
          {field('显示对象', 'visible', <Switch aria-label="显示对象" checked={draft.visible} onChange={visible => patch({ visible })} />)}
          {field('所属文件夹', 'groupId', <Select aria-label="所属文件夹" value={draft.groupId ?? ''} options={[{ value: '', label: '根目录' }, ...(scene.groups ?? []).filter(group => !group.locked).map(group => ({ value: group.id, label: group.name }))]} onChange={groupId => patch({ groupId: groupId || undefined })} />)}
          {draft.type === 'model' && draft.position.map((value, index) => numeric(['经度（°）', '纬度（°）', '椭球高度（m）'][index], `position[${index}]`, value, next => { const position = [...draft.position] as GeoPosition; position[index] = next; patch({ position }) }, index === 0 ? -180 : index === 1 ? -90 : undefined, index === 0 ? 180 : index === 1 ? 90 : undefined))}
          {transform && <>
            {(['translation', 'rotation'] as const).map(key => transform[key].map((value, index) => numeric(`${key === 'translation' ? '平移' : '旋转'} ${['X', 'Y', 'Z'][index]}（${key === 'translation' ? 'm' : '°'}）`, `transform.${key}[${index}]`, value, next => transformVector(key, index, next))))}
            {numeric('等比缩放', 'transform.scale', transform.scale, scale => patch({ transform: { ...transform, scale } } as Partial<CesiumSceneNode>), .001, 10000)}
          </>}
          {draft.type === 'graphic' && <p>几何类型：{draft.geometry.type} · {draft.geometry.positions.length} 个顶点。顶点编辑通过画布中的“编辑顶点”工具进行。</p>}
        </>}
        {section === 'style' && <>
          {draft.type === '3dtiles' && <>{numeric('屏幕误差（px）', 'maximumScreenSpaceError', draft.maximumScreenSpaceError ?? 16, maximumScreenSpaceError => patch({ maximumScreenSpaceError }), 1, 128)}{numeric('缓存预算（MB）', 'cacheBytes', (draft.cacheBytes ?? 268435456) / 1048576, value => patch({ cacheBytes: value * 1048576 }), 1, 4096)}</>}
          {draft.type === 'geojson' && field('颜色', 'color', <Input aria-label="颜色" value={draft.color ?? '#55a6ff'} onChange={event => patch({ color: event.target.value })} />)}
          {draft.type === 'graphic' && <>
            {draft.geometry.type === 'point' && <BillboardDraftFields value={draft.style.billboard} onChange={billboard => { const { billboard: _previous, ...style } = draft.style; patch({ style: billboard ? { ...style, billboard } : style }) }} />}
            {field('颜色', 'style.color', <Input aria-label="颜色" value={draft.style.color} onChange={event => patch({ style: { ...draft.style, color: event.target.value } })} />)}
            {numeric('线宽（px）', 'style.width', draft.style.width, width => patch({ style: { ...draft.style, width } }), 1, 64)}
            {draft.geometry.type === 'point' && !draft.style.billboard && numeric('点大小（px）', 'style.pointSize', draft.style.pointSize, pointSize => patch({ style: { ...draft.style, pointSize } }), 1, 128)}
            {field('标注文字', 'style.label', <Input aria-label="标注文字" value={draft.style.label ?? ''} onChange={event => patch({ style: { ...draft.style, label: event.target.value } })} />)}
            {field('标注字段', 'style.labelField', <Select aria-label="标注字段" value={draft.style.labelField} allowClear options={Object.keys(draft.properties).map(field => ({ value: field, label: field }))} onChange={labelField => { const { labelField: _previous, ...style } = draft.style; patch({ style: labelField ? { ...style, labelField } : style }) }} />)}
          </>}
          {draft.type === 'model' && <p>模型的材质与纹理由 GLB/GLTF 资源定义。</p>}
          {draft.type === 'water' && <>{numeric('水面高度（m）', 'height', draft.height, height => patch({ height }))}{numeric('波幅', 'amplitude', draft.amplitude, amplitude => patch({ amplitude }), 0)}{numeric('频率', 'frequency', draft.frequency, frequency => patch({ frequency }), 0)}{numeric('速度', 'speed', draft.speed, speed => patch({ speed }), 0)}</>}
        </>}
        <div hidden={section !== 'properties'}>{draft.type === 'graphic' ? <AttributeDraft key={`${revision}:properties`} value={draft.properties} onValidity={valid => setInvalid(state => ({ ...state, properties: !valid }))} onChange={properties => patch({ properties } as Partial<CesiumSceneNode>)} /> : <p>此类对象的构件属性由资源提供；在画布中拾取后通过检查器查看。</p>}</div>
        {section === 'popup' && <>
          {field('弹窗标题', 'popup.title', <Input aria-label="弹窗标题" value={draft.popup?.title ?? ''} onChange={event => patch({ popup: { fields: [], ...draft.popup, title: event.target.value } })} />)}
          {field('标题字段', 'popup.titleField', <Input aria-label="标题字段" value={draft.popup?.titleField ?? ''} onChange={event => { const { titleField: _previous, ...popup } = draft.popup ?? { fields: [] }; patch({ popup: event.target.value ? { ...popup, titleField: event.target.value } : popup }) }} />)}
          {(draft.popup?.fields ?? []).map((item, index) => <div className="scene-property-window__attribute" key={index}>
            <Input aria-label={`弹窗字段 ${index + 1}`} placeholder="字段名" value={item.field} onChange={event => patch({ popup: { ...draft.popup, fields: (draft.popup?.fields ?? []).map((field, i) => i === index ? { ...field, field: event.target.value } : field) } })} />
            <Input aria-label={`弹窗字段标签 ${index + 1}`} placeholder="显示名称" value={item.label ?? ''} onChange={event => patch({ popup: { ...draft.popup, fields: (draft.popup?.fields ?? []).map((field, i) => i === index ? { ...field, label: event.target.value } : field) } })} />
            <Button danger aria-label={`删除弹窗字段 ${index + 1}`} onClick={() => patch({ popup: { ...draft.popup, fields: (draft.popup?.fields ?? []).filter((_, i) => i !== index) } })}>删除</Button>
          </div>)}
          <Button onClick={() => patch({ popup: { ...draft.popup, fields: [...(draft.popup?.fields ?? []), { field: 'name', label: '名称' }] } })}>添加弹窗字段</Button>
        </>}
        {section === 'source' && <p>{'asset' in draft ? scene.assets[draft.asset]?.url ?? JSON.stringify(scene.assets[draft.asset]?.reference) : '独立标绘对象，不依赖外部资源。'}</p>}
        {section === 'effects' && draft.type === '3dtiles' && <TilesetEffectsDraft node={draft} onChange={effects => patch({ effects })} />}
      </div>
    </div>
    <footer>{onPreview && <label><Switch aria-label="实时预览" checked={preview} onChange={setPreview} /> 实时预览</label>}<Button disabled={!current} onClick={() => { if (current) { setBase(structuredClone(current)); setDraft(structuredClone(current)); setError(''); setInvalid({}); setRevision(value => value + 1) } }}>重新载入</Button><span /><Button onClick={onClose}>取消</Button><Button disabled={!current || !dirty || Object.values(invalid).some(Boolean)} onClick={() => apply()}>应用</Button><Button type="primary" disabled={!current || Object.values(invalid).some(Boolean)} onClick={() => dirty ? apply(true) : onClose()}>确定</Button></footer>
  </section>
}

function AttributeDraft({ value, onChange, onValidity }: { value: Record<string, unknown>; onChange(value: Record<string, unknown>): void; onValidity(valid: boolean): void }) {
  const [rows, setRows] = useState(() => attributeRows(value))
  const [error, setError] = useState('')
  function update(next: AttributeRow[]): void {
    setRows(next)
    try { onChange(parseAttributeRows(next)); onValidity(true); setError('') }
    catch (reason) { onValidity(false); setError(reason instanceof Error ? reason.message : '属性格式无效') }
  }
  function change(index: number, patch: Partial<AttributeRow>): void { update(rows.map((row, i) => i === index ? { ...row, ...patch } : row)) }
  return <div className="scene-property-window__json">{rows.map((row, index) => <div key={row.id}>
    <div className="scene-property-window__attribute"><Input aria-label={`字段名 ${index + 1}`} value={row.name} placeholder="字段名" onChange={event => change(index, { name: event.target.value })} />
      <Select aria-label={`字段类型 ${index + 1}`} value={row.type} options={['string', 'number', 'boolean', 'null', 'json'].map((value, i) => ({ value, label: ['文本', '数字', '布尔', '空值', 'JSON'][i] }))} onChange={(type: AttributeType) => change(index, { type, value: type === 'boolean' ? 'false' : type === 'null' ? 'null' : row.value })} />
      <Button danger aria-label={`删除字段 ${index + 1}`} onClick={() => update(rows.filter((_, i) => i !== index))}>删除</Button></div>
    <Input aria-label={`字段值 ${index + 1}`} value={row.value} disabled={row.type === 'null'} onChange={event => change(index, { value: event.target.value })} />
  </div>)}{error && <Alert type="error" title={error} />}<Button onClick={() => update([...rows, { id: crypto.randomUUID(), name: '', type: 'string', value: '' }])}>添加属性</Button></div>
}
