import type { LabelStyle, SceneStyle } from '@desktop-webgis/scene-schema'
import type { FeatureLike } from 'ol/Feature.js'
import type View from 'ol/View.js'
import CircleStyle from 'ol/style/Circle.js'
import Fill from 'ol/style/Fill.js'
import Stroke from 'ol/style/Stroke.js'
import Style from 'ol/style/Style.js'
import Text from 'ol/style/Text.js'
import type { StyleFunction } from 'ol/style/Style.js'

function createBaseStyle(style: SceneStyle): Style {
  if (style.type === 'point') {
    return new Style({
      image: new CircleStyle({
        radius: style.radius,
        fill: new Fill({ color: style.fill }),
        stroke: style.stroke
          ? new Stroke({ color: style.stroke, width: style.strokeWidth ?? 1 })
          : undefined
      })
    })
  }

  if (style.type === 'line') {
    return new Style({
      stroke: new Stroke({ color: style.color, width: style.width, lineDash: style.lineDash })
    })
  }

  return new Style({
    fill: new Fill({ color: style.fill }),
    stroke: new Stroke({ color: style.stroke, width: style.strokeWidth, lineDash: style.lineDash })
  })
}

function isLabelVisible(label: LabelStyle, view: View, resolution: number): boolean {
  const zoom = view.getZoomForResolution(resolution)
  if (zoom === undefined) return true
  if (label.minZoom !== undefined && zoom < label.minZoom) return false
  if (label.maxZoom !== undefined && zoom > label.maxZoom) return false
  return true
}

function createText(label: LabelStyle, feature: FeatureLike): Text | undefined {
  const rawValue = feature.get(label.field)
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined

  return new Text({
    text: String(rawValue),
    font: label.font ?? '12px sans-serif',
    fill: new Fill({ color: label.color ?? '#0f172a' }),
    stroke:
      label.haloColor || label.haloWidth
        ? new Stroke({ color: label.haloColor ?? '#ffffff', width: label.haloWidth ?? 3 })
        : undefined,
    offsetX: label.offset?.[0] ?? 0,
    offsetY: label.offset?.[1] ?? 0
  })
}

/** Compiles a declarative style and optional property label to an OpenLayers style function. */
export function createOlStyleFunction(style: SceneStyle, label: LabelStyle | undefined, view: View): StyleFunction {
  const baseStyle = createBaseStyle(style)
  if (!label) return () => baseStyle

  return (feature, resolution) => {
    if (!isLabelVisible(label, view, resolution)) return baseStyle
    const text = createText(label, feature)
    if (!text) return baseStyle
    const rendered = baseStyle.clone()
    rendered.setText(text)
    return rendered
  }
}
