import { useEffect, useState } from 'react'
import { Alert, Button, Input, Select, Tag } from 'antd'
import { applyFieldFilter, type FieldFilterCondition, type FieldFilterOp } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { ModelessWindow } from '@/components/ui/ModelessWindow'
import { layerFilterEvent } from './layer-filter-request'

export function LayerFilterWindowHost() {
  const epoch = useProjectStore(state => state.projectEpoch)
  const [target, setTarget] = useState<{ id: string; epoch: number }>()
  useEffect(() => {
    const open = (event: Event) => setTarget({ id: (event as CustomEvent<string>).detail, epoch: useProjectStore.getState().projectEpoch })
    window.addEventListener(layerFilterEvent, open)
    return () => window.removeEventListener(layerFilterEvent, open)
  }, [])
  return target?.epoch === epoch ? <LayerFilterWindow key={`${epoch}:${target.id}`} layerId={target.id} onClose={() => setTarget(undefined)} /> : null
}

function LayerFilterWindow({ layerId, onClose }: { layerId: string; onClose(): void }) {
  const project = useProjectStore(state => state.project)
  const features = useProjectStore(state => state.featuresByDataset)
  const layer = project.layers.find(item => item.id === layerId)
  const [base] = useState(() => JSON.stringify(layer?.filter ?? []))
  const [conditions, setConditions] = useState<FieldFilterCondition[]>(() => structuredClone(layer?.filter ?? []))
  const [field, setField] = useState(''), [op, setOp] = useState<FieldFilterOp>('eq'), [value, setValue] = useState('')
  const [error, setError] = useState('')
  const rows = layer ? features[layer.datasetId] ?? [] : []
  const fields = [...new Set(rows.flatMap(row => Object.keys(row.properties)))]
  const hasValue = op !== 'is-empty' && op !== 'is-not-empty'
  const count = applyFieldFilter(rows, conditions).length
  function apply() {
    const current = useProjectStore.getState().project.layers.find(item => item.id === layerId)
    if (!current) { setError('图层已移除。'); return }
    if (JSON.stringify(current.filter ?? []) !== base) { setError('图层过滤已在其他位置改变，请重新打开。'); return }
    try { useProjectStore.getState().setLayerFilter(layerId, conditions); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <ModelessWindow title="图层过滤" width={560} height={300} onClose={onClose}><div className="layer-filter-window">
    <strong>{layer?.name ?? '图层已移除'}</strong><p>过滤地图上的要素显示 · 匹配 {count} / {rows.length} 条</p>
    <div className="layer-filter-window__builder">
      <Select aria-label="图层过滤字段" placeholder="字段" value={field || undefined} options={fields.map(value => ({ value, label: value }))} onChange={setField} />
      <Select aria-label="图层过滤条件" value={op} onChange={setOp} options={([{ value: 'eq', label: '等于' }, { value: 'neq', label: '不等于' }, { value: 'contains', label: '包含' }, { value: 'lt', label: '小于' }, { value: 'lte', label: '小于等于' }, { value: 'gt', label: '大于' }, { value: 'gte', label: '大于等于' }, { value: 'is-empty', label: '为空' }, { value: 'is-not-empty', label: '非空' }])} />
      {hasValue && <Input aria-label="图层过滤值" value={value} onChange={event => setValue(event.target.value)} />}
      <Button disabled={!field} onClick={() => setConditions(previous => [...previous, { field, op, ...(hasValue ? { value: parseValue(value) } : {}) }])}>添加</Button>
    </div>
    <div>{conditions.map((item, index) => <Tag key={index} closable onClose={() => setConditions(previous => previous.filter((_, candidate) => candidate !== index))}>{item.field} {item.op} {String(item.value ?? '')}</Tag>)}</div>
    {error && <Alert type="error" title={error} />}
    <footer><Button onClick={() => setConditions([])}>清除条件</Button><Button type="primary" disabled={!layer} onClick={apply}>应用图层过滤</Button></footer>
  </div></ModelessWindow>
}

function parseValue(raw: string): unknown {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  return value !== '' && Number.isFinite(Number(value)) ? Number(value) : raw
}
