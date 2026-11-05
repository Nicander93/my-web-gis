import { useEffect, useRef, useState } from 'react'
import { createCartographyPreview } from '@desktop-webgis/ol-style/cartography'
import type { SymbolPreset } from '@desktop-webgis/ol-style/symbol-library'

export function SymbolPreview({ preset }: { preset: SymbolPreset }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false, dispose: (() => void) | undefined
    setError(undefined)
    if (canvas.current) void createCartographyPreview(canvas.current, { layers: preset.layers, assets: preset.assets, geometry: preset.category }).then(cleanup => {
      if (cancelled) cleanup(); else dispose = cleanup
    }).catch(error => { if (!cancelled) setError(String(error)) })
    return () => { cancelled = true; dispose?.() }
  }, [preset])
  return <span title={error}><canvas ref={canvas} width={96} height={40} role="img" aria-label={`${preset.name}符号预览`} />{error && <span>预览不可用</span>}</span>
}
