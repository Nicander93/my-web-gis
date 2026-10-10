import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultRenderQuality, isRenderQuality } from '@desktop-webgis/cesium-scene-runtime'
import type { RenderQuality } from '@desktop-webgis/cesium-scene-runtime'
import { CityPropertyGroup } from './CityPropertyGroup'

interface RenderPreferences { quality: RenderQuality; setQuality(quality: RenderQuality): void }
const presets: Record<string, RenderQuality> = {
  performance: { resolutionScale: .75, nativeResolution: false, msaaSamples: 1, fxaa: true },
  balanced: { ...defaultRenderQuality },
  sharp: { resolutionScale: 1.5, nativeResolution: true, msaaSamples: 4, fxaa: false }
}

/** Device preferences stay outside project serialization and undo history. */
export const useCityRenderPreferences = create<RenderPreferences>()(persist(set => ({
  quality: { ...defaultRenderQuality },
  setQuality: quality => set({ quality })
}), {
  name: 'desktop-webgis.city-render-quality',
  merge: (stored, current) => {
    const quality = stored && typeof stored === 'object' && 'quality' in stored ? stored.quality : undefined
    return { ...current, quality: isRenderQuality(quality) ? quality : { ...defaultRenderQuality } }
  }
}))

export function CityRenderSettings() {
  const { quality, setQuality } = useCityRenderPreferences()
  const preset = Object.keys(presets).find(key => Object.entries(presets[key]).every(([field, value]) => quality[field as keyof RenderQuality] === value)) ?? ''
  const scales = [...new Set([.5,.75,1,1.25,1.5,2,quality.resolutionScale])].sort((a,b) => a-b)
  function patch(value: Partial<RenderQuality>): void { setQuality({ ...quality, ...value }) }
  return <CityPropertyGroup title="画质与性能" hint="修改立即生效并记住在本机，不改变项目或撤销记录。高分辨率增加绘制与显存开销；模型细节由瓦片精度决定，底图清晰度取决于影像源。">
    <label className="editor-field">画质预设<select value={preset} onChange={event => {
      if (presets[event.target.value]) setQuality(presets[event.target.value])
    }}><option value="">自定义</option><option value="performance">流畅</option><option value="balanced">均衡</option><option value="sharp">清晰</option></select></label>
    <label className="editor-field">分辨率比例<select value={quality.resolutionScale} onChange={event => patch({ resolutionScale: Number(event.target.value) })}>{scales.map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
    <label className="city-check">原生像素<input aria-label="使用屏幕原生像素（高 DPI）" type="checkbox" checked={quality.nativeResolution} onChange={event => patch({ nativeResolution: event.target.checked })} /></label>
    <CityPropertyGroup title="抗锯齿" open={false} hint="MSAA 受显卡和 WebGL 能力限制；FXAA 会稍微软化边缘。关闭 FXAA 可避免画面过度柔化。">
      <label className="editor-field">MSAA<select aria-label="多重采样抗锯齿（MSAA）" value={quality.msaaSamples} onChange={event => patch({ msaaSamples: Number(event.target.value) as RenderQuality['msaaSamples'] })}>{[1,2,4,8].map(value => <option key={value} value={value}>{value === 1 ? '关闭' : `${value}×`}</option>)}</select></label>
      <label className="city-check">FXAA<input aria-label="快速抗锯齿（FXAA）" type="checkbox" checked={quality.fxaa} onChange={event => patch({ fxaa: event.target.checked })} /></label>
    </CityPropertyGroup>
    <button type="button" className="city-text-action" onClick={() => setQuality({ ...defaultRenderQuality })}>恢复均衡画质</button>
  </CityPropertyGroup>
}
