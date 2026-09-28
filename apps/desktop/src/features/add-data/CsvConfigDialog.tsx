import { useState } from 'react'
import { X, AlertCircle, CheckCircle2 } from 'lucide-react'

export interface CsvConfig {
  xField: string
  yField: string
  crs: string
}

export interface CsvConfigDialogProps {
  open: boolean
  fields: string[]
  sampleRows: Record<string, string>[]
  onConfirm: (config: CsvConfig) => void
  onCancel: () => void
}

const SUPPORTED_CRS = [
  { value: 'EPSG:4326', label: 'EPSG:4326 (WGS84 经纬度)' },
  { value: 'EPSG:3857', label: 'EPSG:3857 (Web Mercator)' }
]

export function CsvConfigDialog({
  open,
  fields,
  sampleRows,
  onConfirm,
  onCancel
}: CsvConfigDialogProps) {
  const [xField, setXField] = useState(findCoordinateField(fields, ['x', 'lon', 'longitude', 'lng', 'jd', '经度']))
  const [yField, setYField] = useState(findCoordinateField(fields, ['y', 'lat', 'latitude', 'wd', '纬度']))
  const [crs, setCrs] = useState('EPSG:4326')

  if (!open) return null

  const canConfirm = xField && yField && xField !== yField

  function handleConfirm() {
    if (canConfirm) {
      onConfirm({ xField, yField, crs })
    }
  }

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-content csv-config-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <h2>配置 CSV 坐标</h2>
          <button className="dialog-close" onClick={onCancel} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="dialog-body">
          <div className="csv-config-section">
            <h3>坐标字段</h3>
            <p className="csv-config-hint">
              选择包含 X(经度) 和 Y(纬度) 坐标的字段
            </p>

            <div className="csv-config-row">
              <label htmlFor="x-field">X 字段 (经度)</label>
              <select
                id="x-field"
                value={xField}
                onChange={(e) => setXField(e.target.value)}
              >
                <option value="">-- 选择字段 --</option>
                {fields.map(field => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </div>

            <div className="csv-config-row">
              <label htmlFor="y-field">Y 字段 (纬度)</label>
              <select
                id="y-field"
                value={yField}
                onChange={(e) => setYField(e.target.value)}
              >
                <option value="">-- 选择字段 --</option>
                {fields.map(field => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="csv-config-section">
            <h3>坐标参考系统 (CRS)</h3>
            <div className="csv-config-row">
              <label htmlFor="crs">CRS</label>
              <select
                id="crs"
                value={crs}
                onChange={(e) => setCrs(e.target.value)}
              >
                {SUPPORTED_CRS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="csv-config-note">
              <AlertCircle size={14} />
              <span>如果 CRS 未知或不在列表中,请先通过外部工具转换为支持的坐标系</span>
            </p>
          </div>

          {sampleRows.length > 0 && (
            <div className="csv-config-section">
              <h3>数据预览 (前 {sampleRows.length} 行)</h3>
              <div className="csv-preview-table-container">
                <table className="csv-preview-table">
                  <thead>
                    <tr>
                      {fields.map(field => (
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
                    {sampleRows.map((row, i) => (
                      <tr key={i}>
                        {fields.map(field => (
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

          {canConfirm && (
            <div className="csv-config-success">
              <CheckCircle2 size={16} />
              <span>
                将从 "{xField}" 和 "{yField}" 创建点图层
              </span>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button className="button-secondary" onClick={onCancel}>
            取消
          </button>
          <button
            className="button-primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            确认
          </button>
        </div>
      </div>
    </div>
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
