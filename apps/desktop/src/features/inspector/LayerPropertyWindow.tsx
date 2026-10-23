import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, ColorPicker, Input, InputNumber, Select, Switch } from 'antd'
import { ApplyProjectSnapshotEditCommand, createId, findGroupForLayer, getLayerGroupState, isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'
import type { Layer, ProcessingRecord } from '@desktop-webgis/gis-core'
import { cloneSymbolWithColor, colorToString, symbolPrimaryColor } from '@desktop-webgis/ol-style'
import type { LayerStyle, Symbol } from '@desktop-webgis/ol-style'
import { useProjectStore } from '@/stores/project.store'
import { PropertyWindow } from '@/components/ui/PropertyWindow'
import { propertyWindowEvent } from './property-window-request'
import type { PropertyWindowRequest } from './property-window-request'
import { FolderPropertyWindow } from './FolderPropertyWindow'
import { createMapPropertyPreview } from '@/features/map/map-runtime-host'
import { PopupDraftFields } from './PopupDraftFields'
import { CRS_PRESETS } from '@desktop-webgis/vector-io'
import { assignSourceCrs } from './source-crs'
import { useCartographyEditor } from './useCartographyEditor'
import { processingToolName } from '@/features/processing/processing-tools'

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
  const cartographyEditor = useCartographyEditor(id)
  const project = useProjectStore(state => state.project)
  const featuresByDataset = useProjectStore(state => state.featuresByDataset)
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
  const datasetFeatures = dataset ? featuresByDataset[dataset.id] ?? [] : []
  const geometryCounts = new Map<string, number>()
  for (const feature of datasetFeatures) geometryCounts.set(feature.geometry.type, (geometryCounts.get(feature.geometry.type) ?? 0) + 1)
  const geometrySummary = [...geometryCounts].map(([type, count]) => `${type}（${count}）`).join('、') || '暂无已加载要素'
  const source = dataset?.source
  const sourceLocation = source ? ('path' in source ? source.path : 'url' in source ? source.url : source.label) : '数据集已删除'
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
  function metadata(label: string, alias: string, value: ReactNode) {
    if (query && !`${label} ${alias}`.toLowerCase().includes(query.toLowerCase())) return null
    return <div className="scene-property-window__field"><span>{label}<small>{alias}</small></span><div>{value}</div></div>
  }
  function apply(close = false): void {
    try {
      const store = useProjectStore.getState(), snapshot = store.getSnapshot()
      const live = snapshot.project.layers.find(layer => layer.id === id)
      if (store.projectEpoch !== epoch) throw new Error('项目已切换，请重新打开窗口。')
      if (!live) throw new Error('图层已删除。')
      if (JSON.stringify(live) !== JSON.stringify(base)) throw new Error('图层已被其他操作修改，请重新载入。')
      if (getLayerGroupState(snapshot.project, findGroupForLayer(snapshot.project, id)?.id).locked) throw new Error('所属文件夹已锁定。')
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
    {section === 'style' && (vector ? !cartographyEditor.editable ? <Alert type="info" message={cartographyEditor.locked ? '图层已锁定' : '高级标准样式为只读'} description="当前配置已保留，可继续编辑其他图层属性。" /> : <>
      <p>当前模式：{style.mode === 'single' ? '单一符号' : style.mode === 'categorized' ? '分类' : '分级'}；专题配置随图层保留。</p>
      {field(style.mode === 'single' ? '符号颜色' : '默认符号颜色', 'symbol.color', <ColorPicker aria-label="符号颜色" value={colorToString(symbolPrimaryColor(symbol))} showText onChange={color => { const rgb = color.toRgb(); setSymbol(cloneSymbolWithColor(symbol, { r: rgb.r, g: rgb.g, b: rgb.b, a: rgb.a })) }} />)}
      {symbol.type === 'circle' && field('点半径（px）', 'symbol.radius', <InputNumber min={1} max={128} value={symbol.radius} onChange={radius => { if (radius !== null) setSymbol({ ...symbol, radius }) }} />)}
      {symbol.type === 'solid' && 'width' in symbol && field('线宽（px）', 'symbol.width', <InputNumber min={1} max={64} value={symbol.width} onChange={width => { if (width !== null) setSymbol({ ...symbol, width }) }} />)}
      {style.mode === 'categorized' && style.categories.map((category, index) => field(category.label ?? String(category.value), `categories[${index}].symbol`, <ColorPicker value={colorToString(symbolPrimaryColor(category.symbol))} showText onChange={color => { const rgb = color.toRgb(); setStyle({ ...style, categories: style.categories.map((item, i) => i === index ? { ...item, symbol: cloneSymbolWithColor(item.symbol, { r: rgb.r, g: rgb.g, b: rgb.b, a: rgb.a }) } : item) }) }} />))}
      {style.mode === 'graduated' && style.breaks.map((item, index) => field(item.label ?? String(item.value), `breaks[${index}].symbol`, <ColorPicker value={colorToString(symbolPrimaryColor(item.symbol))} showText onChange={color => { const rgb = color.toRgb(); setStyle({ ...style, breaks: style.breaks.map((item, i) => i === index ? { ...item, symbol: cloneSymbolWithColor(item.symbol, { r: rgb.r, g: rgb.g, b: rgb.b, a: rgb.a }) } : item) }) }} />))}
    </> : <p>服务影像使用服务端样式，可在常规页调整不透明度。</p>)}
    {section === 'label' && (vector ? !cartographyEditor.editable ? <Alert type="info" message={cartographyEditor.locked ? '图层已锁定' : '高级标准样式为只读'} description="当前配置已保留，可继续编辑其他图层属性。" /> : <>
      {field('标注字段', 'label.field', <Select aria-label="标注字段" value={style.label?.field} allowClear options={(dataset?.fields ?? []).map(field => ({ value: field.name, label: field.name }))} onChange={field => setStyle({ ...style, label: field ? { fontSize: 12, ...style.label, field } : undefined })} />)}
      {style.label && field('字号（px）', 'label.fontSize', <InputNumber min={6} max={72} value={style.label.fontSize ?? 12} onChange={fontSize => { if (fontSize !== null && style.label) setStyle({ ...style, label: { ...style.label, fontSize } }) }} />)}
    </> : <p>服务影像的标注由服务端提供。</p>)}
    {section === 'popup' && (vector ? <PopupDraftFields popup={draft.interaction?.popup} fields={popupFields} onChange={popup => { const { popup: _previous, ...interaction } = draft.interaction ?? {}; patch({ interaction: popup ? { ...interaction, popup } : interaction }) }} /> : <p>服务影像不提供本地属性弹窗。</p>)}
    {section === 'source' && <>
      {dataset?.kind === 'vector' && <>
        <Alert type="info" title="源 CRS 赋值只修订数据源声明，不改变现有要素坐标。坐标转换请使用重投影导出。共享此数据集的图层使用同一声明。" />
        {field('源 CRS 赋值', 'sourceCrs', <Select aria-label="源 CRS 赋值" showSearch optionFilterProp="label" value={sourceCrs || undefined} placeholder="未覆盖导入时的来源声明" options={CRS_PRESETS.map(preset => ({ value: preset.code, label: `${preset.code} · ${preset.name}` }))} onChange={setSourceCrs} />)}
      </>}
      <h3>数据源与几何</h3>
      {metadata('数据集 ID', 'dataset.id', <code>{draft.datasetId}</code>)}
      {metadata('数据类型', 'dataset.kind', dataset ? ({ vector: '本地矢量', wms: 'WMS 影像', wmts: 'WMTS 瓦片', wfs: 'WFS 只读快照' }[dataset.kind]) : '数据集已删除')}
      {metadata('数据来源', 'source.path source.url', <code style={{ overflowWrap: 'anywhere' }}>{sourceLocation}</code>)}
      {metadata('显示坐标系', 'project.crs', project.crs)}
      {metadata('内部要素坐标系', 'geometry.crs', 'EPSG:4326')}
      {metadata('已加载要素', 'geometry.count', datasetFeatures.length)}
      {metadata('几何类型', 'geometry.type', dataset?.kind === 'wms' || dataset?.kind === 'wmts' ? '服务影像，无本地几何' : geometrySummary)}
      {metadata('字段数', 'dataset.fields', dataset?.fields?.length ?? '未声明')}
      {dataset?.kind === 'wms' && <>
        {metadata('WMS 版本', 'source.version', dataset.source.version)}
        {metadata('图层名', 'source.layerNames', dataset.source.layerNames.join(', '))}
        {metadata('样式名', 'source.styleNames', dataset.source.styleNames?.join(', ') || '默认')}
        {metadata('图像格式', 'source.format', dataset.source.format ?? '未记录')}
        {metadata('透明背景', 'source.transparent', dataset.source.transparent === undefined ? '未记录' : dataset.source.transparent ? '是' : '否')}
        {metadata('服务 CRS', 'source.crs', dataset.source.crs ?? '视图默认')}
        {metadata('服务范围（WGS84）', 'source.bboxWgs84', formatExtent(dataset.source.bboxWgs84))}
        {metadata('认证模式', 'source.authMode', dataset.source.authMode)}
      </>}
      {dataset?.kind === 'wmts' && <>
        {metadata('WMTS 版本', 'source.version', dataset.source.version)}
        {metadata('图层', 'source.layer', dataset.source.layer)}
        {metadata('TileMatrixSet', 'source.tileMatrixSet', dataset.source.tileMatrixSet)}
        {metadata('投影', 'source.projection source.supportedCrs', dataset.source.projection ?? dataset.source.supportedCrs ?? '—')}
        {metadata('请求编码', 'source.requestEncoding', dataset.source.requestEncoding)}
        {metadata('瓦片矩阵级数', 'source.tileMatrices', dataset.source.tileMatrices.length)}
        {metadata('服务范围（WGS84）', 'source.bboxWgs84', formatExtent(dataset.source.bboxWgs84))}
        {metadata('认证模式', 'source.authMode', dataset.source.authMode)}
      </>}
      {dataset?.kind === 'wfs' && <>
        {metadata('WFS 版本', 'source.version', dataset.source.version)}
        {metadata('要素类型', 'source.typeName', dataset.source.typeName)}
        {metadata('快照要素', 'source.loadedCount', dataset.source.loadedCount ?? datasetFeatures.length)}
        {metadata('输出格式', 'source.outputFormat', dataset.source.outputFormat ?? '未记录')}
        {metadata('请求坐标系', 'source.srsName', dataset.source.srsName ?? '服务默认')}
        {metadata('快照完整性', 'source.complete', dataset.source.complete === false ? dataset.source.truncatedByLimit ? '不完整（达到记录上限）' : '不完整' : dataset.source.complete === true ? '完整' : '未记录')}
        {metadata('编辑状态', 'source.readOnly', '只读快照，不执行 WFS-T；需要编辑时请复制为本地图层')}
        {metadata('查询范围模式', 'source.extentMode', dataset.source.extentMode === 'full' ? '全范围' : dataset.source.extentMode === 'view' ? '当前视图范围' : '未记录')}
        {metadata('上次查询范围（WGS84）', 'source.queryExtentWgs84', formatExtent(dataset.source.queryExtentWgs84))}
        {metadata('服务范围（WGS84）', 'source.bboxWgs84', formatExtent(dataset.source.bboxWgs84))}
        {metadata('分页加载', 'source.paginationUsed', dataset.source.paginationUsed === undefined ? '未记录' : dataset.source.paginationUsed ? '是' : '否')}
        {metadata('重复要素 ID', 'source.duplicateIdCount', dataset.source.duplicateIdCount ?? 0)}
        {metadata('上次加载时间', 'source.lastLoadedAt', dataset.source.lastLoadedAt ? new Date(dataset.source.lastLoadedAt).toLocaleString() : '未记录')}
        {metadata('认证模式', 'source.authMode', dataset.source.authMode)}
      </>}
      {dataset?.kind === 'vector' && dataset.processing && <ProcessingProvenance record={dataset.processing} />}
    </>}
  </PropertyWindow>
}

function formatExtent(extent?: readonly number[]): string {
  return extent?.map(value => value.toFixed(2)).join(', ') ?? '—'
}

function ProcessingProvenance({ record }: { record: ProcessingRecord }) {
  const scopeLabel = { all: '全部要素', filtered: '图层筛选结果', selected: '当前选中要素' }[record.scope]
  const options = record.options
  return <details className="scene3d-property-section">
    <summary>处理来源与参数</summary>
    <p>输入图层：{record.sourceLayerName}</p>
    <p>工具：{processingToolName(options.tool)}</p>
    <p>输入范围：{scopeLabel}</p>
    {record.engine && <p>处理引擎：{record.engine.id} · {record.engine.version}</p>}
    {options.tool === 'buffer' && <p>缓冲距离：{options.distance} {options.unit === 'meters' ? '米' : '千米'}</p>}
    {options.tool === 'dissolve' && <p>分组字段：{options.field || '不分组'}</p>}
    {options.tool === 'extract-location' && <p>空间关系：{options.predicate === 'intersects' ? '相交（包括边界）' : options.predicate === 'within' ? '完全位于其中' : '不相交'}</p>}
    {options.tool === 'summarize-location' && <p>区域统计：{options.predicate === 'within' ? '完全位于区域内' : '相交（含边界）'}；字段 {options.field || '仅数量'}；前缀 {options.prefix || '无'}</p>}
    {options.tool === 'attribute-join' && <p>属性连接：{options.inputKey} → {options.joinKey}；{options.mode === 'left' ? '保留全部输入' : '仅保留匹配项'}；字段 {options.fields.join('、') || '无'}；前缀 {options.prefix || '无'}</p>}
    {options.tool === 'spatial-join' && <>
      <p>空间连接：{options.predicate === 'within' ? '完全位于其中' : '相交（含边界）'}；{options.mode === 'left' ? '保留全部输入' : '仅保留匹配项'}</p>
      <p>带入字段：{options.fields.join('、') || '无'}；前缀 {options.prefix || '无'}</p>
      <p>结果数量上限：{options.maxResults ?? '未记录（旧任务）'}</p>
    </>}
    {(options.tool === 'measure-area' || options.tool === 'measure-length' || options.tool === 'measure-perimeter') && <p>测量字段：{options.field}；单位：{options.unit}；WGS84 球面 XY 模型，不含高程。</p>}
    {options.tool === 'calculate-field' && <p>计算字段：{options.field}；表达式：{options.expression}</p>}
    {record.overlay && <>
      <p>第二输入：{record.overlay.layerName}</p>
      <p>第二输入范围：{{ all: '全部要素', filtered: '图层筛选结果', selected: '当前选中要素' }[record.overlay.scope]}（{record.overlay.inputCount} 个要素）</p>
    </>}
    <p>处理数量：{record.inputCount} 个输入 → {record.outputCount} 个结果</p>
    <p>完成时间：{new Date(record.completedAt).toLocaleString()}</p>
  </details>
}
