import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Button, Select, Switch } from 'antd'
import { defaultRenderQuality, isRenderQuality } from '@desktop-webgis/cesium-scene-runtime'
import type { RenderQuality } from '@desktop-webgis/cesium-scene-runtime'
import { ScenePropertyGroup } from './ScenePropertyGroup'

interface RenderPreferences { quality: RenderQuality; setQuality(quality: RenderQuality): void }
const presets: Record<string, RenderQuality> = {
  performance: { resolutionScale: .75, nativeResolution: false, msaaSamples: 1, fxaa: true },
  balanced: { ...defaultRenderQuality },
  sharp: { resolutionScale: 1.5, nativeResolution: true, msaaSamples: 4, fxaa: false }
}

/** Device preferences stay outside project serialization and undo history. */
export const useSceneRenderPreferences = create<RenderPreferences>()(persist(set => ({
  quality: { ...defaultRenderQuality },
  setQuality: quality => set({ quality })
}), {
  name: 'desktop-webgis.city-render-quality',
  merge: (stored, current) => {
    const quality = stored && typeof stored === 'object' && 'quality' in stored ? stored.quality : undefined
    return { ...current, quality: isRenderQuality(quality) ? quality : { ...defaultRenderQuality } }
  }
}))

export function SceneRenderSettings() {
  const { quality, setQuality } = useSceneRenderPreferences()
  const preset = Object.keys(presets).find(key => Object.entries(presets[key]).every(([field, value]) => quality[field as keyof RenderQuality] === value)) ?? ''
  const scales = [...new Set([.5,.75,1,1.25,1.5,2,quality.resolutionScale])].sort((a,b) => a-b)
  function patch(value: Partial<RenderQuality>): void { setQuality({ ...quality, ...value }) }
  return <ScenePropertyGroup title="画质与性能" hint="修改立即生效并记住在本机，不改变项目或撤销记录。高分辨率增加绘制与显存开销；模型细节由瓦片精度决定，底图清晰度取决于影像源。">
    <label className="editor-field">画质预设<Select aria-label="画质预设" value={preset} options={[{ value: '', label: '自定义' }, { value: 'performance', label: '流畅' }, { value: 'balanced', label: '均衡' }, { value: 'sharp', label: '清晰' }]} onChange={value => { if (presets[value]) setQuality(presets[value]) }} /></label>
    <label className="editor-field">分辨率比例<Select aria-label="分辨率比例" value={quality.resolutionScale} options={scales.map(value => ({ value, label: `${value}×` }))} onChange={resolutionScale => patch({ resolutionScale })} /></label>
    <label className="scene3d-check">原生像素<Switch aria-label="使用屏幕原生像素（高 DPI）" checked={quality.nativeResolution} onChange={nativeResolution => patch({ nativeResolution })} /></label>
    <ScenePropertyGroup title="抗锯齿" open={false} hint="MSAA 受显卡和 WebGL 能力限制；FXAA 会稍微软化边缘。关闭 FXAA 可避免画面过度柔化。">
      <label className="editor-field">MSAA<Select aria-label="多重采样抗锯齿（MSAA）" value={quality.msaaSamples} options={[1,2,4,8].map(value => ({ value, label: value === 1 ? '关闭' : `${value}×` }))} onChange={msaaSamples => patch({ msaaSamples: msaaSamples as RenderQuality['msaaSamples'] })} /></label>
      <label className="scene3d-check">FXAA<Switch aria-label="快速抗锯齿（FXAA）" checked={quality.fxaa} onChange={fxaa => patch({ fxaa })} /></label>
    </ScenePropertyGroup>
    <Button type="link" onClick={() => setQuality({ ...defaultRenderQuality })}>恢复均衡画质</Button>
  </ScenePropertyGroup>
}
