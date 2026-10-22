import { useState } from 'react'
import { Alert, Button, Dropdown, Select, Space, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import { Eye, EyeOff, MoreHorizontal, Pencil } from 'lucide-react'
import { createId, getEffectiveLocked, getLayerCartography } from '@desktop-webgis/gis-core'
import type { CartographyState } from '@desktop-webgis/gis-core'
import {
  createDrawingLayer,
  duplicateDrawingLayer,
  moveDrawingLayer,
  removeDrawingLayer,
  setDrawingLayerProperty,
  type DrawingLayerType
} from '@desktop-webgis/ol-style/cartography-operations'
import { useProjectStore } from '@/stores/project.store'
import { finishStyleInteraction } from './style-interaction'
import './cartography-rules-panel.css'

type StyleLayer = CartographyState['styleLayers'][number]
type FilterLayer = StyleLayer & { filter?: unknown }

const drawingTypes: Array<{ value: DrawingLayerType; label: string }> = [
  { value: 'line', label: '线' },
  { value: 'circle', label: '圆点' },
  { value: 'fill', label: '面' },
  { value: 'symbol', label: '注记' }
]

export function summarizeRuleFilter(filter: unknown): string {
  if (filter === undefined) return '全部要素'
  const serialized = JSON.stringify(filter)
  return serialized.length > 92 ? `${serialized.slice(0, 89)}…` : serialized
}

/** Only the visibility property changes; every other standard AST field remains untouched. */
export function setRuleLayerVisibility(layers: readonly StyleLayer[], id: string, visible: boolean): StyleLayer[] {
  return setDrawingLayerProperty(layers, id, 'layout', 'visibility', visible ? 'visible' : 'none') as StyleLayer[]
}

export function CartographyRulesPanel({ layerId, onEdit, onBack }: { layerId: string; onEdit: (drawingLayerId: string) => void; onBack?: () => void }) {
  const project = useProjectStore(state => state.project)
  const fragment = getLayerCartography(project, layerId)
  const locked = getEffectiveLocked(project, layerId)
  const [newType, setNewType] = useState<DrawingLayerType>('line')
  const [error, setError] = useState<string>()
  const layers = fragment?.styleLayers ?? []

  function writeLatest(build: (current: StyleLayer[], styleSourceId: string) => StyleLayer[]) {
    const state = useProjectStore.getState()
    if (!state.project.layers.some(layer => layer.id === layerId) || getEffectiveLocked(state.project, layerId)) {
      setError('当前图层已删除或锁定，无法修改规则。')
      return
    }
    const currentFragment = getLayerCartography(state.project, layerId)
    if (!currentFragment) {
      setError('当前图层的标准样式绑定已移除。')
      return
    }
    try {
      finishStyleInteraction(layerId)
      state.setLayerCartography(layerId, build(currentFragment.styleLayers, currentFragment.binding.styleSourceId))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function duplicate(id: string) {
    writeLatest(current => duplicateDrawingLayer(current, id, createId('style-layer')) as StyleLayer[])
  }

  function remove(id: string) {
    writeLatest(current => removeDrawingLayer(current, id) as StyleLayer[])
  }

  function move(id: string, offset: -1 | 1) {
    writeLatest(current => {
      const index = current.findIndex(layer => layer.id === id)
      if (index < 0) throw new Error(`规则不存在：${id}`)
      return moveDrawingLayer(current, id, index + offset) as StyleLayer[]
    })
  }

  function setVisibility(layer: StyleLayer, visible: boolean) {
    writeLatest(current => setRuleLayerVisibility(current, layer.id, visible))
  }

  function add() {
    writeLatest((current, source) => [...current, createDrawingLayer({ id: createId('style-layer'), source, type: newType }) as StyleLayer])
  }

  const columns: TableColumnsType<StyleLayer> = [
    {
      title: '规则摘要',
      dataIndex: 'id',
      width: '68%',
      render: (_, layer) => <div className="cartography-rules__summary">
        <div className="cartography-rules__summary-heading">
          <Tag>{drawingTypes.find(type => type.value === layer.type)?.label ?? layer.type}</Tag>
          <code title={layer.id}>{layer.id}</code>
        </div>
        <span className="cartography-rules__filter" title={summarizeRuleFilter((layer as FilterLayer).filter)}>{summarizeRuleFilter((layer as FilterLayer).filter)}</span>
        <span className="cartography-rules__zoom">Zoom {layer.minzoom ?? '—'}–{layer.maxzoom ?? '—'}</span>
      </div>
    },
    {
      title: '操作',
      width: '32%',
      align: 'right',
      render: (_, layer, index) => {
        const visible = layer.layout?.visibility !== 'none'
        return <div className="cartography-rules__actions">
          <Button size="small" type="text" icon={<Pencil size={14} />} disabled={locked} aria-label={`编辑规则 ${layer.id}`} title="编辑" onClick={() => onEdit(layer.id)} />
          <Button size="small" type="text" icon={visible ? <Eye size={14} /> : <EyeOff size={14} />} disabled={locked} aria-label={`${visible ? '隐藏' : '显示'}规则 ${layer.id}`} title={visible ? '隐藏' : '显示'} onClick={() => setVisibility(layer, !visible)} />
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'duplicate', label: '复制', disabled: locked },
                { key: 'move-up', label: '上移', disabled: locked || index === 0 },
                { key: 'move-down', label: '下移', disabled: locked || index === layers.length - 1 },
                { type: 'divider' },
                { key: 'delete', label: '删除', danger: true, disabled: locked }
              ],
              onClick: ({ key }) => {
                if (key === 'duplicate') duplicate(layer.id)
                if (key === 'move-up') move(layer.id, -1)
                if (key === 'move-down') move(layer.id, 1)
                if (key === 'delete') remove(layer.id)
              }
            }}
          >
            <Button size="small" type="text" icon={<MoreHorizontal size={15} />} disabled={locked} aria-label={`更多规则操作 ${layer.id}`} title="更多" />
          </Dropdown>
        </div>
      }
    }
  ]

  return <section className="cartography-rules" aria-label="规则渲染">
    <header className="cartography-rules__header">
      <div><strong>渲染方式</strong><Tag color="blue">规则</Tag></div>
      {onBack && <Button onClick={onBack}>返回基础面板</Button>}
    </header>
    {error && <Alert type="error" showIcon message={error} closable onClose={() => setError(undefined)} />}
    {locked && <Alert type="warning" showIcon message="图层或所属文件夹已锁定，规则只读。" />}
    <Space className="cartography-rules__toolbar" wrap>
      <Select aria-label="新规则类型" value={newType} options={drawingTypes} onChange={setNewType} disabled={locked} />
      <Button type="primary" disabled={locked || !fragment} onClick={add}>新增规则</Button>
      <span className="cartography-rules__hint">顺序按标准绘制层顺序生效；未设置 filter 的规则作用于全部要素。</span>
    </Space>
    <Table<StyleLayer>
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={layers}
      columns={columns}
      locale={{ emptyText: '尚无绘制规则' }}
      tableLayout="fixed"
      className="cartography-rules__table"
    />
  </section>
}
