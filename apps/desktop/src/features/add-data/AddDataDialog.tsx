import { useState } from 'react'
import { FileText, Upload, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { pickFile } from '@/services/files'
import { importGeoJson, importShapefileZip, importDxfFile, detectFileType } from '@/services/import'
import type { ImportResult } from '@/services/import'

interface AddDataDialogProps {
  open: boolean
  onClose: () => void
  onImport: (result: ImportResult) => void
}

type DialogStep = 'select' | 'confirm'

export function AddDataDialog({ open, onClose, onImport }: AddDataDialogProps) {
  const [activeTab, setActiveTab] = useState<'file' | 'service'>('file')
  const [step, setStep] = useState<DialogStep>('select')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ImportResult | null>(null)

  if (!open) return null

  function handleClose() {
    setStep('select')
    setParseResult(null)
    setError(null)
    onClose()
  }

  function handleCancel() {
    setStep('select')
    setParseResult(null)
    setError(null)
  }

  function handleConfirm() {
    if (parseResult) {
      onImport(parseResult)
      handleClose()
    }
  }

  async function parseFile(source: string | File, fileType: string, fileName: string) {
    setError(null)
    setLoading(true)

    try {
      let result: ImportResult

      switch (fileType) {
        case 'geojson':
          result = await importGeoJson(source)
          break
        case 'shapefile':
          result = await importShapefileZip(source)
          break
        case 'dxf':
          result = await importDxfFile(source)
          break
        default:
          setError(`不支持的文件类型: ${fileName}`)
          setLoading(false)
          return
      }

      if (result.errors.length > 0) {
        setError(result.errors.join('; '))
        setLoading(false)
        return
      }

      setParseResult(result)
      setStep('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handlePickFile() {
    const path = await pickFile([
      { name: 'GeoJSON', extensions: ['geojson', 'json'] },
      { name: 'Shapefile', extensions: ['zip'] },
      { name: 'DXF', extensions: ['dxf'] },
      { name: 'All Files', extensions: ['*'] }
    ])

    if (!path) return

    const fileType = detectFileType(path)
    await parseFile(path, fileType, path)
  }

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault()

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return

    const file = files[0]
    const fileType = detectFileType(file.name)
    await parseFile(file, fileType, file.name)
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault()
  }

  const totalFeatures = parseResult?.layers.reduce((sum, layer) => sum + layer.features.length, 0) ?? 0
  const hasWarnings = parseResult?.layers.some(layer => layer.warnings.length > 0) ?? false

  return (
    <div className="dialog-overlay" onClick={handleClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <h2>添加数据</h2>
          <button className="dialog-close" onClick={handleClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        {step === 'select' && (
          <>
            <div className="dialog-tabs">
              <button
                className={`dialog-tab ${activeTab === 'file' ? 'active' : ''}`}
                onClick={() => setActiveTab('file')}
              >
                <FileText size={14} />
                文件
              </button>
              <button
                className={`dialog-tab ${activeTab === 'service' ? 'active' : ''}`}
                onClick={() => setActiveTab('service')}
                disabled
                title="地图服务功能将在后续版本中实现"
              >
                <Upload size={14} />
                地图服务
              </button>
            </div>

            <div className="dialog-body">
              {activeTab === 'file' && (
                <div
                  className="file-drop-zone"
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  <FileText size={48} />
                  <p>将文件拖放到此处</p>
                  <p className="file-drop-hint">或</p>
                  <button
                    className="button-primary"
                    onClick={handlePickFile}
                    disabled={loading}
                  >
                    {loading ? '解析中...' : '选择文件'}
                  </button>
                  <p className="file-drop-formats">
                    支持格式: GeoJSON (.geojson, .json), Shapefile (.zip), DXF (.dxf)
                  </p>
                </div>
              )}

              {activeTab === 'service' && (
                <div className="service-placeholder">
                  <p>地图服务功能将在后续版本中实现</p>
                </div>
              )}

              {error && (
                <div className="import-error">
                  <strong>导入失败:</strong> {error}
                </div>
              )}
            </div>
          </>
        )}

        {step === 'confirm' && parseResult && (
          <>
            <div className="dialog-body">
              <div className="import-preview">
                <div className="preview-header">
                  <CheckCircle2 size={24} className="preview-icon-success" />
                  <h3>解析成功</h3>
                </div>

                <div className="preview-summary">
                  <div className="preview-stat">
                    <span className="stat-label">图层数量</span>
                    <span className="stat-value">{parseResult.layers.length}</span>
                  </div>
                  <div className="preview-stat">
                    <span className="stat-label">要素总数</span>
                    <span className="stat-value">{totalFeatures}</span>
                  </div>
                </div>

                <div className="preview-layers">
                  {parseResult.layers.map((layer, index) => (
                    <div key={index} className="preview-layer-item">
                      <div className="layer-item-header">
                        <span className={`layer-symbol layer-symbol-${layer.styleKind}`} />
                        <strong>{layer.name}</strong>
                        <span className="layer-item-count">{layer.features.length} 个要素</span>
                      </div>
                      {layer.warnings.length > 0 && (
                        <div className="layer-warnings">
                          <AlertCircle size={14} />
                          <span>{layer.warnings.join('; ')}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {hasWarnings && (
                  <div className="preview-note">
                    <AlertCircle size={16} />
                    <span>部分数据存在警告，但不影响导入</span>
                  </div>
                )}
              </div>
            </div>

            <div className="dialog-footer">
              <button className="button-secondary" onClick={handleCancel}>
                取消
              </button>
              <button className="button-primary" onClick={handleConfirm}>
                确认导入
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
