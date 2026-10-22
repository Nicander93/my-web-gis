import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, ColorPicker, Dropdown, Input, InputNumber, Select, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Color, LayerStyle, Symbol } from '@desktop-webgis/ol-style'
import { cloneSymbolWithColor, colorToString, rgb, symbolPrimaryColor } from '@desktop-webgis/ol-style'
import {
  COLOR_RAMP_OPTIONS,
  listAttributeFields,
  listNumericFields,
  parseHexColor,
  reclassifyStyle,
  switchStyleMode
} from './style-draft'
import { useCartographyEditor } from './useCartographyEditor'
import { layerCommands } from '@/app/commands/layer.commands'
import './cartography-editor.css'
import { SymbolEditor } from './SymbolEditor'
import { SymbolLibrary } from './SymbolLibrary'
import { readPersonalSymbolLibrary } from './symbol-library-store'
import { SldExportDialog } from './SldExportDialog'
import { GeoServerPublishDialog, type GeoServerLoadWmsRequest } from './GeoServerPublishDialog'
import { CartographyRulesPanel } from './CartographyRulesPanel'
import { StandardStyleControls } from './StandardStyleControls'
import { LayerSymbolPreview } from './LayerSymbolPreview'
import { addPublishedWmsLayer } from './published-wms'

interface StylePanelProps {
  layerId: string
}

interface StyleRow {
  key: string
  index: number
  value: string
  label: string
  count: number
}

function colorFromPicker(color: { toRgb(): { r: number; g: number; b: number; a: number } }): Color {
  return color.toRgb()
}

function editSymbolColor(symbol: Symbol, color: Color, part: 'primary' | 'stroke' = 'primary'): Symbol {
  if (symbol.type === 'mixed') {
    return {
      ...symbol,
      ...(symbol.point ? { point: editSymbolColor(symbol.point, color, part) as typeof symbol.point } : {}),
      ...(symbol.line ? { line: editSymbolColor(symbol.line, color, part) as typeof symbol.line } : {}),
      ...(symbol.polygon ? { polygon: editSymbolColor(symbol.polygon, color, part) as typeof symbol.polygon } : {})
    }
  }
  if (symbol.type === 'circle') {
    if (part === 'stroke') return { ...symbol, stroke: color }
    return { ...symbol, fill: color }
  }
  if ('width' in symbol) return { ...symbol, color }
  return part === 'stroke' ? { ...symbol, stroke: color } : { ...symbol, fill: color }
}

function SymbolControls({
  symbol,
  onChange,
  finish
}: {
  symbol: Symbol
  onChange: (next: Symbol, property: string) => void
  finish: () => void
}) {
  if (symbol.type === 'mixed') {
    return (
      <div className="cartography-symbol-parts">
        {symbol.point ? <SymbolControls symbol={symbol.point} onChange={(next, property) => onChange({ ...symbol, point: next as typeof symbol.point }, `point.${property}`)} finish={finish} /> : null}
        {symbol.line ? <SymbolControls symbol={symbol.line} onChange={(next, property) => onChange({ ...symbol, line: next as typeof symbol.line }, `line.${property}`)} finish={finish} /> : null}
        {symbol.polygon ? <SymbolControls symbol={symbol.polygon} onChange={(next, property) => onChange({ ...symbol, polygon: next as typeof symbol.polygon }, `polygon.${property}`)} finish={finish} /> : null}
      </div>
    )
  }

  const isPolygon = symbol.type === 'solid' && !('width' in symbol)
  const primaryColor = symbolPrimaryColor(symbol)
  const title = symbol.type === 'circle' ? '点符号' : isPolygon ? '面符号' : '线符号'
  return (
    <div className="cartography-symbol-part">
      <div className="cartography-symbol-title">{title}</div>
      <div className="cartography-control-grid">
        <span>颜色</span>
        <ColorPicker
          aria-label={`${title}颜色`}
          value={colorToString(primaryColor)}
          showText
          onChange={value => onChange(editSymbolColor(symbol, colorFromPicker(value)), 'symbol.color')}
          onOpenChange={open => { if (open) onChange(symbol, 'symbol.color'); else finish() }}
        />
        {symbol.type === 'circle' ? (
          <>
            <span>点半径（px）</span>
            <InputNumber
              aria-label="点半径"
              min={1}
              max={128}
              value={symbol.radius}
              onFocus={() => onChange(symbol, 'symbol.radius')}
              onChange={value => { if (value !== null) onChange({ ...symbol, radius: value }, 'symbol.radius') }}
              onBlur={finish}
            />
          </>
        ) : 'width' in symbol ? (
          <>
            <span>线宽（px）</span>
            <InputNumber
              aria-label="线宽"
              min={0.1}
              max={64}
              step={0.5}
              value={symbol.width}
              onFocus={() => onChange(symbol, 'symbol.width')}
              onChange={value => { if (value !== null) onChange({ ...symbol, width: value }, 'symbol.width') }}
              onBlur={finish}
            />
          </>
        ) : (
          <>
            <span>描边颜色</span>
            <ColorPicker
              aria-label="面描边颜色"
              value={colorToString(symbol.stroke ?? rgb(80, 80, 80))}
              showText
              onChange={value => onChange(editSymbolColor(symbol, colorFromPicker(value), 'stroke'), 'symbol.stroke')}
              onOpenChange={open => { if (open) onChange(symbol, 'symbol.stroke'); else finish() }}
            />
            <span>描边宽度（px）</span>
            <InputNumber
              aria-label="描边宽度"
              min={0}
              max={32}
              step={0.5}
              value={symbol.strokeWidth ?? 1}
              onFocus={() => onChange(symbol, 'symbol.strokeWidth')}
              onChange={value => { if (value !== null) onChange({ ...symbol, strokeWidth: value }, 'symbol.strokeWidth') }}
              onBlur={finish}
            />
          </>
        )}
      </div>
    </div>
  )
}

function categoryCount(features: ReturnType<typeof useCartographyEditor>['features'], field: string, value: string | number): number {
  return features.filter(feature => feature.properties?.[field] === value).length
}

export function StylePanel({ layerId }: StylePanelProps) {
  const [dialog, setDialog] = useState<'editor' | 'library' | 'sld' | 'publish'>()
  const [rules, setRules] = useState(false)
  const [drawingLayerId, setDrawingLayerId] = useState<string>()
  const editor = useCartographyEditor(layerId)
  useEffect(() => { setDialog(undefined); setRules(false); setDrawingLayerId(undefined) }, [layerId])
  function loadPublishedWms(request: GeoServerLoadWmsRequest) {
    if (addPublishedWmsLayer(request)) setDialog(undefined)
  }
  return <>
    {editor.fragment && <div className="style-symbol-summary"><LayerSymbolPreview layerId={layerId} /><div className="style-symbol-summary__actions"><Button type="link" size="small" disabled={editor.locked} onClick={() => setDialog('library')}>选择符号…</Button><Button type="link" size="small" disabled={editor.locked} onClick={() => setDialog('editor')}>专业符号编辑…</Button></div><Dropdown trigger={['click']} menu={{ items: [{ key: 'sld', label: '导出 SLD…' }, { key: 'publish', label: '发布到 GeoServer…', disabled: editor.locked }], onClick: ({ key }) => setDialog(key as 'sld' | 'publish') }}><Button size="small" aria-label="样式菜单">更多</Button></Dropdown></div>}
    {rules ? <CartographyRulesPanel layerId={layerId} onEdit={id => { setDrawingLayerId(id); setDialog('editor') }} onBack={() => setRules(false)} /> : <StylePanelBody layerId={layerId} onShowRules={() => setRules(true)} onEdit={id => { setDrawingLayerId(id); setDialog('editor') }} />}
    {!rules && editor.fragment && !editor.editable && <Button size="small" onClick={() => setRules(true)}>查看与编辑规则列表</Button>}
    {dialog === 'editor' && <SymbolEditor layerId={layerId} initialDrawingLayerId={drawingLayerId} onClose={() => { setDialog(undefined); setDrawingLayerId(undefined) }} />}
    {dialog === 'library' && <SymbolLibrary layerId={layerId} onClose={() => setDialog(undefined)} />}
    {dialog === 'sld' && <SldExportDialog layerId={layerId} onClose={() => setDialog(undefined)} />}
    {dialog === 'publish' && <GeoServerPublishDialog layerId={layerId} onClose={() => setDialog(undefined)} onLoadWms={loadPublishedWms} />}
  </>
}

function StylePanelBody({ layerId, onShowRules, onEdit }: StylePanelProps & { onShowRules(): void; onEdit(id: string): void }) {
  const editor = useCartographyEditor(layerId)
  const [selected, setSelected] = useState(0)
  const [classCount, setClassCount] = useState(5)
  const [colorRampId, setColorRampId] = useState<string>('BlueRed')
  let personalRamps: ReturnType<typeof readPersonalSymbolLibrary>['colorRamps'] = []
  try { personalRamps = readPersonalSymbolLibrary().colorRamps } catch { /* Library manager reports malformed persisted data. */ }
  const [message, setMessage] = useState<string | null>(null)
  const fields = useMemo(() => listAttributeFields(editor.features), [editor.features])
  const numericFields = useMemo(() => listNumericFields(editor.features), [editor.features])

  useEffect(() => {
    setSelected(0)
    setClassCount(5)
    setColorRampId('BlueRed')
    setMessage(null)
  }, [layerId])

  if (!editor.layer || !editor.style) return <div className="empty-state empty-state-box">请选择一个图层</div>
  const style = editor.style
  if (!editor.editable && editor.fragment) return <StandardStyleControls layerId={layerId} onEdit={onEdit} />
  if (!editor.editable) {
    return (
      <div className="inspector-card cartography-editor style-panel">
        <div className="cartography-editor__heading">样式</div>
        <Alert
          type="info"
          showIcon
          message={editor.locked ? '图层已锁定' : editor.fragment ? '高级标准样式为只读' : '当前图层不支持矢量样式编辑'}
          description={editor.locked ? '请先解锁图层或所属文件夹，再编辑样式。' : editor.fragment
            ? '当前样式含有此面板无法无损编辑的表达式或符号图层。内容已保留；本面板不会将其降级为固定值。'
            : '标准矢量样式绑定仅适用于矢量数据图层。'}
        />
      </div>
    )
  }

  function update(next: LayerStyle, property?: string) {
    editor.updateStyle(next, property)
    setMessage(null)
  }

  function updateSelectedSymbol(next: Symbol, property: string) {
    if (style.mode === 'single') {
      update({ ...style, symbol: next }, property)
    } else if (style.mode === 'categorized' && style.categories.length > selected) {
      update({ ...style, categories: style.categories.map((item, index) => index === selected ? { ...item, symbol: next } : item) }, `categories.${selected}.${property}`)
    } else if (style.mode === 'graduated' && style.breaks.length > selected) {
      update({ ...style, breaks: style.breaks.map((item, index) => index === selected ? { ...item, symbol: next } : item) }, `breaks.${selected}.${property}`)
    } else {
      update({ ...style, fallback: next }, `fallback.${property}`)
    }
  }

  const selectedSymbol: Symbol = style.mode === 'single'
    ? style.symbol
    : style.mode === 'categorized'
      ? style.categories[selected]?.symbol ?? style.fallback
      : style.breaks[selected]?.symbol ?? style.fallback

  const rows: StyleRow[] = style.mode === 'categorized'
    ? style.categories.map((item, index) => ({
        key: `category-${index}`,
        index,
        value: String(item.value),
        label: item.label ?? String(item.value),
        count: categoryCount(editor.features, style.field, item.value)
      }))
    : style.mode === 'graduated'
      ? style.breaks.map((item, index) => ({
          key: `break-${index}`,
          index,
          value: `≤ ${item.value}`,
          label: item.label ?? '',
          count: editor.features.filter(feature => {
            const value = feature.properties?.[style.field]
            return typeof value === 'number' && Number.isFinite(value) && value <= item.value &&
              (index === 0 || value > style.breaks[index - 1]!.value)
          }).length
        }))
      : []

  const columns: ColumnsType<StyleRow> = [
    { title: style.mode === 'categorized' ? '分类值' : '分级上界', dataIndex: 'value', width: 96 },
    {
      title: '图例名称',
      dataIndex: 'label',
      render: (_value, row) => (
        <Input
          aria-label={`${row.value} 图例名称`}
          value={row.label}
          onChange={event => {
            if (style.mode === 'categorized') {
              update({ ...style, categories: style.categories.map((item, index) => index === row.index ? { ...item, label: event.target.value } : item) }, `categories.${row.index}.label`)
            } else if (style.mode === 'graduated') {
              update({ ...style, breaks: style.breaks.map((item, index) => index === row.index ? { ...item, label: event.target.value || undefined } : item) }, `breaks.${row.index}.label`)
            }
          }}
          onBlur={editor.finish}
        />
      )
    },
    { title: '要素数', dataIndex: 'count', width: 68, align: 'right' }
  ]

  function reclassify() {
    editor.finish()
    const result = reclassifyStyle(style, editor.features, { classCount, colorRampId, customColors: personalRamps.find(ramp => ramp.id === colorRampId)?.colors })
    if (result.error) {
      setMessage(result.error)
      return
    }
    update(result.style)
    setSelected(0)
  }

  return (
    <div className="inspector-card cartography-editor style-panel">
      <div className="cartography-editor__heading">样式</div>
      {editor.error ? <Alert type="error" message={editor.error} /> : null}
      <section className="cartography-editor__section">
        <div className="cartography-editor__section-title">渲染方式</div>
        <div className="cartography-editor__controls">
          <Select<LayerStyle['mode'] | 'rules'>
            aria-label="渲染方式"
            value={style.mode}
            options={[
              { value: 'single', label: '单一符号' },
              { value: 'categorized', label: '分类渲染' },
              { value: 'graduated', label: '分级渲染' },
              { value: 'rules', label: '规则渲染' }
            ]}
            onChange={mode => {
              editor.finish()
              if (mode === 'rules') { onShowRules(); return }
              update(switchStyleMode(style, mode as LayerStyle['mode']))
              setSelected(0)
            }}
          />
          {style.mode !== 'single' ? (
            <Select
              aria-label={style.mode === 'categorized' ? '分类字段' : '分级字段'}
              value={style.field || undefined}
              placeholder="选择字段"
              options={(style.mode === 'graduated' ? numericFields : fields).map(field => ({ value: field, label: field }))}
              onChange={field => { editor.finish(); update({ ...style, field }) }}
            />
          ) : null}
          {style.mode === 'graduated' ? (
            <Select
              aria-label="分类方法"
              value={style.method === 'manual' ? 'equal-interval' : style.method}
              options={[{ value: 'equal-interval', label: '等间距' }, { value: 'quantile', label: '分位数' }]}
              onChange={method => { editor.finish(); update({ ...style, method: method as 'equal-interval' | 'quantile' }) }}
            />
          ) : null}
          {style.mode !== 'single' ? (
            <>
              <Select
                aria-label="分类色带"
                value={colorRampId}
                options={[...COLOR_RAMP_OPTIONS.map(ramp => ({ value: ramp.id, label: ramp.label })), ...personalRamps.map(ramp => ({ value: ramp.id, label: ramp.name }))]}
                onChange={value => { editor.finish(); setColorRampId(value) }}
              />
              {style.mode === 'graduated' ? (
                <label className="cartography-editor__compact-control">
                  <span>分段数</span>
                  <InputNumber min={1} max={32} value={classCount} onChange={value => setClassCount(value ?? 1)} />
                </label>
              ) : null}
              <Button onClick={reclassify}>{style.mode === 'categorized' ? '重新分类' : '重新分级'}</Button>
            </>
          ) : null}
        </div>
        {style.mode !== 'single' && rows.length ? (
          <Table<StyleRow>
            size="small"
            pagination={false}
            rowKey="key"
            columns={columns}
            dataSource={rows}
            rowClassName={row => row.index === selected ? 'cartography-editor__selected-row' : ''}
            onRow={row => ({ onClick: () => { setSelected(row.index) } })}
          />
        ) : style.mode !== 'single' ? (
          <div className="cartography-editor__empty-classes">暂无分类项，请选择字段后重新分类。</div>
        ) : null}
      </section>

      <section className="cartography-editor__section">
        <div className="cartography-editor__section-title">
          {style.mode === 'single' ? '符号参数' : style.mode === 'categorized' ? rows[selected]?.label ?? 'Fallback 符号' : rows[selected]?.label ?? 'Fallback 符号'}
        </div>
        <SymbolControls symbol={selectedSymbol} onChange={updateSelectedSymbol} finish={editor.finish} />
      </section>

      {style.mode !== 'single' ? (
        <section className="cartography-editor__section">
          <div className="cartography-editor__section-title">未匹配默认符号</div>
          <SymbolControls
            symbol={style.fallback}
            onChange={(symbol, property) => update({ ...style, fallback: symbol }, `fallback.${property}`)}
            finish={editor.finish}
          />
        </section>
      ) : null}

      {message ? <Alert className="cartography-editor__message" type="warning" message={message} /> : null}
      <section className="cartography-editor__section cartography-editor__layer-rendering">
        <div className="cartography-editor__section-title">图层渲染</div>
        <Button onClick={() => layerCommands.properties(layerId)}>图层显示设置…</Button>
      </section>
    </div>
  )
}
