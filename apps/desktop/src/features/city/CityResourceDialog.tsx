import { useState } from 'react'
import { Box, Building2, Layers2 } from 'lucide-react'
import { isCityResourceUrl } from '@desktop-webgis/cesium-scene-schema'
import { EditorDialog } from '@/components/ui/EditorDialog'

export type CityResourceType = '3dtiles' | 'model' | 'geojson'
interface CityResourceDialogProps {
  onClose(): void
  onAdd(type: CityResourceType, url: string, name: string): void
}
const resources = [
  { type: '3dtiles', label: '3D Tiles', icon: Building2, hint: '城市模型、倾斜摄影和建筑数据', placeholder: 'https://example.com/city/tileset.json' },
  { type: 'model', label: 'GLB 模型', icon: Box, hint: '添加独立模型，在场景中放置和调整', placeholder: 'https://example.com/models/building.glb' },
  { type: 'geojson', label: 'GeoJSON', icon: Layers2, hint: '地理要素及其属性数据', placeholder: 'https://example.com/data/area.geojson' }
] as const

export function CityResourceDialog({ onClose, onAdd }: CityResourceDialogProps) {
  const [type, setType] = useState<CityResourceType>('3dtiles')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const selected = resources.find(item => item.type === type) ?? resources[0]
  return <EditorDialog title="添加三维资源" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); setError(''); if (!isCityResourceUrl(url.trim())) { setError('请输入 HTTP(S) 资源地址或项目相对路径，例如 ./models/tileset.json。'); return }; try { onAdd(type, url.trim(), name.trim() || selected.label); onClose() } catch (reason) { setError(reason instanceof Error ? reason.message : '无法添加资源，请检查地址。') } }}>
      <div className="dialog-body">
        <fieldset className="resource-types"><legend>资源类型</legend>{resources.map(item => <label key={item.type} className={type === item.type ? 'resource-type resource-type--selected' : 'resource-type'}><input type="radio" name="resource-type" checked={type === item.type} onChange={() => { setType(item.type); setError('') }} /><item.icon size={20} aria-hidden="true" />{item.label}</label>)}</fieldset>
        <p className="dialog-description">{selected.hint}</p>
        <label className="editor-field">资源地址<input name="resource-url" autoComplete="off" spellCheck={false} value={url} onChange={event => { setUrl(event.target.value); setError('') }} placeholder={selected.placeholder} required /></label>
        <label className="editor-field">对象名称<input name="resource-name" autoComplete="off" value={name} onChange={event => setName(event.target.value)} placeholder="例如：中心城区" /></label>
        <p className="editor-help">3D Tiles 和 GeoJSON 保留原有地理坐标；GLB 放置在当前视图中心，可继续拖动调整。</p>
        {error && <p className="editor-error" role="alert">{error}</p>}
      </div>
      <footer className="dialog-footer"><button className="button-secondary" type="button" onClick={onClose}>取消</button><button className="button-primary" type="submit">添加到场景</button></footer>
    </form>
  </EditorDialog>
}
