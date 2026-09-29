import { useMemo, useState } from 'react'
import { Table2 } from 'lucide-react'
import {
  applyFieldFilter,
  computeFieldStats,
  sortFeatures,
  type FieldFilterCondition,
  type FieldFilterOp
} from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
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

export function AttributeTable() {
  const selectedLayerId = useProjectStore((state) => state.selectedLayerId)
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const selection = useProjectStore((state) => state.selection)
  const lastSelectionCountAfterFilter = useProjectStore((state) => state.lastSelectionCountAfterFilter)
  const setLayerFilter = useProjectStore((state) => state.setLayerFilter)
  const selectMatching = useProjectStore((state) => state.selectMatching)
  const toggleFeatureSelection = useProjectStore((state) => state.toggleFeatureSelection)
  const clearSelection = useProjectStore((state) => state.clearSelection)
  const updateFeatureProperties = useProjectStore((state) => state.updateFeatureProperties)

  const setAttributeTableState = useSessionStore((state) => state.setAttributeTableState)
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

  const [draftField, setDraftField] = useState('')
  const [draftOp, setDraftOp] = useState<FieldFilterOp>('eq')
  const [draftValue, setDraftValue] = useState('')
  const [editing, setEditing] = useState<{ featureId: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState('')

  const selectedLayer = selectedLayerId
    ? project.layers.find((layer) => layer.id === selectedLayerId)
    : null

  const allFeatures = selectedLayer ? (featuresByDataset[selectedLayer.datasetId] ?? []) : []
  const layerFilter = selectedLayer?.filter ?? []

  const filteredFeatures = useMemo(
    () => applyFieldFilter(allFeatures, layerFilter),
    [allFeatures, layerFilter]
  )

  const selectionIds = useMemo(() => {
    if (!selectedLayerId || selection.layerId !== selectedLayerId) return new Set<string>()
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
      rows = sortFeatures(rows, [{ field: sortField, direction: sortDirection }])
    } else {
      rows = sortFeatures(rows, [])
    }
    return rows
  }, [filteredFeatures, selectedOnly, selectionIds, searchQuery, sortField, sortDirection])

  const totalPages = Math.max(1, Math.ceil(viewFeatures.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pageRows = viewFeatures.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const statsTargetField = statsField ?? fieldNames[0] ?? null
  const stats = useMemo(() => {
    if (!statsTargetField) return null
    return computeFieldStats(filteredFeatures, statsTargetField, 'filtered')
  }, [filteredFeatures, statsTargetField])

  function patchTable(updates: Parameters<typeof setAttributeTableState>[1]): void {
    if (!selectedLayerId) return
    setAttributeTableState(selectedLayerId, updates)
  }

  function addFilterCondition(): void {
    if (!selectedLayerId || !draftField) return
    const condition: FieldFilterCondition = needsValue(draftOp)
      ? { field: draftField, op: draftOp, value: coerceDraftValue(draftValue) }
      : { field: draftField, op: draftOp }
    setLayerFilter(selectedLayerId, [...layerFilter, condition])
    patchTable({ currentPage: 1 })
  }

  function removeFilterCondition(index: number): void {
    if (!selectedLayerId) return
    setLayerFilter(
      selectedLayerId,
      layerFilter.filter((_, i) => i !== index)
    )
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
    setEditing({ featureId, field })
    setEditValue(current == null ? '' : String(current))
  }

  function commitEdit(): void {
    if (!selectedLayerId || !editing) return
    const feature = allFeatures.find((item) => item.id === editing.featureId)
    if (!feature) {
      setEditing(null)
      return
    }
    const next = { ...feature.properties, [editing.field]: coerceDraftValue(editValue) }
    updateFeatureProperties(selectedLayerId, editing.featureId, next)
    setEditing(null)
  }

  const emptySelectedOnly = selectedOnly && selectionIds.size === 0

  return (
    <div className="feature-panel attribute-table-content">
      <div className="table-summary">
        <div className="table-title">
          <Table2 size={15} />
          <strong>{selectedLayer?.name ?? '未选择图层'}</strong>
        </div>
        <span>
          A {allFeatures.length} · F {filteredFeatures.length} · S{' '}
          {selection.layerId === selectedLayerId ? selection.featureIds.length : 0}
          {lastSelectionCountAfterFilter != null && selection.layerId === selectedLayerId
            ? `（筛选后选中 ${lastSelectionCountAfterFilter}）`
            : ''}
          {selectedOnly ? ' · 仅选中' : ''}
        </span>
      </div>

      {selectedLayer && (
        <div className="attr-toolbar" aria-label="属性表工具">
          <label className="attr-search">
            <span>表内搜索</span>
            <input
              type="search"
              value={searchQuery}
              placeholder="仅筛表格，不改地图过滤/选择"
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
                patchTable({ selectedOnly: event.target.checked, currentPage: 1 })
              }
            />
            仅选中
          </label>

          <Button
            variant="ghost"
            title="将当前图层筛选结果 F 设为选择 S（不会由筛选自动触发）"
            onClick={() => selectedLayerId && selectMatching(selectedLayerId)}
          >
            选择匹配记录
          </Button>

          <Button
            variant="ghost"
            onClick={() => clearSelection()}
            disabled={selection.featureIds.length === 0}
          >
            清除选择
          </Button>
        </div>
      )}

      {selectedLayer && (
        <div className="attr-filter-bar" aria-label="图层字段过滤">
          <span className="attr-filter-label">图层过滤 (F)</span>
          <select value={draftField} onChange={(e) => setDraftField(e.target.value)}>
            <option value="">字段…</option>
            {fieldNames.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
          <select value={draftOp} onChange={(e) => setDraftOp(e.target.value as FieldFilterOp)}>
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
          <Button variant="ghost" onClick={addFilterCondition} disabled={!draftField}>
            添加条件
          </Button>
          {layerFilter.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => selectedLayerId && setLayerFilter(selectedLayerId, [])}
            >
              清除过滤
            </Button>
          )}
          <ul className="attr-filter-chips">
            {layerFilter.map((condition, index) => (
              <li key={`${condition.field}-${condition.op}-${index}`}>
                <code>
                  {condition.field} {condition.op}
                  {needsValue(condition.op) ? ` ${String(condition.value ?? '')}` : ''}
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

      {selectedLayer && stats && statsTargetField && (
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
            范围：{stats.scopeLabel} · 非空 {stats.nonNull} / 空 {stats.nullCount} / 合计{' '}
            {stats.total}
            {stats.numeric
              ? ` · min ${stats.numeric.min} · max ${stats.numeric.max} · sum ${stats.numeric.sum} · mean ${formatMean(stats.numeric.mean)}`
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
                  title="按稳定 Feature ID 排序（清除字段排序）"
                  onClick={() =>
                    patchTable({ sortField: null, sortDirection: 'asc', currentPage: 1 })
                  }
                >
                  ID
                </th>
                {fieldNames.map((field) => (
                  <th
                    key={field}
                    className="sortable"
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
                    {sortField === field ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
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
                        readOnly
                        tabIndex={-1}
                        aria-label={`选择 ${feature.id}`}
                      />
                    </td>
                    <td>{(safePage - 1) * PAGE_SIZE + index + 1}</td>
                    <td>{feature.id}</td>
                    {fieldNames.map((field) => {
                      const value = feature.properties[field]
                      const isEditing =
                        editing?.featureId === feature.id && editing.field === field
                      return (
                        <td
                          key={field}
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
                                if (e.key === 'Enter') commitEdit()
                                if (e.key === 'Escape') setEditing(null)
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
                        onClick={() => patchTable({ selectedOnly: false, currentPage: 1 })}
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

      {selectedLayer && viewFeatures.length > 0 && (
        <div className="attr-pagination">
          <Button
            variant="ghost"
            disabled={safePage <= 1}
            onClick={() => patchTable({ currentPage: safePage - 1 })}
          >
            上一页
          </Button>
          <span>
            第 {safePage} / {totalPages} 页 · 本页 {pageRows.length} · 表格 {viewFeatures.length}{' '}
            条（每页 {PAGE_SIZE}）
          </span>
          <Button
            variant="ghost"
            disabled={safePage >= totalPages}
            onClick={() => patchTable({ currentPage: safePage + 1 })}
          >
            下一页
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
