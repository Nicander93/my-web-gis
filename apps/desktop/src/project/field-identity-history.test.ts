import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneValue, createId, createProject, MemoryFeatureProvider, requireMapContent, SetDatasetContentCommand, type GisFeature, type ProjectEditContext } from '@desktop-webgis/project'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { prepareFieldSchemaEdit, type FieldSchemaEdit } from '@/ui/panels/attribute-table/field-schema-edits'
import { useProjectStore } from '@/project/project.store'
import { projectSession } from './project-session'
import { projectEdits } from './project-edits'
import { featureData } from '@/project/datasets/feature-data'
const row = (left = 1, right = 2): GisFeature => ({ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { left, right } })
beforeEach(() => { projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} }); layerContentCommands.addLayer('data', 'Data', [row()], 'point'); projectEdits.clear() })
function apply(edit: FieldSchemaEdit) {
  const prepared = prepareFieldSchemaEdit(useProjectStore.getState().project, 'data', featureData.getAll('data'), edit)
  projectEdits.execute(new SetDatasetContentCommand(createId('schema'), 'Schema', 'data', prepared.before, prepared.after, prepared.change))
}
describe('runtime column identity and existing schema history', () => {
  it('retires properties removed by a same-project snapshot and restores their identities on undo', () => {
    const original = featureData.getFieldNamespace('data')!
    const snapshot = projectSession.getSnapshot()
    delete snapshot.featuresByDataset.data[0].properties.right
    projectSession.applySnapshotAsEdit(snapshot, 'Remove implicit property')
    expect([...featureData.getFieldNamespace('data')!.fields.keys()]).toEqual(['left'])
    expect(projectEdits.undo()).toBe(true)
    expect([...featureData.getFieldNamespace('data')!.fields]).toEqual([...original.fields])
    expect(projectEdits.redo()).toBe(true)
    expect([...featureData.getFieldNamespace('data')!.fields.keys()]).toEqual(['left'])
  })

  it('distinguishes the removed column from another column renamed to its old name', () => {
    const original = featureData.getFieldNamespace('data')!
    apply({ type: 'remove', name: 'right', clearReferences: true })
    apply({ type: 'rename', from: 'left', to: 'right' })
    const current = featureData.getFieldNamespace('data')!
    expect(current.fields.get('right')).toBe(original.fields.get('left'))
    expect([...current.fields.values()]).not.toContain(original.fields.get('right'))
    expect(featureData.getById('data', 'row')!.properties).toEqual({ right: 1 })
    expect(projectEdits.undo()).toBe(true); expect(projectEdits.undo()).toBe(true)
    expect([...featureData.getFieldNamespace('data')!.fields]).toEqual([...original.fields])
    expect(projectEdits.redo()).toBe(true); expect(projectEdits.redo()).toBe(true)
    expect(featureData.getFieldNamespace('data')!.fields.get('right')).toBe(original.fields.get('left'))
  })

  it('rejects configuration commands that would bypass source schema ownership', () => {
    const before = useProjectStore.getState(), namespace = featureData.getFieldNamespace('data')!
    expect(() => projectEdits.execute({
      id: 'bypass', label: 'Bypass', scope: 'configuration',
      execute(context: ProjectEditContext) {
        const project = cloneValue(context.getProject())
        requireMapContent(project).datasets.find(dataset => dataset.id === 'data')!.fields = [{ name: 'fake', type: 'string', nullable: true }]
        context.replaceProject(project)
      },
      undo() {}
    })).toThrow('字段模式修改必须经过数据编辑事务')
    expect(useProjectStore.getState()).toBe(before)
    expect([...featureData.getFieldNamespace('data')!.fields]).toEqual([...namespace.fields])
    expect(projectEdits.canUndo()).toBe(false)
    expect(featureData.pendingCount()).toBe(0)
  })

  it('keeps rename identity, retires deleted columns and restores distinct same-name columns on replay', () => {
    const original = featureData.getFieldNamespace('data')!, left = original.fields.get('left'), right = original.fields.get('right')
    apply({ type: 'rename', from: 'left', to: 'renamed' })
    expect(featureData.getFieldNamespace('data')!.fields.get('renamed')).toBe(left)
    expect(featureData.getFieldNamespace('data')!.fields.has('left')).toBe(false)
    apply({ type: 'remove', name: 'right', clearReferences: true })
    expect(featureData.getFieldNamespace('data')!.fields.has('right')).toBe(false)
    apply({ type: 'add', field: { name: 'right', type: 'number', nullable: true }, defaultValue: 3 })
    const added = featureData.getFieldNamespace('data')!.fields.get('right')
    expect(added).toBeTruthy(); expect(added).not.toBe(right)
    expect(projectEdits.undo()).toBe(true); expect(featureData.getFieldNamespace('data')!.fields.has('right')).toBe(false)
    expect(projectEdits.undo()).toBe(true); expect(featureData.getFieldNamespace('data')!.fields.get('right')).toBe(right)
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.getFieldNamespace('data')!.fields.get('left')).toBe(left); expect(featureData.pendingCount()).toBe(0)
    expect(projectEdits.redo()).toBe(true); expect(projectEdits.redo()).toBe(true); expect(projectEdits.redo()).toBe(true)
    expect(featureData.getFieldNamespace('data')!.fields.get('right')).toBe(added)
    expect(featureData.getFieldNamespace('data')!.identity).toBe(original.identity)
    expect(original.fields.get('right')).toBe(right)
  })
  it('retains logical namespace and matching columns across a refreshed data generation', () => {
    const before = featureData.getFieldNamespace('data')!, generation = featureData.getSessionIdentity('data')
    featureData.setAll('data', [row(9, 8)])
    const refreshed = featureData.getFieldNamespace('data')!
    expect(refreshed.identity).toBe(before.identity); expect([...refreshed.fields]).toEqual([...before.fields])
    expect(featureData.getSessionIdentity('data')).not.toBe(generation)
  })
  it('rolls identity changes back and reads the namespace without full-row materialization', () => {
    const before = featureData.getFieldNamespace('data')!
    expect(() => featureData.transaction(() => { featureData.update('data', { ...row(), properties: { left: 1, right: 2, extra: 3 } }); throw new Error('fail') })).toThrow('fail')
    const read = vi.spyOn(MemoryFeatureProvider.prototype, 'getLoadedRows').mockImplementation(() => { throw new Error('full rows forbidden') })
    try { expect([...featureData.getFieldNamespace('data')!.fields]).toEqual([...before.fields]) }
    finally { read.mockRestore() }
  })
  it('restores implicit property identities across same-project snapshot undo and redo', () => {
    const snapshot = projectSession.getSnapshot(); snapshot.featuresByDataset.data[0].properties.extra = 3
    projectSession.applySnapshotAsEdit(snapshot, 'Extra')
    const identity = featureData.getFieldNamespace('data')!.fields.get('extra')
    expect(identity).toBeTruthy(); expect(projectEdits.undo()).toBe(true)
    expect(featureData.getFieldNamespace('data')!.fields.has('extra')).toBe(false)
    expect(projectEdits.redo()).toBe(true); expect(featureData.getFieldNamespace('data')!.fields.get('extra')).toBe(identity)
  })
})
