import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { EditState } from '@desktop-webgis/cesium-scene-runtime'
import type { GeoPosition } from '@desktop-webgis/cesium-scene-schema'

interface Props {
  state: EditState
  onSelect(index: number): void
  onPosition(index: number, position: GeoPosition): void
  onInsert(index: number): void
  onRemove(index: number): void
}

export function GraphicVertexInspector({ state, onSelect, onPosition, onInsert, onRemove }: Props) {
  const { geometry, selectedIndex } = state
  const position = geometry.positions[selectedIndex]
  const minimum = geometry.type === 'point' ? 1 : geometry.type === 'polyline' ? 2 : 3
  const canInsert = geometry.type !== 'point' && (geometry.type === 'polygon' || selectedIndex < geometry.positions.length - 1)
  return <div className="city-properties">
    <section className="city-property-section"><h3>编辑几何</h3><p className="editor-help">拖动实心顶点调整位置，点击白色中点插入顶点。完成后统一应用。</p>
      <label className="editor-field">当前顶点<select aria-label="当前顶点" value={selectedIndex} onChange={event => onSelect(Number(event.target.value))}>{geometry.positions.map((_, index) => <option key={index} value={index}>顶点 {index + 1}</option>)}</select></label>
      <VertexPosition key={`${selectedIndex}:${JSON.stringify(position)}`} position={position} ground={geometry.heightMode === 'ground'} onApply={value => onPosition(selectedIndex, value)} />
      <div className="city-form-actions"><button className="button-secondary" disabled={!canInsert} onClick={() => onInsert(selectedIndex)}><Plus size={14} aria-hidden="true" />后方插入</button><button className="city-danger-action" disabled={geometry.positions.length <= minimum} onClick={() => onRemove(selectedIndex)}><Trash2 size={14} aria-hidden="true" />删除顶点</button></div>
      <p className="editor-help">{geometry.positions.length} 个顶点{geometry.type !== 'point' ? ` · 至少保留 ${minimum} 个` : ''} · WGS84</p>
    </section>
    <section className="city-property-section"><h3>操作提示</h3><p className="editor-help">Enter 应用全部修改 · Esc 取消恢复<br />Delete 删除当前顶点。切换对象或撤销会取消尚未应用的几何修改。</p></section>
  </div>
}

function VertexPosition({ position, ground, onApply }: { position: GeoPosition; ground: boolean; onApply(value: GeoPosition): void }) {
  const [draft, setDraft] = useState(position.map(String))
  const changed = JSON.stringify(draft) !== JSON.stringify(position.map(String))
  return <form onSubmit={event => { event.preventDefault(); onApply(draft.map(Number) as GeoPosition) }}>
    {['经度（度）', '纬度（度）', '椭球高度（米）'].map((label, index) => <label className="editor-field" key={label}>{label}<input aria-label={`顶点${label}`} type="number" required step="any" disabled={ground && index === 2} min={index === 0 ? -180 : index === 1 ? -90 : undefined} max={index === 0 ? 180 : index === 1 ? 90 : undefined} value={draft[index]} onChange={event => setDraft(draft.map((value, i) => i === index ? event.target.value : value))} /></label>)}
    {ground && <p className="editor-help">贴地图形的显示高度跟随地表。</p>}
    <button type="submit" className="button-secondary" disabled={!changed}>预览坐标</button>
  </form>
}
