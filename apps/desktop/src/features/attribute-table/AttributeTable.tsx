import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, PanelBottomClose } from 'lucide-react'
import {
  applyFieldFilter,
  computeFieldStats,
  sortFeatures,
  type FieldFilterCondition,
  type FieldFilterOp
} from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { capabilitiesForDataset } from '@desktop-webgis/gis-core'
import { useSessionStore } from '@/stores/session.store'
import { Button } from '@/components/ui/Button'

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
}

export function AttributeTable({
  targetPicker,
  onClose
}: AttributeTableProps = {}) {
  const selectedLayerId = useWorkbenchStore((state) => state.tableLayerId)
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

  const searchQuery = tableState?.searchQuery ?? ''
  const currentPage = tableState?.currentPage ?? 1
  const selectedOnly = tableState?.selectedOnly ?? false
  const sortField = tableState?.sortField ?? null
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

  const selectedLayer = selectedLayerId
    ? project.layers.find((layer) => layer.id === selectedLayerId)
    : null
  const canEditCells =
    editLayerId === selectedLayerId &&
    capabilitiesForDataset(
      project.datasets.find(
        (dataset) => dataset.id === selectedLayer?.datasetId
      )
    ).editGeometry

  const allFeatures = selectedLayer
    ? (featuresByDataset[selectedLayer.datasetId] ?? [])
    : []
  const layerFilter = selectedLayer?.filter
  const appliedFilter = layerFilter ?? []
  const [filterDraft, setFilterDraft] =
    useState<FieldFilterCondition[]>(appliedFilter)
  useEffect(() => {
    setFilterDraft(layerFilter ?? [])
  }, [layerFilter])
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

  const fieldNames = useMemo(() => {
    const keys = new Set<string>()
    for (const feature of allFeatures) {
      for (const key of Object.keys(feature.properties)) keys.add(key)
    }
    return Array.from(keys).sort((a, b) => a.localeCompare(b))
  }, [allFeatures])

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

  const statsTargetField = statsField ?? fieldNames[0] ?? null
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
    setEditing({ featureId, field })
    setEditValue(current == null ? '' : String(current))
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
    const next = {
      ...feature.properties,
      [editing.field]: coerceDraftValue(editValue)
    }
    updateFeatureProperties(selectedLayerId, editing.featureId, next)
    setEditing(null)
  }

  const emptySelectedOnly = selectedOnly && selectionIds.size === 0
  const recordStatus = `全部 ${allFeatures.length} · 过滤后 ${filteredFeatures.length} · 显示 ${viewFeatures.length}${selectionIds.size > 0 ? ` · 选中 ${selectionIds.size}` : ''}`

  return (
    <div className="feature-panel attribute-table-content">
      <div className="attr-toolbar" aria-label="属性表工具">
        {targetPicker}
        {selectedLayer && <>
          <label className="attr-search">
            <input
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

          <label className="attr-check">
            <input
              type="checkbox"
              checked={selectedOnly}
              onChange={(event) =>
                patchTable({
                  selectedOnly: event.target.checked,
                  currentPage: 1
                })
              }
            />
            仅选中
          </label>

          <details
            className="attr-selection-actions"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                event.currentTarget.open = false
              }
            }}
            onClick={(event) => {
              if (event.target instanceof HTMLElement && event.target.closest('button')) {
                event.currentTarget.open = false
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
              }
            }}
          >
            <summary>选择</summary>
            <div>
              <Button
                variant="ghost"
                title="选择图层过滤结果；表内搜索不改变此范围"
                onClick={() => selectedLayerId && selectMatching(selectedLayerId)}
              >
                选择匹配记录
              </Button>
              <Button
                variant="ghost"
                onClick={() => clearSelection()}
                disabled={
                  selection.layerId !== selectedLayerId ||
                  selection.featureIds.length === 0
                }
              >
                清除选择
              </Button>
            </div>
          </details>
          <Button
            variant="ghost"
            aria-expanded={filterOpen}
            onClick={() => patchTable({ filterOpen: !filterOpen })}
          >
            图层过滤{appliedFilter.length ? ` (${appliedFilter.length})` : ''}
          </Button>
          <Button
            variant="ghost"
            aria-expanded={statisticsOpen}
            onClick={() => patchTable({ statisticsOpen: !statisticsOpen })}
          >
            字段统计
          </Button>
        </>}
        {onClose && (
          <Button variant="icon" aria-label="收起属性表" title="收起属性表" onClick={onClose}>
            <PanelBottomClose size={16} />
          </Button>
        )}
      </div>

      {selectedLayer && filterOpen && (
        <div className="attr-filter-bar" aria-label="图层字段过滤">
          <span className="attr-filter-label" title="应用后同时影响地图与此表">
            图层过滤 · 影响地图和表格
          </span>
          <select
            value={draftField}
            onChange={(e) => setDraftField(e.target.value)}
          >
            <option value="">字段…</option>
            {fieldNames.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
          <select
            value={draftOp}
            onChange={(e) => setDraftOp(e.target.value as FieldFilterOp)}
          >
            {FILTER_OPS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
          {needsValue(draftOp) && (
            <input
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
                <button
                  type="button"
                  onClick={() => removeFilterCondition(index)}
                  aria-label="移除条件"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedLayer && statisticsOpen && stats && statsTargetField && (
        <div className="attr-stats" aria-label="字段统计">
          <label>
            统计字段
            <select
              value={statsTargetField}
              onChange={(e) => patchTable({ statsField: e.target.value })}
            >
              {fieldNames.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
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

      <div className="table-scroll">
        {selectedLayer && !emptySelectedOnly && pageRows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th style={{ width: 48 }}>#</th>
                <th
                  className="sortable"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      patchTable({
                        sortField: null,
                        sortDirection: 'asc',
                        currentPage: 1
                      })
                    }
                  }}
                  title="按稳定 Feature ID 排序（清除字段排序）"
                  onClick={() =>
                    patchTable({
                      sortField: null,
                      sortDirection: 'asc',
                      currentPage: 1
                    })
                  }
                >
                  ID
                </th>
                {fieldNames.map((field) => (
                  <th
                    key={field}
                    className="sortable"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleSort(field)
                      }
                    }}
                    onClick={() => toggleSort(field)}
                    aria-sort={
                      sortField === field
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    {field}
                    {sortField === field
                      ? sortDirection === 'asc'
                        ? ' ↑'
                        : ' ↓'
                      : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((feature, index) => {
                const selected = selectionIds.has(feature.id)
                return (
                  <tr
                    key={feature.id}
                    data-feature-id={feature.id}
                    className={selected ? 'row-selected' : undefined}
                    onClick={(event) => {
                      if (!selectedLayerId) return
                      toggleFeatureSelection(
                        selectedLayerId,
                        feature.id,
                        event.metaKey || event.ctrlKey
                      )
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() =>
                          selectedLayerId &&
                          toggleFeatureSelection(
                            selectedLayerId,
                            feature.id,
                            true
                          )
                        }
                        aria-label={`选择 ${feature.id}`}
                      />
                    </td>
                    <td>{(safePage - 1) * PAGE_SIZE + index + 1}</td>
                    <td>{feature.id}</td>
                    {fieldNames.map((field) => {
                      const value = feature.properties[field]
                      const isEditing =
                        editing?.featureId === feature.id &&
                        editing.field === field
                      return (
                        <td
                          key={field}
                          tabIndex={canEditCells ? 0 : undefined}
                          title={
                            canEditCells
                              ? '双击或按 Enter 编辑'
                              : '只读；在编辑功能区启动此图层编辑'
                          }
                          onKeyDown={(event) => {
                            if (!isEditing && event.key === 'Enter') {
                              event.preventDefault()
                              startEdit(feature.id, field, value)
                            }
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation()
                            startEdit(feature.id, field, value)
                          }}
                        >
                          {isEditing ? (
                            <input
                              className="cell-editor"
                              value={editValue}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.stopPropagation()
                                  commitEdit()
                                }
                                if (e.key === 'Escape') {
                                  e.stopPropagation()
                                  cancelledEdit.current = true
                                  setEditing(null)
                                }
                              }}
                            />
                          ) : value != null && value !== '' ? (
                            String(value)
                          ) : (
                            '—'
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>名称</th>
                <th>类型</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="empty-table-cell">
                  {!selectedLayer ? (
                    '请选择一个图层'
                  ) : emptySelectedOnly ? (
                    <div className="empty-selected-only">
                      <p>当前无选中要素（仅选中模式）</p>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          patchTable({ selectedOnly: false, currentPage: 1 })
                        }
                      >
                        清除“仅选中”查看模式
                      </Button>
                    </div>
                  ) : allFeatures.length === 0 ? (
                    '该图层暂无属性数据'
                  ) : (
                    '无匹配记录'
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        )}
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
