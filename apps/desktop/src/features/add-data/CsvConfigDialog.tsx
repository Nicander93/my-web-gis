import { useState, useEffect, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import { runImportTask } from '@/services/import-worker'
import type { CsvPreviewResult, CrsInfo } from '@desktop-webgis/vector-io'
import { CRS_PRESETS, isGeographicCrsCode } from '@desktop-webgis/vector-io'

export interface CsvConfig {
  xField: string
  yField: string
  crs: CrsInfo
}

export interface CsvConfigDialogProps {
  open: boolean
  csvContent: string
  onConfirm: (config: CsvConfig) => void
  onCancel: () => void
}

const COMMON_CRS = CRS_PRESETS

export function CsvConfigDialog({
  open,
  csvContent,
  onConfirm,
  onCancel
}: CsvConfigDialogProps) {
  const initialPreview: CsvPreviewResult = { fields: [], sampleRows: [], totalRows: 0, validRows: 0, invalidRows: 0, errors: [] }
  const initialized = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  
  const [xField, setXField] = useState(() => 
    findCoordinateField(initialPreview.fields, ['x', 'lon', 'longitude', 'lng', 'jd', '经度'])
  )
  const [yField, setYField] = useState(() => 
    findCoordinateField(initialPreview.fields, ['y', 'lat', 'latitude', 'wd', '纬度'])
  )
  const [crsCode, setCrsCode] = useState(() => COMMON_CRS.find(crs => crs.code === initialPreview.declaredCrs)?.code ?? 'EPSG:4326')
  const [preview, setPreview] = useState<CsvPreviewResult>(initialPreview)
  const coordinateInput = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (open) coordinateInput.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError('')
    void runImportTask<CsvPreviewResult>({ kind: 'csv-preview', content: csvContent,
      options: xField && yField && xField !== yField ? { xField, yField, crs: { code: crsCode } } : undefined
    }, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setPreview(result)
      if (!initialized.current) {
        initialized.current = true
        setXField(findCoordinateField(result.fields, ['x', 'lon', 'longitude', 'lng', 'jd', '经度']))
        setYField(findCoordinateField(result.fields, ['y', 'lat', 'latitude', 'wd', '纬度']))
        if (result.declaredCrs) setCrsCode(result.declaredCrs)
      }
      setLoading(false)
    }).catch(reason => {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) }
    })
    return () => controller.abort()
  }, [open, xField, yField, crsCode, csvContent])

  if (!open) return null

  const canConfirm = !loading && !error && xField && yField && xField !== yField

  function handleConfirm() {
    if (canConfirm) {
      onConfirm({ xField, yField, crs: { code: crsCode } })
    }
  }

  return (
    <>
        <div className="dialog-body csv-config-content">
          {loading && <p role="status">正在后台检查 CSV…</p>}
          {error && <p role="alert">{error}</p>}
          <div className="csv-config-section">
            <div className="csv-config-row">
              <label htmlFor="x-field">{isGeographicCrsCode(crsCode) ? '经度 (X)' : 'X (米)'}</label>
              <select
                ref={coordinateInput}
                id="x-field"
                value={xField}
                onChange={(e) => setXField(e.target.value)}
              >
                <option value="">-- 选择字段 --</option>
                {preview.fields.map(field => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </div>

            <div className="csv-config-row">
              <label htmlFor="y-field">{isGeographicCrsCode(crsCode) ? '纬度 (Y)' : 'Y (米)'}</label>
              <select
                id="y-field"
                value={yField}
                onChange={(e) => setYField(e.target.value)}
              >
                <option value="">-- 选择字段 --</option>
                {preview.fields.map(field => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="csv-config-section">
            <div className="csv-config-row">
              <label htmlFor="crs">坐标系</label>
              <select
                id="crs"
                value={crsCode}
                onChange={(e) => setCrsCode(e.target.value)}
              >
                {COMMON_CRS.map(option => (
                  <option key={option.code} value={option.code}>
                    {option.name} ({option.code})
                  </option>
                ))}
              </select>
            </div>
            <details className="csv-config-help">
              <summary>坐标系说明</summary>
              <p>坐标系未知或不在列表中时，请先转换为支持的坐标系，再导入。</p>
            </details>
          </div>

          {preview.sampleRows.length > 0 && (
            <div className="csv-config-section">
              <h3>数据预览 (前 {preview.sampleRows.length} 行)</h3>
              
              {canConfirm && preview.validRows > 0 && (
                <p className="csv-record-count">
                  全部 {preview.totalRows} · 可导入 {preview.validRows}
                  {preview.invalidRows > 0 ? ` · 错误 ${preview.invalidRows}` : ''}
                </p>
              )}
              
              <div className="csv-preview-table-container">
                <table className="csv-preview-table">
                  <thead>
                    <tr>
                      {preview.fields.map(field => (
                        <th key={field} className={
                          field === xField ? 'highlight-x' :
                          field === yField ? 'highlight-y' : ''
                        }>
                          {field}
                          {field === xField && ' (X)'}
                          {field === yField && ' (Y)'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, i) => (
                      <tr key={i}>
                        {preview.fields.map(field => (
                          <td key={field} className={
                            field === xField ? 'highlight-x' :
                            field === yField ? 'highlight-y' : ''
                          }>
                            {row[field] || ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {canConfirm && preview.errors.length > 0 && (
                <div className="csv-error-list">
                  <strong>错误行 (前 {Math.min(preview.errors.length, 5)} 行):</strong>
                  <ul>
                    {preview.errors.slice(0, 5).map((error, i) => (
                      <li key={i}>行 {error.row}: {error.reason}</li>
                    ))}
                  </ul>
                  {preview.errors.length > 5 && (
                    <p>还有 {preview.errors.length - 5} 行错误...</p>
                  )}
                </div>
              )}
            </div>
          )}

          {!canConfirm && (xField || yField) && (
            <div className="csv-config-warning">
              <AlertCircle size={16} />
              <span>
                {xField === yField ? 'X 和 Y 字段不能相同' : '请选择 X 和 Y 字段'}
              </span>
            </div>
          )}

        </div>

        <div className="dialog-footer">
          <button className="button-secondary" onClick={onCancel}>
            返回
          </button>
          <button
            className="button-primary"
            onClick={handleConfirm}
            disabled={!canConfirm || preview.validRows === 0}
          >
            确认 ({preview.validRows} 个有效记录)
          </button>
        </div>
    </>
  )
}

function findCoordinateField(fields: string[], candidates: string[]): string {
  const lowerFields = fields.map(f => f.toLowerCase())
  
  for (const candidate of candidates) {
    const index = lowerFields.indexOf(candidate)
    if (index !== -1) {
      return fields[index]
    }
  }
  
  return ''
}
