import { useState } from 'react'
import { AutoComplete, Button, Checkbox, Input, Select } from 'antd'
import { createId, SetDatasetContentCommand, type DatasetField, type GisFeature } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { capabilitiesForDataset, getEffectiveLocked } from '@desktop-webgis/gis-core'
import { calculateTableField, resolveDatasetFields } from './field-edits'

type CalculationScope = 'all' | 'filtered' | 'selected'

export function FieldCalculator({ layerId, filteredFeatures, selectedIds, onClose }: {
  layerId: string; filteredFeatures: GisFeature[]; selectedIds: ReadonlySet<string>; onClose(): void
}) {
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const editLayerId = useWorkbenchStore((state) => state.editLayerId)
  const layer = project.layers.find((item) => item.id === layerId)
  const dataset = project.datasets.find((item) => item.id === layer?.datasetId)
  const features = dataset ? featuresByDataset[dataset.id] ?? [] : []
  const fields = resolveDatasetFields(features, dataset?.fields)
  const [name, setName] = useState('')
  const [type, setType] = useState<DatasetField['type']>('number')
  const [nullable, setNullable] = useState(true)
  const [scope, setScope] = useState<CalculationScope>('all')
  const [expression, setExpression] = useState('')
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const existing = fields.find((field) => field.name === name)
  const targets = scope === 'all' ? features : scope === 'filtered' ? filteredFeatures
    : features.filter((feature) => selectedIds.has(feature.id))
  const canEdit = !!dataset && editLayerId === layerId && !getEffectiveLocked(project, layerId) && capabilitiesForDataset(dataset).editGeometry

  function apply(): void {
    setFailed(false)
    try {
      if (!dataset || !canEdit) throw new Error('请先将当前本地矢量图层设为编辑目标，并解除锁定')
      const result = calculateTableField(features, dataset.fields, existing ?? { name, type, nullable }, expression,
        new Set(targets.map((feature) => feature.id)))
      const ok = useProjectStore.getState().executeEditCommand(new SetDatasetContentCommand(
        createId('cmd'), '字段计算', dataset.id, { fields: dataset.fields, features }, result))
      if (!ok) throw new Error('字段计算未应用')
      setMessage(`已计算 ${result.count} 条记录，可一步撤销`)
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }
  return <section className="attr-field-calculator" aria-label="字段计算器">
    <label>字段<AutoComplete value={name} onChange={setName} style={{ width: 150 }}
      options={fields.map((field) => ({ value: field.name }))}>
      <Input aria-label="计算字段名" />
    </AutoComplete></label>
    <label>类型<Select aria-label="计算字段类型" style={{ width: 80 }} value={existing?.type ?? type} disabled={!!existing}
      onChange={setType} options={[{ value: 'number', label: '数值' }, { value: 'string', label: '文本' },
        { value: 'boolean', label: '布尔' }, { value: 'json', label: 'JSON' }]} /></label>
    <Checkbox checked={existing?.nullable ?? nullable} disabled={!!existing}
      onChange={(event) => setNullable(event.target.checked)}>允许空值</Checkbox>
    <label>范围<Select aria-label="计算范围" style={{ width: 115 }} value={scope} onChange={setScope}
      options={[{ value: 'all', label: '全部记录' }, { value: 'filtered', label: '图层过滤后' },
        { value: 'selected', label: '选中记录' }]} /></label><span>{targets.length} 条</span>
    <label className="attr-expression">表达式<Input aria-label="字段计算表达式" value={expression}
      placeholder={'例如 field("人口") * 2'} onChange={(event) => setExpression(event.target.value)} /></label>
    <Button type="primary" onClick={apply} disabled={!canEdit}>应用计算</Button>
    <Button onClick={onClose}>关闭计算器</Button>
    <small>支持 field、coalesce、round、concat 和算术运算；表内搜索不改变计算范围。覆盖已有字段保留原类型。</small>
    {!canEdit && <span>只读：请设置当前图层为编辑目标</span>}
    {message && <span role={failed ? 'alert' : 'status'}>{message}</span>}
  </section>
}
