import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, ColorPicker, Input, InputNumber, Select, Switch } from 'antd'
import { ApplyProjectSnapshotEditCommand, createId, findGroupForLayer, getLayerGroupState, isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'
import type { Layer } from '@desktop-webgis/gis-core'
import { cloneSymbolWithColor, colorToString, symbolPrimaryColor } from '@desktop-webgis/ol-style'
import type { LayerStyle, Symbol } from '@desktop-webgis/ol-style'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { PropertyWindow } from '@/components/ui/PropertyWindow'
import { propertyWindowEvent } from './property-window-request'
import type { PropertyWindowRequest } from './property-window-request'
import { FolderPropertyWindow } from './FolderPropertyWindow'
import { createMapPropertyPreview } from '@/features/map/map-runtime-host'
import { PopupDraftFields } from './PopupDraftFields'
import { CRS_PRESETS } from '@desktop-webgis/vector-io'
import { assignSourceCrs } from './source-crs'

/** Host captures a target and epoch at the explicit open action, never at selection changes. */
export function LayerPropertyWindowHost() {
  const epoch = useProjectStore(state => state.projectEpoch)
  const [target, setTarget] = useState<{ kind: 'layer' | 'folder'; id: string; epoch: number; revision: number } | null>(null)
  useEffect(() => {
    const open = (event: Event) => { const request = (event as CustomEvent<PropertyWindowRequest>).detail; setTarget({ ...request, epoch: useProjectStore.getState().projectEpoch, revision: Date.now() }) }
    window.addEventListener(propertyWindowEvent, open)
    return () => window.removeEventListener(propertyWindowEvent, open)
  }, [])
  if (!target || target.epoch !== epoch) return null
  const key = `${target.epoch}:${target.id}:${target.revision}`
  return target.kind === 'folder' ? <FolderPropertyWindow key={key} id={target.id} onClose={() => setTarget(null)} /> : <LayerPropertyWindow key={key} id={target.id} onClose={() => setTarget(null)} />
}

function LayerPropertyWindow({ id, onClose }: { id: string; onClose(): void }) {
  const project = useProjectStore(state => state.project)
  const epoch = useState(() => useProjectStore.getState().projectEpoch)[0]
  const current = project.layers.find(layer => layer.id === id)
  const title = useState(() => current?.name ?? id)[0]
  const [base, setBase] = useState(() => structuredClone(current))
  const [draft, setDraft] = useState(() => structuredClone(current))
  const [baseDataset, setBaseDataset] = useState(() => structuredClone(project.datasets.find(dataset => dataset.id === current?.datasetId)))
  const [sourceCrs, setSourceCrs] = useState(() => baseDataset?.kind === 'vector' ? baseDataset.sourceCrs ?? '' : '')
  const [section, setSection] = useState('general'), [query, setQuery] = useState(''), [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  useEffect(() => {
    if (!preview || !base || !draft || JSON.stringify(current) !== JSON.stringify(base)) return
    const session = createMapPropertyPreview(base, epoch)
    try { session.update(draft) } catch { session.dispose() }
    return () => session.dispose()
  }, [preview, base, draft, current, epoch])
  if (!base || !draft) return null
  const dataset = project.datasets.find(dataset => dataset.id === draft.datasetId)
  const vector = dataset?.kind === 'vector' || dataset?.kind === 'wfs'
  const style = isLegacyStyle(draft.style) ? migrateLegacyStyle(draft.style) : draft.style
  const crsDirty = baseDataset?.kind === 'vector' && sourceCrs !== (baseDataset.sourceCrs ?? '')
  const dirty = JSON.stringify(base) !== JSON.stringify(draft) || crsDirty
  const patch = (patch: Partial<Layer>) => setDraft({ ...draft, ...patch })
  const setStyle = (style: LayerStyle) => patch({ style })
  function field(label: string, alias: string, control: ReactNode) {
    if (query && !`${label} ${alias}`.toLowerCase().includes(query.toLowerCase())) return null
    return <label className="scene-property-window__field"><span>{label}<small>{alias}</small></span>{control}</label>
  }
  function apply(close = false): void {
    try {
      const store = useProjectStore.getState(), snapshot = store.getSnapshot()
      const live = snapshot.project.layers.find(layer => layer.id === id)
      if (store.projectEpoch !== epoch) throw new Error('项目已切换，请重新打开窗口。')
      if (!live) throw new Error('图层已删除。')
      if (JSON.stringify(live) !== JSON.stringify(base)) throw new Error('图层已被其他操作修改，请重新载入。')
      if (getLayerGroupState(snapshot.project, findGroupForLayer(snapshot.project, id)?.id).locked) throw new Error('所属文件夹已锁定。')
      if (useSessionStore.getState().sessions[id]?.styleDraft?.dirty) throw new Error('请先应用或放弃检查器中的样式草稿。')
      if (!draft?.name.trim()) throw new Error('请输入图层名称。')
      if (!Number.isFinite(draft.opacity) || draft.opacity < 0 || draft.opacity > 1) throw new Error('不透明度必须在 0–100% 之间。')
      if (draft.minZoom !== undefined && draft.maxZoom !== undefined && draft.minZoom > draft.maxZoom) throw new Error('最小缩放不能大于最大缩放。')
      const after = crsDirty && baseDataset?.kind === 'vector' ? assignSourceCrs(snapshot, baseDataset, sourceCrs) : structuredClone(snapshot)
      after.project.layers = after.project.layers.map(layer => layer.id === id ? structuredClone(draft) : layer)
      if (dirty) store.executeEditCommand(new ApplyProjectSnapshotEditCommand(createId('cmd'), '应用完整图层属性', snapshot, after))
      setBase(structuredClone(draft)); setBaseDataset(structuredClone(after.project.datasets.find(dataset => dataset.id === draft.datasetId))); setError(''); if (close) onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '属性无效') }
  }
  const symbol = style.mode === 'single' ? style.symbol : style.fallback
  const setSymbol = (symbol: Symbol) => setStyle(style.mode === 'single' ? { ...style, symbol } : { ...style, fallback: symbol })
  const popupFields = [...new Set([...(dataset?.fields?.map(field => field.name) ?? []), ...(useProjectStore.getState().featuresByDataset[draft.datasetId] ?? []).slice(0, 100).flatMap(feature => Object.keys(feature.properties))])]
  function reload(): void {
    setBase(structuredClone(current)); setDraft(structuredClone(current))
    setBaseDataset(structuredClone(dataset)); setSourceCrs(dataset?.kind === 'vector' ? dataset.sourceCrs ?? '' : ''); setError('')
  }
  return <PropertyWindow title={`完整属性：${title}`} subtitle={`图层 · ${id}`} dirty={dirty} categories={[{ key: 'general', label: '常规与显示' }, { key: 'style', label: '样式' }, { key: 'label', label: '标注' }, { key: 'popup', label: '属性弹窗' }, { key: 'source', label: '数据源' }]} section={section} onSection={setSection} query={query} onQuery={setQuery} onClose={onClose} footer={<><label><Switch aria-label="实时预览" checked={preview} onChange={setPreview} /> 实时预览</label><Button disabled={!current} onClick={reload}>重新载入</Button><span /><Button onClick={onClose}>取消</Button><Button disabled={!current || !dirty} onClick={() => apply()}>应用</Button><Button type="primary" disabled={!current} onClick={() => apply(true)}>确定</Button></>}>
    {(!current || error) && <Alert type="error" title={error || '图层已删除，无法应用。'} />}
    {section === 'general' && <>
      {field('图层名称', 'name', <Input aria-label="图层名称" value={draft.name} onChange={event => patch({ name: event.target.value })} />)}
      {field('显示图层', 'visible', <Switch aria-label="显示图层" checked={draft.visible} onChange={visible => patch({ visible })} />)}
      {field('不透明度（%）', 'opacity', <InputNumber aria-label="不透明度" value={draft.opacity * 100} min={0} max={100} onChange={value => { if (value !== null) patch({ opacity: value / 100 }) }} />)}
      {field('最小缩放', 'minZoom', <InputNumber aria-label="最小缩放" value={draft.minZoom} min={0} max={30} onChange={value => patch({ minZoom: value ?? undefined })} />)}
      {field('最大缩放', 'maxZoom', <InputNumber aria-label="最大缩放" value={draft.maxZoom} min={0} max={30} onChange={value => patch({ maxZoom: value ?? undefined })} />)}
      {vector && field('地图可选择', 'interaction.selectable', <Switch aria-label="地图可选择" checked={draft.interaction?.selectable !== false} onChange={selectable => patch({ interaction: { ...draft.interaction, selectable } })} />)}
    </>}
    {section === 'style' && (vector ? <>
      <p>当前模式：{style.mode === 'single' ? '单一符号' : style.mode === 'categorized' ? '分类' : '分级'}；专题配置随图层保留。</p>
      {field(style.mode === 'single' ? '符号颜色' : '默认符号颜色', 'symbol.color', <ColorPicker aria-label="符号颜色" value={colorToString(symbolPrimaryColor(symbol))} showText onChange={color => { const rgb = color.toRgb(); setSymbol(cloneSymbolWithColor(symbol, { r: rgb.r, g: rgb.g, b: rgb.b, a: rgb.a })) }} />)}
      {symbol.type === 'circle' && field('点半径（px）', 'symbol.radius', <InputNumber min={1} max={128} value={symbol.radius} onChange={radius => { if (radius !== null) setSymbol({ ...symbol, radius }) }} />)}
      {symbol.type === 'solid' && 'width' in symbol && field('线宽（px）', 'symbol.width', <InputNumber min={1} max={64} value={symbol.width} onChange={width => { if (width !== null) setSymbol({ ...symbol, width }) }} />)}
      {style.mode === 'categorized' && style.categories.map((category, index) => field(category.label ?? String(category.value), `categories[${index}].symbol`, <ColorPicker value={colorToString(symbolPrimaryColor(category.symbol))} showText onChange={color => { const rgb = color.toRgb(); setStyle({ ...style, categories: style.categories.map((item, i) => i === index ? { ...item, symbol: cloneSymbolWithColor(item.symbol, { r: rgb.r, g: rgb.g, b: rgb.b, a: rgb.a }) } : item) }) }} />))}
      {style.mode === 'graduated' && style.breaks.map((item, index) => field(item.label ?? String(item.value), `breaks[${index}].symbol`, <ColorPicker value={colorToString(symbolPrimaryColor(item.symbol))} showText onChange={color => { const rgb = color.toRgb(); setStyle({ ...style, breaks: style.breaks.map((item, i) => i === index ? { ...item, symbol: cloneSymbolWithColor(item.symbol, { r: rgb.r, g: rgb.g, b: rgb.b, a: rgb.a }) } : item) }) }} />))}
    </> : <p>服务影像使用服务端样式，可在常规页调整不透明度。</p>)}
    {section === 'label' && (vector ? <>
      {field('标注字段', 'label.field', <Select aria-label="标注字段" value={style.label?.field} allowClear options={(dataset?.fields ?? []).map(field => ({ value: field.name, label: field.name }))} onChange={field => setStyle({ ...style, label: field ? { fontSize: 12, ...style.label, field } : undefined })} />)}
      {style.label && field('字号（px）', 'label.fontSize', <InputNumber min={6} max={72} value={style.label.fontSize ?? 12} onChange={fontSize => { if (fontSize !== null && style.label) setStyle({ ...style, label: { ...style.label, fontSize } }) }} />)}
    </> : <p>服务影像的标注由服务端提供。</p>)}
    {section === 'popup' && (vector ? <PopupDraftFields popup={draft.interaction?.popup} fields={popupFields} onChange={popup => { const { popup: _previous, ...interaction } = draft.interaction ?? {}; patch({ interaction: popup ? { ...interaction, popup } : interaction }) }} /> : <p>服务影像不提供本地属性弹窗。</p>)}
    {section === 'source' && <>
      {dataset?.kind === 'vector' && <>
        <Alert type="info" title="源 CRS 赋值只修订数据源声明，不改变现有要素坐标。坐标转换请使用重投影导出。共享此数据集的图层使用同一声明。" />
        {field('源 CRS 赋值', 'sourceCrs', <Select aria-label="源 CRS 赋值" showSearch optionFilterProp="label" value={sourceCrs || undefined} placeholder="未覆盖导入时的来源声明" options={CRS_PRESETS.map(preset => ({ value: preset.code, label: `${preset.code} · ${preset.name}` }))} onChange={setSourceCrs} />)}
      </>}
      <dl><dt>数据集 ID</dt><dd>{draft.datasetId}</dd><dt>数据类型</dt><dd>{dataset?.kind}</dd><dt>显示坐标系</dt><dd>{project.crs}</dd><dt>内部要素坐标系</dt><dd>EPSG:4326</dd><dt>数据来源</dt><dd style={{ overflowWrap: 'anywhere' }}>{dataset ? 'path' in dataset.source ? dataset.source.path : 'url' in dataset.source ? dataset.source.url : 'label' in dataset.source ? dataset.source.label : '内存数据' : '数据集已删除'}</dd></dl>
    </>}
  </PropertyWindow>
}
