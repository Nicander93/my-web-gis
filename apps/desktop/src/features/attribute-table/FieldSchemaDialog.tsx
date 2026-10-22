import { useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, InputNumber, Select, Space, Typography } from 'antd'
import { capabilitiesForDataset, createId, getEffectiveLocked, SetDatasetContentCommand, type DatasetField } from '@desktop-webgis/gis-core'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useSessionStore } from '@/stores/session.store'
import { parseCellValue } from './field-edits'
import { getFieldReferences, prepareFieldSchemaEdit, type FieldSchemaEdit } from './field-schema-edits'

/** Field transactions remain bound to the layer that opened them. */
export function FieldSchemaDialog({ layerId, mode, name, onClose }: {
  layerId: string; mode: 'add' | 'rename' | 'remove'; name?: string; onClose(): void
}) {
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const editLayerId = useWorkbenchStore((state) => state.editLayerId)
  const sessions = useSessionStore((state) => state.sessions)
  const layer = project.layers.find((item) => item.id === layerId)
  const dataset = project.datasets.find((item) => item.id === layer?.datasetId)
  const affected = project.layers.filter((item) => item.datasetId === dataset?.id)
  const [newName, setNewName] = useState(mode === 'rename' ? name ?? '' : '')
  const [type, setType] = useState<DatasetField['type']>('string')
  const [nullable, setNullable] = useState(true)
  const [nullDefault, setNullDefault] = useState(true)
  const [draft, setDraft] = useState('')
  const [clearReferences, setClearReferences] = useState(false)
  const [error, setError] = useState('')
  const title = { add: '新增字段', rename: '重命名字段', remove: '删除字段' }[mode]
  const locked = affected.find((item) => getEffectiveLocked(project, item.id))
  const canEdit = !!dataset && capabilitiesForDataset(dataset).editGeometry && editLayerId === layerId && !locked
  const tableFilterReferences = name ? affected.filter((item) =>
    sessions[item.id]?.attributeTable?.filterDraft?.some((condition) => condition.field === name))
    .map((item) => `${item.name}：属性表筛选`) : []
  const references = name ? [...getFieldReferences(project, affected, name), ...tableFilterReferences] : []

  function apply(): void {
    try {
      if (!dataset || !canEdit) throw new Error('当前图层不是可写编辑目标，或已被锁定')
      if (mode !== 'add' && !name) throw new Error('原字段已不存在')
      if (mode === 'remove' && tableFilterReferences.length && !clearReferences) throw new Error('请先调整属性表筛选，或勾选同时移除引用')
      const field = { name: newName, type, nullable }
      const edit: FieldSchemaEdit = mode === 'add'
        ? { type: 'add', field, defaultValue: nullDefault ? null : parseCellValue(field, draft) }
        : mode === 'rename' ? { type: 'rename', from: name!, to: newName }
          : { type: 'remove', name: name!, clearReferences }
      const result = prepareFieldSchemaEdit(project, dataset.id, featuresByDataset[dataset.id] ?? [], edit)
      if (!useProjectStore.getState().executeEditCommand(new SetDatasetContentCommand(
        createId('cmd'), title, dataset.id, result.before, result.after, result.change))) throw new Error('字段操作未应用')
      for (const item of affected) {
        const tableFilter = sessions[item.id]?.attributeTable?.filterDraft
        if (!tableFilter?.length) continue
        if (mode === 'rename' && name) {
          useSessionStore.getState().setAttributeTableState(item.id, { filterDraft: tableFilter.map((condition) =>
            condition.field === name ? { ...condition, field: newName } : condition) })
        } else if (mode === 'remove' && clearReferences) {
          useSessionStore.getState().setAttributeTableState(item.id, { filterDraft: tableFilter.filter((condition) => condition.field !== name) })
        }
      }
      onClose()
      // Rename/delete can remove the original row button; use the stable field-list entry.
      queueMicrotask(() => document.querySelector<HTMLElement>('.attribute-table-tab-panel:not([hidden]) .attr-columns button')?.focus())
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  return <EditorDialog title={title} onClose={onClose}>
    <Form layout="vertical" onFinish={apply} className="field-schema-form">
      <Typography.Paragraph>图层：{layer?.name ?? '目标已不存在'}。本次修改影响同一数据集的 {affected.length} 个图层，可一步撤销。</Typography.Paragraph>
      {mode !== 'remove' && <Form.Item label={mode === 'rename' ? '新字段名' : '字段名'}>
        <Input aria-label="字段名称" value={newName} onChange={(event) => { setNewName(event.target.value); setError('') }} />
      </Form.Item>}
      {mode === 'add' && <>
        <Form.Item label="字段类型"><Select aria-label="新增字段类型" value={type} onChange={(value) => { setType(value); setDraft('') }}
          options={[{ value: 'string', label: '文本' }, { value: 'number', label: '数值' }, { value: 'boolean', label: '布尔' }, { value: 'json', label: 'JSON' }]} /></Form.Item>
        <Form.Item><Checkbox checked={nullable} onChange={(event) => {
          setNullable(event.target.checked); if (!event.target.checked) setNullDefault(false)
        }}>允许空值</Checkbox></Form.Item>
        <Form.Item><Checkbox checked={nullDefault} disabled={!nullable} onChange={(event) => setNullDefault(event.target.checked)}>默认值为空</Checkbox></Form.Item>
        {!nullDefault && <Form.Item label="默认值（应用于全部记录）">
          {type === 'number' ? <InputNumber aria-label="新增字段默认值" value={draft === '' ? null : Number(draft)}
            onChange={(value) => setDraft(value == null ? '' : String(value))} style={{ width: '100%' }} />
            : type === 'boolean' ? <Select aria-label="新增字段默认值" value={draft || undefined} onChange={setDraft}
              options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} />
              : <Input aria-label="新增字段默认值" value={draft} placeholder={type === 'json' ? '例如 {"enabled":true}' : ''}
                onChange={(event) => setDraft(event.target.value)} />}
        </Form.Item>}
      </>}
      {mode === 'rename' && <Alert type="info" showIcon title={`保留 ${name} 的字段类型、值和几何；同步重命名过滤、样式、标注和弹窗引用。`} />}
      {mode === 'remove' && <>
        <Alert type="warning" showIcon title={`将删除字段 ${name} 及全部记录中的对应值。`} />
        {references.length > 0 && <Typography.Paragraph>引用：{references.join('；')}</Typography.Paragraph>}
        <Form.Item><Checkbox checked={clearReferences} onChange={(event) => setClearReferences(event.target.checked)}>
          同时移除过滤、样式、标注、弹窗及表格草稿中的引用（分类/分级样式回退为其默认符号）
        </Checkbox></Form.Item>
      </>}
      {!canEdit && <Alert type="warning" title={locked ? `共享数据集的图层 ${locked.name} 已锁定，请先解除锁定`
        : '只读：请先将当前本地矢量图层设为编辑目标'} />}
      {error && <Alert role="alert" type="error" showIcon title={error} />}
      <Space className="desktop-dialog-actions">
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" danger={mode === 'remove'} htmlType="submit" disabled={!canEdit}>
          {mode === 'remove' ? '删除字段及数据' : '应用字段修改'}
        </Button>
      </Space>
    </Form>
  </EditorDialog>
}
