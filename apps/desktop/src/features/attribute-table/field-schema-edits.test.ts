import { beforeEach, describe, expect, it } from 'vitest'
import { createProject, createDefaultLayerStyle, SetDatasetContentCommand, type GisFeature, type Project } from '@desktop-webgis/gis-core'
import { prepareFieldSchemaEdit, type FieldSchemaEdit } from './field-schema-edits'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { useWorkbenchStore } from '@/stores/workbench.store'

const rows: GisFeature[] = [2, 4].map((value, index) => ({ id: `row-${index}`,
  geometry: { type: 'Point', coordinates: [116 + index, 39] }, properties: { value, code: '001' }, metadata: { sourceId: index } }))

function fixture(): Project {
  const project = createProject('Schema')
  project.datasets = [{ id: 'data', name: 'Schema', kind: 'vector', source: { type: 'memory', label: 'Schema' } }]
  project.layers = [{ id: 'first', name: 'First', datasetId: 'data', visible: true, editable: true, opacity: 1,
    style: { mode: 'categorized', field: 'value', categories: [{ value: 2, symbol: { type: 'circle', radius: 8 } }],
      fallback: { type: 'circle', radius: 5 }, label: { field: 'value', fontSize: 12 } },
    filter: [{ field: 'value', op: 'eq', value: 2 }], interaction: { selectable: false, popup: { titleField: 'value',
      fields: [{ field: 'value', label: '人口', format: 'number' }, { field: 'code', format: 'text' }] } } },
    { id: 'second', name: 'Second', datasetId: 'data', visible: false, editable: true, opacity: 0.4,
      style: createDefaultLayerStyle('point'), filter: [{ field: 'value', op: 'gt', value: 0 }] }]
  return project
}

function command(edit: FieldSchemaEdit) {
  const state = useProjectStore.getState()
  const result = prepareFieldSchemaEdit(state.project, 'data', state.featuresByDataset.data, edit)
  return new SetDatasetContentCommand('schema', '字段编辑', 'data', result.before, result.after, result.change)
}

describe('dataset field schema transactions', () => {
  beforeEach(() => useProjectStore.getState().loadSnapshot({ project: fixture(), featuresByDataset: { data: rows } }))

  it('validates duplicate/reserved names and default constraints before touching data, including empty datasets', () => {
    const before = useProjectStore.getState().getSnapshot()
    const project = before.project
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'rename', from: 'value', to: 'code' })).toThrow(/已存在/)
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'add', field: { name: '__proto__', type: 'number', nullable: true }, defaultValue: 0 })).toThrow(/保留/)
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'add', field: { name: 'empty', type: 'number', nullable: false }, defaultValue: null })).toThrow(/空值/)
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    const result = prepareFieldSchemaEdit(project, 'data', [], { type: 'add', field: { name: 'count', type: 'number', nullable: false }, defaultValue: 0 })
    expect(result.after.features).toEqual([])
    expect(result.after.fields).toEqual([{ name: 'count', type: 'number', nullable: false }])
  })

  it('renames all shared-layer references and table drafts as one undo while preserving unrelated state', () => {
    const before = useProjectStore.getState().getSnapshot()
    useWorkbenchStore.getState().bindTable('first'); useWorkbenchStore.getState().bindTable('second')
    useSessionStore.getState().setAttributeTableState('second', { sortField: 'value', statsField: 'value', hiddenFields: ['value'],
      fieldOrder: ['value', 'code'], scrollTop: 72, searchQuery: '001', filterDraft: [{ field: 'value', op: 'lt', value: 10 }] })
    useProjectStore.getState().setSelection({ layerId: 'first', featureIds: ['row-0'] })
    useProjectStore.getState().executeEditCommand(command({ type: 'rename', from: 'value', to: 'population' }))
    const next = useProjectStore.getState()
    expect(next.featuresByDataset.data.map((row) => row.properties)).toEqual([{ population: 2, code: '001' }, { population: 4, code: '001' }])
    expect(next.featuresByDataset.data.map((row) => ({ id: row.id, geometry: row.geometry, metadata: row.metadata })))
      .toEqual(rows.map((row) => ({ id: row.id, geometry: row.geometry, metadata: row.metadata })))
    expect(next.project.layers[0].filter?.[0].field).toBe('population')
    expect(next.project.layers[1].filter?.[0].field).toBe('population')
    expect(next.project.layers[0].interaction?.popup).toEqual({ titleField: 'population', fields: [
      { field: 'population', label: '人口', format: 'number' }, { field: 'code', format: 'text' }] })
    expect(next.project.layers[0].style).toMatchObject({ field: 'population', label: { field: 'population' } })
    expect(next.selection.featureIds).toEqual(['row-0'])
    expect(useSessionStore.getState().sessions.second.attributeTable).toMatchObject({ sortField: 'population', statsField: 'population',
      hiddenFields: ['population'], fieldOrder: ['population', 'code'], filterDraft: [{ field: 'population', op: 'lt', value: 10 }], scrollTop: 72, searchQuery: '001' })
    expect(next.undoEdit()).toBe(true)
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().canUndoEdit()).toBe(false)
    expect(useSessionStore.getState().sessions.second.attributeTable?.sortField).toBe('value')
    expect(useProjectStore.getState().redoEdit()).toBe(true)
    expect(useWorkbenchStore.getState().tableLayerIds).toEqual(['first', 'second'])
  })

  it('blocks referenced deletion, explicitly clears configurations, and restores them with their values on undo', () => {
    const before = useProjectStore.getState().getSnapshot()
    expect(() => command({ type: 'remove', name: 'value', clearReferences: false })).toThrow(/仍被引用/)
    expect(useProjectStore.getState().canUndoEdit()).toBe(false)
    useProjectStore.getState().executeEditCommand(command({ type: 'remove', name: 'value', clearReferences: true }))
    const state = useProjectStore.getState()
    expect(state.project.layers[0].style).toEqual({ mode: 'single', symbol: { type: 'circle', radius: 5 } })
    expect(state.project.layers.map((layer) => layer.filter)).toEqual([[], []])
    expect(state.project.layers[0].interaction).toEqual({ selectable: false, popup: { fields: [{ field: 'code', format: 'text' }] } })
    expect(state.featuresByDataset.data.map((row) => row.properties)).toEqual([{ code: '001' }, { code: '001' }])
    expect(state.undoEdit()).toBe(true)
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  })

  it('protects unapplied style drafts during execution and history recovery', () => {
    const edit = command({ type: 'rename', from: 'value', to: 'population' })
    useSessionStore.getState().setStyleDraft('second', { style: { mode: 'single', symbol: { type: 'circle', radius: 10 } },
      dirty: true, classCount: 5, colorRampId: 'BlueRed' })
    const before = useProjectStore.getState().getSnapshot()
    expect(() => useProjectStore.getState().executeEditCommand(edit)).toThrow(/样式草稿/)
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().canUndoEdit()).toBe(false)
    useSessionStore.getState().patchStyleDraft('second', { dirty: false })
    useProjectStore.getState().executeEditCommand(edit)
    useSessionStore.getState().patchStyleDraft('second', { dirty: true })
    expect(useProjectStore.getState().getHistoryBlockReason('undo')).toMatch(/字段编辑/)
    expect(useProjectStore.getState().undoEdit()).toBe(false)
  })

  it('adds typed defaults to every feature and preserves the string value on undo/redo', () => {
    useProjectStore.getState().executeEditCommand(command({ type: 'add', field: { name: 'externalId', type: 'string', nullable: false }, defaultValue: '0007' }))
    expect(useProjectStore.getState().featuresByDataset.data.map((row) => row.properties.externalId)).toEqual(['0007', '0007'])
    expect(useProjectStore.getState().undoEdit()).toBe(true)
    expect(useProjectStore.getState().featuresByDataset.data).toEqual(rows)
    expect(useProjectStore.getState().redoEdit()).toBe(true)
    expect(useProjectStore.getState().project.datasets[0].fields?.find((field) => field.name === 'externalId')?.nullable).toBe(false)
  })

  it('refuses schema changes through another view when a shared layer inherits a folder lock', () => {
    const project = fixture()
    project.groups = [{ id: 'locked', name: 'Locked', visible: true, locked: true, layerIds: ['second'] }]
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'rename', from: 'value', to: 'population' })).toThrow(/Second 已锁定/)
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'add', field: { name: 'added', type: 'number', nullable: true }, defaultValue: null })).toThrow(/Second 已锁定/)
  })
})
