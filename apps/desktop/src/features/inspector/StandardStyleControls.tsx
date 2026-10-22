import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, ColorPicker, InputNumber, Select } from 'antd'
import { getEffectiveLocked, getLayerCartography } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { beginStyleInteraction, finishStyleInteraction } from './style-interaction'
import { updateStandardStyleProperty } from './standard-style-properties'
import { listAttributeFields } from './style-draft'

interface Parameter {
  key: string
  label: string
  kind: 'color' | 'number'
  fallback: string | number
  min?: number
  max?: number
}

const paintParameters: Record<string, Parameter[]> = {
  circle: [
    { key: 'circle-color', label: '颜色', kind: 'color', fallback: '#3388ff' },
    { key: 'circle-radius', label: '半径', kind: 'number', fallback: 5, min: 0 },
    { key: 'circle-stroke-color', label: '描边颜色', kind: 'color', fallback: '#ffffff' },
    { key: 'circle-stroke-width', label: '描边宽度', kind: 'number', fallback: 0, min: 0 },
    { key: 'circle-opacity', label: '不透明度', kind: 'number', fallback: 1, min: 0, max: 1 }
  ],
  line: [
    { key: 'line-color', label: '颜色', kind: 'color', fallback: '#3388ff' },
    { key: 'line-width', label: '线宽', kind: 'number', fallback: 1, min: 0 },
    { key: 'line-opacity', label: '不透明度', kind: 'number', fallback: 1, min: 0, max: 1 }
  ],
  fill: [
    { key: 'fill-color', label: '填充颜色', kind: 'color', fallback: '#3388ff' },
    { key: 'fill-outline-color', label: '边线颜色', kind: 'color', fallback: '#3388ff' },
    { key: 'fill-opacity', label: '不透明度', kind: 'number', fallback: 1, min: 0, max: 1 }
  ],
  symbol: [
    { key: 'text-color', label: '文字颜色', kind: 'color', fallback: '#000000' },
    { key: 'text-halo-color', label: '描边颜色', kind: 'color', fallback: '#ffffff' },
    { key: 'text-halo-width', label: '描边宽度', kind: 'number', fallback: 0, min: 0 }
  ]
}

/** The compact panel edits each representable property independently of advanced siblings. */
export function StandardStyleControls({ layerId, labels = false, onEdit }: { layerId: string; labels?: boolean; onEdit(id: string): void }) {
  const project = useProjectStore(state => state.project)
  const epoch = useProjectStore(state => state.projectEpoch)
  const rows = useProjectStore(state => state.featuresByDataset)
  const fragment = getLayerCartography(project, layerId)
  const layer = project.layers.find(item => item.id === layerId)
  const fields = useMemo(() => listAttributeFields(layer ? rows[layer.datasetId] ?? [] : []), [layer, rows])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const layers = fragment?.styleLayers.filter(item => labels ? item.type === 'symbol' : item.type !== 'symbol') ?? []
  const selected = layers.find(item => item.id === selectedId) ?? layers[0]
  const locked = getEffectiveLocked(project, layerId)
  useEffect(() => () => finishStyleInteraction(layerId), [layerId])
  if (!selected) return <div className="empty-state">{labels ? '当前没有文字样式，可在专业标注编辑中添加。' : '当前没有可编辑的符号图层。'}</div>

  function update(section: 'paint' | 'layout', key: string, value: unknown) {
    if (!selected || locked) return
    try {
      updateStandardStyleProperty(epoch, layerId, selected.id, section, key, value, beginStyleInteraction(layerId, `${selected.id}.${key}`))
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  function parameter(item: Parameter, section: 'paint' | 'layout' = 'paint') {
    const properties = selected?.[section] as Record<string, unknown> | undefined
    const value = properties?.[item.key] ?? item.fallback
    const isExpression = item.kind === 'color' ? typeof value !== 'string' : typeof value !== 'number'
    return <label key={item.key} className="cartography-editor__field"><span>{item.label}</span>
      {isExpression ? <Button aria-label={`${item.label}表达式`} disabled={locked} title="保留原表达式，在专业编辑器中修改" onClick={() => selected && onEdit(selected.id)}>表达式…</Button>
        : item.kind === 'color' ? <ColorPicker aria-label={`标准${item.label}`} disabled={locked} showText value={String(value)}
          onChange={color => update(section, item.key, color.toRgbString())} onOpenChange={open => { if (!open) finishStyleInteraction(layerId) }} />
          : <InputNumber aria-label={`标准${item.label}`} disabled={locked} value={Number(value)} min={item.min} max={item.max} step={item.max === 1 ? 0.1 : 0.5}
            onChange={value => { if (value !== null) update(section, item.key, value) }} onBlur={() => finishStyleInteraction(layerId)} />}
    </label>
  }

  const text = selected.type === 'symbol' ? selected.layout?.['text-field'] : undefined
  const field = Array.isArray(text) && text.length === 2 && text[0] === 'get' && typeof text[1] === 'string' ? text[1] : undefined
  return <div className={`cartography-editor standard-style-controls${labels ? ' label-panel' : ' style-panel'}`}>
    <Select aria-label={labels ? '文字样式图层' : '符号图层'} value={selected.id} onChange={id => { finishStyleInteraction(layerId); setSelectedId(id) }} options={layers.map((item, index) => ({ value: item.id, label: `${index + 1} · ${item.type} · ${item.id}` }))} />
    {locked && <Alert type="info" title="图层已锁定" />}
    {error && <Alert type="error" title={error} />}
    {labels && <label className="cartography-editor__field"><span>标注字段</span>{field
      ? <Select aria-label="标准标注字段" disabled={locked} value={field} options={fields.map(value => ({ value, label: value }))} onChange={value => { update('layout', 'text-field', ['get', value]); finishStyleInteraction(layerId) }} />
      : <Button disabled={locked} onClick={() => onEdit(selected.id)}>文字表达式…</Button>}</label>}
    <div className="cartography-editor__controls cartography-editor__controls--two">
      {labels && parameter({ key: 'text-size', label: '字号', kind: 'number', fallback: 16, min: 1 }, 'layout')}
      {(paintParameters[selected.type] ?? []).map(item => parameter(item))}
    </div>
    <Button size="small" disabled={locked} onClick={() => onEdit(selected.id)}>更多符号参数…</Button>
  </div>
}
