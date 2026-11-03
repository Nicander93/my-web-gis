import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { featureData } from '@/data/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, expect, it } from 'vitest'
import { createProject, createDefaultLayerStyle, parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { useLayerViewStore } from '@/view-state/layer-view.store'
import { useWorkbenchStore } from '@/view-state/workbench.store'
import type { ImportResult } from '@/exchange/import'
import { commitLocalImport, prepareLocalImport } from './local-import-command'

const result = (): ImportResult => ({ errors: [], layers: ['First', 'Second'].map((name) => ({ name,
  features: [{ id: name, properties: { code: '001', value: 2 }, geometry: { type: 'Point', coordinates: [116, 39] } }],
  styleKind: 'point', warnings: [] })) })

beforeEach(() => {
  const project = createProject('Import')
  requireMapContent(project).datasets = [{ id: 'existing-data', name: 'Existing', kind: 'vector', source: { type: 'memory', label: 'Existing' } }]
  requireMapContent(project).layers = [{ id: 'existing', datasetId: 'existing-data', name: 'Existing', visible: true, opacity: 1,
    editable: false, style: createDefaultLayerStyle('point') }]
  projectSession.loadSnapshot({ project, featuresByDataset: { 'existing-data': [] } })
  useLayerViewStore.getState().setSelectedLayer('existing')
  useWorkbenchStore.getState().setEditLayer('existing')
  useLayerViewStore.getState().setAttributeTableState('existing', { searchQuery: 'draft', columnWidths: { code: 232 } })
})

it('imports a whole selection as one history step while preserving existing edit targets and table sessions', () => {
  const before = projectSession.getSnapshot()
  const session = useLayerViewStore.getState().sessions.existing
  const preview = result()
  commitLocalImport(preview)
  const after = projectSession.getSnapshot()
  expect(requireMapContent(after.project).layers).toHaveLength(3)
  expect(useWorkbenchStore.getState().editLayerId).toBe('existing')
  expect(useLayerViewStore.getState().sessions.existing).toEqual(session)
  expect(parseProjectSnapshot(serializeProjectSnapshot(after))).toEqual(after)
  preview.layers[0].features[0].properties.code = 'mutated preview'
  expect(Object.values(featureData.readSnapshot()).flat()[0].properties.code).toBe('001')
  expect(projectEdits.undo()).toBe(true)
  expect(projectSession.getSnapshot()).toEqual(before)
  expect(useLayerViewStore.getState().selectedLayerId).toBe('existing')
  expect(projectEdits.canUndo()).toBe(false)
  expect(useLayerViewStore.getState().sessions.existing).toEqual(session)
  expect(projectEdits.redo()).toBe(true)
  expect(projectSession.getSnapshot()).toEqual(after)
})

it('rejects a malformed second layer or batch error without writing the valid first layer', () => {
  const before = projectSession.getSnapshot(), session = useLayerViewStore.getState().sessions.existing
  const bad = result(); bad.layers[1].features.push(bad.layers[1].features[0])
  expect(() => commitLocalImport(bad)).toThrow(/ID.*重复/)
  expect(() => commitLocalImport({ ...result(), errors: ['Second layer failed'] })).toThrow('Second layer failed')
  expect(projectSession.getSnapshot()).toEqual(before)
  expect(useLayerViewStore.getState().sessions.existing).toEqual(session)
  expect(projectEdits.canUndo()).toBe(false)
})

it('rejects empty selections before any command is created', () => {
  expect(() => prepareLocalImport(projectSession.getSnapshot(), { layers: [], errors: [] })).toThrow(/没有可导入/)
  expect(projectEdits.canUndo()).toBe(false)
})

it('keeps earlier immediate styles and table sessions when undoing an import', () => {
  layerConfigurationCommands.setLayerStyle('existing', { mode: 'single', symbol: { type: 'circle', radius: 12 } })
  const before = projectSession.getSnapshot()
  const session = structuredClone(useLayerViewStore.getState().sessions.existing)
  commitLocalImport(result())
  expect(projectEdits.getBlockReason('undo')).toBeNull()
  expect(projectEdits.undo()).toBe(true)
  expect(projectSession.getSnapshot()).toEqual(before)
  expect(useLayerViewStore.getState().sessions.existing).toEqual(session)
})
