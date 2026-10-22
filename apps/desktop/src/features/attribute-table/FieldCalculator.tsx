import { useMemo, useRef, useState } from 'react'
import { AutoComplete, Checkbox, Input, Radio, Select, Table, Tag } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { Button } from '@/components/ui/Button'
import { createId, SetDatasetContentCommand, type DatasetField, type FieldFilterCondition, type GisFeature } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { capabilitiesForDataset, getEffectiveLocked } from '@desktop-webgis/gis-core'
import { calculateTableField, previewTableField, resolveDatasetFields, resolveFieldCalculationTargets, type FieldCalculationPreviewRow, type FieldCalculationScope } from './field-edits'

function formatPreviewValue(value: unknown): string {
  if (value == null) return '空值'
  if (typeof value === 'object') return JSON.stringify(value) ?? '空值'
  return String(value)
}

const FUNCTIONS = ['coalesce', 'round', 'concat', 'abs', 'min', 'max']

export function FieldCalculator({ layerId, tableFeatures, selectedIds, onClose }: {
  layerId: string; tableFeatures: GisFeature[]; selectedIds: ReadonlySet<string>; onClose(): void
}) {
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const editLayerId = useWorkbenchStore((state) => state.editLayerId)
  const layer = project.layers.find((item) => item.id === layerId)
  const dataset = project.datasets.find((item) => item.id === layer?.datasetId)
  const features = dataset ? featuresByDataset[dataset.id] ?? [] : []
  const fields = resolveDatasetFields(features, dataset?.fields)
  const [mode, setMode] = useState<'create' | 'update'>('create')
  const [name, setName] = useState('')
  const [type, setType] = useState<DatasetField['type']>('number')
  const [nullable, setNullable] = useState(true)
  const [scope, setScope] = useState<FieldCalculationScope>('all')
  const [expression, setExpression] = useState('')
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const expressionRef = useRef<TextAreaRef>(null)
  const selectedField = mode === 'update' ? fields.find((field) => field.name === name) : undefined
  const targetField = selectedField ?? { name, type, nullable }
  const targets = resolveFieldCalculationTargets(scope, features, tableFeatures, layer?.filter ?? [], selectedIds)
  const canEdit = !!dataset && editLayerId === layerId && !getEffectiveLocked(project, layerId) && capabilitiesForDataset(dataset).editGeometry
  const preview = useMemo(() => {
    if (!expression.trim() || !name.trim() || (mode === 'update' && !selectedField)) return { rows: [], error: '' }
    try {
      return { rows: previewTableField(features, targets, targetField, expression, dataset?.fields), error: '' }
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error) }
    }
  }, [features, targets, targetField, expression, dataset?.fields, name, mode, selectedField])

  function insertExpression(value: string): void {
    const input = expressionRef.current?.resizableTextArea?.textArea
    const start = input?.selectionStart ?? expression.length
    const end = input?.selectionEnd ?? expression.length
    const next = `${expression.slice(0, start)}${value}${expression.slice(end)}`
    setExpression(next)
    requestAnimationFrame(() => {
      expressionRef.current?.focus()
      input?.setSelectionRange(start + value.length, start + value.length)
    })
  }

  function apply(): void {
    setFailed(false)
    try {
      if (!dataset || !canEdit) throw new Error('请先将当前本地矢量图层设为编辑目标，并解除锁定')
      if (mode === 'update' && !selectedField) throw new Error('请选择要更新的已有字段')
      if (mode === 'create' && fields.some((field) => field.name === name)) throw new Error('字段已存在；请选择“更新已有字段”')
      const field = selectedField ?? { name, type, nullable }
      const result = calculateTableField(features, dataset.fields, field, expression,
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
    <div className="attr-calculator-config">
      <div className="attr-calculator-config-row">
        <span>操作模式</span>
        <Radio.Group aria-label="字段操作" value={mode} onChange={(event) => {
          setMode(event.target.value); setName(''); setMessage('')
        }} optionType="button" buttonStyle="solid" options={[
          { value: 'create', label: '新建字段' }, { value: 'update', label: '更新已有字段' }
        ]} />
      </div>
      <div className="attr-calculator-config-row">
        {mode === 'create' ? <label>字段名<AutoComplete className="attr-calculator-field-name" value={name} onChange={setName}
          options={fields.map((field) => ({ value: field.name }))}>
          <Input aria-label="计算字段名" />
        </AutoComplete></label> : <label>目标字段<Select aria-label="更新字段" className="attr-calculator-field-name" value={name || undefined}
          placeholder="选择已有字段" onChange={setName} options={fields.map((field) => ({ value: field.name, label: field.name }))} />
        </label>}
        {mode === 'create' && <>
          <label>类型<Select aria-label="计算字段类型" className="attr-calculator-field-type" value={type} onChange={setType}
            options={[{ value: 'number', label: '数值' }, { value: 'string', label: '文本' },
              { value: 'boolean', label: '布尔' }, { value: 'json', label: 'JSON' }]} /></label>
          <Checkbox checked={nullable} onChange={(event) => setNullable(event.target.checked)}>允许空值</Checkbox>
        </>}
      </div>
      <div className="attr-calculator-config-row">
        <label>计算范围<Select aria-label="计算范围" className="attr-calculator-field-scope" value={scope} onChange={setScope}
          options={[{ value: 'all', label: '全部记录' }, { value: 'table', label: '当前表格结果' },
            { value: 'layer-filtered', label: '图层过滤后' }, { value: 'selected', label: '选中记录' }]} /></label>
        <strong className="attr-calculator-target-count" aria-label="目标记录数">目标记录：{targets.length} 条</strong>
      </div>
    </div>
    <div className="attr-expression-tools">
      <Select aria-label="插入字段" className="attr-calculator-insert-field" placeholder="插入字段…" value={undefined}
        options={fields.map((field) => ({ value: field.name, label: field.name }))}
        onChange={(field) => insertExpression(`field(${JSON.stringify(field)})`)} />
      <Select aria-label="插入函数" className="attr-calculator-insert-function" placeholder="插入函数…" value={undefined}
        options={FUNCTIONS.map((name) => ({ value: name, label: name }))}
        onChange={(fn) => insertExpression(`${fn}()`)} />
    </div>
    <label className="attr-expression">表达式<Input.TextArea ref={expressionRef} aria-label="字段计算表达式" value={expression}
      rows={3} placeholder={'例如 field("人口") * 2'} onChange={(event) => { setExpression(event.target.value); setMessage('') }} />
    </label>
    <div className="attr-calculator-preview" aria-label="计算预览">
      <strong>预览前 5 条目标记录</strong>
      {preview.error && <span role="alert">{preview.error}</span>}
      <Table<FieldCalculationPreviewRow> size="small" rowKey="index" dataSource={preview.rows} pagination={false}
        locale={{ emptyText: '当前范围没有可预览记录' }} columns={[
          { title: '记录', dataIndex: 'index', width: 86, render: (index: number) => `第 ${index} 条` },
          { title: '结果', key: 'result', render: (_, row) => row.error
            ? <span className="attr-calculator-preview__error" role="alert">{row.error}</span>
            : <span className="attr-calculator-preview__result">{formatPreviewValue(row.value)}</span> },
          { title: '状态', key: 'status', width: 76, render: (_, row) => <Tag color={row.error ? 'error' : row.value == null ? 'default' : 'success'}>
            {row.error ? '错误' : row.value == null ? '空值' : '正常'}
          </Tag> }
        ]} />
    </div>
    <small>支持 field、coalesce、round、concat、abs、min、max、算术与三元表达式。表格结果含当前搜索、筛选和仅选中条件；表内计算不改变地图过滤。</small>
    {!canEdit && <span>只读：请设置当前图层为编辑目标</span>}
    {message && <span role={failed ? 'alert' : 'status'}>{message}</span>}
    <div className="attr-calculator-actions">
      <Button variant="primary" onClick={apply} disabled={!canEdit}>应用计算</Button>
      <Button onClick={onClose}>关闭计算器</Button>
    </div>
  </section>
}
