import { Button, InputNumber, Select, Switch } from 'antd'
import type { GeoPosition, TilesetNode } from '@desktop-webgis/cesium-scene-schema'

/** Draft-only controls; applying the parent window owns the single history entry. */
export function TilesetEffectsDraft({ node, onChange }: { node: TilesetNode; onChange(effects: NonNullable<TilesetNode['effects']>): void }) {
  const effects = node.effects ?? []
  function patch(id: string, value: Record<string, unknown>): void { onChange(effects.map(effect => effect.id === id ? { ...effect, ...value } : effect)) }
  return <div className="scene-property-window__json">
    {!effects.length && <p>尚未添加范围。先在检查器中绘制裁剪或压平范围，再在此编辑专业参数。</p>}
    {effects.map((effect, index) => <section key={effect.id} className="scene3d-property-section">
      <h3>{effect.kind === 'clip-polygon' ? '多边形裁剪' : '局部压平'} · 范围 {index + 1}</h3>
      <label className="scene-property-window__field"><span>启用<small>enabled</small></span><Switch aria-label={`启用效果 ${index + 1}`} checked={effect.enabled} onChange={enabled => patch(effect.id, { enabled })} /></label>
      {effect.kind === 'clip-polygon' ? <label className="scene-property-window__field"><span>保留区域<small>mode</small></span><Select aria-label={`裁剪模式 ${index + 1}`} value={effect.mode} options={[{ value: 'keep-inside', label: '范围内部' }, { value: 'keep-outside', label: '范围外部' }]} onChange={mode => onChange(effects.map(item => item.kind === 'clip-polygon' ? { ...item, mode } : item))} /></label>
        : <label className="scene-property-window__field"><span>目标椭球高程（m）<small>height</small></span><InputNumber aria-label={`压平目标高程 ${index + 1}`} value={effect.height} onChange={height => { if (height !== null && Number.isFinite(height)) patch(effect.id, { height }) }} /></label>}
      <details className="property-effect-vertices"><summary>{effect.positions.length} 个控制点 · 经度 / 纬度 / 椭球高程</summary>
      {effect.positions.map((position, vertex) => <div className="scene-property-window__attribute" key={vertex}>
        {position.map((value, axis) => <InputNumber key={axis} aria-label={`范围 ${index + 1} 顶点 ${vertex + 1} ${['经度', '纬度', '高度'][axis]}`} value={value} min={axis === 0 ? -180 : axis === 1 ? -90 : undefined} max={axis === 0 ? 180 : axis === 1 ? 90 : undefined} onChange={value => {
          if (value === null || !Number.isFinite(value)) return
          const positions = effect.positions.map(item => [...item] as GeoPosition); positions[vertex][axis] = value; patch(effect.id, { positions })
        }} />)}
      </div>)}
      </details>
      <Button danger type="text" onClick={() => onChange(effects.filter(item => item.id !== effect.id))}>删除范围 {index + 1}</Button>
    </section>)}
    {!!effects.length && <p>局部压平使用 WGS84 椭球高程；范围最大跨度 5 km。应用时更新实际 Tileset，取消不会改动已应用效果。</p>}
  </div>
}
