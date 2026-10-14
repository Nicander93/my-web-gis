import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { isTauri } from '@tauri-apps/api/core'
import { FileText, Upload, CheckCircle2, AlertCircle } from 'lucide-react'
import { pickFiles, readFile } from '@/services/files'
import {
  importGeoJson,
  importShapefileZip,
  importDxfFile,
  importCsvFile,
  detectFileType
} from '@/services/import'
import type { ImportResult } from '@/services/import'
import type { CrsInfo } from '@desktop-webgis/vector-io'
import { CRS_PRESETS } from '@desktop-webgis/vector-io'
import { CsvConfigDialog } from './CsvConfigDialog'
import { useProjectStore } from '@/stores/project.store'
import type { CsvConfig } from './CsvConfigDialog'
import {
  ServiceConnectPanel,
  type ServiceLayerAddRequest
} from './ServiceConnectPanel'

interface AddDataDialogProps {
  open: boolean
  onClose: () => void
  onImport: (result: ImportResult) => void
  /** P15: add selected service layers (never called on failed connect). */
  onAddServiceLayers?: (layers: ServiceLayerAddRequest[]) => void
}

type DialogStep =
  | 'select'
  | 'confirm'
  | 'select-crs'
  | 'select-shapefile-layers'
  | 'select-csv-config'
  | 'select-dxf-config'

const COMMON_CRS = CRS_PRESETS

export function AddDataDialog({
  open,
  onClose,
  onImport,
  onAddServiceLayers
}: AddDataDialogProps) {
  const browserFileInput = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<'file' | 'service'>('file')
  const [step, setStep] = useState<DialogStep>('select')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ImportResult | null>(null)
  const [pendingDxf, setPendingDxf] = useState<{
    source: string | File
    fileName: string
    availableLayers: string[]
  } | null>(null)
  const [pendingShapefile, setPendingShapefile] = useState<{
    source: string | File
    fileName: string
    availableLayers: string[]
  } | null>(null)
  const [pendingCsv, setPendingCsv] = useState<{
    source: string | File
    fileName: string
    content: string
  } | null>(null)
  const [selectedCrs, setSelectedCrs] = useState<string>('EPSG:4326')
  const [geoJsonCrs, setGeoJsonCrs] = useState('auto')
  const [selectedShapefileLayers, setSelectedShapefileLayers] = useState<
    Set<string>
  >(new Set())
  const [selectedDxfLayers, setSelectedDxfLayers] = useState<Set<string>>(
    new Set()
  )
  const parseGeneration = useRef(0)
  const openedProjectId = useRef<string | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (open) openedProjectId.current = useProjectStore.getState().project.id
    return () => { parseGeneration.current++ }
  }, [open])

  if (!open) return null

  function handleClose() {
    parseGeneration.current++
    setLoading(false)
    setStep('select')
    setParseResult(null)
    setPendingDxf(null)
    setPendingShapefile(null)
    setPendingCsv(null)
    setSelectedShapefileLayers(new Set())
    setSelectedDxfLayers(new Set())
    setSelectedCrs('EPSG:4326')
    setGeoJsonCrs('auto')
    setError(null)
    onClose()
  }

  function handleCancel() {
    parseGeneration.current++
    setLoading(false)
    setStep('select')
    setParseResult(null)
    setPendingDxf(null)
    setPendingShapefile(null)
    setPendingCsv(null)
    setSelectedShapefileLayers(new Set())
    setSelectedDxfLayers(new Set())
    setSelectedCrs('EPSG:4326')
    setError(null)
  }

  function handleConfirm() {
    if (loading || !parseResult) return
    try {
      if (useProjectStore.getState().project.id !== openedProjectId.current) throw new Error('工程已改变，请关闭窗口并重新导入')
      onImport(parseResult)
      handleClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  function isCurrentRead(generation: number): boolean {
    if (parseGeneration.current !== generation || !openRef.current) return false
    if (useProjectStore.getState().project.id !== openedProjectId.current) {
      setError('读取期间工程已改变，结果未导入；请重新打开添加数据窗口')
      return false
    }
    return true
  }

  async function parseFile(
    source: string | File,
    fileType: string,
    fileName: string,
    dxfOptions?: { crs?: CrsInfo; selectedLayers?: string[] },
    shapefileOptions?: { selectedLayers?: string[] },
    csvConfig?: CsvConfig
  ) {
    const generation = ++parseGeneration.current
    if (!isCurrentRead(generation)) return
    setParseResult(null)
    setError(null)
    setLoading(true)

    try {
      if (fileType === 'csv' && !csvConfig) {
        const content =
          typeof source === 'string'
            ? ((await readFile(source, false)) as string)
            : await source.text()

        if (!isCurrentRead(generation)) return
        setPendingCsv({ source, fileName, content })
        setStep('select-csv-config')
        setLoading(false)
        return
      }

      let result: ImportResult

      switch (fileType) {
        case 'geojson':
          result = await importGeoJson(
            source,
            geoJsonCrs === 'auto' ? {} : { sourceCrs: { code: geoJsonCrs } }
          )
          break
        case 'shapefile': {
          const preResult = await importShapefileZip(source, shapefileOptions)
          if (!isCurrentRead(generation)) return

          if (preResult.errors.length > 0) {
            setError(preResult.errors.join('; '))
            setLoading(false)
            return
          }

          if (
            !shapefileOptions?.selectedLayers &&
            preResult.layers.length > 1
          ) {
            setPendingShapefile({
              source,
              fileName,
              availableLayers: preResult.layers.map((l) => l.name)
            })
            const allLayers = new Set(preResult.layers.map((l) => l.name))
            setSelectedShapefileLayers(allLayers)
            setStep('select-shapefile-layers')
            setLoading(false)
            return
          }

          result = preResult
          break
        }
        case 'dxf': {
          if (!dxfOptions?.crs) {
            const { importDxfLayers } =
              await import('@desktop-webgis/vector-io')
            let content: string
            if (typeof source === 'string') {
              content = (await readFile(source, false)) as string
            } else {
              content = await source.text()
            }

            if (!isCurrentRead(generation)) return
            const layersResult = importDxfLayers(content, {})
            const availableLayers = layersResult.layers.map((l) => l.name)

            setPendingDxf({
              source,
              fileName,
              availableLayers
            })
            const allLayers = new Set(availableLayers)
            setSelectedDxfLayers(allLayers)
            setStep('select-dxf-config')
            setLoading(false)
            return
          }

          result = await importDxfFile(source, dxfOptions)
          break
        }
        case 'csv':
          if (!csvConfig) {
            setError('CSV 配置缺失')
            setLoading(false)
            return
          }
          result = await importCsvFile(source, csvConfig)
          break
        default:
          setError(`不支持的文件类型: ${fileName}`)
          setLoading(false)
          return
      }

      if (!isCurrentRead(generation)) return
      if (result.errors.length > 0) {
        setError(result.errors.join('; '))
        setLoading(false)
        return
      }

      setParseResult(result)
      setStep('confirm')
    } catch (err) {
      if (isCurrentRead(generation)) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (parseGeneration.current === generation) setLoading(false)
    }
  }

  async function handleDxfConfigConfirm() {
    if (!pendingDxf) return

    const selectedLayers = Array.from(selectedDxfLayers)
    if (selectedLayers.length === 0) {
      setError('请至少选择一个图层')
      return
    }

    const crs: CrsInfo = { code: selectedCrs }
    const generation = parseGeneration.current + 1
    await parseFile(pendingDxf.source, 'dxf', pendingDxf.fileName, {
      crs,
      selectedLayers
    })
    if (parseGeneration.current === generation) setPendingDxf(null)
  }

  async function handleShapefileLayersConfirm() {
    if (!pendingShapefile) return

    const selectedLayers = Array.from(selectedShapefileLayers)
    if (selectedLayers.length === 0) {
      setError('请至少选择一个图层')
      return
    }

    const generation = parseGeneration.current + 1
    await parseFile(
      pendingShapefile.source,
      'shapefile',
      pendingShapefile.fileName,
      undefined,
      { selectedLayers }
    )
    if (parseGeneration.current === generation) setPendingShapefile(null)
  }

  function toggleShapefileLayer(layerName: string) {
    setSelectedShapefileLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layerName)) {
        next.delete(layerName)
      } else {
        next.add(layerName)
      }
      return next
    })
  }

  function selectAllShapefileLayers() {
    if (!pendingShapefile) return
    setSelectedShapefileLayers(new Set(pendingShapefile.availableLayers))
  }

  function deselectAllShapefileLayers() {
    setSelectedShapefileLayers(new Set())
  }

  function toggleDxfLayer(layerName: string) {
    setSelectedDxfLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layerName)) {
        next.delete(layerName)
      } else {
        next.add(layerName)
      }
      return next
    })
  }

  function selectAllDxfLayers() {
    if (!pendingDxf) return
    setSelectedDxfLayers(new Set(pendingDxf.availableLayers))
  }

  function deselectAllDxfLayers() {
    setSelectedDxfLayers(new Set())
  }

  async function handleCsvConfigConfirm(config: CsvConfig) {
    if (!pendingCsv) return
    const generation = parseGeneration.current + 1
    await parseFile(
      pendingCsv.source,
      'csv',
      pendingCsv.fileName,
      undefined,
      undefined,
      config
    )
    if (parseGeneration.current === generation) setPendingCsv(null)
  }

  function handleCsvConfigCancel() {
    setPendingCsv(null)
    setStep('select')
  }

  async function handlePickFile() {
    if (!isTauri()) {
      browserFileInput.current?.click()
      return
    }
    try {
      const generation = parseGeneration.current
      const paths = await pickFiles([
        { name: 'GeoJSON', extensions: ['geojson', 'json'] },
        { name: 'Shapefile', extensions: ['zip'] },
        { name: 'DXF', extensions: ['dxf'] },
        { name: 'CSV', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ])

      if (!paths.length || !isCurrentRead(generation)) return
      await parseSources(paths)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '无法打开文件选择窗口。'
      )
    }
  }

  async function parseSources(sources: Array<string | File>): Promise<void> {
    if (!sources.length) return
    const name = (source: string | File) => typeof source === 'string' ? source.replaceAll('\\', '/').split('/').pop() || 'imported' : source.name
    if (sources.length === 1) {
      await parseFile(sources[0], detectFileType(name(sources[0])), name(sources[0]))
      return
    }
    const generation = ++parseGeneration.current
    setParseResult(null); setStep('select'); setError(null)
    if (!sources.every((source) => detectFileType(name(source)) === 'geojson')) {
      setLoading(false)
      setError('多文件批次目前支持 GeoJSON；SHP ZIP、DXF 和 CSV 请分别完成各自配置后导入。')
      return
    }
    setLoading(true)
    const result: ImportResult = { layers: [], errors: [] }
    try {
      for (const source of sources) {
        if (!isCurrentRead(generation)) return
        const parsed = await importGeoJson(source, geoJsonCrs === 'auto' ? {} : { sourceCrs: { code: geoJsonCrs } })
        if (!isCurrentRead(generation)) return
        result.layers.push(...parsed.layers)
        result.errors.push(...parsed.errors.map((error) => `${name(source)}：${error}`))
      }
      if (result.errors.length) { setError(result.errors.join('；')); return }
      setParseResult(result); setStep('confirm')
    } catch (reason) {
      if (isCurrentRead(generation)) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (parseGeneration.current === generation) setLoading(false) }
  }

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault()

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return

    await parseSources(files)
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault()
  }

  const totalFeatures =
    parseResult?.layers.reduce(
      (sum, layer) => sum + layer.features.length,
      0
    ) ?? 0
  const hasWarnings =
    parseResult?.layers.some((layer) => layer.warnings.length > 0) ?? false

  return (
    <EditorDialog
      title={step === 'select-csv-config' ? 'CSV 坐标' : '添加数据'}
      onClose={handleClose}
      busy={loading}
      className="data-source-dialog"
    >
      <input
        ref={browserFileInput}
        type="file"
        multiple
        hidden
        accept=".geojson,.json,.zip,.dxf,.csv"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (files.length) void parseSources(files)
        }}
      />
      <div className="import-progress" aria-label="导入步骤">
        <span className={step === 'select' ? 'is-current' : ''}>
          1 数据来源
        </span>
        <span
          className={
            step !== 'select' && step !== 'confirm' ? 'is-current' : ''
          }
        >
          2 读取与配置
        </span>
        <span className={step === 'confirm' ? 'is-current' : ''}>
          3 确认导入
        </span>
      </div>

      {loading && <div className="import-cancel-read"><Button onClick={handleCancel}>取消读取</Button>
        <span>读取完成后仍需确认；取消不会写入项目。</span></div>}

      {step === 'select' && (
        <div className="data-source-layout">
          <div className="dialog-tabs">
            <Button variant="ghost"
              className={`dialog-tab ${activeTab === 'file' ? 'active' : ''}`}
              onClick={() => setActiveTab('file')}
            >
              <FileText size={14} />
              本地文件
            </Button>
            <Button variant="ghost"
              className={`dialog-tab ${activeTab === 'service' ? 'active' : ''}`}
              onClick={() => setActiveTab('service')}
            >
              <Upload size={14} />
              地图服务
            </Button>
          </div>

          <div className="dialog-body">
            {activeTab === 'file' && (
              <details className="export-fieldset">
                <summary>GeoJSON 源坐标系设置</summary>
                <label>
                  源坐标系{' '}
                  <select
                    value={geoJsonCrs}
                    disabled={loading}
                    onChange={(event) => setGeoJsonCrs(event.target.value)}
                  >
                    <option value="auto">文件声明；未声明则 WGS84</option>
                    {COMMON_CRS.map((crs) => (
                      <option key={crs.code} value={crs.code}>
                        {crs.code} · {crs.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="export-hint">
                  仅用于 GeoJSON。经度/X 在前，纬度/Y 在后；转换为 WGS84
                  后入库。与文件声明冲突时拒绝导入，不猜测坐标系。
                </p>
              </details>
            )}
            {activeTab === 'file' && (
              <div
                className="file-drop-zone"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <FileText size={32} />
                <p>将文件拖放到此处</p>
                <p className="file-drop-hint">或</p>
                <Button
                  variant="primary" className="button-primary"
                  onClick={handlePickFile}
                  disabled={loading}
                >
                  {loading ? '解析中...' : '选择文件'}
                </Button>
                <p className="file-drop-formats">
                  支持格式: GeoJSON (.geojson, .json), Shapefile (.zip), DXF
                  (.dxf), CSV (.csv)
                </p>
              </div>
            )}

            {activeTab === 'service' && (
              <ServiceConnectPanel
                onAddLayers={(layers: ServiceLayerAddRequest[]) => {
                  onAddServiceLayers?.(layers)
                  handleClose()
                }}
              />
            )}

            {error && (
              <div className="import-error">
                <strong>导入失败:</strong> {error}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'select-dxf-config' && pendingDxf && (
        <>
          <div className="dialog-body">
            <div className="dxf-config-container">
              <div className="config-header">
                <AlertCircle size={24} className="config-icon-warning" />
                <h3>配置 DXF 导入</h3>
              </div>

              <div className="config-section">
                <h4>选择坐标系</h4>
                <p className="config-hint">
                  DXF 文件未包含坐标系信息,请选择正确的坐标系 (CAD 单位):
                </p>
                <select
                  value={selectedCrs}
                  onChange={(e) => setSelectedCrs(e.target.value)}
                  className="crs-select"
                >
                  {COMMON_CRS.map(({ code, name }) => (
                    <option key={code} value={code}>
                      {name} ({code})
                    </option>
                  ))}
                </select>
                <p className="config-note">
                  选择的坐标系将用于坐标转换。注意: CAD 米制坐标不等同于经纬度。
                </p>
              </div>

              <div className="config-section">
                <h4>选择要导入的图层</h4>
                <p className="config-hint">
                  此文件包含 {pendingDxf.availableLayers.length} 个 CAD
                  图层，请选择要导入的图层:
                </p>

                <div className="selector-actions">
                  <Button variant="ghost" className="button-link" onClick={selectAllDxfLayers}>
                    全选
                  </Button>
                  <Button
                    variant="ghost" className="button-link"
                    onClick={deselectAllDxfLayers}
                  >
                    取消全选
                  </Button>
                </div>

                <div className="layer-list">
                  {pendingDxf.availableLayers.map((layerName) => (
                    <label key={layerName} className="layer-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedDxfLayers.has(layerName)}
                        onChange={() => toggleDxfLayer(layerName)}
                      />
                      <span>{layerName}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="dialog-footer">
            <Button className="button-secondary" onClick={handleCancel}>
              取消
            </Button>
            <Button
              variant="primary" className="button-primary"
              onClick={handleDxfConfigConfirm}
              disabled={loading || selectedDxfLayers.size === 0}
            >
              {loading ? '导入中...' : `导入 ${selectedDxfLayers.size} 个图层`}
            </Button>
          </div>
        </>
      )}

      {step === 'select-shapefile-layers' && pendingShapefile && (
        <>
          <div className="dialog-body">
            <div className="shapefile-layer-selector">
              <div className="selector-header">
                <FileText size={24} className="selector-icon" />
                <h3>选择要导入的图层</h3>
              </div>
              <p className="selector-hint">
                此 ZIP 文件包含 {pendingShapefile.availableLayers.length} 个
                Shapefile，请选择要导入的图层:
              </p>

              <div className="selector-actions">
                <Button
                  variant="ghost" className="button-link"
                  onClick={selectAllShapefileLayers}
                >
                  全选
                </Button>
                <Button
                  variant="ghost" className="button-link"
                  onClick={deselectAllShapefileLayers}
                >
                  取消全选
                </Button>
              </div>

              <div className="layer-list">
                {pendingShapefile.availableLayers.map((layerName) => (
                  <label key={layerName} className="layer-checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedShapefileLayers.has(layerName)}
                      onChange={() => toggleShapefileLayer(layerName)}
                    />
                    <span>{layerName}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="dialog-footer">
            <Button className="button-secondary" onClick={handleCancel}>
              取消
            </Button>
            <Button
              variant="primary" className="button-primary"
              onClick={handleShapefileLayersConfirm}
              disabled={loading || selectedShapefileLayers.size === 0}
            >
              {loading
                ? '导入中...'
                : `导入 ${selectedShapefileLayers.size} 个图层`}
            </Button>
          </div>
        </>
      )}

      {step === 'select-csv-config' && pendingCsv && (
        <CsvConfigDialog
          open={true}
          csvContent={pendingCsv.content}
          onConfirm={handleCsvConfigConfirm}
          onCancel={handleCsvConfigCancel}
        />
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
                  <span className="stat-value">
                    {parseResult.layers.length}
                  </span>
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
                      <span
                        className={`layer-symbol layer-symbol-${layer.styleKind}`}
                      />
                      <strong>{layer.name}</strong>
                      <span className="layer-item-count">
                        {layer.features.length} 个要素
                      </span>
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
            <Button className="button-secondary" onClick={handleCancel}>
              取消
            </Button>
            <Button variant="primary" className="button-primary" disabled={loading} onClick={handleConfirm}>
              确认导入
            </Button>
          </div>
        </>
      )}
    </EditorDialog>
  )
}
