import { useEffect, useMemo, useState } from 'react'
import { Alert, AutoComplete, Button, ColorPicker, Input, InputNumber, Modal, Select, Space, Switch } from 'antd'
import { createId, getEffectiveLocked, getLayerCartography } from '@desktop-webgis/gis-core'
import type { CartographyState } from '@desktop-webgis/gis-core'
import {
  createDrawingLayer,
  duplicateDrawingLayer,
  moveDrawingLayer,
  removeDrawingLayer,
  setDrawingLayerProperty,
  setDrawingLayerZoom
} from '@desktop-webgis/ol-style/cartography-operations'
import { validateMapLibreStyle } from '@desktop-webgis/ol-style/cartography'
import type { MapLibreStyleSpecification } from '@desktop-webgis/ol-style/cartography'
import { useProjectStore } from '@/stores/project.store'
import { listAttributeFields } from './style-draft'
import { beginStyleInteraction, finishStyleInteraction } from './style-interaction'
import { LineWidthEditor } from './LineWidthEditor'
import './symbol-editor.css'

interface SymbolEditorProps {
  layerId: string
  onClose: () => void
  initialType?: 'symbol'
  initialDrawingLayerId?: string
}

type StandardStyleLayers = CartographyState['styleLayers']
type StyleLayer = StandardStyleLayers[number]
type LayerType = 'line' | 'circle' | 'fill' | 'symbol'
type ComparisonOperator = '==' | '!=' | '<' | '<=' | '>' | '>='
type ComparisonValueType = 'string' | 'number' | 'boolean'

interface ComparisonDraft {
  field: string
  operator: ComparisonOperator
  valueType: ComparisonValueType
  value: string
}

const typeNames: Record<LayerType, string> = { line: '线', circle: '圆点', fill: '面', symbol: '文字符号' }
const typeOptions: Array<{ value: LayerType; label: string }> = Object.entries(typeNames).map(([value, label]) => ({ value: value as LayerType, label }))
const comparisonOperators: ComparisonOperator[] = ['==', '!=', '<', '<=', '>', '>=']
const textAnchors = ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']

export function chooseInitialLayerId(layers: StandardStyleLayers | undefined, initialType?: 'symbol', drawingLayerId?: string): string | undefined {
  if (!layers?.length) return undefined
  if (drawingLayerId && layers.some(layer => layer.id === drawingLayerId)) return drawingLayerId
  return initialType === 'symbol' ? layers.find(layer => layer.type === 'symbol')?.id ?? layers[0]?.id : layers[0]?.id
}

function emptyComparison(): ComparisonDraft {
  return { field: '', operator: '==', valueType: 'string', value: '' }
}

export function readSimpleComparison(value: unknown): ComparisonDraft | undefined {
  if (!Array.isArray(value) || value.length !== 3 || !comparisonOperators.includes(value[0] as ComparisonOperator)) return undefined
  const get = value[1]
  const operand = value[2]
  if (!Array.isArray(get) || get.length !== 2 || get[0] !== 'get' || typeof get[1] !== 'string' || !get[1]) return undefined
  if (typeof operand === 'string') return { field: get[1], operator: value[0] as ComparisonOperator, valueType: 'string', value: operand }
  if (typeof operand === 'number' && Number.isFinite(operand)) return { field: get[1], operator: value[0] as ComparisonOperator, valueType: 'number', value: String(operand) }
  if (typeof operand === 'boolean') return { field: get[1], operator: value[0] as ComparisonOperator, valueType: 'boolean', value: String(operand) }
  return undefined
}

export function createSimpleComparison(draft: ComparisonDraft): unknown[] {
  if (!draft.field.trim()) throw new Error('请填写过滤字段')
  let value: string | number | boolean
  if (draft.valueType === 'number') {
    value = Number(draft.value)
    if (!draft.value.trim() || !Number.isFinite(value)) throw new Error('比较值必须是有限数值')
  } else if (draft.valueType === 'boolean') {
    if (draft.value !== 'true' && draft.value !== 'false') throw new Error('布尔比较值必须是 true 或 false')
    value = draft.value === 'true'
  } else value = draft.value
  return [draft.operator, ['get', draft.field.trim()], value]
}

function property(layer: StyleLayer, section: 'paint' | 'layout', name: string): unknown {
  const values = layer[section] as unknown as Record<string, unknown> | undefined
  return values?.[name]
}

function jsonText(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

function layerFilter(layer: StyleLayer): unknown {
  return 'filter' in layer ? layer.filter : undefined
}

function setLayerFilter(layer: StyleLayer, value: unknown): void {
  if (layer.type === 'background') throw new Error('背景图层不支持 filter')
  const filterable = layer as StyleLayer & { filter?: unknown }
  filterable.filter = value
}

function clearLayerFilter(layer: StyleLayer): void {
  if (layer.type === 'background') throw new Error('背景图层不支持 filter')
  const filterable = layer as StyleLayer & { filter?: unknown }
  delete filterable.filter
}

function colorText(value: unknown): string {
  return typeof value === 'string' ? value : '#3388ff'
}

function rgbaText(value: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${Math.round(value.r)}, ${Math.round(value.g)}, ${Math.round(value.b)}, ${value.a})`
}

function readDirectFieldExpression(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length !== 2 || value[0] !== 'get' || typeof value[1] !== 'string') return undefined
  return value[1]
}

function literalFontStack(value: unknown): string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(font => typeof font === 'string')) return undefined
  return value
}

function sourceDescriptor(layer: StyleLayer): MapLibreStyleSpecification['sources'][string] {
  return 'source-layer' in layer
    ? { type: 'vector', tiles: ['https://example.invalid/{z}/{x}/{y}.pbf'] }
    : { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
}

function validateFragment(layers: StandardStyleLayers): void {
  const sources: MapLibreStyleSpecification['sources'] = Object.create(null)
  for (const layer of layers) {
    if ('source' in layer && !Object.hasOwn(sources, layer.source)) sources[layer.source] = sourceDescriptor(layer)
  }
  const errors = validateMapLibreStyle({ version: 8, sources, layers })
  if (errors.length) throw new Error(`样式无效：${errors.join('；')}`)
}

/** Parses and validates one filter edit while retaining every other layer AST node. */
export function applyLayerFilterJson(layers: StandardStyleLayers, layerId: string, rawValue: string): StandardStyleLayers {
  const value: unknown = rawValue.trim() ? JSON.parse(rawValue) : undefined
  const next = structuredClone(layers)
  const target = next.find(candidate => candidate.id === layerId)
  if (!target) throw new Error(`不存在样式图层：${layerId}`)
  if (value === undefined) clearLayerFilter(target)
  else setLayerFilter(target, value)
  validateFragment(next)
  return next
}

function advancedOptions(layer: StyleLayer): Array<{ value: string; label: string }> {
  const values = layer.type === 'line'
    ? ['paint.line-color', 'paint.line-width', 'paint.line-opacity', 'paint.line-dasharray', 'layout.line-cap', 'layout.line-join']
    : layer.type === 'circle'
      ? ['paint.circle-color', 'paint.circle-radius', 'paint.circle-opacity', 'paint.circle-stroke-color', 'paint.circle-stroke-width']
      : layer.type === 'fill'
        ? ['paint.fill-color', 'paint.fill-opacity', 'paint.fill-outline-color', 'paint.fill-pattern']
        : layer.type === 'symbol'
          ? [
            'layout.text-field', 'layout.text-font', 'layout.text-size', 'layout.text-offset', 'layout.text-rotate',
            'layout.text-anchor', 'layout.text-max-angle', 'layout.text-padding', 'layout.text-keep-upright',
            'layout.text-allow-overlap', 'layout.text-ignore-placement', 'layout.text-optional',
            'layout.symbol-placement', 'layout.symbol-spacing', 'layout.symbol-avoid-edges', 'layout.icon-optional',
            'paint.text-color', 'paint.text-halo-color', 'paint.text-halo-width'
          ]
          : []
  const actual = [
    ...Object.keys(layer.paint ?? {}).map(name => `paint.${name}`),
    ...Object.keys(layer.layout ?? {}).map(name => `layout.${name}`)
  ]
  return [...new Set([...values, ...actual])].map(value => ({ value, label: value })).concat({ value: 'filter', label: 'filter' })
}

export function SymbolEditor({ layerId, onClose, initialType, initialDrawingLayerId }: SymbolEditorProps) {
  const project = useProjectStore(state => state.project)
  const featuresByDataset = useProjectStore(state => state.featuresByDataset)
  const layer = project.layers.find(candidate => candidate.id === layerId)
  const fragment = getLayerCartography(project, layerId)
  const [selectedLayerId, setSelectedLayerId] = useState<string | undefined>(() => chooseInitialLayerId(fragment?.styleLayers, initialType, initialDrawingLayerId))
  const [message, setMessage] = useState<string | null>(null)
  const [advancedPath, setAdvancedPath] = useState('filter')
  const [advancedDraft, setAdvancedDraft] = useState('')
  const [advancedDirty, setAdvancedDirty] = useState(false)
  const [filterDraft, setFilterDraft] = useState('')
  const [filterDirty, setFilterDirty] = useState(false)
  const [comparison, setComparison] = useState<ComparisonDraft>(() => emptyComparison())
  const [comparisonDirty, setComparisonDirty] = useState(false)
  const selectedLayer = fragment?.styleLayers.find(candidate => candidate.id === selectedLayerId) ?? fragment?.styleLayers[0]
  const locked = layer ? getEffectiveLocked(project, layerId) : false
  const editable = Boolean(layer && fragment && !locked)
  const fields = useMemo(() => layer ? listAttributeFields(featuresByDataset[layer.datasetId] ?? []) : [], [featuresByDataset, layer])
  const currentFilterText = jsonText(selectedLayer ? layerFilter(selectedLayer) : undefined)
  const currentComparison = selectedLayer ? readSimpleComparison(layerFilter(selectedLayer)) : undefined
  const comparisonReady = Boolean(comparison.field.trim()) && (comparison.valueType !== 'number' || Number.isFinite(Number(comparison.value)) && comparison.value.trim() !== '') &&
    (comparison.valueType !== 'boolean' || comparison.value === 'true' || comparison.value === 'false')
  const advancedValue = useMemo(() => {
    if (!selectedLayer) return undefined
    if (advancedPath === 'filter') return layerFilter(selectedLayer)
    const [section, ...parts] = advancedPath.split('.')
    return section === 'paint' || section === 'layout' ? property(selectedLayer, section, parts.join('.')) : undefined
  }, [advancedPath, selectedLayer])

  useEffect(() => () => finishStyleInteraction(layerId), [layerId])
  useEffect(() => {
    setSelectedLayerId(chooseInitialLayerId(fragment?.styleLayers, initialType, initialDrawingLayerId))
    setAdvancedDirty(false)
    setFilterDirty(false)
    setComparisonDirty(false)
    setMessage(null)
  }, [layerId, initialType, initialDrawingLayerId])
  useEffect(() => {
    if (!advancedDirty) setAdvancedDraft(jsonText(advancedValue))
  }, [advancedDirty, advancedValue])
  useEffect(() => {
    if (!filterDirty) setFilterDraft(currentFilterText)
  }, [filterDirty, currentFilterText])
  useEffect(() => {
    if (!comparisonDirty) setComparison(currentComparison ?? emptyComparison())
  }, [comparisonDirty, selectedLayer?.id, currentFilterText])

  function writeLatest(build: (layers: StandardStyleLayers, currentFragment: NonNullable<typeof fragment>) => StandardStyleLayers, transactionProperty?: string): boolean {
    const state = useProjectStore.getState()
    const currentProject = state.project
    if (!currentProject.layers.some(candidate => candidate.id === layerId)) {
      setMessage('图层已删除，无法继续编辑。')
      return false
    }
    if (getEffectiveLocked(currentProject, layerId)) {
      setMessage('图层或所属文件夹已锁定，无法修改样式。')
      return false
    }
    const currentFragment = getLayerCartography(currentProject, layerId)
    if (!currentFragment) {
      setMessage('当前图层的标准样式绑定已移除，无法继续编辑。')
      return false
    }
    try {
      const next = build(currentFragment.styleLayers, currentFragment)
      state.setLayerCartography(layerId, next, transactionProperty ? beginStyleInteraction(layerId, transactionProperty) : undefined)
      setMessage(null)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  function finishInteraction() {
    finishStyleInteraction(layerId)
  }

  function updateProperty(name: string, value: unknown, section: 'paint' | 'layout', historyKey = `${section}.${name}`) {
    writeLatest(layers => setDrawingLayerProperty(layers, selectedLayer?.id ?? '', section, name, value), historyKey)
  }

  function addLayer(type: LayerType) {
    finishInteraction()
    const id = createId('style-layer')
    const success = writeLatest((layers, current) => [...layers, createDrawingLayer({ id, source: current.binding.styleSourceId, type })])
    if (success) setSelectedLayerId(id)
  }

  function duplicateSelected(id: string) {
    finishInteraction()
    const newId = createId('style-layer')
    const success = writeLatest(layers => duplicateDrawingLayer(layers, id, newId))
    if (success) setSelectedLayerId(newId)
  }

  function deleteSelected(id: string) {
    finishInteraction()
    const index = fragment?.styleLayers.findIndex(candidate => candidate.id === id) ?? 0
    const success = writeLatest(layers => removeDrawingLayer(layers, id))
    if (success) setSelectedLayerId(fragment?.styleLayers[Math.max(0, index - 1)]?.id ?? fragment?.styleLayers[index + 1]?.id)
  }

  function moveSelected(id: string, offset: -1 | 1) {
    finishInteraction()
    writeLatest(layers => {
      const index = layers.findIndex(candidate => candidate.id === id)
      if (index < 0) throw new Error(`不存在样式图层：${id}`)
      return moveDrawingLayer(layers, id, index + offset)
    })
  }

  function updateZoom(minzoom?: number, maxzoom?: number, historyKey = 'zoom') {
    writeLatest(layers => setDrawingLayerZoom(layers, selectedLayer?.id ?? '', minzoom, maxzoom), historyKey)
  }

  function applyAdvanced() {
    if (!selectedLayer) return
    let value: unknown
    try {
      value = JSON.parse(advancedDraft)
    } catch (error) {
      setMessage(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    finishInteraction()
    const success = advancedPath === 'filter'
      ? writeLatest(layers => applyLayerFilterJson(layers, selectedLayer.id, JSON.stringify(value)))
      : (() => {
        const [section, ...parts] = advancedPath.split('.')
        if (section !== 'paint' && section !== 'layout') return false
        return writeLatest(layers => setDrawingLayerProperty(layers, selectedLayer.id, section, parts.join('.'), value))
      })()
    if (success) {
      setAdvancedDirty(false)
      setFilterDirty(false)
    }
  }

  function removeAdvancedValue() {
    if (!selectedLayer) return
    finishInteraction()
    const success = advancedPath === 'filter'
      ? writeLatest(layers => applyLayerFilterJson(layers, selectedLayer.id, ''))
      : (() => {
        const [section, ...parts] = advancedPath.split('.')
        if (section !== 'paint' && section !== 'layout') return false
        return writeLatest(layers => setDrawingLayerProperty(layers, selectedLayer.id, section, parts.join('.'), undefined))
      })()
    if (success) {
      setAdvancedDraft('')
      setFilterDraft('')
      setAdvancedDirty(false)
      setFilterDirty(false)
    }
  }

  function close() {
    finishInteraction()
    onClose()
  }

  function propertyNumber(section: 'paint' | 'layout', name: string, label: string, min: number, max?: number, step = 1, defaultValue = min) {
    const value = property(selectedLayer!, section, name)
    return (
      <label className="symbol-editor__control" key={`${section}.${name}`}>
        <span>{label}</span>
        <InputNumber
          aria-label={label}
          disabled={!editable || value !== undefined && typeof value !== 'number'}
          min={min}
          max={max}
          step={step}
          value={typeof value === 'number' ? value : value === undefined ? defaultValue : undefined}
          onFocus={() => beginStyleInteraction(layerId, `${section}.${name}`)}
          onChange={next => { if (next !== null) updateProperty(name, next, section) }}
          onBlur={finishInteraction}
        />
      </label>
    )
  }

  function propertyColor(section: 'paint' | 'layout', name: string, label: string) {
    const value = property(selectedLayer!, section, name)
    const isEditable = value === undefined || typeof value === 'string'
    return (
      <label className="symbol-editor__control" key={`${section}.${name}`}>
        <span>{label}</span>
        <ColorPicker
          aria-label={label}
          disabled={!editable || !isEditable}
          value={colorText(value)}
          format="rgb"
          showText
          onOpenChange={open => { if (open) beginStyleInteraction(layerId, `${section}.${name}`); else finishInteraction() }}
          onChange={color => updateProperty(name, rgbaText(color.toRgb()), section)}
        />
        {!isEditable ? <span className="symbol-editor__hint">表达式请从高级 JSON 编辑</span> : null}
      </label>
    )
  }

  function propertySelect(section: 'paint' | 'layout', name: string, label: string, options: string[]) {
    const value = property(selectedLayer!, section, name)
    return (
      <label className="symbol-editor__control" key={`${section}.${name}`}>
        <span>{label}</span>
        <Select
          aria-label={label}
          disabled={!editable || value !== undefined && typeof value !== 'string'}
          value={typeof value === 'string' ? value : value === undefined ? options[0] : undefined}
          options={options.map(option => ({ value: option, label: option }))}
          onChange={next => { finishInteraction(); updateProperty(name, next, section) }}
        />
      </label>
    )
  }

  function propertyBoolean(section: 'paint' | 'layout', name: string, label: string, defaultValue = false) {
    const value = property(selectedLayer!, section, name)
    return (
      <label className="symbol-editor__control" key={`${section}.${name}`}>
        <span>{label}</span>
        <Switch
          aria-label={label}
          disabled={!editable || value !== undefined && typeof value !== 'boolean'}
          checked={typeof value === 'boolean' ? value : value === undefined ? defaultValue : false}
          onChange={checked => {
            finishInteraction()
            writeLatest(layers => setDrawingLayerProperty(layers, selectedLayer?.id ?? '', section, name, checked))
          }}
        />
        {value !== undefined && typeof value !== 'boolean' ? <span className="symbol-editor__hint">表达式请从高级 JSON 编辑</span> : null}
      </label>
    )
  }

  function updateTextOffset(axis: 0 | 1, value: number) {
    const current = property(selectedLayer!, 'layout', 'text-offset')
    const offset = Array.isArray(current) && current.length === 2 && current.every(item => typeof item === 'number')
      ? [current[0], current[1]] as [number, number]
      : [0, 0] as [number, number]
    offset[axis] = value
    updateProperty('text-offset', offset, 'layout')
  }

  function applyComparison() {
    if (!selectedLayer) return
    let expression: unknown[]
    try {
      expression = createSimpleComparison(comparison)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return
    }
    finishInteraction()
    const success = writeLatest(layers => applyLayerFilterJson(layers, selectedLayer.id, JSON.stringify(expression)))
    if (success) setComparisonDirty(false)
  }

  function addComparisonRule() {
    if (!selectedLayer || selectedLayer.type === 'background') return
    let expression: unknown[]
    try {
      expression = createSimpleComparison(comparison)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return
    }
    const newId = createId('style-layer')
    finishInteraction()
    const success = writeLatest(layers => {
      const copied = duplicateDrawingLayer(layers, selectedLayer.id, newId)
      return applyLayerFilterJson(copied, newId, JSON.stringify(expression))
    })
    if (success) {
      setSelectedLayerId(newId)
      setComparisonDirty(false)
    }
  }

  const canAdd = editable && fragment !== undefined
  const textFieldValue = selectedLayer?.type === 'symbol' ? property(selectedLayer, 'layout', 'text-field') : undefined
  const textFieldField = readDirectFieldExpression(textFieldValue)
  const textFieldMode = typeof textFieldValue === 'string' ? 'literal' : textFieldField !== undefined ? 'field' : 'expression'
  const textOffsetValue = selectedLayer?.type === 'symbol' ? property(selectedLayer, 'layout', 'text-offset') : undefined
  const textOffsetLiteral = textOffsetValue === undefined || Array.isArray(textOffsetValue) && textOffsetValue.length === 2 && textOffsetValue.every(item => typeof item === 'number')
  const fontStack = selectedLayer?.type === 'symbol' ? literalFontStack(property(selectedLayer, 'layout', 'text-font')) : undefined

  return (
    <Modal
      className="symbol-editor-modal"
      title={`专业符号 · ${layer?.name ?? '图层已删除'}`}
      open
      width={1000}
      footer={null}
      destroyOnHidden
      onCancel={close}
      afterClose={finishInteraction}
    >
      {!layer || !fragment ? (
        <div className="symbol-editor__properties">
          <Alert type="warning" showIcon message={layer ? '标准样式绑定已移除' : '图层已删除'} description="编辑器未保留独立草稿。关闭窗口后可从当前图层状态重新打开。" />
        </div>
      ) : (
        <div className="symbol-editor">
          <aside className="symbol-editor__layers" aria-label="绘制层列表">
            <div className="symbol-editor__layers-heading">
              <span>绘制层</span>
              <Space size={4}>
                {initialType === 'symbol' ? <Button size="small" disabled={!canAdd} onClick={() => addLayer('symbol')}>新增注记层</Button> : null}
                <Select
                  aria-label="新增绘制层类型"
                  disabled={!canAdd}
                  placeholder="新增"
                  value={undefined}
                  options={typeOptions}
                  onChange={addLayer}
                />
              </Space>
            </div>
            <div className="symbol-editor__layer-list">
              {fragment.styleLayers.map((styleLayer, index) => (
                <div className={`symbol-editor__layer-row${styleLayer.id === selectedLayer?.id ? ' symbol-editor__layer-row--selected' : ''}`} key={styleLayer.id}>
                  <Button
                    type="text"
                    block
                    className="symbol-editor__layer-select"
                    aria-current={styleLayer.id === selectedLayer?.id ? 'true' : undefined}
                    onClick={() => { finishInteraction(); setSelectedLayerId(styleLayer.id) }}
                  >
                    <span className="symbol-editor__layer-name">{typeNames[styleLayer.type as LayerType] ?? styleLayer.type}</span>
                    <span className="symbol-editor__layer-id">{styleLayer.id}</span>
                  </Button>
                  <Space className="symbol-editor__layer-actions" size={0}>
                    <Button aria-label={`上移 ${styleLayer.id}`} size="small" type="text" disabled={!editable || index === 0} onClick={() => { setSelectedLayerId(styleLayer.id); moveSelected(styleLayer.id, -1) }}>↑</Button>
                    <Button aria-label={`下移 ${styleLayer.id}`} size="small" type="text" disabled={!editable || index === fragment.styleLayers.length - 1} onClick={() => { setSelectedLayerId(styleLayer.id); moveSelected(styleLayer.id, 1) }}>↓</Button>
                    <Button aria-label={`复制 ${styleLayer.id}`} size="small" type="text" disabled={!editable} onClick={() => { setSelectedLayerId(styleLayer.id); duplicateSelected(styleLayer.id) }}>复制</Button>
                    <Button aria-label={`删除 ${styleLayer.id}`} size="small" type="text" danger disabled={!editable} onClick={() => { setSelectedLayerId(styleLayer.id); deleteSelected(styleLayer.id) }}>删</Button>
                  </Space>
                </div>
              ))}
              {!fragment.styleLayers.length ? <div className="symbol-editor__hint">还没有绘制层，请从上方新增。</div> : null}
            </div>
            <span className="symbol-editor__hint">稳定 ID 用于样式绑定，绘制顺序按列表保存。</span>
          </aside>

          <main className="symbol-editor__properties">
            {message ? <Alert className="symbol-editor__message" type="error" showIcon message={message} /> : null}
            {locked ? <Alert className="symbol-editor__message" type="warning" showIcon message="图层已锁定，样式只读。" /> : null}
            {selectedLayer ? <>
              <div className="symbol-editor__selected-title">
                <strong>{typeNames[selectedLayer.type as LayerType] ?? selectedLayer.type}</strong>
                <span>{selectedLayer.id}</span>
              </div>

              {selectedLayer.type === 'line' ? (
                <>
                  <section className="symbol-editor__section">
                    <div className="symbol-editor__section-heading">线符号</div>
                    <div className="symbol-editor__control-grid">
                      {propertyColor('paint', 'line-color', '线颜色')}
                      {propertyNumber('paint', 'line-opacity', '线不透明度', 0, 1, 0.05, 1)}
                      {propertySelect('layout', 'line-cap', '端点', ['butt', 'round', 'square'])}
                      {propertySelect('layout', 'line-join', '连接', ['bevel', 'round', 'miter'])}
                    </div>
                    <label className="symbol-editor__wide-control">
                      <span>线宽</span>
                      <LineWidthEditor
                        value={property(selectedLayer, 'paint', 'line-width') ?? 1}
                        disabled={!editable}
                        onBegin={() => beginStyleInteraction(layerId, 'paint.line-width')}
                        onFinish={finishInteraction}
                        onChange={value => updateProperty('line-width', value, 'paint')}
                      />
                    </label>
                  </section>
                </>
              ) : null}

              {selectedLayer.type === 'circle' ? (
                <section className="symbol-editor__section">
                  <div className="symbol-editor__section-heading">圆点符号</div>
                  <div className="symbol-editor__control-grid">
                    {propertyColor('paint', 'circle-color', '填充颜色')}
                    {propertyNumber('paint', 'circle-radius', '半径（px）', 0, 128, 1)}
                    {propertyNumber('paint', 'circle-opacity', '填充不透明度', 0, 1, 0.05, 1)}
                    {propertyColor('paint', 'circle-stroke-color', '描边颜色')}
                    {propertyNumber('paint', 'circle-stroke-width', '描边宽度（px）', 0, 32, 0.5, 0)}
                  </div>
                </section>
              ) : null}

              {selectedLayer.type === 'fill' ? (
                <section className="symbol-editor__section">
                  <div className="symbol-editor__section-heading">面符号</div>
                  <div className="symbol-editor__control-grid">
                    {propertyColor('paint', 'fill-color', '填充颜色')}
                    {propertyNumber('paint', 'fill-opacity', '不透明度', 0, 1, 0.05, 1)}
                    {propertyColor('paint', 'fill-outline-color', '轮廓颜色')}
                  </div>
                </section>
              ) : null}

              {selectedLayer.type === 'symbol' ? (
                <section className="symbol-editor__section">
                  <div className="symbol-editor__section-heading">文字符号</div>
                  <label className="symbol-editor__wide-control">
                    <span>文字内容方式</span>
                    <Select
                      aria-label="文字内容方式"
                      disabled={!editable}
                      value={textFieldMode}
                      options={[{ value: 'field', label: '字段' }, { value: 'literal', label: '固定文字' }, { value: 'expression', label: '表达式' }]}
                      onChange={mode => {
                        finishInteraction()
                        if (mode === 'literal') updateProperty('text-field', typeof textFieldValue === 'string' ? textFieldValue : '文字', 'layout')
                        if (mode === 'field') updateProperty('text-field', ['get', textFieldField ?? fields[0] ?? 'name'], 'layout')
                        if (mode === 'expression') setAdvancedPath('layout.text-field')
                      }}
                    />
                    {textFieldMode === 'literal' ? (
                      <Input
                        aria-label="固定符号文字"
                        disabled={!editable}
                        value={textFieldValue as string}
                        onFocus={() => beginStyleInteraction(layerId, 'layout.text-field')}
                        onChange={event => updateProperty('text-field', event.target.value, 'layout')}
                        onBlur={finishInteraction}
                      />
                    ) : null}
                    {textFieldMode === 'field' ? (
                      <AutoComplete
                        aria-label="符号文字字段"
                        disabled={!editable}
                        value={textFieldField}
                        options={fields.map(field => ({ value: field }))}
                        placeholder="输入字段名"
                        onFocus={() => beginStyleInteraction(layerId, 'layout.text-field')}
                        onChange={field => { if (field.trim()) updateProperty('text-field', ['get', field], 'layout') }}
                        onBlur={finishInteraction}
                      />
                    ) : null}
                    {textFieldMode === 'expression' ? <Alert type="info" showIcon message="当前 text-field 是标准表达式或格式化 AST，原样保留。可在高级属性中编辑 JSON。" /> : null}
                  </label>
                  <label className="symbol-editor__wide-control">
                    <span>字体栈（逗号分隔）</span>
                    <Input
                      aria-label="文字字体栈"
                      disabled={!editable || fontStack === undefined}
                      value={fontStack?.join(', ') ?? ''}
                      placeholder="例如 Open Sans Regular, Arial Unicode MS Regular"
                      onFocus={() => beginStyleInteraction(layerId, 'layout.text-font')}
                      onChange={event => {
                        const value = event.target.value.split(',').map(font => font.trim()).filter(Boolean)
                        if (value.length) updateProperty('text-font', value, 'layout')
                      }}
                      onBlur={finishInteraction}
                    />
                    {fontStack === undefined ? <span className="symbol-editor__hint">字体栈为表达式，已保留原 AST；请用高级 JSON 编辑。</span> : null}
                  </label>
                  <div className="symbol-editor__control-grid">
                    {propertyNumber('layout', 'text-size', '字号（px）', 1, 128, 1)}
                    {propertyColor('paint', 'text-color', '文字颜色')}
                    {propertyColor('paint', 'text-halo-color', '文字描边颜色')}
                    {propertyNumber('paint', 'text-halo-width', '文字描边宽度', 0, 32, 0.5, 0)}
                    {propertySelect('layout', 'symbol-placement', '放置方式', ['point', 'line', 'line-center'])}
                    {propertySelect('layout', 'text-anchor', '文字锚点', textAnchors)}
                    {propertyNumber('layout', 'text-rotate', '文字旋转（°）', -180, 180, 1, 0)}
                    {propertyNumber('layout', 'text-max-angle', '沿线最大夹角（°）', 0, 180, 1, 45)}
                    {propertyNumber('layout', 'text-padding', '避让间距（px）', 0, 256, 1, 2)}
                    {propertyNumber('layout', 'symbol-spacing', '沿线重复间距（px）', 1, 1024, 1, 250)}
                    {propertyBoolean('layout', 'text-keep-upright', '沿线文字保持正向', true)}
                    {propertyBoolean('layout', 'symbol-avoid-edges', '避开瓦片边缘', false)}
                    {propertyBoolean('layout', 'text-allow-overlap', '允许文字重叠', false)}
                    {propertyBoolean('layout', 'text-ignore-placement', '忽略其他符号避让', false)}
                    {propertyBoolean('layout', 'text-optional', '文字可选（仅图标时显示）', false)}
                    {propertyBoolean('layout', 'icon-optional', '图标可选（仅文字时显示）', false)}
                  </div>
                  <div className="symbol-editor__offset-grid">
                    <span className="symbol-editor__hint">文字偏移（em）</span>
                    {[0, 1].map(axis => (
                      <label className="symbol-editor__control" key={axis}>
                        <span>{axis === 0 ? '水平' : '垂直'}</span>
                        <InputNumber
                          aria-label={`文字${axis === 0 ? '水平' : '垂直'}偏移`}
                          disabled={!editable || !textOffsetLiteral}
                          step={0.1}
                          value={Array.isArray(textOffsetValue) ? textOffsetValue[axis] as number : 0}
                          onFocus={() => beginStyleInteraction(layerId, 'layout.text-offset')}
                          onChange={value => { if (value !== null) updateTextOffset(axis as 0 | 1, value) }}
                          onBlur={finishInteraction}
                        />
                      </label>
                    ))}
                    {!textOffsetLiteral ? <span className="symbol-editor__hint">偏移为表达式，已保留原 AST；请用高级 JSON 编辑。</span> : null}
                  </div>
                </section>
              ) : null}

              <section className="symbol-editor__section">
                <div className="symbol-editor__section-heading">过滤与显示范围</div>
                <div className="symbol-editor__control-grid">
                  <label className="symbol-editor__control">
                    <span>最小 Zoom</span>
                    <InputNumber
                      aria-label="绘制层最小 Zoom"
                      disabled={!editable}
                      min={0}
                      max={24}
                      value={selectedLayer.minzoom}
                      placeholder="不限"
                      onFocus={() => beginStyleInteraction(layerId, 'minzoom')}
                      onChange={value => updateZoom(value ?? undefined, selectedLayer.maxzoom, 'minzoom')}
                      onBlur={finishInteraction}
                    />
                  </label>
                  <label className="symbol-editor__control">
                    <span>最大 Zoom</span>
                    <InputNumber
                      aria-label="绘制层最大 Zoom"
                      disabled={!editable}
                      min={0}
                      max={24}
                      value={selectedLayer.maxzoom}
                      placeholder="不限"
                      onFocus={() => beginStyleInteraction(layerId, 'maxzoom')}
                      onChange={value => updateZoom(selectedLayer.minzoom, value ?? undefined, 'maxzoom')}
                      onBlur={finishInteraction}
                    />
                  </label>
                </div>
                <div className="symbol-editor__comparison">
                  <div className="symbol-editor__section-heading">常用字段比较</div>
                  {layerFilter(selectedLayer) !== undefined && !currentComparison ? (
                    <Alert
                      type="info"
                      showIcon
                      message="当前 Filter 是复合或未知表达式，保持原样。结构化比较仅在应用时替换；复杂过滤请使用下方 JSON。"
                    />
                  ) : null}
                  <div className="symbol-editor__comparison-grid">
                    <AutoComplete
                      aria-label="过滤字段"
                      disabled={!editable}
                      value={comparison.field}
                      options={fields.map(field => ({ value: field }))}
                      placeholder="字段名"
                      onChange={field => { setComparison(current => ({ ...current, field })); setComparisonDirty(true) }}
                    />
                    <Select
                      aria-label="比较操作符"
                      disabled={!editable}
                      value={comparison.operator}
                      options={comparisonOperators.map(operator => ({ value: operator, label: operator }))}
                      onChange={operator => { setComparison(current => ({ ...current, operator })); setComparisonDirty(true) }}
                    />
                    <Select
                      aria-label="比较值类型"
                      disabled={!editable}
                      value={comparison.valueType}
                      options={[
                        { value: 'string', label: '文本' },
                        { value: 'number', label: '数值' },
                        { value: 'boolean', label: '布尔值' }
                      ]}
                      onChange={(valueType: ComparisonValueType) => {
                        setComparison(current => ({ ...current, valueType, value: valueType === 'boolean' ? 'true' : '' }))
                        setComparisonDirty(true)
                      }}
                    />
                    {comparison.valueType === 'boolean' ? (
                      <Select
                        aria-label="布尔比较值"
                        disabled={!editable}
                        value={comparison.value}
                        options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
                        onChange={value => { setComparison(current => ({ ...current, value })); setComparisonDirty(true) }}
                      />
                    ) : (
                      <Input
                        aria-label="过滤比较值"
                        disabled={!editable}
                        type={comparison.valueType === 'number' ? 'number' : 'text'}
                        value={comparison.value}
                        placeholder="比较值"
                        onChange={event => { setComparison(current => ({ ...current, value: event.target.value })); setComparisonDirty(true) }}
                      />
                    )}
                  </div>
                  <Space wrap>
                    <Button size="small" type="primary" disabled={!editable || !comparisonReady} onClick={applyComparison}>应用比较 Filter</Button>
                    <Button size="small" disabled={!editable || !comparisonReady || selectedLayer.type === 'background'} onClick={addComparisonRule}>新增规则（复制为绘制层）</Button>
                  </Space>
                </div>
                <label className="symbol-editor__wide-control">
                  <span>Filter（MapLibre JSON）</span>
                  <Input.TextArea
                    aria-label="绘制层 Filter JSON"
                    disabled={!editable}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    placeholder='留空表示不过滤；例如 ["==", ["get", "type"], "main"]'
                    value={filterDraft}
                    onChange={event => { setFilterDraft(event.target.value); setFilterDirty(true) }}
                  />
                  <Space>
                    <Button
                      size="small"
                      type="primary"
                      disabled={!editable || !filterDirty}
                      onClick={() => {
                        let value: unknown
                        try { value = filterDraft.trim() ? JSON.parse(filterDraft) : undefined }
                        catch (error) { setMessage(`Filter JSON 解析失败：${error instanceof Error ? error.message : String(error)}`); return }
                        finishInteraction()
                        const success = writeLatest(layers => applyLayerFilterJson(layers, selectedLayer.id, value === undefined ? '' : JSON.stringify(value)))
                        if (success) setFilterDirty(false)
                      }}
                    >应用 Filter</Button>
                    <Button size="small" disabled={!editable || !layerFilter(selectedLayer)} onClick={() => { setFilterDraft(''); setFilterDirty(true) }}>清除</Button>
                  </Space>
                </label>
              </section>

              <section className="symbol-editor__section">
                <div className="symbol-editor__section-heading">高级属性</div>
                <div className="symbol-editor__advanced-json">
                  <Select
                    aria-label="高级样式属性"
                    disabled={!editable}
                    value={advancedPath}
                    options={advancedOptions(selectedLayer)}
                    onChange={path => { setAdvancedPath(path); setAdvancedDirty(false); setFilterDirty(false) }}
                  />
                  <Input.TextArea
                    aria-label="高级样式 JSON"
                    disabled={!editable}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    value={advancedDraft}
                    onChange={event => {
                      setAdvancedDraft(event.target.value)
                      setAdvancedDirty(true)
                      if (advancedPath === 'filter') { setFilterDraft(event.target.value); setFilterDirty(true) }
                    }}
                  />
                  <Space>
                    <Button size="small" type="primary" disabled={!editable || !advancedDirty} onClick={applyAdvanced}>应用 JSON</Button>
                    <Button size="small" disabled={!editable} onClick={removeAdvancedValue}>删除当前属性</Button>
                  </Space>
                </div>
              </section>
            </> : <Alert type="info" message="当前没有选中的绘制层" />}
          </main>
        </div>
      )}
    </Modal>
  )
}
