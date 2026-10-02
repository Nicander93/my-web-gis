import type {
  PopupDefinition,
  SceneLayer,
  SceneManifest,
  SceneSource,
  SceneStyle,
  SceneView,
  ValidationIssue,
  ValidationResult
} from './types.js'
import { SCENE_MANIFEST_VERSION, SCENE_MANIFEST_VERSION_V1 } from './types.js'
import { validateCityScene } from '@desktop-webgis/cesium-scene-schema'

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = new Set([
  '$schema',
  'version',
  'id',
  'title',
  'description',
  'view',
  'credentials',
  'sources',
  'layers',
  'widgets',
  'theme',
  'presentation',
  'metadata',
  'city'
])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function issue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message })
}

function requireString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  options: { nonEmpty?: boolean } = { nonEmpty: true }
): value is string {
  if (typeof value !== 'string') {
    issue(issues, path, 'type.string', '必须是字符串')
    return false
  }

  if (options.nonEmpty !== false && value.trim().length === 0) {
    issue(issues, path, 'string.empty', '不得为空')
    return false
  }

  return true
}

function optionalString(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && typeof value !== 'string') {
    issue(issues, path, 'type.string', '必须是字符串')
  }
}

function optionalBoolean(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && typeof value !== 'boolean') {
    issue(issues, path, 'type.boolean', '必须是布尔值')
  }
}

function optionalFiniteNumber(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && !isFiniteNumber(value)) {
    issue(issues, path, 'type.number', '必须是有限数值')
  }
}

function validateNumberTuple(
  value: unknown,
  size: number,
  path: string,
  issues: ValidationIssue[]
): value is number[] {
  if (!Array.isArray(value) || value.length !== size || !value.every(isFiniteNumber)) {
    issue(issues, path, 'type.numberTuple', `必须是长度为 ${size} 的有限数值数组`)
    return false
  }
  return true
}

function validateZoomRange(record: UnknownRecord, path: string, issues: ValidationIssue[]): void {
  optionalFiniteNumber(record.minZoom, `${path}.minZoom`, issues)
  optionalFiniteNumber(record.maxZoom, `${path}.maxZoom`, issues)

  if (
    isFiniteNumber(record.minZoom) &&
    isFiniteNumber(record.maxZoom) &&
    record.minZoom > record.maxZoom
  ) {
    issue(issues, path, 'range.zoom', 'minZoom 不得大于 maxZoom')
  }
}

function validateView(value: unknown, path: string, issues: ValidationIssue[]): value is SceneView {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return false
  }

  requireString(value.projection, `${path}.projection`, issues)
  validateNumberTuple(value.center, 2, `${path}.center`, issues)
  if (!isFiniteNumber(value.zoom)) issue(issues, `${path}.zoom`, 'type.number', '必须是有限数值')
  optionalFiniteNumber(value.rotation, `${path}.rotation`, issues)
  validateZoomRange(value, path, issues)
  if (value.extent !== undefined) validateNumberTuple(value.extent, 4, `${path}.extent`, issues)
  return true
}

function validateUrl(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (!requireString(value, path, issues)) return false

  if (/^(file:|[a-zA-Z]:[\\/]|\\\\|\/)/.test(value)) {
    issue(issues, path, 'url.localPath', '不得使用 file URL、本地绝对路径或根路径')
    return false
  }

  const scheme = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(value)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') {
    issue(issues, path, 'url.scheme', '只允许相对 URL 或 HTTP(S) URL')
    return false
  }

  return true
}

function validateGeoJson(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是 GeoJSON FeatureCollection 对象')
    return
  }

  if (value.type !== 'FeatureCollection') {
    issue(issues, `${path}.type`, 'geojson.featureCollection', '必须为 FeatureCollection')
  }
  if (!Array.isArray(value.features)) {
    issue(issues, `${path}.features`, 'type.array', '必须是数组')
  }
}

function validateSource(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  credentialIds: Set<string>
): value is SceneSource {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return false
  }

  if (value.type === 'geojson') {
    const hasData = value.data !== undefined
    const hasUrl = value.url !== undefined
    if (hasData === hasUrl) {
      issue(issues, path, 'source.location', 'data 和 url 必须且只能提供一个')
    }
    if (hasData) validateGeoJson(value.data, `${path}.data`, issues)
    if (hasUrl) validateUrl(value.url, `${path}.url`, issues)
    optionalString(value.dataProjection, `${path}.dataProjection`, issues)
    optionalString(value.idField, `${path}.idField`, issues)
    return true
  }

  if (value.type === 'xyz') {
    if (validateUrl(value.url, `${path}.url`, issues)) {
      const url = value.url as string
      if (!url.includes('{z}') || !url.includes('{x}') || !url.includes('{y}')) {
        issue(issues, `${path}.url`, 'xyz.placeholders', '必须包含 {z}、{x} 和 {y} 占位符')
      }
    }
    if (value.crossOrigin !== undefined && value.crossOrigin !== 'anonymous' && value.crossOrigin !== 'use-credentials') {
      issue(issues, `${path}.crossOrigin`, 'xyz.crossOrigin', '必须是 anonymous 或 use-credentials')
    }
    if (value.maxZoom !== undefined) validatePositiveNumber(value.maxZoom, `${path}.maxZoom`, issues, true)
    optionalString(value.attribution, `${path}.attribution`, issues)
    return true
  }

  if (value.type === 'provider') {
    if (value.provider === 'tianditu') {
      if (value.mapType !== 'vector' && value.mapType !== 'imagery' && value.mapType !== 'terrain') {
        issue(issues, `${path}.mapType`, 'provider.mapType', '天地图必须是 vector、imagery 或 terrain')
      }
      if (
        value.projection !== undefined &&
        value.projection !== 'EPSG:3857' &&
        value.projection !== 'EPSG:4326'
      ) {
        issue(issues, `${path}.projection`, 'provider.projection', '天地图只支持 EPSG:3857 或 EPSG:4326')
      }
      optionalBoolean(value.withLabels, `${path}.withLabels`, issues)
    } else if (value.provider === 'google-map-tiles') {
      if (value.mapType !== 'roadmap' && value.mapType !== 'satellite' && value.mapType !== 'terrain') {
        issue(issues, `${path}.mapType`, 'provider.mapType', 'Google Map Tiles 必须是 roadmap、satellite 或 terrain')
      }
      requireString(value.language, `${path}.language`, issues)
      if (requireString(value.region, `${path}.region`, issues) && !/^[A-Za-z]{2}$/.test(value.region as string)) {
        issue(issues, `${path}.region`, 'provider.region', '必须是两个字母的 CLDR 地区代码')
      }
    } else {
      issue(issues, `${path}.provider`, 'provider.type', '不支持该地图 Provider')
    }

    if (requireString(value.credential, `${path}.credential`, issues) && !credentialIds.has(value.credential as string)) {
      issue(
        issues,
        `${path}.credential`,
        'reference.credential',
        `Credential “${String(value.credential)}” 不存在`
      )
    }
    return true
  }

﻿  if (value.type === 'wms') {
    validateUrl(value.url, `${path}.url`, issues)
    requireString(value.version, `${path}.version`, issues)
    if (!Array.isArray(value.layerNames) || value.layerNames.length === 0) {
      issue(issues, `${path}.layerNames`, 'wms.layerNames', '必须提供至少一个 layerName')
    } else {
      value.layerNames.forEach((name, index) => optionalString(name, `${path}.layerNames[${index}]`, issues))
    }
    if (value.styleNames !== undefined) {
      if (!Array.isArray(value.styleNames)) {
        issue(issues, `${path}.styleNames`, 'type.array', '必须是数组')
      }
    }
    optionalString(value.format, `${path}.format`, issues)
    optionalBoolean(value.transparent, `${path}.transparent`, issues)
    optionalString(value.crs, `${path}.crs`, issues)
    if (value.authMode !== 'none' && value.authMode !== 'runtime') {
      issue(issues, `${path}.authMode`, 'wms.authMode', '必须是 none 或 runtime')
    }
    return true
  }

  if (value.type === 'wmts') {
    validateUrl(value.url, `${path}.url`, issues)
    requireString(value.version, `${path}.version`, issues)
    requireString(value.layer, `${path}.layer`, issues)
    requireString(value.tileMatrixSet, `${path}.tileMatrixSet`, issues)
    if (value.requestEncoding !== 'KVP' && value.requestEncoding !== 'REST') {
      issue(issues, `${path}.requestEncoding`, 'wmts.requestEncoding', '必须是 KVP 或 REST')
    }
    if (!Array.isArray(value.tileMatrices) || value.tileMatrices.length === 0) {
      issue(issues, `${path}.tileMatrices`, 'wmts.tileMatrices', '必须提供 TileMatrix 定义')
    }
    if (value.authMode !== 'none' && value.authMode !== 'runtime') {
      issue(issues, `${path}.authMode`, 'wmts.authMode', '必须是 none 或 runtime')
    }
    optionalString(value.style, `${path}.style`, issues)
    optionalString(value.format, `${path}.format`, issues)
    optionalString(value.projection, `${path}.projection`, issues)
    optionalString(value.supportedCrs, `${path}.supportedCrs`, issues)
    return true
  }

  issue(issues, `${path}.type`, 'source.type', '只支持 geojson、xyz、provider、wms 或 wmts Source')
  return false
}


function validateLineDash(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => isFiniteNumber(item) && item >= 0)) {
    issue(issues, path, 'style.lineDash', '必须是非空的非负有限数值数组')
  }
}

function validatePositiveNumber(value: unknown, path: string, issues: ValidationIssue[], allowZero = false): void {
  if (!isFiniteNumber(value) || (allowZero ? value < 0 : value <= 0)) {
    issue(issues, path, 'range.positive', allowZero ? '必须是非负有限数值' : '必须是正有限数值')
  }
}

function validateStyle(value: unknown, path: string, issues: ValidationIssue[]): value is SceneStyle {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return false
  }

  if (value.type === 'point') {
    validatePositiveNumber(value.radius, `${path}.radius`, issues)
    requireString(value.fill, `${path}.fill`, issues)
    optionalString(value.stroke, `${path}.stroke`, issues)
    if (value.strokeWidth !== undefined) {
      validatePositiveNumber(value.strokeWidth, `${path}.strokeWidth`, issues, true)
    }
    return true
  }

  if (value.type === 'line') {
    requireString(value.color, `${path}.color`, issues)
    validatePositiveNumber(value.width, `${path}.width`, issues)
    validateLineDash(value.lineDash, `${path}.lineDash`, issues)
    return true
  }

  if (value.type === 'polygon') {
    requireString(value.fill, `${path}.fill`, issues)
    requireString(value.stroke, `${path}.stroke`, issues)
    validatePositiveNumber(value.strokeWidth, `${path}.strokeWidth`, issues, true)
    validateLineDash(value.lineDash, `${path}.lineDash`, issues)
    return true
  }

  issue(issues, `${path}.type`, 'style.type', '必须是 point、line 或 polygon')
  return false
}

function validateLabel(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return
  }
  requireString(value.field, `${path}.field`, issues)
  optionalString(value.color, `${path}.color`, issues)
  optionalString(value.font, `${path}.font`, issues)
  optionalString(value.haloColor, `${path}.haloColor`, issues)
  if (value.haloWidth !== undefined) validatePositiveNumber(value.haloWidth, `${path}.haloWidth`, issues, true)
  if (value.offset !== undefined) validateNumberTuple(value.offset, 2, `${path}.offset`, issues)
  validateZoomRange(value, path, issues)
}

function validateSceneColor(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '颜色必须是 { r, g, b, a } 对象')
    return
  }
  for (const channel of ['r', 'g', 'b'] as const) {
    if (!isFiniteNumber(value[channel]) || value[channel] < 0 || value[channel] > 255) {
      issue(issues, `${path}.${channel}`, 'color.channel', '必须是 0..255 有限数值')
    }
  }
  if (!isFiniteNumber(value.a) || value.a < 0 || value.a > 1) {
    issue(issues, `${path}.a`, 'color.alpha', '必须是 0..1 有限数值')
  }
}

function validateSceneSymbol(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return
  }

  if (value.type === 'circle') {
    validatePositiveNumber(value.radius, `${path}.radius`, issues)
    if (value.fill !== undefined) validateSceneColor(value.fill, `${path}.fill`, issues)
    if (value.stroke !== undefined) validateSceneColor(value.stroke, `${path}.stroke`, issues)
    if (value.strokeWidth !== undefined) {
      validatePositiveNumber(value.strokeWidth, `${path}.strokeWidth`, issues, true)
    }
    return
  }

  if (value.type === 'solid') {
    if ('width' in value && !('fill' in value)) {
      if (value.color !== undefined) validateSceneColor(value.color, `${path}.color`, issues)
      else issue(issues, `${path}.color`, 'symbol.color', '线符号必须提供 color')
      validatePositiveNumber(value.width, `${path}.width`, issues)
      validateLineDash(value.lineDash, `${path}.lineDash`, issues)
      return
    }
    if (value.fill !== undefined) validateSceneColor(value.fill, `${path}.fill`, issues)
    if (value.stroke !== undefined) validateSceneColor(value.stroke, `${path}.stroke`, issues)
    if (value.strokeWidth !== undefined) {
      validatePositiveNumber(value.strokeWidth, `${path}.strokeWidth`, issues, true)
    }
    validateLineDash(value.lineDash, `${path}.lineDash`, issues)
    return
  }

  if (value.type === 'mixed') {
    if (value.point !== undefined) validateSceneSymbol(value.point, `${path}.point`, issues)
    if (value.line !== undefined) validateSceneSymbol(value.line, `${path}.line`, issues)
    if (value.polygon !== undefined) validateSceneSymbol(value.polygon, `${path}.polygon`, issues)
    if (value.point === undefined && value.line === undefined && value.polygon === undefined) {
      issue(issues, path, 'symbol.mixed.empty', 'mixed 符号至少提供 point、line 或 polygon 之一')
    }
    return
  }

  issue(issues, `${path}.type`, 'symbol.type', '必须是 circle、solid 或 mixed')
}

function validateSceneLabelConfig(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return
  }
  requireString(value.field, `${path}.field`, issues)
  if (value.fontSize !== undefined) validatePositiveNumber(value.fontSize, `${path}.fontSize`, issues)
  if (value.color !== undefined) validateSceneColor(value.color, `${path}.color`, issues)
  if (value.strokeColor !== undefined) validateSceneColor(value.strokeColor, `${path}.strokeColor`, issues)
  if (value.strokeWidth !== undefined) {
    validatePositiveNumber(value.strokeWidth, `${path}.strokeWidth`, issues, true)
  }
  optionalFiniteNumber(value.offsetX, `${path}.offsetX`, issues)
  optionalFiniteNumber(value.offsetY, `${path}.offsetY`, issues)
  validateZoomRange(value, path, issues)
}

function validateLayerStyle(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return
  }

  if (value.mode === 'single') {
    validateSceneSymbol(value.symbol, `${path}.symbol`, issues)
    if (value.label !== undefined) validateSceneLabelConfig(value.label, `${path}.label`, issues)
    return
  }

  if (value.mode === 'categorized') {
    requireString(value.field, `${path}.field`, issues)
    if (!Array.isArray(value.categories)) {
      issue(issues, `${path}.categories`, 'type.array', '必须是数组')
    } else {
      value.categories.forEach((entry, index) => {
        const entryPath = `${path}.categories[${index}]`
        if (!isRecord(entry)) {
          issue(issues, entryPath, 'type.object', '必须是对象')
          return
        }
        if (
          !(typeof entry.value === 'string' || (typeof entry.value === 'number' && Number.isFinite(entry.value)))
        ) {
          issue(issues, `${entryPath}.value`, 'category.value', '必须是字符串或有限数值')
        }
        validateSceneSymbol(entry.symbol, `${entryPath}.symbol`, issues)
        optionalString(entry.label, `${entryPath}.label`, issues)
      })
    }
    validateSceneSymbol(value.fallback, `${path}.fallback`, issues)
    if (value.label !== undefined) validateSceneLabelConfig(value.label, `${path}.label`, issues)
    return
  }

  if (value.mode === 'graduated') {
    requireString(value.field, `${path}.field`, issues)
    if (value.method !== 'equal-interval' && value.method !== 'quantile' && value.method !== 'manual') {
      issue(issues, `${path}.method`, 'graduated.method', '必须是 equal-interval、quantile 或 manual')
    }
    if (!Array.isArray(value.breaks)) {
      issue(issues, `${path}.breaks`, 'type.array', '必须是数组')
    } else {
      value.breaks.forEach((entry, index) => {
        const entryPath = `${path}.breaks[${index}]`
        if (!isRecord(entry)) {
          issue(issues, entryPath, 'type.object', '必须是对象')
          return
        }
        if (!isFiniteNumber(entry.value)) {
          issue(issues, `${entryPath}.value`, 'type.number', '必须是有限数值')
        }
        validateSceneSymbol(entry.symbol, `${entryPath}.symbol`, issues)
        optionalString(entry.label, `${entryPath}.label`, issues)
      })
    }
    validateSceneSymbol(value.fallback, `${path}.fallback`, issues)
    if (value.label !== undefined) validateSceneLabelConfig(value.label, `${path}.label`, issues)
    return
  }

  issue(issues, `${path}.mode`, 'style.mode', 'version 2 样式必须提供 mode: single | categorized | graduated')
}

function validatePopup(value: unknown, path: string, issues: ValidationIssue[]): value is PopupDefinition {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return false
  }
  optionalString(value.titleField, `${path}.titleField`, issues)
  if (!Array.isArray(value.fields)) {
    issue(issues, `${path}.fields`, 'type.array', '必须是数组')
    return false
  }
  value.fields.forEach((field, index) => {
    const fieldPath = `${path}.fields[${index}]`
    if (!isRecord(field)) {
      issue(issues, fieldPath, 'type.object', '必须是对象')
      return
    }
    requireString(field.field, `${fieldPath}.field`, issues)
    optionalString(field.label, `${fieldPath}.label`, issues)
    if (
      field.format !== undefined &&
      field.format !== 'text' &&
      field.format !== 'number' &&
      field.format !== 'date' &&
      field.format !== 'url'
    ) {
      issue(issues, `${fieldPath}.format`, 'popup.format', '必须是 text、number、date 或 url')
    }
  })
  return true
}

function validateLayer(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  sources: UnknownRecord,
  version: unknown
): value is SceneLayer {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return false
  }

  requireString(value.id, `${path}.id`, issues)
  requireString(value.name, `${path}.name`, issues)
  optionalBoolean(value.visible, `${path}.visible`, issues)
  if (value.role !== undefined && value.role !== 'basemap' && value.role !== 'overlay') {
    issue(issues, `${path}.role`, 'layer.role', '必须是 basemap 或 overlay')
  }
  validateZoomRange(value, path, issues)

  if (value.opacity !== undefined && (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1)) {
    issue(issues, `${path}.opacity`, 'range.opacity', '必须处于 0..1')
  }

  if (value.type === 'tile') {
    if (requireString(value.source, `${path}.source`, issues)) {
      const source = sources[value.source as string]
      if (!source) {
        issue(issues, `${path}.source`, 'reference.source', `Source “${String(value.source)}” 不存在`)
      } else if (
        isRecord(source) &&
        source.type !== 'xyz' &&
        source.type !== 'provider' &&
        source.type !== 'wms' &&
        source.type !== 'wmts'
      ) {
        issue(issues, `${path}.source`, 'reference.sourceType', 'Tile Layer 必须引用 xyz、provider、wms 或 wmts Source')
      }
    }
    return true
  }

  if (value.type === 'vector') {
    if (requireString(value.source, `${path}.source`, issues)) {
      const source = sources[value.source as string]
      if (!source) {
        issue(issues, `${path}.source`, 'reference.source', `Source “${String(value.source)}” 不存在`)
      } else if (isRecord(source) && source.type !== 'geojson') {
        issue(issues, `${path}.source`, 'reference.sourceType', 'Vector Layer 必须引用 geojson Source')
      }
    }

    if (version === SCENE_MANIFEST_VERSION_V1) {
      validateStyle(value.style, `${path}.style`, issues)
      if (value.label !== undefined) validateLabel(value.label, `${path}.label`, issues)
    } else if (version === SCENE_MANIFEST_VERSION) {
      if (value.label !== undefined) {
        issue(
          issues,
          `${path}.label`,
          'style.legacyLabel',
          'version 2 不得使用顶层 label；请写入 style.label'
        )
      }
      validateLayerStyle(value.style, `${path}.style`, issues)
    }

    if (value.interaction !== undefined) {
      if (!isRecord(value.interaction)) {
        issue(issues, `${path}.interaction`, 'type.object', '必须是对象')
      } else {
        optionalBoolean(value.interaction.selectable, `${path}.interaction.selectable`, issues)
        if (value.interaction.popup !== undefined) {
          validatePopup(value.interaction.popup, `${path}.interaction.popup`, issues)
        }
      }
    }
    return true
  }

  issue(issues, `${path}.type`, 'layer.type', '只支持 tile 或 vector Layer')
  return false
}

function validateWidgets(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return
  }
  for (const field of ['layerSwitcher', 'legend', 'scaleLine', 'fullscreen', 'zoom', 'mousePosition']) {
    optionalBoolean(value[field], `${path}.${field}`, issues)
  }
}

function validateCredentials(value: unknown, path: string, issues: ValidationIssue[]): Set<string> {
  const ids = new Set<string>()
  if (value === undefined) return ids
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是 Credential 字典')
    return ids
  }
  for (const [id, credential] of Object.entries(value)) {
    ids.add(id)
    if (id.trim().length === 0) issue(issues, path, 'id.empty', 'Credential ID 不得为空')
    const credentialPath = `${path}.${id}`
    if (!isRecord(credential)) {
      issue(issues, credentialPath, 'type.object', '必须是对象')
      continue
    }
    if (credential.type !== 'runtime-reference') {
      issue(issues, `${credentialPath}.type`, 'credential.type', '必须是 runtime-reference')
    }
    requireString(credential.key, `${credentialPath}.key`, issues)
  }
  return ids
}

function validateTheme(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return
  }
  optionalString(value.preset, `${path}.preset`, issues)
  if (
    value.colorScheme !== undefined &&
    value.colorScheme !== 'light' &&
    value.colorScheme !== 'dark' &&
    value.colorScheme !== 'system'
  ) {
    issue(issues, `${path}.colorScheme`, 'theme.colorScheme', '必须是 light、dark 或 system')
  }
  optionalString(value.accent, `${path}.accent`, issues)
  if (value.surface !== undefined && value.surface !== 'solid' && value.surface !== 'glass') {
    issue(issues, `${path}.surface`, 'theme.surface', '必须是 solid 或 glass')
  }
  optionalString(value.fontFamily, `${path}.fontFamily`, issues)
  if (value.logo !== undefined) validateUrl(value.logo, `${path}.logo`, issues)
}

function validatePresentation(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  layerIds: Set<string>
): void {
  if (!isRecord(value)) {
    issue(issues, path, 'type.object', '必须是对象')
    return
  }
  if (value.chapters === undefined) return
  if (!Array.isArray(value.chapters)) {
    issue(issues, `${path}.chapters`, 'type.array', '必须是数组')
    return
  }

  const chapterIds = new Set<string>()
  value.chapters.forEach((chapter, index) => {
    const chapterPath = `${path}.chapters[${index}]`
    if (!isRecord(chapter)) {
      issue(issues, chapterPath, 'type.object', '必须是对象')
      return
    }
    if (requireString(chapter.id, `${chapterPath}.id`, issues)) {
      const chapterId = chapter.id as string
      if (chapterIds.has(chapterId)) issue(issues, `${chapterPath}.id`, 'id.duplicate', 'Chapter ID 重复')
      chapterIds.add(chapterId)
    }
    requireString(chapter.title, `${chapterPath}.title`, issues)
    optionalString(chapter.description, `${chapterPath}.description`, issues)
    validateView(chapter.view, `${chapterPath}.view`, issues)

    if (chapter.visibleLayers !== undefined) {
      if (!Array.isArray(chapter.visibleLayers) || !chapter.visibleLayers.every((item) => typeof item === 'string')) {
        issue(issues, `${chapterPath}.visibleLayers`, 'type.stringArray', '必须是字符串数组')
      } else {
        chapter.visibleLayers.forEach((layerId, layerIndex) => {
          if (!layerIds.has(layerId)) {
            issue(
              issues,
              `${chapterPath}.visibleLayers[${layerIndex}]`,
              'reference.layer',
              `Layer “${layerId}” 不存在`
            )
          }
        })
      }
    }

    if (
      chapter.highlightedFeatureIds !== undefined &&
      (!Array.isArray(chapter.highlightedFeatureIds) ||
        !chapter.highlightedFeatureIds.every((item) => typeof item === 'string'))
    ) {
      issue(issues, `${chapterPath}.highlightedFeatureIds`, 'type.stringArray', '必须是字符串数组')
    }
  })
}

/** Validates both the v1 structure and references between sources, layers and chapters. */
export function validateScene(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!isRecord(input)) {
    return { valid: false, issues: [{ path: '$', code: 'type.object', message: '场景必须是对象' }] }
  }

  for (const field of Object.keys(input)) {
    if (!ROOT_FIELDS.has(field)) issue(issues, `$.${field}`, 'field.unknown', '未知顶层字段')
  }

  const version = input.version
  if (version !== SCENE_MANIFEST_VERSION_V1 && version !== SCENE_MANIFEST_VERSION) {
    issue(issues, '$.version', 'version.unsupported', '只支持 SceneManifest version 1 或 2')
  }

  requireString(input.id, '$.id', issues)
  requireString(input.title, '$.title', issues)
  optionalString(input.description, '$.description', issues)
  optionalString(input.$schema, '$.$schema', issues)
  validateView(input.view, '$.view', issues)
  if (input.city !== undefined) {
    if (version !== 2) issue(issues, '$.city', 'version.city', '三维扩展仅支持 SceneManifest version 2')
    for (const entry of validateCityScene(input.city, '$.city')) issue(issues, entry.path, 'city.invalid', entry.message)
  }

  const credentialIds = validateCredentials(input.credentials, '$.credentials', issues)
  let sourcesRecord: UnknownRecord = {}
  if (!isRecord(input.sources)) {
    issue(issues, '$.sources', 'type.object', '必须是 Source 字典')
  } else {
    sourcesRecord = input.sources
    for (const [sourceId, source] of Object.entries(input.sources)) {
      if (sourceId.trim().length === 0) issue(issues, '$.sources', 'id.empty', 'Source ID 不得为空')
      validateSource(source, `$.sources.${sourceId}`, issues, credentialIds)
    }
  }

  const layerIds = new Set<string>()
  if (!Array.isArray(input.layers)) {
    issue(issues, '$.layers', 'type.array', '必须是 Layer 数组')
  } else {
    input.layers.forEach((layer, index) => {
      const layerPath = `$.layers[${index}]`
      validateLayer(layer, layerPath, issues, sourcesRecord, version)
      if (isRecord(layer) && typeof layer.id === 'string') {
        if (layerIds.has(layer.id)) issue(issues, `${layerPath}.id`, 'id.duplicate', 'Layer ID 重复')
        layerIds.add(layer.id)
      }
    })
  }

  if (input.widgets !== undefined) validateWidgets(input.widgets, '$.widgets', issues)
  if (input.theme !== undefined) validateTheme(input.theme, '$.theme', issues)
  if (input.presentation !== undefined) {
    validatePresentation(input.presentation, '$.presentation', issues, layerIds)
  }
  if (input.metadata !== undefined && !isRecord(input.metadata)) {
    issue(issues, '$.metadata', 'type.object', '必须是 JSON 对象')
  }

  return { valid: issues.length === 0, issues }
}

export function isSceneManifest(input: unknown): input is SceneManifest {
  return validateScene(input).valid
}
