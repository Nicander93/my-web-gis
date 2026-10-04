import { reprojectFeatures, pointsToCoordinateCsv, type CoordinateCsvFeature } from '@desktop-webgis/vector-io'

const features: CoordinateCsvFeature[] = [{ id: 'a', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { name: 'Station' } }]
const result: CoordinateCsvFeature[] = reprojectFeatures(features, { code: 'EPSG:4326' }, { code: 'EPSG:3857' })
const csv: string | null = pointsToCoordinateCsv(result, { code: 'EPSG:3857' }, { code: 'EPSG:4326' })
void csv
