import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { capabilitiesForDataset, requiresOverlay, requiresPolygon, type ProcessingTool, type ProcessingOptions } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { resolveProcessingInput, type ProcessingScope } from '@/services/processing'
import { processingCommands } from '@/app/commands/processing.commands'
import { emitCommandStatus } from '@/app/commands/status'
import { layerCommands } from '@/app/commands/layer.commands'

const tools: Array<{ id: ProcessingTool; name: string; description: string }> = [
  { id: 'buffer', name: '缓冲区', description: '按距离为每个要素生成缓冲面，保留属性。重叠范围不会自动融合。' },
  { id: 'centroid', name: '顶点质心', description: '为每个要素生成顶点平均位置。结果可能落在面外，不是面积加权中心。' },
  { id: 'envelope', name: '整体外包矩形', description: '为整个输入范围生成一个矩形面，属性记录输入数量。' },
  { id: 'explode', name: '多部件拆分', description: '将多点、多线、多面拆成单部件，复制原属性；单部件保持原几何。' },
  { id: 'clip', name: '面裁剪', description: '用第二输入的面范围裁剪输入面，保留输入属性。掩膜会先融合，避免重复结果。' },
  { id: 'intersect', name: '面相交', description: '按两层面要素配对生成重叠区域。属性分别使用 A_、B_ 前缀；仅边界接触不生成面。' },
  { id: 'difference', name: '面差集', description: '从输入面扣除第二输入的覆盖范围，保留输入属性。完全覆盖的要素不输出。' },
  { id: 'dissolve', name: '面融合', description: '融合全部面，或按字段分组融合。仅保留分组字段，不自动汇总其他属性。' },
  { id: 'extract-location', name: '按位置提取', description: '按与第二输入合并范围的空间关系提取点、线或面。每个匹配要素只输出一次，保留完整几何和原属性。' },
  { id: 'summarize-location', name: '按区域统计', description: '保留每个输入区域，统计第二图层中符合空间关系的要素数量，可同时计算数值合计和均值。' },
  { id: 'attribute-join', name: '属性连接', description: '按两层字段的相等值带入属性，保留输入几何。重复连接键明确报错，避免悄悄选择一条记录。' },
  { id: 'spatial-join', name: '空间连接', description: '按空间关系带入第二图层的属性，保留完整输入几何。匹配多个要素时，每个配对输出一条记录。' }
]
const scopeLabels: Record<ProcessingScope, string> = { all: '全部要素', filtered: '图层筛选结果', selected: '当前选中要素' }

/** One compact processing workflow; drafts and cancellation never modify the source project. */
export function ProcessingDialog({ onClose }: { onClose(): void }) {
  const project = useProjectStore(s => s.project)
  const featuresByDataset = useProjectStore(s => s.featuresByDataset)
  const selection = useProjectStore(s => s.selection)
  const selectedLayerId = useProjectStore(s => s.selectedLayerId)
  const vectorLayers = project.layers.filter(layer => capabilitiesForDataset(project.datasets.find(dataset => dataset.id === layer.datasetId)).exportVector)
  const polygonLayers = vectorLayers.filter(layer => {
    const rows = featuresByDataset[layer.datasetId] ?? []
    return rows.length > 0 && rows.every(feature => feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
  })
  const [layerId, setLayerId] = useState(() => vectorLayers.some(l => l.id === selectedLayerId) ? selectedLayerId! : vectorLayers[0]?.id ?? '')
  const [tool, setTool] = useState<ProcessingTool>('buffer')
  const [scope, setScope] = useState<ProcessingScope>('all')
  const [overlayId, setOverlayId] = useState('')
  const [overlayScope, setOverlayScope] = useState<ProcessingScope>('all')
  const [groupField, setGroupField] = useState('')
  const [predicate, setPredicate] = useState<'intersects' | 'within' | 'disjoint'>('intersects')
  const [summaryField, setSummaryField] = useState('')
  const [prefix, setPrefix] = useState('stats_')
  const [inputKey, setInputKey] = useState('')
  const [joinKey, setJoinKey] = useState('')
  const [joinFields, setJoinFields] = useState<string[]>([])
  const [joinMode, setJoinMode] = useState<'left' | 'inner'>('left')
  const [distance, setDistance] = useState('100')
  const [unit, setUnit] = useState<'meters' | 'kilometers'>('meters')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<{ text: string; layerId: string } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const active = tools.find(item => item.id === tool)!
  const isJoin = tool === 'attribute-join' || tool === 'spatial-join'
  const candidates = requiresPolygon(tool) ? polygonLayers : vectorLayers
  const layer = candidates.find(item => item.id === layerId)
  const overlayCandidates = tool === 'summarize-location' || isJoin ? vectorLayers : polygonLayers
  const overlayLayer = overlayCandidates.find(item => item.id === overlayId)
  const overlayInput = overlayLayer ? resolveProcessingInput(overlayLayer, overlayScope, featuresByDataset[overlayLayer.datasetId] ?? [], selection) : []
  const overlayCount = overlayInput.length
  const overlayFields = Array.from(new Set(overlayInput.flatMap(feature => Object.keys(feature.properties))))
  const numericFields = overlayFields.filter(field => overlayInput.some(feature => typeof feature.properties[field] === 'number' && Number.isFinite(feature.properties[field])))
  const input = layer ? resolveProcessingInput(layer, scope, featuresByDataset[layer.datasetId] ?? [], selection) : []
  const fields = Array.from(new Set(input.flatMap(feature => Object.keys(feature.properties)))).filter(field => input.every(feature => {
    const value = feature.properties[field]
    return value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  }))
  const defaultName = `${layer?.name ?? '结果'}_${active.name}`
  const count = layer ? resolveProcessingInput(layer, scope, featuresByDataset[layer.datasetId] ?? [], selection).length : 0

  function selectTool(nextTool: ProcessingTool): void {
    const available = requiresPolygon(nextTool) ? polygonLayers : vectorLayers
    const nextLayerId = available.some(item => item.id === layerId) ? layerId : available[0]?.id ?? ''
    setTool(nextTool)
    setLayerId(nextLayerId)
    setScope('all')
    const availableOverlay = nextTool === 'summarize-location' || nextTool === 'attribute-join' || nextTool === 'spatial-join' ? vectorLayers : polygonLayers
    setOverlayId(availableOverlay.find(item => item.id !== nextLayerId)?.id ?? availableOverlay[0]?.id ?? '')
    setOverlayScope('all')
    setGroupField('')
    setPredicate('intersects'); setSummaryField(''); setPrefix(nextTool === 'attribute-join' || nextTool === 'spatial-join' ? 'join_' : 'stats_')
    setInputKey(''); setJoinKey(''); setJoinFields([])
    setError('')
    setSuccess(null)
  }

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    mounted.current = true
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      mounted.current = false
      controller.current?.abort()
      previousFocus?.focus()
    }
  }, [])

  function close(): void { controller.current?.abort(); onClose() }

  async function run(): Promise<void> {
    setError(''); setSuccess(null)
    const abort = new AbortController()
    controller.current = abort
    try {
      const resultName = (name || defaultName).trim()
      if (!resultName) throw new Error('请输入结果图层名称。')
      const options: ProcessingOptions = tool === 'buffer' ? { tool, distance: Number(distance), unit }
        : tool === 'dissolve' ? { tool, field: fields.includes(groupField) ? groupField : undefined }
        : tool === 'summarize-location' ? { tool, predicate: predicate === 'within' ? 'within' : 'intersects', field: summaryField || undefined, prefix }
        : tool === 'attribute-join' ? { tool, inputKey, joinKey, fields: joinFields, prefix, mode: joinMode }
        : tool === 'spatial-join' ? { tool, predicate: predicate === 'within' ? 'within' : 'intersects', fields: joinFields, prefix, mode: joinMode }
        : tool === 'extract-location' ? { tool, predicate } : { tool }
      if (tool === 'buffer' && (!Number.isFinite(Number(distance)) || Number(distance) <= 0 || Number(distance) * (unit === 'kilometers' ? 1000 : 1) > 1000000)) {
        throw new Error('缓冲距离必须大于 0，且不超过 1000 千米。')
      }
      setBusy(true)
      const result = await processingCommands.run({ layerId, scope, options, name: resultName, signal: abort.signal,
        overlay: requiresOverlay(tool) ? { layerId: overlayId, scope: overlayScope } : undefined })
      if (!mounted.current || abort.signal.aborted) return
      const text = `已生成「${resultName}」：${result.inputCount} 个输入 → ${result.outputCount} 个结果`
      setSuccess({ text, layerId: result.layerId })
      emitCommandStatus(text)
    } catch (reason) {
      if (!mounted.current) return
      if (abort.signal.aborted) emitCommandStatus('已取消空间处理')
      else setError(reason instanceof Error ? reason.message : '空间处理失败。')
    } finally {
      if (mounted.current) setBusy(false)
      if (controller.current === abort) controller.current = null
    }
  }

  return <div className="dialog-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <div className="dialog-content processing-dialog" role="dialog" aria-modal="true" aria-labelledby="processing-title" ref={dialogRef}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); close() }
        if (event.key === 'Tab') {
          const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])
          const first = items[0], last = items.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header className="dialog-header"><h2 id="processing-title">空间处理</h2><button type="button" className="dialog-close" aria-label="关闭空间处理" onClick={close}><X size={18} /></button></header>
      <div className="processing-content">
        <nav className="processing-tools" aria-label="处理工具">{tools.map(item => <button key={item.id} type="button" aria-pressed={tool === item.id} disabled={busy} onClick={() => selectTool(item.id)}>{item.name}</button>)}</nav>
        <div className="processing-form">
          <h3>{active.name}</h3><p className="processing-description">{active.description}</p>
          {!candidates.length ? <p role="status">{requiresPolygon(tool) ? '请先添加面图层。此工具仅支持纯面图层，不支持点、线或混合图层。' : '请先添加矢量数据。WMS 和 WMTS 图像图层不支持空间处理。'}</p> : <>
            <label>输入图层<select value={layerId} disabled={busy} onChange={event => { setLayerId(event.target.value); setScope('all'); setError(''); setSuccess(null) }}>{candidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>处理范围<select value={scope} disabled={busy} onChange={event => { setScope(event.target.value as ProcessingScope); setError(''); setSuccess(null) }}>{(Object.keys(scopeLabels) as ProcessingScope[]).map(key => <option key={key} value={key}>{scopeLabels[key]}</option>)}</select></label>
            <p className="processing-description" aria-live="polite">本次输入 {count} 个要素{scope === 'selected' ? '（仅包含通过图层筛选的选中要素）' : ''}</p>
            {requiresOverlay(tool) && <fieldset className="processing-overlay-input">
              <legend>{tool === 'summarize-location' ? '被统计图层' : isJoin ? '连接数据图层' : '第二输入 B（面图层）'}</legend>
              <label>第二图层<select value={overlayId} disabled={busy} onChange={event => { setOverlayId(event.target.value); setOverlayScope('all'); setSummaryField(''); setJoinKey(''); setJoinFields([]); setError(''); setSuccess(null) }}><option value="">请选择图层</option>{overlayCandidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>第二输入范围<select value={overlayScope} disabled={busy} onChange={event => { setOverlayScope(event.target.value as ProcessingScope); setSummaryField(''); setJoinKey(''); setJoinFields([]); setError(''); setSuccess(null) }}>{(Object.keys(scopeLabels) as ProcessingScope[]).map(key => <option key={key} value={key}>{scopeLabels[key]}</option>)}</select></label>
              <p className="processing-description" aria-live="polite">第二输入 {overlayCount} 个要素</p>
            </fieldset>}
            {tool === 'dissolve' && <label>分组字段<select value={fields.includes(groupField) ? groupField : ''} disabled={busy} onChange={event => { setGroupField(event.target.value); setSuccess(null); setError('') }}><option value="">不分组（融合全部）</option>{fields.map(field => <option key={field} value={field}>{field}</option>)}</select></label>}
            {tool === 'extract-location' && <>
              <label>空间关系<select value={predicate} disabled={busy} onChange={event => { setPredicate(event.target.value as typeof predicate); setSuccess(null); setError('') }}>
                <option value="intersects">相交（包括边界接触）</option><option value="within">完全位于其中（要求内部相交）</option><option value="disjoint">不相交（边界也不接触）</option>
              </select></label>
              <p className="processing-description">边界上的点、仅沿边界的线不算“完全位于其中”。多个范围会先合并；提取保留完整要素，不执行裁剪。</p>
            </>}
            {tool === 'summarize-location' && <>
              <label>匹配关系<select value={predicate} disabled={busy} onChange={event => { setPredicate(event.target.value as typeof predicate); setSuccess(null) }}><option value="intersects">相交（含边界）</option><option value="within">完全位于区域内（要求内部相交）</option></select></label>
              <label>数值字段<select value={summaryField} disabled={busy} onChange={event => { setSummaryField(event.target.value); setSuccess(null) }}><option value="">仅统计数量</option>{numericFields.map(field => <option key={field} value={field}>{field}</option>)}</select></label>
              <p className="processing-description">完整要素每区计一次；重叠区域各自计数。保留零匹配区域；仅有限数值参与合计和均值，均值无有效值时为空。</p>
            </>}
            {isJoin && <>
              {tool === 'attribute-join' ? <>
              <label>输入连接键<select value={inputKey} disabled={busy} onChange={event => { setInputKey(event.target.value); setSuccess(null) }}><option value="">请选择字段</option>{fields.map(field => <option key={field}>{field}</option>)}</select></label>
              <label>第二输入连接键<select value={joinKey} disabled={busy} onChange={event => { setJoinKey(event.target.value); setSuccess(null) }}><option value="">请选择字段</option>{overlayFields.map(field => <option key={field}>{field}</option>)}</select></label>
              </> : <label>空间关系<select value={predicate} disabled={busy} onChange={event => { setPredicate(event.target.value as typeof predicate); setSuccess(null) }}><option value="intersects">相交（含边界）</option><option value="within">输入完整位于第二要素内（要求内部相交）</option></select></label>}
              <fieldset disabled={busy}><legend>带入字段</legend>{overlayFields.map(field => <label key={field}><input type="checkbox" checked={joinFields.includes(field)} onChange={event => { setJoinFields(previous => event.target.checked ? [...previous, field] : previous.filter(item => item !== field)); setSuccess(null) }} />{field}</label>)}</fieldset>
              <label>连接方式<select value={joinMode} disabled={busy} onChange={event => { setJoinMode(event.target.value as typeof joinMode); setSuccess(null) }}><option value="left">保留全部输入（左连接）</option><option value="inner">仅保留匹配输入（内连接）</option></select></label>
              <p className="processing-description">{tool === 'attribute-join' ? '数字 1 与文本“1”不同，文本区分大小写且不自动去空格。空值不匹配；重复的非空连接键会报错。' : '边界接触属于相交；完整位于其中要求内部相交。多个匹配会增加结果数量；第二要素不会先融合。'}缺失的带入字段为 null。</p>
            </>}
            {(tool === 'summarize-location' || isJoin) && <><label>新增字段前缀<input value={prefix} disabled={busy} onChange={event => { setPrefix(event.target.value); setSuccess(null) }} /></label><p className="processing-description">{tool === 'summarize-location' ? `输出：${prefix}count${summaryField ? `、${prefix}sum、${prefix}mean` : ''}` : `带入字段使用 ${prefix || '无'} 前缀`}；已有字段同名时会报错，不覆盖原属性。</p></>}
            {tool === 'buffer' && <div className="processing-distance"><label>缓冲距离<input type="number" min="0" step="any" value={distance} disabled={busy} onChange={event => setDistance(event.target.value)} /></label><label>单位<select value={unit} disabled={busy} onChange={event => setUnit(event.target.value as typeof unit)}><option value="meters">米</option><option value="kilometers">千米</option></select></label></div>}
            <label>结果图层名称<input value={name} placeholder={defaultName} disabled={busy} onChange={event => setName(event.target.value)} /></label>
            <p className="processing-description">结果保存为独立本地图层，可继续处理、编辑或导出。原图层保持不变。</p>
            {tool === 'buffer' && <p className="processing-description">使用 WGS84 经纬度计算距离；暂不支持极区、跨日期变更线或大于 1000 千米的缓冲。</p>}
          </>}
          {error && <p className="export-error" role="alert">{error}</p>}
          {success && <div className="processing-result" role="status"><p>{success.text}</p><button type="button" className="button-secondary" onClick={() => { layerCommands.zoomToLayer(success.layerId); close() }}>查看结果</button></div>}
        </div>
      </div>
      <footer className="dialog-footer"><button type="button" className="button-secondary" onClick={() => busy ? controller.current?.abort() : close()}>{busy ? '取消处理' : '关闭'}</button><button type="button" className="button-primary" disabled={busy || !layer || count === 0 || (isJoin && !joinFields.length) || (tool === 'attribute-join' && (!inputKey || !joinKey)) || (requiresOverlay(tool) && (!overlayLayer || (overlayCount === 0 && tool !== 'summarize-location' && !isJoin)))} onClick={() => void run()}>{busy ? '处理中…' : '生成结果图层'}</button></footer>
    </div>
  </div>
}
