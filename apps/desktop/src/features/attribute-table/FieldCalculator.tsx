import { useState } from 'react'
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
    <label>字段<input aria-label="计算字段名" value={name} list={`fields-${layerId}`}
      onChange={(event) => setName(event.target.value)} /></label>
    <datalist id={`fields-${layerId}`}>{fields.map((field) => <option key={field.name} value={field.name} />)}</datalist>
    <label>类型<select aria-label="计算字段类型" value={existing?.type ?? type} disabled={!!existing}
      onChange={(event) => setType(event.target.value as DatasetField['type'])}>
      <option value="number">数值</option><option value="string">文本</option>
      <option value="boolean">布尔</option><option value="json">JSON</option>
    </select></label>
    <label><input type="checkbox" checked={existing?.nullable ?? nullable} disabled={!!existing}
      onChange={(event) => setNullable(event.target.checked)} />允许空值</label>
    <label>范围<select aria-label="计算范围" value={scope} onChange={(event) => setScope(event.target.value as CalculationScope)}>
      <option value="all">全部记录</option><option value="filtered">图层过滤后</option><option value="selected">选中记录</option>
    </select></label><span>{targets.length} 条</span>
    <label className="attr-expression">表达式<input aria-label="字段计算表达式" value={expression}
      placeholder={'例如 field("人口") * 2'} onChange={(event) => setExpression(event.target.value)} /></label>
    <button type="button" onClick={apply} disabled={!canEdit}>应用计算</button>
    <button type="button" onClick={onClose}>关闭计算器</button>
    <small>支持 field、coalesce、round、concat 和算术运算；表内搜索不改变计算范围。覆盖已有字段保留原类型。</small>
    {!canEdit && <span>只读：请设置当前图层为编辑目标</span>}
    {message && <span role={failed ? 'alert' : 'status'}>{message}</span>}
  </section>
}
