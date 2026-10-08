/**
 * Pure ProjectSnapshot → SceneManifest compile.
 * Groups flatten to render order; WFS becomes an explicitly labelled snapshot;
 * credentials / layout never enter the Scene. Unsupported content fails loudly.
 */
import {
  applyFieldFilter,
  featuresToGeoJson,
  flattenLayerIds,
  getEffectiveVisible,
  stripCredentialRefsFromDataset,
  type Dataset,
  type FieldFilterCondition,
  type GisFeature,
  type Layer,
  type Project,
  type ProjectSnapshot,
  type WmsServiceSource,
  type WmtsServiceSource
} from '@desktop-webgis/gis-core'
import {
  parseScene,
  type SceneLayer,
  type SceneLayerStyle,
  type SceneManifest,
  type SceneSource,
  type WmsSceneSource,
  type WmtsSceneSource
} from '@desktop-webgis/scene-schema'

export interface CompileProjectOptions {
  /** Scene id (defaults to project.id). */
  sceneId?: string
  /** Scene title (defaults to project.name). */
  title?: string
  /**
   * When true (default), vector/WFS features are filtered to F before embed.
   * Filter definition is also recorded under layer metadata for transparency.
   */
  applyFilters?: boolean
  /**
   * When false, refuse any WMS/WMTS layer (explicit block).
   * Default true — emit service sources without credential values.
   */
  includeServiceLayers?: boolean
}

export interface CompileProjectResult {
  scene: SceneManifest
  /** Human-readable notes (e.g. WFS snapshot labels). */
  notes: string[]
}

export class CompileProjectError extends Error {
  readonly blockers: string[]

  constructor(blockers: string[]) {
    super(blockers.join('\n'))
    this.name = 'CompileProjectError'
    this.blockers = blockers
  }
}

function layerStyleToScene(style: Layer['style']): SceneLayerStyle {
  // LayerStyle from ol-style is structurally SceneLayerStyle after legacy migration.
  return structuredClone(style) as SceneLayerStyle
}

export function toWmsSceneSource(source: WmsServiceSource): WmsSceneSource {
  return {
    type: 'wms',
    url: source.url,
    version: source.version,
    layerNames: [...source.layerNames],
    ...(source.styleNames ? { styleNames: [...source.styleNames] } : {}),
    ...(source.format ? { format: source.format } : {}),
    ...(source.transparent !== undefined ? { transparent: source.transparent } : {}),
    ...(source.crs ? { crs: source.crs } : {}),
    ...(source.bboxWgs84 ? { bboxWgs84: [...source.bboxWgs84] as [number, number, number, number] } : {}),
    authMode: source.authMode === 'none' ? 'none' : 'runtime' // secrets never embedded
  }
}

export function toWmtsSceneSource(source: WmtsServiceSource): WmtsSceneSource {
  return {
    type: 'wmts',
    url: source.url,
    version: source.version,
    layer: source.layer,
    ...(source.style ? { style: source.style } : {}),
    ...(source.format ? { format: source.format } : {}),
    tileMatrixSet: source.tileMatrixSet,
    requestEncoding: source.requestEncoding,
    ...(source.urls ? { urls: [...source.urls] } : {}),
    ...(source.projection ? { projection: source.projection } : {}),
    ...(source.supportedCrs ? { supportedCrs: source.supportedCrs } : {}),
    ...(source.bboxWgs84 ? { bboxWgs84: [...source.bboxWgs84] as [number, number, number, number] } : {}),
    tileMatrices: source.tileMatrices.map((m) => ({ ...m, topLeftCorner: [...m.topLeftCorner] as [number, number] })),
    authMode: source.authMode === 'none' ? 'none' : 'runtime'
  }
}

function datasetById(project: Project): Map<string, Dataset> {
  return new Map(project.datasets.map((d) => [d.id, d]))
}

/**
 * Compile a persisted project snapshot into a SceneManifest v2(+WMS/WMTS).
 * Does not upload; does not embed credential values or editor layout.
 */
export function compileProjectToScene(
  snapshot: ProjectSnapshot,
  options: CompileProjectOptions = {}
): CompileProjectResult {
  const applyFilters = options.applyFilters !== false
  const includeServiceLayers = options.includeServiceLayers !== false
  const project = snapshot.project
  const notes: string[] = []
  const blockers: string[] = []

  const sources: Record<string, SceneSource> = {}
  const layers: SceneLayer[] = []
  const datasets = datasetById(project)

  // Scene render order: bottom → top. Project list is top → bottom.
  const orderedIds = [...flattenLayerIds(project)].reverse()

  for (const layerId of orderedIds) {
    const layer = project.layers.find((l) => l.id === layerId)
    if (!layer) continue
    const dataset = datasets.get(layer.datasetId)
    if (!dataset) {
      blockers.push(`图层 “${layer.name}” (${layer.id}) 缺少 Dataset “${layer.datasetId}”`)
      continue
    }

    const sourceId = `src-${dataset.id}`
    const visible = getEffectiveVisible(project, layer.id)

    if (dataset.kind === 'vector' || dataset.kind === 'wfs') {
      let features: GisFeature[] = snapshot.featuresByDataset[dataset.id] ?? []
      const filter: FieldFilterCondition[] = layer.filter ?? []
      if (applyFilters && filter.length > 0) {
        features = applyFieldFilter(features, filter)
      }

      if (dataset.kind === 'wfs') {
        notes.push(
          `图层 “${layer.name}” 发布为 WFS 快照（loadedCount=${dataset.source.loadedCount ?? features.length}，complete=${dataset.source.complete === true}），不含动态凭据`
        )
      }

      const collection = featuresToGeoJson(features)
      // Narrow to scene-schema GeoJSON shape (properties JSON-compatible).
      sources[sourceId] = {
        type: 'geojson',
        data: collection as never,
        dataProjection: 'EPSG:4326'
      }

      const meta: Record<string, unknown> = {}
      if (dataset.kind === 'wfs') {
        meta.wfsSnapshot = true
        meta.wfsTypeName = dataset.source.typeName
        meta.wfsVersion = dataset.source.version
        meta.wfsComplete = dataset.source.complete === true
        meta.wfsLoadedCount = dataset.source.loadedCount ?? features.length
        if (dataset.source.queryExtentWgs84) meta.wfsQueryExtentWgs84 = dataset.source.queryExtentWgs84
      }
      if (filter.length > 0) meta.vectorFilter = filter
      // Preserve original CRS metadata from first feature when present.
      const sourceCrs = features.find((f) => f.metadata?.sourceCrs)?.metadata?.sourceCrs
      if (sourceCrs) meta.sourceCrs = sourceCrs

      layers.push({
        id: layer.id,
        name: layer.name,
        type: 'vector',
        source: sourceId,
        visible,
        opacity: layer.opacity,
        style: layerStyleToScene(layer.style),
        ...(Object.keys(meta).length
          ? {
              // interaction reserved; stash display meta via a side channel on style? use scene metadata map instead
            }
          : {})
      })

      // Attach per-layer notes into scene.metadata.layers later
      void meta
      ;(layers[layers.length - 1] as SceneLayer & { _meta?: Record<string, unknown> })._meta = meta
      continue
    }

    if (dataset.kind === 'wms' || dataset.kind === 'wmts') {
      if (!includeServiceLayers) {
        blockers.push(`图层 “${layer.name}” 是 ${dataset.kind.toUpperCase()}，当前编译选项已禁止服务图层`)
        continue
      }
      const stripped = stripCredentialRefsFromDataset(dataset)
      if (stripped.kind === 'wms') {
        sources[sourceId] = toWmsSceneSource(stripped.source)
      } else if (stripped.kind === 'wmts') {
        sources[sourceId] = toWmtsSceneSource(stripped.source)
      }
      layers.push({
        id: layer.id,
        name: layer.name,
        type: 'tile',
        source: sourceId,
        visible,
        opacity: layer.opacity
      })
      if (dataset.source.authMode !== 'none') {
        notes.push(
          `服务图层 “${layer.name}” 需要运行时凭据（authMode=${dataset.source.authMode}）；Scene 未嵌入密钥`
        )
      }
      continue
    }

    blockers.push(`图层 “${layer.name}” 使用了无法发布的 Dataset kind`)
  }

  if (blockers.length > 0) {
    throw new CompileProjectError(blockers)
  }

  // Collect group display info (flattened for render; groups are editorial metadata).
  const groupMeta = (project.groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    visible: g.visible,
    layerIds: [...g.layerIds]
  }))

  const layerMeta: Record<string, unknown> = {}
  for (const layer of layers) {
    const extra = (layer as SceneLayer & { _meta?: Record<string, unknown> })._meta
    if (extra && Object.keys(extra).length) layerMeta[layer.id] = extra
    delete (layer as SceneLayer & { _meta?: unknown })._meta
  }

  // Basemap with embedded credential strings cannot be published silently.
  if (project.basemap.type === 'tianditu' || project.basemap.type === 'google-map-tiles') {
    blockers.push(
      `底图类型 “${project.basemap.type}” 含 credential 字段；发布前请改为 OSM/XYZ 或通过 Scene credentials 运行时注入（已显式阻止静默输出）`
    )
  }

  if (blockers.length > 0) {
    throw new CompileProjectError(blockers)
  }

  const scene = parseScene({
    version: 2,
    id: options.sceneId ?? project.id,
    title: options.title ?? project.name,
    view: {
      projection: project.crs || 'EPSG:3857',
      center: project.mapState.center,
      zoom: project.mapState.zoom,
      rotation: project.mapState.rotation
    },
    sources,
    layers,
    ...(project.city ? { city: structuredClone(project.city) } : {}),
    metadata: {
      compiledFromProjectId: project.id,
      compiledFromProjectVersion: project.version,
      layerGroups: groupMeta,
      layerMeta,
      notes
    }
  })

  return { scene, notes }
}
