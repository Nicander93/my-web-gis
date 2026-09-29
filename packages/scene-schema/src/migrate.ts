import type { SceneColor } from './types.js'
import { requireCssColor } from './colors.js'
import type {
  LabelStyle,
  SceneLabelConfig,
  SceneLayerStyle,
  SceneManifest,
  SceneManifestInput,
  SceneManifestV1,
  SceneManifestV2,
  SceneStyle,
  SceneSymbol,
  VectorLayer,
  VectorLayerV1
} from './types.js'
import { SCENE_MANIFEST_VERSION } from './types.js'

function migrateLabel(label: LabelStyle | undefined, path: string): SceneLabelConfig | undefined {
  if (!label) return undefined

  const config: SceneLabelConfig = { field: label.field }

  if (label.color !== undefined) {
    config.color = requireCssColor(label.color, `${path}.color`)
  }
  if (label.haloColor !== undefined) {
    config.strokeColor = requireCssColor(label.haloColor, `${path}.haloColor`)
  }
  if (label.haloWidth !== undefined) config.strokeWidth = label.haloWidth
  if (label.minZoom !== undefined) config.minZoom = label.minZoom
  if (label.maxZoom !== undefined) config.maxZoom = label.maxZoom
  if (label.offset) {
    config.offsetX = label.offset[0]
    config.offsetY = label.offset[1]
  }
  if (label.font) {
    const match = /(\d+(?:\.\d+)?)\s*px/.exec(label.font)
    if (match) config.fontSize = Number(match[1])
  }

  return config
}

function migrateV1Style(style: SceneStyle, label: LabelStyle | undefined, path: string): SceneLayerStyle {
  const labelConfig = migrateLabel(label, `${path}.label`)

  let symbol: SceneSymbol
  if (style.type === 'point') {
    symbol = {
      type: 'circle',
      radius: style.radius,
      fill: requireCssColor(style.fill, `${path}.style.fill`),
      ...(style.stroke !== undefined
        ? { stroke: requireCssColor(style.stroke, `${path}.style.stroke`) }
        : {}),
      ...(style.strokeWidth !== undefined ? { strokeWidth: style.strokeWidth } : {})
    }
  } else if (style.type === 'line') {
    symbol = {
      type: 'solid',
      color: requireCssColor(style.color, `${path}.style.color`),
      width: style.width,
      ...(style.lineDash !== undefined ? { lineDash: style.lineDash } : {})
    }
  } else {
    symbol = {
      type: 'solid',
      fill: requireCssColor(style.fill, `${path}.style.fill`),
      stroke: requireCssColor(style.stroke, `${path}.style.stroke`),
      strokeWidth: style.strokeWidth,
      ...(style.lineDash !== undefined ? { lineDash: style.lineDash } : {})
    }
  }

  return {
    mode: 'single',
    symbol,
    ...(labelConfig ? { label: labelConfig } : {})
  }
}

function isV1VectorLayer(layer: SceneManifestV1['layers'][number]): layer is VectorLayerV1 {
  return layer.type === 'vector'
}

function migrateV1Layer(layer: SceneManifestV1['layers'][number], index: number): SceneManifest['layers'][number] {
  if (!isV1VectorLayer(layer)) return structuredClone(layer)

  const { label, style, ...rest } = layer
  const migrated: VectorLayer = {
    ...structuredClone(rest),
    type: 'vector',
    style: migrateV1Style(style, label, `$.layers[${index}]`)
  }
  return migrated
}

/** Upgrade a validated v1 document into the canonical v2 write form. */
export function migrateSceneManifestV1(scene: SceneManifestV1): SceneManifestV2 {
  const next: SceneManifestV2 = {
    ...structuredClone(scene),
    version: SCENE_MANIFEST_VERSION,
    layers: scene.layers.map((layer, index) => migrateV1Layer(layer, index))
  }
  return next
}

/** Accept v1 or v2; always return canonical v2. */
export function upgradeSceneManifest(input: SceneManifestInput): SceneManifest {
  if (input.version === 1) return migrateSceneManifestV1(input)
  return structuredClone(input)
}

export type { SceneColor }