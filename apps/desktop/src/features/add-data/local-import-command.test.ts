import { beforeEach, expect, it } from 'vitest'
import { createProject, createDefaultLayerStyle, parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import type { ImportResult } from '@/services/import'
import { commitLocalImport, prepareLocalImport } from './local-import-command'

const result = (): ImportResult => ({ errors: [], layers: ['First', 'Second'].map((name) => ({ name,
  features: [{ id: name, properties: { code: '001', value: 2 }, geometry: { type: 'Point', coordinates: [116, 39] } }],
  styleKind: 'point', warnings: [] })) })

beforeEach(() => {
  const project = createProject('Import')
  project.datasets = [{ id: 'existing-data', name: 'Existing', kind: 'vector', source: { type: 'memory', label: 'Existing' } }]
  project.layers = [{ id: 'existing', datasetId: 'existing-data', name: 'Existing', visible: true, opacity: 1,
    editable: false, style: createDefaultLayerStyle('point') }]
  useProjectStore.getState().loadSnapshot({ project, featuresByDataset: { 'existing-data': [] } })
  useProjectStore.getState().setSelectedLayer('existing')
  useWorkbenchStore.getState().setEditLayer('existing')
  useSessionStore.getState().setAttributeTableState('existing', { searchQuery: 'draft', columnWidths: { code: 232 } })
})

it('imports a whole selection as one history step while preserving existing edit targets and table sessions', () => {
  const before = useProjectStore.getState().getSnapshot()
  const session = useSessionStore.getState().sessions.existing
  const preview = result()
  commitLocalImport(preview)
  const after = useProjectStore.getState().getSnapshot()
  expect(after.project.layers).toHaveLength(3)
  expect(useWorkbenchStore.getState().editLayerId).toBe('existing')
  expect(useSessionStore.getState().sessions.existing).toEqual(session)
  expect(parseProjectSnapshot(serializeProjectSnapshot(after))).toEqual(after)
  preview.layers[0].features[0].properties.code = 'mutated preview'
  expect(Object.values(useProjectStore.getState().featuresByDataset).flat()[0].properties.code).toBe('001')
  expect(useProjectStore.getState().undoEdit()).toBe(true)
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  expect(useProjectStore.getState().selectedLayerId).toBe('existing')
  expect(useProjectStore.getState().canUndoEdit()).toBe(false)
  expect(useSessionStore.getState().sessions.existing).toEqual(session)
  expect(useProjectStore.getState().redoEdit()).toBe(true)
  expect(useProjectStore.getState().getSnapshot()).toEqual(after)
})

it('rejects a malformed second layer or batch error without writing the valid first layer', () => {
  const before = useProjectStore.getState().getSnapshot(), session = useSessionStore.getState().sessions.existing
  const bad = result(); bad.layers[1].features.push(bad.layers[1].features[0])
  expect(() => commitLocalImport(bad)).toThrow(/ID.*重复/)
  expect(() => commitLocalImport({ ...result(), errors: ['Second layer failed'] })).toThrow('Second layer failed')
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  expect(useSessionStore.getState().sessions.existing).toEqual(session)
  expect(useProjectStore.getState().canUndoEdit()).toBe(false)
})

it('rejects empty selections before any command is created', () => {
  expect(() => prepareLocalImport(useProjectStore.getState().getSnapshot(), { layers: [], errors: [] })).toThrow(/没有可导入/)
  expect(useProjectStore.getState().canUndoEdit()).toBe(false)
})

it('blocks undo only for imported layers with dirty style drafts, preserving unrelated drafts', () => {
  const state = useProjectStore.getState()
  useSessionStore.getState().setStyleDraft('existing', { style: state.getNormalizedLayerStyle('existing')!,
    dirty: true, classCount: 5, colorRampId: 'BlueRed' })
  commitLocalImport(result())
  expect(useProjectStore.getState().getHistoryBlockReason('undo')).toBeNull()
  const imported = useProjectStore.getState().project.layers.at(-1)!
  useSessionStore.getState().setStyleDraft(imported.id, { style: state.getNormalizedLayerStyle(imported.id)!, dirty: true, classCount: 5, colorRampId: 'BlueRed' })
  const after = useProjectStore.getState().getSnapshot()
  expect(useProjectStore.getState().undoEdit()).toBe(false)
  expect(useProjectStore.getState().getSnapshot()).toEqual(after)
})
