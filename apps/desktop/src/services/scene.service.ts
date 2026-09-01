import {
  createDefaultLayerStyle,
  createId,
  createProject,
  featuresToGeoJson,
  inferLayerStyleKind,
  parseGeoJsonFeatures,
  type BasemapConfig,
  type GisFeature,
  type LayerStyle,
  type Project,
  type ProjectSnapshot
} from '@desktop-webgis/gis-core'
import { serializeScene } from '@desktop-webgis/scene-core'
import {
  parseScene,
  type GeoJsonFeatureCollection,
  type SceneManifest,
  type SceneSource,
  type SceneStyle,
  type VectorLayer
} from '@desktop-webgis/scene-schema'

export function projectToScene(
  project: Project,
  featuresByDataset: Record<string, GisFeature[]>,
  colorScheme: 'light' | 'dark' | 'system' = 'system'
): SceneManifest {
  const sources: Record<string, SceneSource> = { basemap: basemapToSceneSource(project.basemap) }
  const credentials: NonNullable<SceneManifest['credentials']> = {}
  if (project.basemap.type === 'tianditu' || project.basemap.type === 'google-map-tiles') {
    credentials[project.basemap.credential] = {
      type: 'runtime-reference',
      key: project.basemap.credential
    }
  }

  const layers: SceneManifest['layers'] = [
    { id: 'basemap', name: '底图', type: 'tile', source: 'basemap', role: 'basemap' }
  ]
  for (const layer of project.layers) {
    const sourceId = `dataset-${layer.datasetId}`
    if (!sources[sourceId]) {
      sources[sourceId] = {
        type: 'geojson',
        dataProjection: 'EPSG:4326',
        data: featuresToGeoJson(featuresByDataset[layer.datasetId] ?? []) as GeoJsonFeatureCollection
      }
    }
    layers.push({
      id: layer.id,
      name: layer.name,
      type: 'vector',
      source: sourceId,
      visible: layer.visible,
      opacity: layer.opacity,
      role: 'overlay',
      style: layerStyleToSceneStyle(layer.style, featuresByDataset[layer.datasetId] ?? []),
      interaction: { selectable: true }
    })
  }

  return parseScene({
    version: 1,
    id: project.id,
    title: project.name,
    view: { projection: project.crs, ...project.mapState },
    credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
    sources,
    layers,
    widgets: { layerSwitcher: true, legend: true, scaleLine: true, fullscreen: true, zoom: true },
    theme: { colorScheme, preset: 'report', surface: 'solid' }
  })
}

export function serializeProjectScene(
  project: Project,
  featuresByDataset: Record<string, GisFeature[]>,
  colorScheme: 'light' | 'dark' | 'system' = 'system'
): string {
  return serializeScene(projectToScene(project, featuresByDataset, colorScheme))
}

export async function sceneToProjectSnapshot(
  input: string | unknown,
  fetcher: typeof globalThis.fetch = globalThis.fetch
): Promise<ProjectSnapshot> {
  const scene = parseScene(typeof input === 'string' ? JSON.parse(input) : input)
  if (scene.view.projection !== 'EPSG:3857') {
    throw new Error('编辑器当前仅支持打开 EPSG:3857 场景。')
  }
  const project = createProject(scene.title)
  project.id = scene.id
  project.mapState = {
    center: scene.view.center,
    zoom: scene.view.zoom,
    rotation: scene.view.rotation ?? 0
  }
  const basemapLayer = scene.layers.find((layer) => layer.type === 'tile' && layer.role === 'basemap')
  if (basemapLayer?.type === 'tile') {
    const source = scene.sources[basemapLayer.source]
    if (source) project.basemap = sceneSourceToBasemap(source)
  }

  const featuresByDataset: Record<string, GisFeature[]> = {}
  const datasetBySource = new Map<string, string>()
  for (const sceneLayer of scene.layers) {
    if (sceneLayer.type !== 'vector') continue
    const source = scene.sources[sceneLayer.source]
    if (!source || source.type !== 'geojson') continue
    let datasetId = datasetBySource.get(sceneLayer.source)
    if (!datasetId) {
      datasetId = createId('dataset')
      datasetBySource.set(sceneLayer.source, datasetId)
      const data = source.data ?? (await fetchGeoJson(source.url, fetcher))
      const features = parseGeoJsonFeatures(data)
      featuresByDataset[datasetId] = features
      project.datasets.push({
        id: datasetId,
        name: sceneLayer.name,
        kind: 'vector',
        source: source.url ? { type: 'geojson-url', url: source.url } : { type: 'memory', label: sceneLayer.name }
      })
    }
    const features = featuresByDataset[datasetId] ?? []
    project.layers.push({
      id: sceneLayer.id,
      datasetId,
      name: sceneLayer.name,
      visible: sceneLayer.visible ?? true,
      opacity: sceneLayer.opacity ?? 1,
      editable: true,
      style: sceneStyleToLayerStyle(sceneLayer, features)
    })
  }
  return { project, featuresByDataset }
}

function basemapToSceneSource(config: BasemapConfig): SceneSource {
  if (config.type === 'osm') {
    return {
      type: 'xyz',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }
  }
  if (config.type === 'xyz') {
    return { type: 'xyz', url: config.url, attribution: config.attribution, maxZoom: config.maxZoom }
  }
  if (config.type === 'tianditu') {
    return {
      type: 'provider',
      provider: 'tianditu',
      mapType: config.mapType,
      projection: config.projection,
      withLabels: config.withLabels,
      credential: config.credential
    }
  }
  return {
    type: 'provider',
    provider: 'google-map-tiles',
    mapType: config.mapType,
    language: config.language,
    region: config.region,
    credential: config.credential
  }
}

function sceneSourceToBasemap(source: SceneSource): BasemapConfig {
  if (source.type === 'xyz') {
    if (source.url.includes('tile.openstreetmap.org')) return { type: 'osm' }
    return { type: 'xyz', url: source.url, attribution: source.attribution, maxZoom: source.maxZoom }
  }
  if (source.type !== 'provider') return { type: 'osm' }
  if (source.provider === 'tianditu') {
    return {
      type: 'tianditu',
      mapType: source.mapType,
      projection: source.projection,
      withLabels: source.withLabels,
      credential: source.credential
    }
  }
  return {
    type: 'google-map-tiles',
    mapType: source.mapType,
    language: source.language,
    region: source.region,
    credential: source.credential
  }
}

function layerStyleToSceneStyle(style: LayerStyle, features: GisFeature[]): SceneStyle {
  const kind = style.kind === 'mixed' ? inferLayerStyleKind(features) : style.kind
  if (kind === 'point') {
    return { type: 'point', radius: style.pointRadius, fill: style.fill, stroke: style.stroke, strokeWidth: style.width }
  }
  if (kind === 'line') return { type: 'line', color: style.stroke, width: style.width }
  return { type: 'polygon', fill: style.fill, stroke: style.stroke, strokeWidth: style.width }
}

function sceneStyleToLayerStyle(layer: VectorLayer, features: GisFeature[]): LayerStyle {
  const kind = layer.style.type === 'point' ? 'point' : layer.style.type === 'line' ? 'line' : 'polygon'
  const defaults = createDefaultLayerStyle(features.length > 0 ? inferLayerStyleKind(features) : kind)
  if (layer.style.type === 'point') {
    return {
      ...defaults,
      kind,
      fill: layer.style.fill,
      stroke: layer.style.stroke ?? defaults.stroke,
      width: layer.style.strokeWidth ?? defaults.width,
      pointRadius: layer.style.radius
    }
  }
  if (layer.style.type === 'line') return { ...defaults, kind, stroke: layer.style.color, width: layer.style.width }
  return {
    ...defaults,
    kind,
    fill: layer.style.fill,
    stroke: layer.style.stroke,
    width: layer.style.strokeWidth
  }
}

async function fetchGeoJson(url: string | undefined, fetcher: typeof globalThis.fetch): Promise<unknown> {
  if (!url) throw new Error('GeoJSON Source 缺少 data 或 url。')
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`GeoJSON 加载失败：HTTP ${response.status}`)
  return response.json()
}
