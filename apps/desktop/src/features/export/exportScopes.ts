import {
  applyFieldFilter,
  cloneValue,
  sortFeatures,
  type GisFeature
} from '@desktop-webgis/gis-core'
import type { Layer, Project, SelectionState } from '@desktop-webgis/gis-core'

/** Four export scopes per plan §4.2. */
export type ExportScope = 'all' | 'layer-filter' | 'selection' | 'table-result'

export interface TableViewState {
  searchQuery: string
  selectedOnly: boolean
  sortField: string | null
  sortDirection: 'asc' | 'desc'
}

export interface ExportScopeCounts {
  all: number
  'layer-filter': number
  selection: number
  'table-result': number
}

export const EXPORT_SCOPE_LABELS: Record<ExportScope, string> = {
  all: '全部（图层全部要素）',
  'layer-filter': '图层筛选结果（F）',
  selection: '当前选中（S）',
  'table-result': '当前表格结果'
}

export function resolveExportFeatures(args: {
  scope: ExportScope
  layer: Layer
  allFeatures: GisFeature[]
  selection: SelectionState
  tableView: TableViewState
}): GisFeature[] {
  const { scope, layer, allFeatures, selection, tableView } = args
  const filtered = applyFieldFilter(allFeatures, layer.filter)

  let rows: GisFeature[]
  switch (scope) {
    case 'all':
      rows = allFeatures
      break
    case 'layer-filter':
      rows = filtered
      break
    case 'selection': {
      const ids =
        selection.layerId === layer.id ? new Set(selection.featureIds) : new Set<string>()
      // S is already converged to S∩F by the store; still filter against F for safety.
      rows = filtered.filter((f) => ids.has(f.id))
      break
    }
    case 'table-result': {
      rows = filtered
      if (tableView.selectedOnly) {
        const ids =
          selection.layerId === layer.id ? new Set(selection.featureIds) : new Set<string>()
        rows = rows.filter((f) => ids.has(f.id))
      }
      if (tableView.searchQuery.trim()) {
        const q = tableView.searchQuery.trim().toLowerCase()
        rows = rows.filter((feature) =>
          Object.values(feature.properties).some((value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(q)
          )
        )
      }
      if (tableView.sortField) {
        rows = sortFeatures(rows, [
          { field: tableView.sortField, direction: tableView.sortDirection }
        ])
      } else {
        rows = sortFeatures(rows, [])
      }
      break
    }
    default:
      rows = allFeatures
  }

  // Snapshot: deep clone so later edits do not mutate the export payload.
  return cloneValue(rows)
}

export function countExportScopes(args: {
  layer: Layer
  allFeatures: GisFeature[]
  selection: SelectionState
  tableView: TableViewState
}): ExportScopeCounts {
  return {
    all: resolveExportFeatures({ ...args, scope: 'all' }).length,
    'layer-filter': resolveExportFeatures({ ...args, scope: 'layer-filter' }).length,
    selection: resolveExportFeatures({ ...args, scope: 'selection' }).length,
    'table-result': resolveExportFeatures({ ...args, scope: 'table-result' }).length
  }
}

export function defaultTableView(): TableViewState {
  return {
    searchQuery: '',
    selectedOnly: false,
    sortField: null,
    sortDirection: 'asc'
  }
}

export function findLayer(project: Project, layerId: string | null): Layer | null {
  if (!layerId) return null
  return project.layers.find((l) => l.id === layerId) ?? null
}
