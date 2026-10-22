import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Space, Switch, Table } from 'antd'
import { isTauri } from '@tauri-apps/api/core'
import { getLayerCartography } from '@desktop-webgis/gis-core'
import { exportSld, type SldExportResult } from '@desktop-webgis/ogc-io/sld-export'
import { encodeSldPackage } from '@desktop-webgis/ogc-io/sld-package'
import { verifyStyleAssets } from '@desktop-webgis/ol-style/style-assets'
import { useProjectStore } from '@/stores/project.store'
import { pickSaveFile, writeBinaryFile, writeTextFile } from '@/services/files'

export function SldExportDialog({ layerId, onClose }: { layerId: string; onClose: () => void }) {
  const project = useProjectStore(state => state.project)
  const layer = project.layers.find(layer => layer.id === layerId)
  const [target, setTarget] = useState(layer?.name ?? 'style'), [crs, setCrs] = useState(project.crs)
  const [geometryField, setGeometryField] = useState(''), [preview, setPreview] = useState(false), [zoom, setZoom] = useState(10)
  const [fieldTypesJson, setFieldTypesJson] = useState('{}')
  const [accepted, setAccepted] = useState(false), [error, setError] = useState<string>(), [status, setStatus] = useState<string>(), [busy, setBusy] = useState(false)
  let result: SldExportResult | undefined, validationError: string | undefined
  try {
    const fragment = getLayerCartography(project, layerId)
    if (!fragment) throw new Error('当前图层不支持标准矢量样式输出')
    const fieldTypes: unknown = JSON.parse(fieldTypesJson)
    if (!fieldTypes || typeof fieldTypes !== 'object' || Array.isArray(fieldTypes) || Object.values(fieldTypes).some(value => !['number', 'string', 'boolean'].includes(String(value)))) throw new Error('目标字段类型须为字段名到 string/number/boolean 的 JSON 对象')
    result = exportSld(fragment.styleLayers, { targetLayerName: target, crs, geometryField: geometryField || undefined, fieldTypes: fieldTypes as Record<string, 'number' | 'string' | 'boolean'>, assets: project.cartography?.assets, strict: true, ...(preview ? { previewZoom: zoom } : {}) })
  } catch (error) { validationError = error instanceof Error ? error.message : String(error) }
  const contentKey = JSON.stringify({ layerId, fragment: getLayerCartography(project, layerId), assets: project.cartography?.assets, target, crs, geometryField, fieldTypesJson, preview, zoom })
  useEffect(() => { setAccepted(false); setStatus(undefined) }, [contentKey])

  async function save() {
    if (!result?.publishable || !result.sldXml || result.level === 'approximated' && !accepted) return
    const exported = result
    setBusy(true); setError(undefined)
    try {
      await verifyStyleAssets(project.cartography?.assets ?? [])
      const bytes = await encodeSldPackage(exported)
      const name = `${target.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'style'}.sld.zip`
      if (isTauri()) {
        const path = await pickSaveFile({ title: '导出 SLD 资源包', defaultPath: name, filters: [{ name: 'SLD 资源包', extensions: ['zip'] }] })
        if (!path) return
        await writeBinaryFile(path, bytes)
      } else {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }))
        const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link)
        try { link.click() } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000) }
      }
      setStatus('已导出 SLD、资源和兼容性清单')
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  async function saveXml() {
    if (!result?.sldXml || result.assets.length) return
    const content = result.sldXml
    if (!isTauri()) {
      const url = URL.createObjectURL(new Blob([content], { type: 'application/vnd.ogc.sld+xml' })), link = document.createElement('a')
      link.href = url; link.download = 'style.sld'; document.body.append(link)
      try { link.click() } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000) }
    } else {
      const path = await pickSaveFile({ title: '保存 SLD XML', defaultPath: 'style.sld', filters: [{ name: 'SLD', extensions: ['sld'] }] })
      if (path) await writeTextFile(path, content)
    }
  }
  const enabled = Boolean(result?.publishable && (result.level !== 'approximated' || accepted))
  return <Modal open title="导出 SLD" width={850} onCancel={onClose} footer={<Space><Button onClick={onClose}>关闭</Button><Button disabled={!enabled || busy || Boolean(result?.assets.length)} onClick={() => void saveXml().catch(error => setError(String(error)))}>仅导出 XML</Button><Button type="primary" disabled={!enabled || busy} loading={busy} onClick={() => void save()}>导出资源包</Button></Space>}>
    <Space wrap><label>样式名称<Input aria-label="SLD样式名称" value={target} onChange={event => setTarget(event.target.value)} /></label><label>目标 CRS<Input aria-label="SLD目标CRS" value={crs} onChange={event => setCrs(event.target.value)} /></label><label>目标几何字段<Input aria-label="SLD几何字段" placeholder="例如 the_geom，需核对服务端字段" value={geometryField} onChange={event => setGeometryField(event.target.value)} /></label></Space>
    <Space style={{ marginBlock: 12 }}><Switch checked={preview} onChange={setPreview} aria-label="按固定Zoom降级" /><span>按固定 Zoom 降级</span><InputNumber aria-label="SLD预览Zoom" disabled={!preview} min={0} max={24} value={zoom} onChange={value => { if (value !== null) setZoom(value) }} /></Space>
    <label>目标字段类型（分类/分级类型保护需要；发布向导会从服务器读取）<Input.TextArea aria-label="SLD目标字段类型" value={fieldTypesJson} onChange={event => setFieldTypesJson(event.target.value)} placeholder={'{"kind":"string","value":"number"}'} rows={2} /></label>
    {(validationError || error) && <Alert type="error" showIcon title={validationError ?? error} />}
    {status && <Alert type="success" title={status} />}
    <Table rowKey={(_issue, index) => String(index)} size="small" pagination={false} dataSource={result?.issues ?? []} columns={[{ title: '位置', dataIndex: 'path' }, { title: '兼容性', dataIndex: 'level' }, { title: '说明', dataIndex: 'reason' }, { title: '建议', dataIndex: 'proposedFallback' }]} />
    {result?.level === 'approximated' && <Checkbox checked={accepted} onChange={event => setAccepted(event.target.checked)}>已检查并接受上述近似结果</Checkbox>}
    <Alert type="info" title="SLD 是单向输出；不支持项会阻止导出。图案和图标随资源包输出，数据发布需单独完成。" />
  </Modal>
}
