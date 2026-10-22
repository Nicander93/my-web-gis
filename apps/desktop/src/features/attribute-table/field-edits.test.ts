import { beforeEach, describe, expect, it } from 'vitest'
import { createProject, createDefaultLayerStyle, SetDatasetContentCommand, type GisFeature } from '@desktop-webgis/gis-core'
import { calculateTableField, parseCellValue, previewTableField, resolveDatasetFields, resolveFieldCalculationTargets } from './field-edits'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { useWorkbenchStore } from '@/stores/workbench.store'

const features: GisFeature[] = [2, 0, 4].map((value, index) => ({ id: `row-${index}`,
  geometry: { type: 'Point', coordinates: [116 + index, 39] }, properties: { value, code: '001' } }))
const numeric = { name: 'result', type: 'number' as const, nullable: true }

describe('typed table edits', () => {
  it('rejects a late invalid row without mutating any feature or schema', () => {
    const before = structuredClone(features)
    expect(() => calculateTableField(features, undefined, numeric, '10 / field("value")',
      new Set(features.map((feature) => feature.id)))).toThrow(/row-1/)
    expect(features).toEqual(before)
    expect(resolveDatasetFields(features).some((field) => field.name === 'result')).toBe(false)
  })
  it('preserves IDs, geometry and rows outside the exact selected scope', () => {
    const result = calculateTableField(features, undefined, numeric, 'field("value") * 3', new Set(['row-2']))
    expect(result.count).toBe(1)
    expect(result.features.map((feature) => feature.properties.result)).toEqual([null, null, 12])
    expect(result.features.map((feature) => feature.id)).toEqual(features.map((feature) => feature.id))
    expect(result.features.map((feature) => feature.geometry)).toEqual(features.map((feature) => feature.geometry))
    expect(() => calculateTableField(features, undefined, { ...numeric, nullable: false }, '1', new Set(['row-2']))).toThrow(/空值/)
  })
  it('validates declared types, reserved fields, missing references and empty scope', () => {
    expect(parseCellValue({ name: 'code', type: 'string', nullable: false }, '001')).toBe('001')
    expect(() => parseCellValue(numeric, 'NaN')).toThrow(/有限数值/)
    expect(() => calculateTableField(features, undefined, numeric, 'field("missing")', new Set(['row-0']))).toThrow(/不存在/)
    expect(() => calculateTableField(features, undefined, { ...numeric, name: '__proto__' }, '1', new Set(['row-0']))).toThrow(/保留/)
    expect(() => calculateTableField(features, undefined, numeric, '1', new Set())).toThrow(/没有/)
    expect(() => calculateTableField(features, [numeric], { ...numeric, type: 'string' }, '"x"', new Set(['row-0']))).toThrow(/类型/)
  })

  it('resolves calculator scopes from table results, project filters and selection independently', () => {
    const tableRows = [features[2]]
    const selectedIds = new Set(['row-0'])
    const layerFilter = [{ field: 'value', op: 'gt' as const, value: 1 }]
    expect(resolveFieldCalculationTargets('all', features, tableRows, layerFilter, selectedIds).map((row) => row.id))
      .toEqual(['row-0', 'row-1', 'row-2'])
    expect(resolveFieldCalculationTargets('table', features, tableRows, layerFilter, selectedIds).map((row) => row.id))
      .toEqual(['row-2'])
    expect(resolveFieldCalculationTargets('layer-filtered', features, tableRows, layerFilter, selectedIds).map((row) => row.id))
      .toEqual(['row-0', 'row-2'])
    expect(resolveFieldCalculationTargets('selected', features, tableRows, layerFilter, selectedIds).map((row) => row.id))
      .toEqual(['row-0'])
    expect(features.map((row) => row.properties.value)).toEqual([2, 0, 4])
  })

  it('previews real expression results for five rows and reports a row error without mutating data', () => {
    const original = structuredClone(features)
    const preview = previewTableField(features, features, numeric, '10 / field("value")')
    expect(preview).toEqual([
      { index: 1, value: 5 },
      { index: 2, error: expect.stringContaining('除数不能为零') },
      { index: 3, value: 2.5 }
    ])
    expect(features).toEqual(original)
  })
})

describe('atomic field history and table sessions', () => {
  beforeEach(() => {
    const project = createProject('Fields')
    project.datasets = [{ id: 'dataset', name: 'Fields', kind: 'vector', source: { type: 'memory', label: 'Fields' } }]
    project.layers = [{ id: 'layer', datasetId: 'dataset', name: 'Fields', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
    useProjectStore.getState().loadSnapshot({ project, featuresByDataset: { dataset: features } })
  })
  it('undoes and redoes fields plus all rows once without clearing bound tabs or scroll', () => {
    useWorkbenchStore.getState().bindTable('layer')
    useSessionStore.getState().setAttributeTableState('layer', { searchQuery: '001', scrollTop: 70, fieldOrder: ['code', 'value'] })
    const result = calculateTableField(features, undefined, numeric, 'field("value") + 5', new Set(features.map((feature) => feature.id)))
    useProjectStore.getState().executeEditCommand(new SetDatasetContentCommand('calc', '字段计算', 'dataset', { features }, result))
    expect(useProjectStore.getState().featuresByDataset.dataset[0].properties.result).toBe(7)
    expect(useProjectStore.getState().undoEdit()).toBe(true)
    expect(useProjectStore.getState().featuresByDataset.dataset).toEqual(features)
    expect(useProjectStore.getState().project.datasets[0].fields).toBeUndefined()
    expect(useProjectStore.getState().canUndoEdit()).toBe(false)
    expect(useProjectStore.getState().redoEdit()).toBe(true)
    expect(useProjectStore.getState().project.datasets[0].fields?.find((field) => field.name === 'result')).toEqual(numeric)
    expect(useWorkbenchStore.getState().tableLayerIds).toEqual(['layer'])
    expect(useSessionStore.getState().sessions.layer.attributeTable?.scrollTop).toBe(70)
  })
  it('closes and removes only the target tab and selects an adjacent one', () => {
    const workbench = useWorkbenchStore.getState()
    workbench.bindTable('layer'); workbench.bindTable('second'); workbench.bindTable('third')
    workbench.bindTable('second'); workbench.closeTable('second')
    expect(useWorkbenchStore.getState().tableLayerId).toBe('third')
    workbench.clearLayer('third')
    expect(useWorkbenchStore.getState().tableLayerIds).toEqual(['layer'])
    expect(useWorkbenchStore.getState().tableLayerId).toBe('layer')
  })
})
