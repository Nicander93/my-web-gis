import type { GisFeature } from '@desktop-webgis/gis-core'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import type Geometry from 'ol/geom/Geometry'

const geoJsonFormat = new GeoJSON({
  dataProjection: 'EPSG:4326',
  featureProjection: 'EPSG:3857'
})

export function toOlFeature(feature: GisFeature, projection = 'EPSG:3857'): Feature<Geometry> {
  const olFeature = geoJsonFormat.readFeature(
    {
      type: 'Feature',
      id: feature.id,
      geometry: feature.geometry,
      properties: feature.properties
    },
    {
      dataProjection: 'EPSG:4326',
      featureProjection: projection
    }
  ) as Feature<Geometry>
  olFeature.setId(feature.id)
  olFeature.set('domainFeatureId', feature.id)
  return olFeature
}

export function fromOlFeature(feature: Feature<Geometry>, projection = 'EPSG:3857'): GisFeature {
  const json = geoJsonFormat.writeFeatureObject(feature, {
    dataProjection: 'EPSG:4326',
    featureProjection: projection
  })
  if (!json.geometry || json.geometry.type === 'GeometryCollection') {
    throw new Error('Unsupported or empty geometry')
  }

  const properties = { ...(json.properties ?? {}) }
  delete properties.domainFeatureId

  return {
    id: String(feature.getId() ?? feature.get('domainFeatureId') ?? json.id),
    geometry: json.geometry as GisFeature['geometry'],
    properties
  }
}
