import { useState } from 'react'
import { FileText, Upload, X } from 'lucide-react'
import { pickFile } from '@/services/files'
import { importGeoJson, importShapefileZip, importDxfFile, detectFileType } from '@/services/import'
import type { ImportResult } from '@/services/import'

interface AddDataDialogProps {
  open: boolean
  onClose: () => void
  onImport: (result: ImportResult) => void
}

export function AddDataDialog({ open, onClose, onImport }: AddDataDialogProps) {
  const [activeTab, setActiveTab] = useState<'file' | 'service'>('file')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  async function handlePickFile() {
    setError(null)
    setLoading(true)

    try {
      const path = await pickFile([
        { name: 'GeoJSON', extensions: ['geojson', 'json'] },
        { name: 'Shapefile', extensions: ['zip'] },
        { name: 'DXF', extensions: ['dxf'] },
        { name: 'All Files', extensions: ['*'] }
      ])

      if (!path) {
        setLoading(false)
        return
      }

      const fileType = detectFileType(path)
      let result: ImportResult

      switch (fileType) {
        case 'geojson':
          result = await importGeoJson(path)
          break
        case 'shapefile':
          result = await importShapefileZip(path)
          break
        case 'dxf':
          result = await importDxfFile(path)
          break
        default:
          setError(`不支持的文件类型: ${path}`)
          setLoading(false)
          return
      }

      if (result.errors.length > 0) {
        setError(result.errors.join('; '))
        setLoading(false)
        return
      }

      onImport(result)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const files = Array.from(event.dataTransfer.files)
      if (files.length === 0) {
        setLoading(false)
        return
      }

      const file = files[0]
      const fileType = detectFileType(file.name)
      let result: ImportResult

      switch (fileType) {
        case 'geojson':
          result = await importGeoJson(file)
          break
        case 'shapefile':
          result = await importShapefileZip(file)
          break
        case 'dxf':
          result = await importDxfFile(file)
          break
        default:
          setError(`不支持的文件类型: ${file.name}`)
          setLoading(false)
          return
      }

      if (result.errors.length > 0) {
        setError(result.errors.join('; '))
        setLoading(false)
        return
      }

      onImport(result)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <h2>添加数据</h2>
          <button className="dialog-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

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
                {loading ? '加载中...' : '选择文件'}
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
      </div>
    </div>
  )
}
