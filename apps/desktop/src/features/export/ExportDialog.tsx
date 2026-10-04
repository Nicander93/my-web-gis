import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  inferLayerStyleKind,
  type GisFeature
} from '@desktop-webgis/gis-core'
import { serializeVectorExport, type ExportFormat, type CoordinateExportCrs } from './serializeVectorExport'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { pickSaveFile, writeTextFile } from '@/services/files'
import { emitCommandStatus } from '@/app/commands/status'
import { getLayerCapabilities } from '@/app/commands/layer.commands'
import type { ExportDialogMode } from '@/app/commands/project.commands'
import {
  EXPORT_SCOPE_LABELS,
  countExportScopes,
  defaultTableView,
  findLayer,
  resolveExportFeatures,
  type ExportScope
} from './exportScopes'

export type { ExportFormat } from './serializeVectorExport'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  /** Optional fixed layer; defaults to selected layer. */
  layerId?: string | null
  /** P14: export vs copy open the same dialog with the matching primary action. */
  mode?: ExportDialogMode
}

export function ExportDialog({ open, onClose, layerId, mode = 'export' }: ExportDialogProps) {
  const project = useProjectStore((s) => s.project)
  const featuresByDataset = useProjectStore((s) => s.featuresByDataset)
  const selection = useProjectStore((s) => s.selection)
  const selectedLayerId = useProjectStore((s) => s.selectedLayerId)
  const copyFeaturesToLocalLayer = useProjectStore((s) => s.copyFeaturesToLocalLayer)

  const targetLayerId = layerId ?? selectedLayerId
  const layer = findLayer(project, targetLayerId)
  const allFeatures = layer ? (featuresByDataset[layer.datasetId] ?? []) : []

  const layerSession = useSessionStore((s) =>
    targetLayerId ? s.sessions[targetLayerId] : undefined
  )
  const tableView = useMemo(
    () => ({
      searchQuery: layerSession?.attributeTable?.searchQuery ?? '',
      selectedOnly: layerSession?.attributeTable?.selectedOnly ?? false,
      sortField: layerSession?.attributeTable?.sortField ?? null,
      sortDirection: (layerSession?.attributeTable?.sortDirection ?? 'asc') as 'asc' | 'desc'
    }),
    [layerSession]
  )

  const [scope, setScope] = useState<ExportScope>('all')
  const [format, setFormat] = useState<ExportFormat>('geojson')
  const [coordinateCrs, setCoordinateCrs] = useState<CoordinateExportCrs>('EPSG:4326')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setScope('all')
      setFormat('geojson')
      setCoordinateCrs('EPSG:4326')
      setBusy(false)
      setError(null)
    }
  }, [open, targetLayerId])

  const counts = useMemo(() => {
    if (!layer) {
      return { all: 0, 'layer-filter': 0, selection: 0, 'table-result': 0 }
    }
    return countExportScopes({
      layer,
      allFeatures,
      selection,
      tableView: tableView ?? defaultTableView()
    })
  }, [layer, allFeatures, selection, tableView])

  const currentCount = counts[scope]

  if (!open) return null

  function handleClose(): void {
    // Cancel must not change Dirty — we never touch the store on close.
    setError(null)
    setBusy(false)
    onClose()
  }

  function takeSnapshot(): GisFeature[] {
    if (!layer) return []
    return resolveExportFeatures({
      scope,
      layer,
      allFeatures,
      selection,
      tableView
    })
  }

  async function handleExport(): Promise<void> {
    if (!layer) {
      setError('请先选择图层')
      return
    }
    const caps = getLayerCapabilities(layer.id)
    if (!caps.canExport) {
      setError('当前图层不支持矢量导出（服务瓦片图层不可导出为 GeoJSON/CSV）')
      emitCommandStatus('服务图层不支持矢量导出')
      return
    }
    const snapshot = takeSnapshot()
    if (snapshot.length === 0) {
      setError('当前导出范围为 0 个要素，未生成文件。')
      emitCommandStatus('导出取消：范围为空')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const serialized = serializeVectorExport(snapshot, format, coordinateCrs)
      const isCsv = serialized.extension === 'csv'
      const suffix = format === 'coordinate-csv' ? `_${coordinateCrs.replace(':', '-')}` : ''
      const defaultName = `${layer.name || 'layer'}${suffix}.${serialized.extension}`
      const path = await pickSaveFile({
        title: '导出数据',
        defaultPath: defaultName,
        filters: isCsv
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }]
      })
      if (!path) {
        // User cancelled save dialog — Dirty unchanged.
        emitCommandStatus('已取消导出')
        setBusy(false)
        return
      }

      await writeTextFile(path, serialized.content)
      emitCommandStatus(`已导出 ${snapshot.length} 个要素 → ${path}`)
      handleClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`导出失败：${message}`)
      emitCommandStatus('导出失败')
      setBusy(false)
    }
  }

  function handleCopyLocal(): void {
    if (!layer) {
      setError('请先选择图层')
      return
    }
    const caps = getLayerCapabilities(layer.id)
    if (!caps.canCopy) {
      setError('当前图层不支持复制为本地图层')
      emitCommandStatus('服务图层不支持复制为本地图层')
      return
    }
    const snapshot = takeSnapshot()
    if (snapshot.length === 0) {
      setError('当前范围为 0 个要素，未创建图层。')
      emitCommandStatus('复制取消：范围为空')
      return
    }

    const newName = `${layer.name}（副本）`
    const result = copyFeaturesToLocalLayer(
      snapshot,
      newName,
      inferLayerStyleKind(snapshot)
    )
    if (!result) {
      setError('复制失败')
      return
    }
    emitCommandStatus(`已复制为本地图层「${newName}」，共 ${snapshot.length} 个要素`)
    handleClose()
  }

  return (
    <div className="dialog-overlay" onClick={handleClose}>
      <div className="dialog-content export-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <h2>{mode === 'copy' ? '复制为本地图层' : '导出图层'}</h2>
          <button className="dialog-close" onClick={handleClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="dialog-body">
          {!layer ? (
            <p className="export-empty">请先在图层面板选择一个矢量图层。</p>
          ) : (
            <>
              <p className="export-layer-name">
                图层：<strong>{layer.name}</strong>
              </p>

              <fieldset className="export-fieldset">
                <legend>导出范围</legend>
                {(Object.keys(EXPORT_SCOPE_LABELS) as ExportScope[]).map((key) => (
                  <label key={key} className="export-radio">
                    <input
                      type="radio"
                      name="export-scope"
                      checked={scope === key}
                      onChange={() => {
                        setScope(key)
                        setError(null)
                      }}
                    />
                    <span>
                      {EXPORT_SCOPE_LABELS[key]}
                      <span className="export-count">（{counts[key]}）</span>
                    </span>
                  </label>
                ))}
                <p className="export-hint">
                  {mode === 'copy' ? '确认后使用同一快照复制为本地图层；之后改动不影响本次结果。' : '确认后使用同一快照导出；之后改动不影响本次结果。'}
                </p>
              </fieldset>

              {mode === 'export' && <fieldset className="export-fieldset">
                <legend>导出格式</legend>
                <label className="export-radio">
                  <input
                    type="radio"
                    name="export-format"
                    checked={format === 'geojson'}
                    onChange={() => setFormat('geojson')}
                  />
                  <span>GeoJSON（几何 + 属性；保留原始字符串）</span>
                </label>
                <label className="export-radio">
                  <input
                    type="radio"
                    name="export-format"
                    checked={format === 'csv'}
                    onChange={() => setFormat('csv')}
                  />
                  <span>属性 CSV</span>
                </label>
                {mode === 'export' && <>
                  <label className="export-radio"><input type="radio" name="export-format" checked={format === 'coordinate-csv'} onChange={() => setFormat('coordinate-csv')} /><span>点坐标 CSV（X、Y、坐标系 + 属性）</span></label>
                  {format === 'coordinate-csv' && <label>目标坐标系 <select value={coordinateCrs} onChange={event => setCoordinateCrs(event.target.value as CoordinateExportCrs)} disabled={busy}>
                    <option value="EPSG:4326">WGS84 · 经度/纬度（度）</option><option value="EPSG:3857">Web Mercator · X/Y（米）</option>
                  </select><p className="export-hint">仅支持单点；新增 id、x、y、crs 列，同名属性冲突时拒绝导出。仅转换导出快照，不更改项目；Z 不写入 CSV。重新导入时请选择相同坐标系。Web Mercator 米制坐标不代表准确地面距离。</p></label>}
                </>}
                {format === 'geojson' && <p className="export-hint">GeoJSON 固定输出 WGS84 经度/纬度；地图显示投影不改变导出坐标。</p>}
                {format !== 'geojson' ? (
                  <p className="export-hint export-formula-help">
                    CSV 默认启用电子表格公式防护：以 <code>=</code> <code>+</code>{' '}
                    <code>-</code> <code>@</code> 或制表符/回车开头的单元格会加上前导{' '}
                    <code>&apos;</code>，避免 Excel / LibreOffice 将其当作公式执行。GeoJSON
                    不受此处理，始终保留原始字符串。
                  </p>
                ) : null}
              </fieldset>}

              {currentCount === 0 ? (
                <p className="export-warn">当前范围无要素，不会生成文件或图层。</p>
              ) : null}
              {error ? <p className="export-error">{error}</p> : null}
            </>
          )}
        </div>

        <footer className="dialog-footer">
          <button type="button" className="button-secondary" onClick={handleClose} disabled={busy}>
            取消
          </button>
          {mode === 'copy' ? (
            <button
              type="button"
              className="button-primary"
              onClick={handleCopyLocal}
              disabled={!layer || busy || currentCount === 0}
              title="将当前范围复制为独立本地图层（独立 Dataset）"
            >
              复制为本地图层
            </button>
          ) : (
            <button
              type="button"
              className="button-primary"
              onClick={() => void handleExport()}
              disabled={!layer || busy || currentCount === 0}
            >
              {busy ? '导出中…' : '导出'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
