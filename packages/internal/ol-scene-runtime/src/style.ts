import type { SceneLayerStyle } from '@desktop-webgis/scene-schema'
import { compileStyle, type LayerStyle } from '@desktop-webgis/ol-style'
import type { StyleFunction } from 'ol/style/Style.js'

/**
 * SceneLayerStyle 在结构上与 ol-style 的 LayerStyle 对齐。
 * 把类型断言限制在本地，避免协议类包引入 OpenLayers。
 */
export function toOlLayerStyle(style: SceneLayerStyle): LayerStyle {
  return style as unknown as LayerStyle
}

/** 通过 Desktop 和 Viewer 共用的 ol-style 路径编译场景图层样式。 */
export function createOlStyleFunction(style: SceneLayerStyle): StyleFunction {
  return compileStyle(toOlLayerStyle(style))
}