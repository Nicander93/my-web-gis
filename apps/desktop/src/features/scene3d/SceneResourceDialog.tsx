import { useEffect, useRef, useState } from 'react'
import { Alert, Form, Input, Radio } from 'antd'
import { Box, Building2, Layers2 } from 'lucide-react'
import { isSceneResourceUrl, type ResourceReference } from '@desktop-webgis/cesium-scene-schema'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { Button } from '@/components/ui/Button'

export type SceneResourceType = '3dtiles' | 'model' | 'geojson'
interface SceneResourceDialogProps {
  onClose(): void
  onAdd(type: SceneResourceType, source: string | ResourceReference, name: string): void
  onChooseLocal?: (type: SceneResourceType) => Promise<string | null>
}
const resources = [
  { type: '3dtiles', label: '3D Tiles', icon: Building2, hint: '倾斜摄影、点云及其他分层三维数据', placeholder: 'https://example.com/tiles/tileset.json' },
  { type: 'model', label: 'GLB 模型', icon: Box, hint: '支持 GLB/GLTF；外部几何与纹理从所选目录加载', placeholder: 'https://example.com/models/model.glb' },
  { type: 'geojson', label: 'GeoJSON', icon: Layers2, hint: '地理要素及其属性数据', placeholder: 'https://example.com/data/area.geojson' }
] as const

export function SceneResourceDialog({ onClose, onAdd, onChooseLocal }: SceneResourceDialogProps) {
  const [type, setType] = useState<SceneResourceType>('3dtiles')
  const [mode, setMode] = useState<'url' | 'local'>('url')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const selected = resources.find(item => item.type === type) ?? resources[0]

  async function chooseLocal(): Promise<void> {
    if (!onChooseLocal || busy) return
    setBusy(true); setError('')
    try {
      const selectedPath = await onChooseLocal(type)
      if (alive.current && selectedPath) setPath(selectedPath)
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '无法选择本地资源')
    } finally { if (alive.current) setBusy(false) }
  }
  function submit(): void {
    if (busy) return
    setError('')
    if (mode === 'local' && !path) { setError('请选择本地资源文件'); return }
    if (mode === 'url' && !isSceneResourceUrl(url.trim())) { setError('请输入 HTTP(S) 资源地址或已有项目的相对 URL'); return }
    try {
      onAdd(type, mode === 'local' ? { kind: 'absolute', path } : url.trim(), name.trim() || selected.label)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法添加资源，请检查地址') }
  }

  return <EditorDialog title="添加三维资源" onClose={onClose} busy={busy} className="scene-resource-dialog">
    <Form layout="vertical" disabled={busy} onFinish={submit}>
      <div className="dialog-body">
        <Form.Item label="资源类型">
          <Radio.Group className="resource-types" name="resource-type" value={type} onChange={event => { setType(event.target.value); setPath(''); setError('') }}>
            {resources.map(item => <Radio key={item.type} value={item.type} className={type === item.type ? 'resource-type resource-type--selected' : 'resource-type'}><item.icon size={17} aria-hidden="true" />{item.label}</Radio>)}
          </Radio.Group>
        </Form.Item>
        <p className="dialog-description">{selected.hint}</p>
        <Form.Item label="资源来源"><Radio.Group value={mode} onChange={event => { setMode(event.target.value); setError('') }}><Radio value="url">在线地址</Radio><Radio value="local" disabled={!onChooseLocal}>本地文件</Radio></Radio.Group></Form.Item>
        {mode === 'url' ? <Form.Item label="资源地址" htmlFor="scene-resource-url">
          <Input id="scene-resource-url" name="resource-url" autoComplete="off" spellCheck={false} value={url} onChange={event => { setUrl(event.target.value); setError('') }} placeholder={selected.placeholder} />
        </Form.Item> : <Form.Item label="本地文件" htmlFor="scene-resource-path">
          <div className="scene-resource-dialog__file"><Input id="scene-resource-path" readOnly value={path} placeholder="选择资源主文件" /><Button loading={busy} onClick={() => void chooseLocal()}>选择文件</Button></div>
          <p className="editor-help">仅授权所选文件所在目录。项目内保存为相对引用，目录外保留外部路径；资源文件不内嵌。</p>
        </Form.Item>}
        <Form.Item label="对象名称" htmlFor="scene-resource-name"><Input id="scene-resource-name" name="resource-name" autoComplete="off" value={name} onChange={event => setName(event.target.value)} placeholder="例如：地形模型" /></Form.Item>
        <p className="editor-help">3D Tiles 和 GeoJSON 保留原有地理坐标；模型放置在当前视图中心，可继续调整。</p>
        {!onChooseLocal && <p className="editor-help">本地目录资源请在桌面应用中添加。</p>}
        {error && <Alert type="error" title={error} />}
      </div>
      <footer className="dialog-footer"><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={busy}>添加到场景</Button></footer>
    </Form>
  </EditorDialog>
}
