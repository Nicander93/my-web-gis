import { summarizeByLocation, joinAttributes, checkGeometries, clipLines, addGeometryMeasurements, calculateField, compileFieldExpression, type AnalysisFeature, type GeometryCheckReport, type FieldValue } from '@desktop-webgis/spatial-analysis'

const regions: AnalysisFeature[] = [{ id: 'a', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, properties: { code: 'A' } }]
const result = summarizeByLocation(regions, [], { countField: 'count', predicate: 'within' })
const joined = joinAttributes(result, [{ code: 'A', label: '示例' }], { inputKey: 'code', joinKey: 'code', fields: ['label'], prefix: 'data_', mode: 'left' })
const count: unknown = joined[0].properties.count
void count
const diagnostics: GeometryCheckReport = checkGeometries([{ id: 'input', geometry: null }, ...regions])
void diagnostics.issues[0]?.location
const clipped: AnalysisFeature[] = clipLines([{ id: 'road', geometry: { type: 'LineString', coordinates: [[-1, 0.5], [2, 0.5]] }, properties: {} }], regions)
void clipped
const measured: AnalysisFeature[] = addGeometryMeasurements(regions, { measurement: 'area', field: 'area_km2', unit: 'square-kilometers' })
const calculated: AnalysisFeature[] = calculateField(measured, { field: 'label', expression: 'concat(field("code"), "区域")' })
const value: FieldValue = compileFieldExpression('field("area_km2")').evaluate(calculated[0].properties)
void value
