import { fromLonLat } from 'ol/proj.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import LineString from 'ol/geom/LineString.js'
import Polygon from 'ol/geom/Polygon.js'
import VectorSource from 'ol/source/Vector.js'
import type { MapLibreStyleSpecification } from '@desktop-webgis/ol-style/cartography'

const projectCoordinates = (coordinates: number[][]) => coordinates.map((coordinate) => fromLonLat(coordinate))

function createFeature<T extends Point | LineString | Polygon>(id: string, geometry: T, properties: Record<string, unknown>) {
  const feature = new Feature({ geometry, ...properties })
  feature.setId(id)
  return feature
}

export function createCartographySources() {
  const roads = new VectorSource({ features: [
    createFeature('road-main-west-east', new LineString(projectCoordinates([[121.460, 31.226], [121.484, 31.226]])), { kind: 'primary', name: '人民路 Renmin Road' }),
    createFeature('road-main-north-south', new LineString(projectCoordinates([[121.472, 31.214], [121.472, 31.238]])), { kind: 'primary', name: '中山路 Zhongshan Road' }),
    createFeature('road-local', new LineString(projectCoordinates([[121.460, 31.218], [121.484, 31.234]])), { kind: 'local', name: '支路 Local Road' }),
  ] })
  const rivers = new VectorSource({ features: [
    createFeature('river-canal', new LineString(projectCoordinates([[121.458, 31.233], [121.486, 31.233]])), { kind: 'canal', name: '苏州河 Suzhou Creek' }),
  ] })
  const parcels = new VectorSource({ features: [
    createFeature('parcel-park', new Polygon([[
      fromLonLat([121.469, 31.227]), fromLonLat([121.471, 31.227]),
      fromLonLat([121.471, 31.229]), fromLonLat([121.469, 31.229]),
      fromLonLat([121.469, 31.227]),
    ]]), { kind: 'park', name: '滨河公园 Riverside Park' }),
  ] })
  const places = new VectorSource({ features: [
    createFeature('poi-clinic', new Point(fromLonLat([121.473, 31.227])), { kind: 'clinic', name: '社区医院 Community Clinic' }),
  ] })
  return { roads, rivers, parcels, places }
}

export const cartographyStyle: MapLibreStyleSpecification = {
  version: 8,
  name: 'P0 local cartography fixture',
  sprite: '/cartography-assets/sprite',
  sources: {
    roads: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    rivers: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    parcels: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    places: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [
    { id: 'parcel-pattern', type: 'fill', source: 'parcels', filter: ['==', ['get', 'kind'], 'park'], paint: { 'fill-color': '#d8efd8', 'fill-pattern': 'park-hatch', 'fill-opacity': 0.78 } },
    { id: 'river-casing', type: 'line', source: 'rivers', paint: { 'line-color': '#ffffff', 'line-width': 6 } },
    { id: 'river-water', type: 'line', source: 'rivers', paint: { 'line-color': '#2b86ba', 'line-width': 3.5 } },
    { id: 'road-casing', type: 'line', source: 'roads', paint: { 'line-color': '#fffdf7', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 11] } },
    { id: 'road-inner', type: 'line', source: 'roads', paint: { 'line-color': ['match', ['get', 'kind'], 'primary', '#ce7247', '#e3a94b'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 5] } },
    { id: 'road-labels', type: 'symbol', source: 'roads', layout: { 'symbol-placement': 'line', 'symbol-spacing': 250, 'text-field': ['get', 'name'], 'text-font': ['Segoe UI Regular'], 'text-size': 11, 'text-keep-upright': true }, paint: { 'text-color': '#433f38', 'text-halo-color': '#fffdf7', 'text-halo-width': 2 } },
    { id: 'poi-icon', type: 'symbol', source: 'places', layout: { 'icon-image': 'local-clinic', 'icon-size': 0.8, 'icon-allow-overlap': true, 'text-field': ['get', 'name'], 'text-font': ['Segoe UI Regular'], 'text-size': 10, 'text-offset': [0, 1.3] }, paint: { 'text-color': '#7f2a45', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } },
  ],
}
