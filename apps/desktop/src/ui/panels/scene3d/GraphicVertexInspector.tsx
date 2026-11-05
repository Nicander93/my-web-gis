import { useState } from 'react'
import { Button, InputNumber, Select } from 'antd'
import type { EditState } from '@desktop-webgis/cesium-scene-runtime'
import { graphicMinimum, isParametricGraphic, type GeoPosition } from '@desktop-webgis/cesium-scene-schema'
import { SceneInfo } from './ScenePropertyGroup'

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
  const minimum = graphicMinimum(geometry.type), fixed = isParametricGraphic(geometry.type)
  const canInsert = geometry.type === 'polygon' || geometry.type === 'polyline' && selectedIndex < geometry.positions.length - 1
  return <div className="scene3d-properties">
    <section className="scene3d-property-section"><h3>编辑几何<SceneInfo label="顶点编辑">{fixed ? '拖动两个实心控制点调整范围。Enter 应用，Esc 取消；固定图形不增删控制点。' : '拖动实心顶点调整位置，点击白色中点插入。Enter 应用，Esc 取消，Delete 删除当前顶点。'}</SceneInfo></h3>
      {fixed && <p className="editor-help">两个对角点限定经纬方向的范围；高度由第一个控制点统一设置，不插入或删除控制点。</p>}
      <label className="editor-field">当前顶点<Select aria-label="当前顶点" value={selectedIndex} onChange={onSelect} options={geometry.positions.map((_,index) => ({ value: index, label: `${fixed ? '对角点' : '顶点'} ${index + 1}` }))} /></label>
      <VertexPosition key={`${selectedIndex}:${JSON.stringify(position)}`} position={position} ground={geometry.heightMode === 'ground'} heightLocked={fixed && selectedIndex !== 0} onApply={value => onPosition(selectedIndex, value)} />
      <div className="scene3d-form-actions"><Button disabled={!canInsert} onClick={() => onInsert(selectedIndex)}>后方插入</Button><Button danger disabled={geometry.positions.length <= minimum} onClick={() => onRemove(selectedIndex)}>删除顶点</Button></div>
      <p className="editor-help">{geometry.positions.length} 个顶点{geometry.type !== 'point' ? ` · 至少保留 ${minimum} 个` : ''} · WGS84</p>
    </section>
  </div>
}

function VertexPosition({ position, ground, heightLocked, onApply }: { position: GeoPosition; ground: boolean; heightLocked: boolean; onApply(value: GeoPosition): void }) {
  const [draft, setDraft] = useState<Array<number | null>>([...position])
  const changed = JSON.stringify(draft) !== JSON.stringify(position)
  const valid = draft.every(value => value !== null && Number.isFinite(value))
  return <form onSubmit={event => { event.preventDefault(); if (valid) onApply(draft as GeoPosition) }}>
    {['经度（度）', '纬度（度）', '椭球高度（米）'].map((label, index) => <label className="editor-field" key={label}>{label}<InputNumber aria-label={`顶点${label}`} step={index === 2 ? .1 : .0001} disabled={(ground || heightLocked) && index === 2} min={index === 0 ? -180 : index === 1 ? -90 : undefined} max={index === 0 ? 180 : index === 1 ? 90 : undefined} value={draft[index]} onChange={value => setDraft(draft.map((item,i) => i === index ? value : item))} /></label>)}
    {ground && <SceneInfo label="贴地高度">贴地图形的显示高度跟随地表。</SceneInfo>}
    <Button htmlType="submit" disabled={!changed || !valid}>预览坐标</Button>
  </form>
}
