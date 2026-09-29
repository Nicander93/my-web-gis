import GeoJSON from 'ol/format/GeoJSON'
import GML2 from 'ol/format/GML2'
import GML3 from 'ol/format/GML3'
import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import type { GisFeature } from '@desktop-webgis/gis-core'
import { createId } from '@desktop-webgis/gis-core'

const geoJson4326 = new GeoJSON({
  dataProjection: 'EPSG:4326',
  featureProjection: 'EPSG:4326'
})

function olFeatureToGis(feature: Feature<Geometry>, importId?: string): GisFeature {
  const json = geoJson4326.writeFeatureObject(feature, {
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:4326'
  }) as {
    id?: string | number
    geometry: GisFeature['geometry'] | null
    properties?: Record<string, unknown>
  }
  if (!json.geometry) {
    throw new Error('empty geometry')
  }
  const sourceId = feature.getId() ?? json.id
  return {
    id: sourceId !== undefined && sourceId !== null ? String(sourceId) : createId('wfs'),
    geometry: json.geometry,
    properties: { ...(json.properties ?? {}) },
    metadata: {
      sourceId: sourceId as string | number | undefined,
      sourceCrs: 'EPSG:4326',
      importId
    }
  }
}

/**
 * Parse WFS GML (2/3) response into GisFeatures (stored EPSG:4326).
 * GeoJSON responses should use gis-core parseGeoJsonFeatures instead.
 */
export function parseWfsGmlFeatures(
  body: string,
  options: { srsName?: string; importId?: string } = {}
): { features: GisFeature[]; warnings: string[] } {
  const warnings: string[] = []
  const dataProjection = options.srsName || 'EPSG:4326'
  const formats = [
    new GML3({ srsName: dataProjection }),
    new GML2({ srsName: dataProjection })
  ]

  let olFeatures: Feature<Geometry>[] | null = null
  let lastError: string | undefined
  for (const format of formats) {
    try {
      const read = format.readFeatures(body, {
        dataProjection,
        featureProjection: 'EPSG:4326'
      }) as Feature<Geometry>[]
      if (read) {
        olFeatures = read
        break
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  if (!olFeatures) {
    warnings.push(lastError ? `GML 解析失败: ${lastError}` : 'GML 解析失败')
    return { features: [], warnings }
  }

  const features: GisFeature[] = []
  for (const olFeature of olFeatures) {
    try {
      features.push(olFeatureToGis(olFeature, options.importId))
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err))
    }
  }
  return { features, warnings }
}
