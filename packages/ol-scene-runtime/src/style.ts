import type { SceneLayerStyle } from '@desktop-webgis/scene-schema'
import { compileStyle, type LayerStyle } from '@desktop-webgis/ol-style'
import type { StyleFunction } from 'ol/style/Style.js'

/**
 * SceneLayerStyle is structurally aligned with ol-style LayerStyle.
 * Keep this cast local so protocol packages never import OpenLayers.
 */
export function toOlLayerStyle(style: SceneLayerStyle): LayerStyle {
  return style as unknown as LayerStyle
}

/** Compile a Scene layer style through the shared Desktop/Viewer ol-style path. */
export function createOlStyleFunction(style: SceneLayerStyle): StyleFunction {
  return compileStyle(toOlLayerStyle(style))
}