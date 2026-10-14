import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Checkbox, Dropdown, Input, Select, Table, type TableColumnsType } from 'antd'
import { ChevronLeft, ChevronRight, PanelBottomClose, LocateFixed } from 'lucide-react'
import {
  applyFieldFilter,
  computeFieldStats,
  sortFeatures,
  type FieldFilterCondition,
  type FieldFilterOp,
  type GisFeature
} from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { capabilitiesForDataset, getEffectiveLocked } from '@desktop-webgis/gis-core'
import { useSessionStore } from '@/stores/session.store'
import { Button } from '@/components/ui/Button'
import { zoomMapToFeature, zoomMapToSelected } from '@/features/map/map-runtime-host'
import { FieldCalculator } from './FieldCalculator'
import { parseCellValue, resolveDatasetFields } from './field-edits'
import { FieldSchemaDialog } from './FieldSchemaDialog'
import { ColumnResizeHandle } from './ColumnResizeHandle'

const PAGE_SIZE = 100

const FILTER_OPS: { value: FieldFilterOp; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'is-empty', label: '为空' },
  { value: 'is-not-empty', label: '非空' }
]

function needsValue(op: FieldFilterOp): boolean {
  return op !== 'is-empty' && op !== 'is-not-empty'
}

interface AttributeTableProps {
  targetPicker?: ReactNode
  onClose?: () => void
  layerId?: string
  active?: boolean
}

export function AttributeTable({
  targetPicker,
  onClose,
  layerId,
  active = true
}: AttributeTableProps = {}) {
  const tableLayerId = useWorkbenchStore((state) => state.tableLayerId)
  const selectedLayerId = layerId ?? tableLayerId
  const editLayerId = useWorkbenchStore((state) => state.editLayerId)
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const selection = useProjectStore((state) => state.selection)
  const setLayerFilter = useProjectStore((state) => state.setLayerFilter)
  const selectMatching = useProjectStore((state) => state.selectMatching)
  const toggleFeatureSelection = useProjectStore(
    (state) => state.toggleFeatureSelection
  )
  const clearSelection = useProjectStore((state) => state.clearSelection)
  const updateFeatureProperties = useProjectStore(
    (state) => state.updateFeatureProperties
  )

  const setAttributeTableState = useSessionStore(
    (state) => state.setAttributeTableState
  )
  const layerSession = useSessionStore((state) =>
    selectedLayerId ? state.sessions[selectedLayerId] : undefined
  )
  const tableState = layerSession?.attributeTable
  const scrollRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!active || !selectedLayerId || !scrollRef.current) return
    const saved = useSessionStore.getState().sessions[selectedLayerId]?.attributeTable
    scrollRef.current.scrollTop = saved?.scrollTop ?? 0
    scrollRef.current.scrollLeft = saved?.scrollLeft ?? 0
  }, [selectedLayerId, active])

  const searchQuery = tableState?.searchQuery ?? ''
  const currentPage = tableState?.currentPage ?? 1
  const selectedOnly = tableState?.selectedOnly ?? false
  const requestedSortField = tableState?.sortField ?? null
  const sortDirection = tableState?.sortDirection ?? 'asc'
  const statsField = tableState?.statsField ?? null
  const filterOpen = tableState?.filterOpen ?? false
  const statisticsOpen = tableState?.statisticsOpen ?? false

  const [draftField, setDraftField] = useState('')
  const [draftOp, setDraftOp] = useState<FieldFilterOp>('eq')
  const [draftValue, setDraftValue] = useState('')
  const [editing, setEditing] = useState<{
    featureId: string
    field: string
  } | null>(null)
  const [editValue, setEditValue] = useState('')
  const cancelledEdit = useRef(false)
  const [cellError, setCellError] = useState('')
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false)
  const selectionMenuTrigger = useRef<ComponentRef<typeof Button>>(null)
  const [fieldEdit, setFieldEdit] = useState<{ mode: 'add' | 'rename' | 'remove'; name?: string } | null>(null)

  const selectedLayer = selectedLayerId
    ? project.layers.find((layer) => layer.id === selectedLayerId)
    : null
  const canEditCells =
    !!selectedLayerId && !getEffectiveLocked(project, selectedLayerId) &&
    editLayerId === selectedLayerId &&
    capabilitiesForDataset(
      project.datasets.find(
        (dataset) => dataset.id === selectedLayer?.datasetId
      )
    ).editGeometry

  const allFeatures = selectedLayer
    ? (featuresByDataset[selectedLayer.datasetId] ?? [])
    : []
  const dataset = project.datasets.find((item) => item.id === selectedLayer?.datasetId)
  const layerFilter = selectedLayer?.filter
  const appliedFilter = layerFilter ?? []
  const filterDraft = tableState?.filterDraft ?? appliedFilter
  const previousFilter = useRef(appliedFilter)
  function setFilterDraft(draft: FieldFilterCondition[]): void { patchTable({ filterDraft: draft }) }
  useEffect(() => {
    const current = selectedLayerId ? useSessionStore.getState().sessions[selectedLayerId]?.attributeTable?.filterDraft : undefined
    if (selectedLayerId && (!current || JSON.stringify(current) === JSON.stringify(previousFilter.current))) {
      setAttributeTableState(selectedLayerId, { filterDraft: layerFilter ?? [] })
    }
    previousFilter.current = layerFilter ?? []
  }, [layerFilter, selectedLayerId])
  const filterDirty =
    JSON.stringify(filterDraft) !== JSON.stringify(appliedFilter)

  const filteredFeatures = useMemo(
    () => applyFieldFilter(allFeatures, appliedFilter),
    [allFeatures, layerFilter]
  )

  const selectionIds = useMemo(() => {
    if (!selectedLayerId || selection.layerId !== selectedLayerId)
      return new Set<string>()
    return new Set(selection.featureIds)
  }, [selectedLayerId, selection.layerId, selection.featureIds])

  const fields = useMemo(() => resolveDatasetFields(allFeatures, dataset?.fields), [allFeatures, dataset?.fields])
  const fieldNames = fields.map((field) => field.name)
  const sortField = requestedSortField && fieldNames.includes(requestedSortField) ? requestedSortField : null
  const orderedFields = [...(tableState?.fieldOrder ?? []).filter((name) => fieldNames.includes(name)),
    ...fieldNames.filter((name) => !tableState?.fieldOrder?.includes(name))]
  const visibleFields = orderedFields.filter((name) => !tableState?.hiddenFields?.includes(name))

  const viewFeatures = useMemo(() => {
    let rows = filteredFeatures
    if (selectedOnly) {
      rows = rows.filter((feature) => selectionIds.has(feature.id))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      rows = rows.filter((feature) =>
        Object.values(feature.properties).some((value) =>
          String(value ?? '')
            .toLowerCase()
            .includes(q)
        )
      )
    }
    if (sortField) {
      rows = sortFeatures(rows, [
        { field: sortField, direction: sortDirection }
      ])
    } else {
      rows = sortFeatures(rows, [])
    }
    return rows
  }, [
    filteredFeatures,
    selectedOnly,
    selectionIds,
    searchQuery,
    sortField,
    sortDirection
  ])

  const totalPages = Math.max(1, Math.ceil(viewFeatures.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pageRows = viewFeatures.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  )

  const statsTargetField = statsField && fieldNames.includes(statsField) ? statsField : fieldNames[0] ?? null
  const stats = useMemo(() => {
    if (!statsTargetField) return null
    return computeFieldStats(filteredFeatures, statsTargetField, 'filtered')
  }, [filteredFeatures, statsTargetField])

  function patchTable(
    updates: Parameters<typeof setAttributeTableState>[1]
  ): void {
    if (!selectedLayerId) return
    setAttributeTableState(selectedLayerId, updates)
  }

  function addFilterCondition(): void {
    if (!selectedLayerId || !draftField) return
    const condition: FieldFilterCondition = needsValue(draftOp)
      ? { field: draftField, op: draftOp, value: coerceDraftValue(draftValue) }
      : { field: draftField, op: draftOp }
    setFilterDraft([...filterDraft, condition])
    patchTable({ currentPage: 1 })
  }

  function removeFilterCondition(index: number): void {
    if (!selectedLayerId) return
    setFilterDraft(filterDraft.filter((_, i) => i !== index))
    patchTable({ currentPage: 1 })
  }

  function toggleSort(field: string): void {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        patchTable({ sortDirection: 'desc', currentPage: 1 })
      } else {
        patchTable({ sortField: null, sortDirection: 'asc', currentPage: 1 })
      }
    } else {
      patchTable({ sortField: field, sortDirection: 'asc', currentPage: 1 })
    }
  }

  function startEdit(featureId: string, field: string, current: unknown): void {
    if (!canEditCells) return
    cancelledEdit.current = false
    setCellError('')
    setEditing({ featureId, field })
    setEditValue(current == null ? '' : typeof current === 'object' ? JSON.stringify(current) : String(current))
  }

  function commitEdit(): void {
    if (
      !selectedLayerId ||
      !editing ||
      cancelledEdit.current ||
      !canEditCells
    ) {
      setEditing(null)
      return
    }
    const feature = allFeatures.find((item) => item.id === editing.featureId)
    if (!feature) {
      setEditing(null)
      return
    }
    try {
      const field = fields.find((item) => item.name === editing.field)
      if (!field) throw new Error('编辑字段已不存在')
      const next = { ...feature.properties, [editing.field]: parseCellValue(field, editValue) }
      if (!updateFeatureProperties(selectedLayerId, editing.featureId, next)) throw new Error('当前记录未能写入')
      setCellError('')
    } catch (error) {
      setCellError(error instanceof Error ? error.message : String(error))
    }
    setEditing(null)
  }

  function columnWidth(field: string): number {
    const saved = tableState?.columnWidths
    const width = saved && Object.hasOwn(saved, field) ? saved[field] : undefined
    return typeof width === 'number' && Number.isFinite(width) ? Math.max(80, Math.min(600, width)) : 160
  }

  const columns: TableColumnsType<GisFeature> = [
    { key: 'selection', title: '', width: 36, render: (_, feature) => <Checkbox
      checked={selectionIds.has(feature.id)} aria-label={`选择 ${feature.id}`}
      onClick={(event) => event.stopPropagation()}
      onChange={() => selectedLayerId && toggleFeatureSelection(selectedLayerId, feature.id, true)} /> },
    { key: 'index', title: '#', width: 44, render: (_, __, index) => (safePage - 1) * PAGE_SIZE + index + 1 },
    { key: 'id', title: 'ID', width: 220, onHeaderCell: () => ({ tabIndex: 0, className: 'sortable',
      title: '按稳定 Feature ID 排序（清除字段排序）',
      onClick: () => patchTable({ sortField: null, sortDirection: 'asc', currentPage: 1 }),
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); patchTable({ sortField: null, sortDirection: 'asc', currentPage: 1 })
        }
      } }), render: (_, feature) => <><Button variant="icon" className="attribute-locate"
        title={`定位 ${feature.id}`} aria-label={`定位 ${feature.id}`}
        onClick={(event) => { event.stopPropagation(); if (selectedLayerId) zoomMapToFeature(selectedLayerId, feature.id, null) }}>
        <LocateFixed size={12} />
      </Button><span className="attr-cell-value">{feature.id}</span></> },
    ...visibleFields.map((field): TableColumnsType<GisFeature>[number] => ({
      key: `field:${field}`, width: columnWidth(field),
      title: <><span>{field}{sortField === field ? sortDirection === 'asc' ? ' ↑' : ' ↓' : ''}</span>
        <ColumnResizeHandle field={field} width={columnWidth(field)} onChange={(width) =>
          patchTable({ columnWidths: { ...tableState?.columnWidths, [field]: width } })} /></>,
      onHeaderCell: () => ({ tabIndex: 0, className: 'sortable', 'aria-label': field,
        'aria-sort': sortField === field ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none',
        onClick: () => toggleSort(field), onKeyDown: (event) => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault(); toggleSort(field)
          }
        } }),
      onCell: (feature) => ({ tabIndex: 0, title: canEditCells ? '双击或按 Enter 编辑' : '双击或按 Enter 定位',
        onKeyDown: (event) => {
          if (editing?.featureId === feature.id && editing.field === field || event.key !== 'Enter') return
          event.preventDefault(); event.stopPropagation()
          if (canEditCells) startEdit(feature.id, field, feature.properties[field])
          else if (selectedLayerId) zoomMapToFeature(selectedLayerId, feature.id, null)
        },
        onDoubleClick: (event) => {
          event.stopPropagation()
          if (canEditCells) startEdit(feature.id, field, feature.properties[field])
          else if (selectedLayerId) zoomMapToFeature(selectedLayerId, feature.id, null)
        } }),
      render: (_, feature) => editing?.featureId === feature.id && editing.field === field ? <Input
        className="cell-editor" value={editValue} autoFocus
        onClick={(event) => event.stopPropagation()} onChange={(event) => setEditValue(event.target.value)} onBlur={commitEdit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commitEdit() }
          if (event.key === 'Escape') { event.stopPropagation(); cancelledEdit.current = true; setEditing(null) }
        }} /> : <span className={`attr-cell-value${typeof feature.properties[field] === 'number' ? ' attr-cell-number' : ''}`}>
        {feature.properties[field] == null || feature.properties[field] === '' ? '—' : typeof feature.properties[field] === 'object'
          ? JSON.stringify(feature.properties[field]) : String(feature.properties[field])}
      </span>
    }))
  ]
  const tableWidth = 300 + visibleFields.reduce((sum, field) => sum + columnWidth(field), 0)
  const emptySelectedOnly = selectedOnly && selectionIds.size === 0
  const recordStatus = `全部 ${allFeatures.length} · 过滤后 ${filteredFeatures.length} · 显示 ${viewFeatures.length}${selectionIds.size > 0 || selectedOnly ? ` · 选中 ${selectionIds.size}` : ''}`

  return (
    <div className="feature-panel attribute-table-content">
      <div className="attr-toolbar" aria-label="属性表工具">
        {targetPicker}
        {selectedLayer && <>
          <label className="attr-search">
            <Input
              type="search"
              aria-label="表内搜索"
              value={searchQuery}
              placeholder="搜索当前表格"
              title="只影响表格显示，不改变地图过滤或要素选择"
              onChange={(event) =>
                patchTable({ searchQuery: event.target.value, currentPage: 1 })
              }
            />
          </label>

          <Checkbox className="attr-check"
              checked={selectedOnly}
              onChange={(event) =>
                patchTable({
                  selectedOnly: event.target.checked,
                  currentPage: 1
                })
              }
            >仅选中</Checkbox>

          <Dropdown trigger={['click']} autoFocus open={selectionMenuOpen} onOpenChange={(open) => {
            setSelectionMenuOpen(open)
            if (!open) queueMicrotask(() => selectionMenuTrigger.current?.focus())
          }} menu={{ onClick: () => { setSelectionMenuOpen(false); selectionMenuTrigger.current?.focus() }, items: [
            { key: 'matching', label: '选择匹配记录', title: '选择图层过滤结果；表内搜索不改变此范围',
              onClick: () => selectedLayerId && selectMatching(selectedLayerId) },
            { key: 'locate', label: '定位选中要素', disabled: selection.layerId !== selectedLayerId || !selection.featureIds.length,
              onClick: () => zoomMapToSelected() },
            { key: 'clear', label: '清除选择', disabled: selection.layerId !== selectedLayerId || !selection.featureIds.length,
              onClick: () => clearSelection() }
          ] }}>
            <Button ref={selectionMenuTrigger} variant="ghost" className="attr-selection-actions"
              aria-label="选择" aria-haspopup="menu" aria-expanded={selectionMenuOpen}>选择 ▾</Button>
          </Dropdown>
          <Button
            variant="ghost"
            aria-expanded={filterOpen}
            onClick={() => {
              patchTable({ filterOpen: !filterOpen, statisticsOpen: false })
              setCalculatorOpen(false); setColumnsOpen(false)
            }}
          >
            图层过滤{appliedFilter.length ? ` (${appliedFilter.length})` : ''}
          </Button>
          <Button
            variant="ghost"
            aria-expanded={statisticsOpen}
            onClick={() => {
              patchTable({ statisticsOpen: !statisticsOpen, filterOpen: false })
              setCalculatorOpen(false); setColumnsOpen(false)
            }}
          >
            字段统计
          </Button>
          <Button variant="ghost" aria-expanded={calculatorOpen}
            onClick={() => {
              setCalculatorOpen(!calculatorOpen); setColumnsOpen(false)
              patchTable({ filterOpen: false, statisticsOpen: false })
            }}>字段计算</Button>
          <Button variant="ghost" aria-expanded={columnsOpen}
            onClick={() => {
              setColumnsOpen(!columnsOpen); setCalculatorOpen(false)
              patchTable({ filterOpen: false, statisticsOpen: false })
            }}>字段列表</Button>
        </>}
        {onClose && (
          <Button variant="icon" aria-label="收起属性表" title="收起属性表" onClick={onClose}>
            <PanelBottomClose size={16} />
          </Button>
        )}
      </div>

      {cellError && <div role="alert">{cellError}；原值未改变</div>}
      {selectedLayerId && calculatorOpen && <FieldCalculator layerId={selectedLayerId}
        filteredFeatures={filteredFeatures} selectedIds={selectionIds} onClose={() => setCalculatorOpen(false)} />}
      {selectedLayerId && columnsOpen && <section className="attr-columns" aria-label="字段列表">
        <Button variant="primary" disabled={!canEditCells} onClick={() => setFieldEdit({ mode: 'add' })}>新增字段</Button>
        {orderedFields.map((name, index) => <div key={name}>
          <Checkbox checked={!tableState?.hiddenFields?.includes(name)}
            onChange={(event) => patchTable({ hiddenFields: event.target.checked
              ? (tableState?.hiddenFields ?? []).filter((field) => field !== name)
              : [...(tableState?.hiddenFields ?? []), name] })}>{name}</Checkbox>
          <span className="attr-field-type">{fields.find((field) => field.name === name)?.type}</span>
          <Button variant="icon" aria-label={`上移字段 ${name}`} disabled={index === 0} onClick={() => {
            const order = [...orderedFields]
            ;[order[index - 1], order[index]] = [order[index], order[index - 1]]
            patchTable({ fieldOrder: order })
          }}>↑</Button>
          <Button variant="icon" aria-label={`下移字段 ${name}`} disabled={index === orderedFields.length - 1} onClick={() => {
            const order = [...orderedFields]
            ;[order[index + 1], order[index]] = [order[index], order[index + 1]]
            patchTable({ fieldOrder: order })
          }}>↓</Button>
          <Button variant="ghost" aria-label={`重命名字段 ${name}`} disabled={!canEditCells}
            onClick={() => setFieldEdit({ mode: 'rename', name })}>重命名</Button>
          <Button variant="ghost" aria-label={`删除字段 ${name}`} disabled={!canEditCells}
            onClick={() => setFieldEdit({ mode: 'remove', name })}>删除</Button>
        </div>)}
        <Button variant="ghost" onClick={() => patchTable({ hiddenFields: [], fieldOrder: [], columnWidths: {} })}>重置列显示</Button>
      </section>}
      {selectedLayerId && fieldEdit && <FieldSchemaDialog layerId={selectedLayerId} {...fieldEdit}
        onClose={() => setFieldEdit(null)} />}

      {selectedLayer && filterOpen && (
        <div className="attr-filter-bar" aria-label="图层字段过滤">
          <span className="attr-filter-label" title="应用后同时影响地图与此表">
            图层过滤 · 影响地图和表格
          </span>
          <Select aria-label="过滤字段" placeholder="字段…" value={draftField || undefined}
            onChange={setDraftField} options={fieldNames.map((field) => ({ value: field, label: field }))} />
          <Select aria-label="过滤操作" value={draftOp} onChange={setDraftOp} options={FILTER_OPS} />
          {needsValue(draftOp) && (
            <Input aria-label="过滤值"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              placeholder="值"
            />
          )}
          <Button
            variant="ghost"
            onClick={addFilterCondition}
            disabled={!draftField}
          >
            添加条件
          </Button>
          <Button
            variant="primary"
            disabled={!filterDirty}
            onClick={() => {
              if (selectedLayerId) setLayerFilter(selectedLayerId, filterDraft)
              patchTable({ currentPage: 1 })
            }}
          >
            应用过滤
          </Button>
          {filterDirty && (
            <Button
              variant="ghost"
              onClick={() => setFilterDraft(appliedFilter)}
            >
              还原条件
            </Button>
          )}
          {(appliedFilter.length > 0 || filterDraft.length > 0) && (
            <Button
              variant="ghost"
              onClick={() => {
                if (selectedLayerId) setLayerFilter(selectedLayerId, [])
                setFilterDraft([])
                patchTable({ currentPage: 1 })
              }}
            >
              清除过滤
            </Button>
          )}
          <ul className="attr-filter-chips">
            {filterDraft.map((condition, index) => (
              <li key={`${condition.field}-${condition.op}-${index}`}>
                <code>
                  {condition.field} {condition.op}
                  {needsValue(condition.op)
                    ? ` ${String(condition.value ?? '')}`
                    : ''}
                </code>
                <Button variant="icon"
                  type="button"
                  onClick={() => removeFilterCondition(index)}
                  aria-label="移除条件"
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedLayer && statisticsOpen && stats && statsTargetField && (
        <div className="attr-stats" aria-label="字段统计">
          <label>
            统计字段
            <Select aria-label="统计字段" value={statsTargetField} onChange={(value) => patchTable({ statsField: value })}
              options={fieldNames.map((field) => ({ value: field, label: field }))} />
          </label>
          <span>
            范围：图层过滤结果 · 非空 {stats.nonNull} / 空{' '}
            {stats.nullCount} / 合计 {stats.total}
            {stats.numeric
              ? ` · 最小 ${stats.numeric.min} · 最大 ${stats.numeric.max} · 合计 ${stats.numeric.sum} · 平均 ${formatMean(stats.numeric.mean)}`
              : ' · 无数值统计'}
          </span>
        </div>
      )}

      <div className="table-scroll" ref={scrollRef} onScroll={event => {
        if (!selectedLayerId) return
        const { scrollTop, scrollLeft } = event.currentTarget
        if (scrollTop !== tableState?.scrollTop || scrollLeft !== tableState?.scrollLeft) {
          setAttributeTableState(selectedLayerId, { scrollTop, scrollLeft })
        }
      }}>
        <Table<GisFeature> className="attribute-data-table" size="small" bordered tableLayout="fixed"
          rowKey="id" pagination={false} columns={columns}
          dataSource={selectedLayer && !emptySelectedOnly ? pageRows : []}
          style={{ width: tableWidth, minWidth: '100%' }}
          rowClassName={(feature) => selectionIds.has(feature.id) ? 'row-selected' : ''}
          onRow={(feature) => ({
            'data-feature-id': feature.id, tabIndex: 0, title: '双击行或按 Enter 定位',
            onDoubleClick: (event) => {
              if ((event.target as HTMLElement).closest('input,button')) return
              if (selectedLayerId) zoomMapToFeature(selectedLayerId, feature.id, null)
            },
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget || event.key !== 'Enter') return
              event.preventDefault()
              if (selectedLayerId) zoomMapToFeature(selectedLayerId, feature.id, null)
            },
            onClick: (event) => {
              if (!selectedLayerId) return
              if (event.metaKey || event.ctrlKey) toggleFeatureSelection(selectedLayerId, feature.id, true)
              else if (!selectionIds.has(feature.id)) useProjectStore.getState().setSelection({ layerId: selectedLayerId, featureIds: [feature.id] })
            }
          })}
          locale={{ emptyText: !selectedLayer ? '请选择一个图层' : emptySelectedOnly ? <div className="empty-selected-only">
            <p>当前无选中要素（仅选中模式）</p>
            <Button variant="ghost" onClick={() => patchTable({ selectedOnly: false, currentPage: 1 })}>清除“仅选中”查看模式</Button>
          </div> : allFeatures.length === 0 ? '该图层暂无属性数据' : '无匹配记录' }} />
      </div>

      {selectedLayer && (
        <div className="attr-pagination" aria-label="表格状态与分页">
          <span className="attr-record-count" title={recordStatus}>{recordStatus}</span>
          <span title={canEditCells ? '双击单元格编辑' : '当前表格只读；从图层菜单开始编辑'}>
            {canEditCells ? '可编辑' : '只读'}
          </span>
          <Button
            variant="icon"
            aria-label="上一页"
            title="上一页"
            disabled={safePage <= 1}
            onClick={() => patchTable({ currentPage: safePage - 1 })}
          >
            <ChevronLeft size={16} />
          </Button>
          <span title={`每页 ${PAGE_SIZE} 条`}>
            {viewFeatures.length ? safePage : 0} / {viewFeatures.length ? totalPages : 0}
          </span>
          <Button
            variant="icon"
            aria-label="下一页"
            title="下一页"
            disabled={viewFeatures.length === 0 || safePage >= totalPages}
            onClick={() => patchTable({ currentPage: safePage + 1 })}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  )
}

function coerceDraftValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  const asNum = Number(trimmed)
  if (
    trimmed !== '' &&
    Number.isFinite(asNum) &&
    /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)
  ) {
    return asNum
  }
  return raw
}

function formatMean(mean: number): string {
  if (!Number.isFinite(mean)) return '—'
  return String(Math.round(mean * 1000) / 1000)
}
