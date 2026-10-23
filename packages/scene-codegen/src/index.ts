import {
  parseScene,
  type SceneLayerStyle,
  type SceneManifest
} from '@desktop-webgis/scene-schema'
import { parseSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'

export interface OpenLayersCodegenOptions {
  targetExpression?: string
  credentialGlobal?: string
  includeCssImport?: boolean
}

const SUPPORTED_STYLE_MODES = new Set(['single', 'categorized', 'graduated'])
const SUPPORTED_SOURCE_TYPES = new Set(['geojson', 'xyz', 'provider', 'wms', 'wmts'])

/**
 * Fail loudly when a scene uses capabilities this codegen/runtime path cannot preserve.
 * Never silently omit WMS/WMTS/filters/styles.
 */
export function assertSceneCodegenCapabilities(scene: SceneManifest): void {
  if (scene.city) throw new Error('三维场景请使用 Cesium Scene Runtime 或独立 Viewer；OpenLayers 代码生成不支持三维扩展')
  for (const [sourceId, source] of Object.entries(scene.sources)) {
    if (!SUPPORTED_SOURCE_TYPES.has(source.type)) {
      throw new Error(
        `Source "${sourceId}" 类型 "${String((source as { type?: unknown }).type)}" 不受支持；拒绝静默省略`
      )
    }
  }
  for (const layer of scene.layers) {
    if (layer.type !== 'vector') continue
    const style: SceneLayerStyle = layer.style
    if (!SUPPORTED_STYLE_MODES.has(style.mode)) {
      throw new Error(
        `Layer "${layer.id}" 使用了代码生成尚未支持的样式 mode "${String((style as { mode?: unknown }).mode)}"；拒绝静默降级`
      )
    }
  }
}

/** Generates an ESM module backed by the public OpenLayers Scene Runtime. */
export function generateOpenLayersModule(
  input: unknown,
  options: OpenLayersCodegenOptions = {}
): string {
  const scene = parseScene(input)
  assertSceneCodegenCapabilities(scene)
  const targetExpression = options.targetExpression ?? "document.getElementById('map')"
  if (!targetExpression.trim()) throw new Error('targetExpression 不得为空。')
  const credentialGlobal = options.credentialGlobal ?? '__MAP_CREDENTIALS__'
  const credentialIds = Object.keys(scene.credentials ?? {}).sort()
  const lines = [
    ...(options.includeCssImport === false ? [] : ["import 'ol/ol.css';"]),
    "import { createSceneRuntime } from '@desktop-webgis/ol-scene-runtime';",
    '',
    `export const scene = ${JSON.stringify(scene, null, 2)};`,
    '',
    `const providedCredentials = globalThis[${JSON.stringify(credentialGlobal)}] ?? {};`,
    `const credentials = Object.fromEntries(${JSON.stringify(credentialIds)}.map((id) => [id, providedCredentials[id] ?? '']));`,
    '',
    'export const runtime = await createSceneRuntime({',
    `  target: ${targetExpression},`,
    '  scene,',
    '  credentials',
    '});',
    ''
  ]
  return lines.join('\n')
}

export function generateOpenLayersHtml(modulePath = './map.js'): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenLayers Scene</title>
    <style>html, body, #map { width: 100%; height: 100%; margin: 0; }</style>
  </head>
  <body>
    <div id="map"></div>
    <script type="module" src="${escapeHtmlAttribute(modulePath)}"></script>
  </body>
</html>
`
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

export interface CesiumCodegenDiagnostic {
  severity: 'error' | 'warning'
  path: string
  code: string
  message: string
}

export interface CesiumCodegenOptions { cesiumVersion?: string }
const CODEGEN_CESIUM_VERSION = '1.145.0'
const TILESET_CACHE_BYTES_DEFAULT = 256 * 1024 * 1024

function stripRuntimeBridgeUrls(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const copy = structuredClone(input) as Record<string, unknown>
  if (copy.resources && typeof copy.resources === 'object' && !Array.isArray(copy.resources)) {
    for (const resource of Object.values(copy.resources as Record<string, unknown>)) {
      if (!resource || typeof resource !== 'object' || Array.isArray(resource)) continue
      const item = resource as Record<string, unknown>
      if (typeof item.url === 'string' && /webgis-resource\.localhost|webgis-resource:/i.test(item.url)) delete item.url
    }
  }
  return copy
}

/** Reports v3 scene features that a standalone Cesium module cannot preserve. */
export function inspectCesiumCodegenCapabilities(input: unknown): CesiumCodegenDiagnostic[] {
  let scene: SceneDocument
  try { scene = parseSceneDocument(stripRuntimeBridgeUrls(input)) }
  catch (error) {
    return [{ severity: 'error', path: '$', code: 'scene.invalid', message: error instanceof Error ? error.message : String(error) }]
  }
  const issues: CesiumCodegenDiagnostic[] = []
  const fail = (path: string, code: string, message: string) => issues.push({ severity: 'error', path, code, message })
  const warn = (path: string, code: string, message: string) => issues.push({ severity: 'warning', path, code, message })
  const view = scene.views[scene.activeView]
  if (view.type !== '3d') fail(`$.views.${scene.activeView}`, 'view.type', 'Cesium 导出仅支持活动 3D 视图')
  if (scene.theme) fail('$.theme', 'theme.unsupported', '二维场景主题未纳入 Cesium 原生导出')
  if (scene.presentation) fail('$.presentation', 'presentation.unsupported', '演示配置未纳入 Cesium 原生导出')
  if (scene.metadata && Object.keys(scene.metadata).length) fail('$.metadata', 'metadata.unsupported', '自定义场景元数据无法在 Cesium Viewer 中执行')
  if (scene.environment?.basemap) warn('$.environment.basemap', 'resource.reachability', '底图可访问性取决于导出环境；需要时通过 hooks.resolveResource 提供 URL')
  if (scene.environment?.terrain) warn('$.environment.terrain', 'resource.reachability', '地形可访问性取决于导出环境；需要时通过 hooks.resolveResource 提供 URL')
  const referenced3dResources = new Set<string>()
  for (const node of scene.nodes) if (node.type !== 'group' && node.type !== 'tile' && node.type !== 'vector' && 'resource' in node) referenced3dResources.add(node.resource)
  for (const [id, resource] of Object.entries(scene.resources)) {
    if (!referenced3dResources.has(id)) continue
    if (resource.type === '3dtiles' || resource.type === 'glb' || resource.type === 'geojson') {
      if (!resource.reference && !resource.url && !(resource.type === 'geojson' && 'data' in resource && resource.data)) fail(`$.resources.${id}`, 'resource.missing', '资源没有可引用的 URL、数据或资源引用')
    } else if (resource.type !== 'xyz') fail(`$.resources.${id}`, 'resource.type', `资源类型 ${resource.type} 暂不支持 Cesium 导出`)
    if (resource.reference && resource.reference.kind !== 'url') warn(`$.resources.${id}.reference`, 'resource.hook', '本地资源路径不会打包；createScene 需要 hooks.resolveResource')
    if (resource.authentication || (resource.reference?.kind === 'url' && resource.reference.credentialRef)) warn(`$.resources.${id}`, 'credential.hook', '该资源需要 createScene 的 hooks 提供凭据')
    if ('url' in resource && resource.url) warn(`$.resources.${id}.url`, 'resource.reachability', '远程资源可访问性取决于导出环境')
  }
  scene.nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`
    if (node.type === 'group') return
    if (node.type === 'tile' || node.type === 'vector') {
      warn(path, 'node.2d-omitted', '二维节点会从 Cesium 导出中省略')
      return
    }
    if (node.type === '3dtiles' && node.effects?.length) fail(`${path}.effects`, 'tileset.effects', 'Tileset 裁剪/压平效果尚未纳入独立代码生成')
    else if (node.type === 'water') fail(path, 'node.water', '水面节点尚未纳入独立代码生成')
    if (node.type === 'graphic' && ['rectangle', 'ellipse'].includes(node.geometry.type)) fail(`${path}.geometry`, 'graphic.parametric', '矩形与椭圆参数图形尚未纳入独立代码生成')
    if (node.type === 'graphic' && (node.style.label || node.style.labelField || node.style.billboard)) fail(`${path}.style`, 'graphic.style', 'Graphic 标签或图标样式尚未纳入独立代码生成')
  })
  if (scene.extensions) for (const name of Object.keys(scene.extensions)) fail(`$.extensions.${name}`, 'extension.unsupported', '场景扩展无法在独立 Cesium Viewer 中执行')
  if (scene.widgets && Object.keys(scene.widgets).length) fail('$.widgets', 'widgets.unsupported', '桌面控件配置不会在独立 Viewer 中生效')
  return issues
}

/** Generates standalone CesiumJS code. Host-specific credentials and local grants are injected through hooks. */
export function generateCesiumModule(input: unknown, options: CesiumCodegenOptions = {}): string {
  const diagnostics = inspectCesiumCodegenCapabilities(input)
  const errors = diagnostics.filter(issue => issue.severity === 'error')
  if (errors.length) throw new Error(errors.map(issue => `${issue.path}: ${issue.message}`).join('\n'))
  const scene = parseSceneDocument(stripRuntimeBridgeUrls(input))
  const version = options.cesiumVersion ?? CODEGEN_CESIUM_VERSION
  if (version !== CODEGEN_CESIUM_VERSION) throw new Error(`当前代码生成器仅验证 Cesium ${CODEGEN_CESIUM_VERSION}，拒绝目标版本 ${version}`)
  const exportedResources = new Set<string>()
  for (const node of scene.nodes) if (node.type !== 'group' && node.type !== 'tile' && node.type !== 'vector' && 'resource' in node) exportedResources.add(node.resource)
  const activeView = scene.views[scene.activeView]
  const safeScene = {
    version: scene.version,
    id: scene.id,
    title: scene.title,
    ...(scene.description ? { description: scene.description } : {}),
    resources: Object.fromEntries(Object.entries(scene.resources).filter(([id]) => exportedResources.has(id))),
    nodes: scene.nodes.filter(node => node.type === 'group' || (node.type !== 'tile' && node.type !== 'vector')),
    views: { [scene.activeView]: activeView },
    activeView: scene.activeView,
    ...(scene.environment ? { environment: scene.environment } : {})
  }
  // Native bridge URLs are session scoped. Preserve portable references and resolve them in the host.
  for (const resource of Object.values(safeScene.resources)) {
    if ('url' in resource && typeof resource.url === 'string' && /webgis-resource\.localhost|webgis-resource:/i.test(resource.url)) delete resource.url
  }
  const lines = [
    "import * as Cesium from 'cesium';",
    `export const targetCesiumVersion = ${JSON.stringify(version)};`,
    `const sceneDocument = ${JSON.stringify(safeScene, null, 2)};`,
    'export async function createScene(viewer, hooks = {}) {',
    '  const resources = sceneDocument.resources;',
    '  const resolve = async (resource) => {',
    '    if (hooks.resolveResource) return await hooks.resolveResource(resource, hooks.credentials ?? {});',
    "    if (resource.authentication || resource.credential || resource.reference?.credentialRef) throw new Error('Resource credentials require hooks.resolveResource');",
    "    if (resource.url) return resource.url;",
    "    if (resource.reference?.kind === 'url') return resource.reference.url;",
    "    throw new Error('Resource requires hooks.resolveResource');",
    '  };',
    '  const entities = [];',
    '  const primitives = [];',
    '  const ownedPrimitives = [];',
    '  const dataSources = [];',
    '  const ownedDataSources = [];',
    '  const imageryLayers = [];',
    '  const ownedImageryLayers = [];',
    '  const popupNodesById = new Map(sceneDocument.nodes.filter(node => node.popup).map(node => [node.id, node]));',
    '  const popupNodesByPrimitive = new Map();',
    '  let ownedSelection;',
    '  const originalSelection = viewer.selectedEntity;',
    '  let popupHandler;',
    '  const destroy = () => { if (popupHandler && !popupHandler.isDestroyed()) popupHandler.destroy(); if (!viewer.isDestroyed?.() && ownedSelection && viewer.selectedEntity === ownedSelection) viewer.selectedEntity = originalSelection; for (const entity of entities) { try { viewer.entities.remove(entity); } catch {} } for (const primitive of ownedPrimitives) { try { const removed = !viewer.isDestroyed?.() && viewer.scene.primitives.remove(primitive); if (!removed && !primitive.isDestroyed?.()) primitive.destroy?.(); } catch { try { if (!primitive.isDestroyed?.()) primitive.destroy?.(); } catch {} } } for (const source of ownedDataSources) { try { const removed = !viewer.isDestroyed?.() && viewer.dataSources.remove(source, true); if (!removed && !source.isDestroyed?.()) source.destroy?.(); } catch { try { if (!source.isDestroyed?.()) source.destroy?.(); } catch {} } } for (const layer of ownedImageryLayers) { try { const removed = !viewer.isDestroyed?.() && viewer.imageryLayers.remove(layer, true); if (!removed && !layer.isDestroyed?.()) layer.destroy?.(); } catch { try { if (!layer.isDestroyed?.()) layer.destroy?.(); } catch {} } } };',
    '  const groups = new Map(sceneDocument.nodes.filter(node => node.type === \'group\').map(node => [node.id, node]));',
    '  const isVisible = (node) => { if (!node.visible) return false; let parentId = node.parentId; const seen = new Set(); while (parentId) { if (seen.has(parentId)) return false; seen.add(parentId); const parent = groups.get(parentId); if (!parent) return false; if (!parent.visible) return false; parentId = parent.parentId; } return true; };',
    '  const applyEnuTransform = (base, pivot, transform) => {',
    '    if (transform.translation.every(value => value === 0) && transform.rotation.every(value => value === 0) && transform.scale === 1) return Cesium.Matrix4.clone(base);',
    '    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(pivot);',
    '    const hpr = new Cesium.HeadingPitchRoll(...transform.rotation.map(Cesium.Math.toRadians));',
    '    const rotation = Cesium.Quaternion.fromHeadingPitchRoll(hpr);',
    '    const delta = Cesium.Matrix4.fromTranslationQuaternionRotationScale(new Cesium.Cartesian3(...transform.translation), rotation, new Cesium.Cartesian3(transform.scale, transform.scale, transform.scale));',
    '    const framedDelta = Cesium.Matrix4.multiply(frame, delta, new Cesium.Matrix4());',
    '    Cesium.Matrix4.multiply(framedDelta, Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4()), framedDelta);',
    '    return Cesium.Matrix4.multiply(framedDelta, base, framedDelta);',
    '  };',
    '  const popupDescription = (node) => { if (!node.popup) return undefined; const properties = node.properties ?? {}; const value = (key) => { const item = properties[key]; return item && typeof item.getValue === \'function\' ? item.getValue() : item; }; const escape = (text) => String(text ?? \'\').replace(/[&<>\"]/g, char => ({ \'&\': \'&amp;\', \'<\': \'&lt;\', \'>\': \'&gt;\', \'\"\': \'&quot;\' })[char]); const title = node.popup.title ?? (node.popup.titleField ? value(node.popup.titleField) : node.name); const rows = node.popup.fields.map(field => \'<tr><th>\' + escape(field.label ?? field.field) + \'</th><td>\' + escape(value(field.field)) + \'</td></tr>\').join(\'\'); return \'<strong>\' + escape(title) + \'</strong><table>\' + rows + \'</table>\'; };',
    '  try {',
    '  const activeView = sceneDocument.views[sceneDocument.activeView];',
    '  if (activeView.type !== \'3d\') throw new Error(\'Cesium export requires a 3D view\');',
    '  const camera = activeView.camera;',
    '  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(...camera.position), orientation: { heading: Cesium.Math.toRadians(camera.heading), pitch: Cesium.Math.toRadians(camera.pitch), roll: Cesium.Math.toRadians(camera.roll) } });',
    '  const environment = sceneDocument.environment ?? {};',
    '  if (environment.effects) { viewer.scene.fog.density = environment.effects.fog * 0.002; viewer.scene.fog.enabled = environment.effects.fog > 0; viewer.scene.postProcessStages.bloom.enabled = environment.effects.bloom; }',
    '  if (environment.lighting) { viewer.scene.globe.enableLighting = environment.lighting.sunlight; viewer.shadows = environment.lighting.shadows; viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(environment.lighting.time); }',
    '  if (environment.terrain) { const url = await resolve(environment.terrain); viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(url); }',
    '  if (environment.basemap) { const url = await resolve(environment.basemap); const layer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url, credit: environment.basemap.attribution ? new Cesium.Credit(environment.basemap.attribution) : undefined })); ownedImageryLayers.push(layer); imageryLayers.push(layer); }',
    '  for (const node of sceneDocument.nodes) {',
    "    if (node.type === 'group') continue;",
    "    if (node.type === 'tile' || node.type === 'vector' || !isVisible(node)) continue;",
    '    const resource = node.resource ? resources[node.resource] : undefined;',
    "    if (node.type === '3dtiles') {",
    '      const url = await resolve(resource);',
    `      const tilesetOptions = Object.fromEntries(['maximumScreenSpaceError','cacheBytes','dynamicScreenSpaceError','dynamicScreenSpaceErrorDensity','dynamicScreenSpaceErrorFactor','skipLevelOfDetail'].filter(k => node[k] !== undefined).map(k => [k, node[k]])); tilesetOptions.cacheBytes ??= ${TILESET_CACHE_BYTES_DEFAULT}; const tileset = await Cesium.Cesium3DTileset.fromUrl(url, tilesetOptions); ownedPrimitives.push(tileset);`,
    '      if (node.style) tileset.style = new Cesium.Cesium3DTileStyle(node.style);',
    '      tileset.modelMatrix = applyEnuTransform(tileset.modelMatrix, tileset.boundingSphere.center, node.transform);',
    '      viewer.scene.primitives.add(tileset); tileset.show = isVisible(node); primitives.push(tileset); if (node.popup) popupNodesByPrimitive.set(tileset, node);',
    "    } else if (node.type === 'model') {",
    '      const url = await resolve(resource); const origin = Cesium.Cartesian3.fromDegrees(...node.position); const base = Cesium.Transforms.eastNorthUpToFixedFrame(origin);',
    '      const modelMatrix = applyEnuTransform(base, origin, node.transform); const pickId = { sceneNodeId: node.id, name: node.name }; const model = await Cesium.Model.fromGltfAsync({ url, modelMatrix, id: pickId, show: isVisible(node) }); ownedPrimitives.push(model); viewer.scene.primitives.add(model); primitives.push(model); if (node.popup) popupNodesByPrimitive.set(model, node);',
    "    } else if (node.type === 'imagery' || node.type === 'tile') {",
    '      const url = await resolve(node.type === \'imagery\' ? node : resource); const provider = new Cesium.UrlTemplateImageryProvider({ url, credit: node.attribution ? new Cesium.Credit(node.attribution) : undefined }); const layer = viewer.imageryLayers.addImageryProvider(provider); ownedImageryLayers.push(layer); imageryLayers.push(layer); layer.show = isVisible(node); if (node.opacity !== undefined) layer.alpha = node.opacity;',
    "    } else if (node.type === 'geojson' || node.type === 'vector') {",
    '      const url = resource?.data ? resource.data : await resolve(resource); const color = node.color ? Cesium.Color.fromCssColorString(node.color) : Cesium.Color.WHITE; const dataSource = await Cesium.GeoJsonDataSource.load(url, { stroke: color, fill: color.withAlpha(0.45), markerColor: color }); ownedDataSources.push(dataSource); await viewer.dataSources.add(dataSource); dataSources.push(dataSource); dataSource.show = isVisible(node); for (const entity of dataSource.entities.values) { if (entity.polygon) entity.polygon.material = color.withAlpha(0.45); if (entity.polyline) entity.polyline.material = color; if (entity.point) entity.point.color = color; if (node.popup) entity.description = popupDescription({ ...node, properties: entity.properties }); }',
    "    } else if (node.type === 'graphic') {",
    '      const positions = node.geometry.positions.map(p => Cesium.Cartesian3.fromDegrees(...p)); const color = Cesium.Color.fromCssColorString(node.style.color); const height = node.geometry.heightMode === \'ground\' ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE;',
    '      let geometry; if (node.geometry.type === \'point\') geometry = { position: positions[0], point: { pixelSize: node.style.pointSize, color, heightReference: height } }; else if (node.geometry.type === \'polyline\') geometry = { polyline: { positions, width: node.style.width, material: color, clampToGround: node.geometry.heightMode === \'ground\' } }; else geometry = { polygon: { hierarchy: positions, material: color, perPositionHeight: node.geometry.heightMode === \'absolute\', heightReference: height } };',
    '      const entity = viewer.entities.add({ name: node.name, show: isVisible(node), description: popupDescription(node), ...geometry }); entities.push(entity);',
    '    }',
    '  }',
    '  if (popupNodesById.size) {',
    '    popupHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);',
    '    popupHandler.setInputAction(event => {',
    '      const picked = viewer.scene.pick(event.position);',
    '      if (!picked) { if (ownedSelection && viewer.selectedEntity === ownedSelection) viewer.selectedEntity = originalSelection; ownedSelection = undefined; return; }',
    '      if (picked.id instanceof Cesium.Entity) { viewer.selectedEntity = picked.id; ownedSelection = picked.id; return; }',
    '      const primitive = picked.primitive ?? picked.content?.tileset;',
    '      const popupNode = popupNodesByPrimitive.get(primitive) ?? popupNodesById.get(picked.id?.sceneNodeId ?? picked.id);',
    '      if (!popupNode) return;',
    '      const properties = {}; if (typeof picked.getPropertyIds === \'function\' && typeof picked.getProperty === \'function\') for (const id of picked.getPropertyIds()) properties[id] = picked.getProperty(id); else if (picked.id?.name) properties.name = picked.id.name; else properties.name = popupNode.name;',
    '      const selected = new Cesium.Entity({ id: popupNode.id + \'-picked\', name: popupNode.name, description: popupDescription({ ...popupNode, properties }), properties });',
    '      viewer.selectedEntity = selected; ownedSelection = selected;',
    '    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);',
    '  }',
    '  return { viewer, entities, primitives, dataSources, imageryLayers, destroy };',
    '  } catch (error) { try { destroy(); } catch {} throw error; }',
    '}',
    'export async function mountScene(container, options = {}) {',
    '  const viewer = new Cesium.Viewer(container, options.viewerOptions ?? {});',
    '  try { const scene = await createScene(viewer, options.hooks ?? {}); return { ...scene, destroy() { scene.destroy(); if (!viewer.isDestroyed()) viewer.destroy(); } }; }',
    '  catch (error) { if (!viewer.isDestroyed()) viewer.destroy(); throw error; }',
    '}',
    ''
  ]
  return lines.join('\n')
}
