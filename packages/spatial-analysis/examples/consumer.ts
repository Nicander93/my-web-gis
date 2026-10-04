import { summarizeByLocation, joinAttributes, checkGeometries, type AnalysisFeature, type GeometryCheckReport } from '@desktop-webgis/spatial-analysis'

const regions: AnalysisFeature[] = [{ id: 'a', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, properties: { code: 'A' } }]
const result = summarizeByLocation(regions, [], { countField: 'count', predicate: 'within' })
const joined = joinAttributes(result, [{ code: 'A', label: '示例' }], { inputKey: 'code', joinKey: 'code', fields: ['label'], prefix: 'data_', mode: 'left' })
const count: unknown = joined[0].properties.count
void count
const diagnostics: GeometryCheckReport = checkGeometries([{ id: 'input', geometry: null }, ...regions])
void diagnostics.issues[0]?.location
