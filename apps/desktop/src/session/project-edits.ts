import { useSyncExternalStore } from 'react'
import { assertProjectSnapshotWorkspace, cloneDatasetFields, cloneValue, createId, EditHistory,
  capabilitiesForDataset, getEffectiveLocked, getFieldNameChanges, getLayerCartography, getLayerGroupState, getProjectSnapshotChanges, mergeEditTargets, normalizeLayerTree, reconcileProjectCartography, remapLayerCartographyReferences, remapLayerFieldReferences, sameValue, setLayerCartographyFragment,
  type DatasetField, type EditCommand, type EditTargets, type FeatureStore, type FieldReferenceRebase, type GisFeature, type Project, type ProjectEditContext, type ProjectSnapshot } from '@desktop-webgis/project'
import { getCesiumSceneGroupState, getCesiumSceneNodeState } from '@desktop-webgis/cesium-scene-schema'
import { commitProjectConfiguration, useProjectStore } from '@/session/project.store'
import { notifyDatasetFieldsChanged, notifyLayersRemoved, notifyProjectReplaced, notifySelectionFilter, notifySnapshotApplied } from '@/session/session-events'
import { emitCommandStatus } from '@/platform/command-status'
import { featureData, useFeatureEditState } from '@/data/feature-data'
import type { DatasetCommitReceipt } from '@/data/feature-data-runtime'
import { datasetSchemas } from '@/data/feature-data-runtime'

const history = new EditHistory()
const dataCommandSessions = new WeakMap<EditCommand, Map<string, object>>()
interface HistoricalFields { identity: object; fields: ReadonlyMap<string, string>; layerIds: string[] }
interface CommandFields { before: Map<string, HistoricalFields>; after: Map<string, HistoricalFields> }
const commandFields = new WeakMap<EditCommand, CommandFields>()
let schemaCommitInProgress = false
const schemaCommitReason = '字段提交进行中，请等待完成后继续编辑或撤销'

function captureFields(context: ProjectEditContext): Map<string, HistoricalFields> {
  const project = context.getProject(), result = new Map<string, HistoricalFields>()
  if (project.content.kind === 'map2d') for (const dataset of project.content.datasets) {
    const namespace = featureData.getFieldNamespace(dataset.id)
    if (namespace) result.set(dataset.id, { ...namespace, layerIds: project.content.layers.filter(layer => layer.datasetId === dataset.id).map(layer => layer.id) })
  }
  return result
}
function recordCommandFields<T>(command: EditCommand, context: ProjectEditContext, action: () => T): T {
  if (commandFields.has(command)) return action()
  const before = captureFields(context), result = action()
  commandFields.set(command, { before, after: captureFields(context) })
  return result
}
interface DataCommitView {
  rows: GisFeature[]
  fields?: DatasetField[]
  namespace: { identity: object; fields: ReadonlyMap<string, string> }
}

function committedFieldReferences(command: EditCommand, datasetId: string, view?: DataCommitView): { references: FieldReferenceRebase; complete: boolean } | undefined {
  const binding = commandFields.get(command), current = view?.namespace ?? featureData.getFieldNamespace(datasetId)
  if (!binding || !current) return undefined
  const before = binding.before.get(datasetId), after = binding.after.get(datasetId)
  const matchingBefore = before?.identity === current.identity, matchingAfter = after?.identity === current.identity
  if (!matchingBefore && !matchingAfter) return undefined
  return { complete: matchingBefore && matchingAfter, references: { datasetId,
    matchingSides: [...(matchingBefore ? ['before' as const] : []), ...(matchingAfter ? ['after' as const] : [])],
    layerIds: [...new Set([...(matchingBefore ? before.layerIds : []), ...(matchingAfter ? after.layerIds : [])])],
    before: matchingBefore ? getFieldNameChanges(before.fields, current.fields) : new Map(),
    after: matchingAfter ? getFieldNameChanges(after.fields, current.fields) : new Map(),
    fields: view ? view.fields : featureData.getEffectiveFields(datasetId) } }
}
function retainCommandBindings(command: EditCommand, next: EditCommand, datasetId: string, clearData: boolean): void {
  const data = dataCommandSessions.get(command)
  if (data) { const retained = new Map(data); if (clearData) retained.delete(datasetId); dataCommandSessions.set(next, retained) }
  const fields = commandFields.get(command), namespace = featureData.getFieldNamespace(datasetId)
  if (fields && namespace) {
    const updated = { before: new Map(fields.before), after: new Map(fields.after) }
    for (const side of ['before', 'after'] as const) {
      const original = updated[side].get(datasetId)
      if (original?.identity === namespace.identity) updated[side].set(datasetId, { ...namespace, layerIds: original.layerIds })
    }
    commandFields.set(next, updated)
  }
}
function bindDataSessions(command: EditCommand): void {
  if (command instanceof EditBatch) { command.bindDataSessions(); return }
  if (command.scope === 'configuration') return
  const bindings = new Map<string, object>()
  for (const id of command.dataDatasetIds ?? command.targets?.datasetIds ?? []) {
    const identity = featureData.getSessionIdentity(id)
    if (identity) bindings.set(id, identity)
  }
  const existing = dataCommandSessions.get(command)
  if (existing && (existing.size !== bindings.size || [...bindings].some(([id, identity]) => existing.get(id) !== identity))) throw new Error('Edit command belongs to another dataset session')
  dataCommandSessions.set(command, bindings)
}
const historyListeners = new Set<() => void>()
let historyState = { revision: 0, canUndo: false, canRedo: false }
function publishHistory(): void {
  const retained = history.getCommands()
  featureData.pruneHistory(key => retained.some(command => retainsResource(command, key)))
  historyState = { revision: historyState.revision + 1, canUndo: history.canUndo, canRedo: history.canRedo }
  for (const listener of historyListeners) {
    try { listener() } catch (error) { console.error('History subscriber failed after publication', error) }
  }
}
function retainsResource(command: EditCommand, key: object): boolean {
  return command === key || !!command.runtimeResourceKeys?.includes(key) || command instanceof EditBatch && command.retains(key)
}
function denyDataAccess(): never { throw new Error('工程配置事务不能访问要素数据') }
const configurationData: FeatureStore = {
  getAll: denyDataAccess, getById: denyDataAccess, setAll: denyDataAccess, add: denyDataAccess,
  update: denyDataAccess, remove: denyDataAccess, clear: denyDataAccess, snapshot: denyDataAccess
}
const sceneData: FeatureStore = { ...configurationData, snapshot: () => ({}) }
class EditBlockedError extends Error {
  constructor(message: string, readonly transient = false) { super(message) }
}
// Opaque custom commands can discover a block at write time; retain diagnostics only for this exact replay state.
let blockedReplay: { command: EditCommand; project: ProjectSnapshot['project']; dataRevision: number; direction: 'undo' | 'redo'; reason: string } | null = null

/** Current document definitions decide permission; no row reads, command replay or history mutation. */
function commandBlockReason(command: EditCommand | undefined): string | null {
  if (command && command.scope !== 'configuration' && featureData.getEditState().saving) return '数据保存进行中，请等待完成后编辑或撤销数据'
  if (command instanceof EditBatch) {
    const reason = command.nestedBlockReason()
    if (reason) return reason
  }
  if (command) for (const [id, identity] of dataCommandSessions.get(command) ?? []) {
    if (featureData.getSessionIdentity(id) !== identity) return '数据源会话已替换，不能重放旧数据命令'
  }
  if (!command) return null
  const targets = mergeEditTargets(command.targets, { layerIds: command.guardedLayerIds })
  const project = useProjectStore.getState().project
  if (project.content.kind === 'map2d') {
    const content = project.content
    if (targets.sceneNodeIds?.length || targets.sceneGroupIds?.length) return '当前工程不是三维工作区'
    for (const id of targets.datasetIds ?? []) {
      const dataset = content.datasets.find(item => item.id === id)
      if (!dataset) return '数据集已不存在'
      if (!capabilitiesForDataset(dataset).editGeometry) return '数据源只读，请先复制为本地图层'
      if (content.layers.some(layer => layer.datasetId === id && getEffectiveLocked(project, layer.id))) return '引用此数据集的图层或文件夹已锁定'
    }
    if ((targets.layerIds ?? []).some(id => content.layers.some(layer => layer.id === id) && getEffectiveLocked(project, id))) return '图层或所属文件夹已锁定'
    if ((targets.groupIds ?? []).some(id => content.groups.some(group => group.id === id) && getLayerGroupState(project, id).locked)) return '文件夹或其父级已锁定'
  } else {
    if (targets.datasetIds?.length || targets.layerIds?.length || targets.groupIds?.length) return '当前工程不是二维工作区'
    const scene = project.content.scene
    if ((targets.sceneNodeIds ?? []).some(id => scene.nodes.some(node => node.id === id && getCesiumSceneNodeState(scene, node).locked))) return '场景对象或所属文件夹已锁定'
    if ((targets.sceneGroupIds ?? []).some(id => scene.groups?.some(group => group.id === id) && getCesiumSceneGroupState(scene, id).locked)) return '场景文件夹或其父级已锁定'
  }
  return null
}

/** One application boundary stages configuration and batches data before publishing either. */
function runEdit(scope: 'configuration' | 'data', action: (context: ProjectEditContext) => EditCommand | undefined, owner?: EditCommand): boolean {
  const afterCommit: Array<() => void> = []
  const run = () => {
    const before = useProjectStore.getState().project
    let project = before
    const beforeCommit: Array<() => void> = []
    const replaceProject: ProjectEditContext['replaceProject'] = next => {
      if (next === project) return
      assertProjectSnapshotWorkspace({ project: next, featuresByDataset: {} })
      if (scope === 'configuration' && project.content.kind === 'map2d' && next.content.kind === 'map2d') {
        for (const dataset of project.content.datasets) {
          const candidate = next.content.datasets.find(item => item.id === dataset.id)
          if (candidate && featureData.isSaving(dataset.id) && (candidate.kind !== dataset.kind || !sameValue(candidate.source, dataset.source) ||
            !sameValue('storage' in candidate ? candidate.storage : undefined, 'storage' in dataset ? dataset.storage : undefined) ||
            !sameValue('sourceCrs' in candidate ? candidate.sourceCrs : undefined, 'sourceCrs' in dataset ? dataset.sourceCrs : undefined))) {
            throw new EditBlockedError('数据保存进行中，不能更改源或保存目标', true)
          }
        }
        if (project.content.datasets.some(dataset => {
          const candidate = next.content.kind === 'map2d' ? next.content.datasets.find(item => item.id === dataset.id) : undefined
          return candidate && JSON.stringify(dataset.fields) !== JSON.stringify(candidate.fields)
        })) throw new Error('字段模式修改必须经过数据编辑事务')
      }
      if (next.content.kind !== before.content.kind || scope === 'configuration' && next.metadata.id !== before.metadata.id) throw new Error('配置编辑不能切换工程或工作区')
      project = reconcileProjectCartography(normalizeLayerTree(next), project)
    }
    // Row writes enforce current capability even without target metadata; owner initialization/removal has its own boundary.
    function assertDatasetWrite(id: string, lifecycle?: 'initialize' | 'remove'): void {
      if (before.content.kind !== 'map2d' || project.content.kind !== 'map2d') throw new EditBlockedError('当前工程不是二维工作区')
      const original = before.content.datasets.find(dataset => dataset.id === id), current = project.content.datasets.find(dataset => dataset.id === id)
      if ([before, project].some(value => value.content.kind === 'map2d' && value.content.layers.some(layer => layer.datasetId === id && getEffectiveLocked(value, layer.id)))) {
        throw new EditBlockedError('引用此数据集的图层或文件夹已锁定')
      }
      if (lifecycle === 'initialize' && !original && current) return
      if (lifecycle === 'remove' && original && !current) {
        if (project.content.layers.some(layer => layer.datasetId === id)) throw new EditBlockedError('数据集仍被图层引用')
        return
      }
      if (!current) throw new EditBlockedError('数据集已不存在')
      if (!capabilitiesForDataset(current).editGeometry) throw new EditBlockedError('数据源只读，请先复制为本地图层')
    }
    const writableData: FeatureStore = {
      getAll: id => featureData.getAll(id), getById: (id, row) => featureData.getById(id, row), snapshot: () => featureData.snapshot(),
      add(id, row) { assertDatasetWrite(id); recordWrite(id); featureData.add(id, row) },
      update(id, row) { assertDatasetWrite(id); recordWrite(id); featureData.update(id, row) },
      remove(id, row) { assertDatasetWrite(id); recordWrite(id); featureData.remove(id, row) },
      setAll(id, rows) {
        assertDatasetWrite(id, 'initialize'); recordWrite(id)
        featureData.replaceEdited(id, rows, { fields: datasetSchemas(project)[id] })
      },
      clear(id) { assertDatasetWrite(id, 'remove'); featureData.clear(id) }
    }
    function recordWrite(id: string): void {
      const identity = featureData.getSessionIdentity(id)
      if (!owner || !identity) return
      const bindings = dataCommandSessions.get(owner) ?? new Map<string, object>()
      if (bindings.has(id) && bindings.get(id) !== identity) throw new EditBlockedError('数据源会话已替换')
      bindings.set(id, identity); dataCommandSessions.set(owner, bindings)
    }
    const context: ProjectEditContext = {
      getProject: () => project, replaceProject,
      featureStore: scope === 'configuration' ? configurationData : before.content.kind === 'scene3d' ? sceneData : writableData,
      afterCommit: effect => { afterCommit.push(effect) },
      onLayersRemoved: scope === 'configuration' ? denyDataAccess : layerIds => {
        beforeCommit.push(() => { notifyLayersRemoved(layerIds) })
      },
      onDatasetFieldChange: scope === 'configuration' ? denyDataAccess : (datasetId, from, to) => {
        if (!from) return
        beforeCommit.push(() => { notifyDatasetFieldsChanged({ datasetId, from, to, project }) })
      },
      setDatasetContent: scope === 'configuration' ? denyDataAccess : (id, content, edit) => {
        assertDatasetWrite(id); recordWrite(id)
        featureData.replaceEdited(id, content.features, { fields: content.fields, edit })
      },
      applySnapshotEdit: scope === 'configuration' ? denyDataAccess : (snapshot, edit) => {
        assertProjectSnapshotWorkspace(snapshot)
        const changes = getProjectSnapshotChanges({ project, featuresByDataset: featureData.readSnapshot() }, snapshot)
        replaceProject(cloneValue(snapshot.project))
        featureData.replaceEffectiveSnapshot(snapshot.featuresByDataset, datasetSchemas(snapshot.project), edit)
        beforeCommit.push(() => {
          notifySnapshotApplied({ removedLayers: changes.removedLayers, dataChangedLayers: changes.dataChangedLayers, project })
        })
      },
      replaceSnapshot: scope === 'configuration' ? denyDataAccess : (snapshot: ProjectSnapshot, runtime) => {
        assertProjectSnapshotWorkspace(snapshot)
        replaceProject(cloneValue(snapshot.project))
        if (runtime) featureData.replaceHistorySnapshot(snapshot.featuresByDataset, runtime.key, runtime.side, datasetSchemas(snapshot.project))
        else featureData.replaceAll(snapshot.featuresByDataset, datasetSchemas(snapshot.project))
        beforeCommit.push(() => { notifyProjectReplaced() })
      }
    }
    const command = action(context)
    if (!command) return false
    for (const effect of beforeCommit) effect()
    notifySelectionFilter({ project, before, scope })
    // Data-only edits stay in Buffer/unsavedCount. Only real Project object changes dirty configuration.
    if (project !== before) commitProjectConfiguration(project)
    return true
  }
  const applied = scope === 'data' ? featureData.transaction(run) : run()
  if (applied) for (const effect of afterCommit) {
    try { effect() }
    catch (error) { emitCommandStatus(`编辑已完成；界面跟随更新失败：${error instanceof Error ? error.message : String(error)}`) }
  }
  return applied
}

/** A multi-feature gesture has one rollback and undo boundary. */
class EditBatch implements EditCommand {
  hasFieldChanges(datasetId: string): boolean { return this.commands.some(command => hasFieldChanges(command, datasetId)) }
  nestedBlockReason(): string | null {
    for (const command of this.commands) { const reason = commandBlockReason(command); if (reason) return reason }
    return null
  }
  private hasUnclassifiedData(): boolean {
    return this.commands.some(command => command instanceof EditBatch ? command.hasUnclassifiedData() :
      command.scope !== 'configuration' && !command.dataOnly && !command.rebaseDataCommit && !command.rebaseDatasetLifecycleCommit && !dataCommandSessions.get(command)?.size)
  }
  bindDataSessions(): void { this.commands.forEach(bindDataSessions) }
  withoutCommittedRows(datasetId: string, identity: object, view?: DataCommitView): EditCommand | undefined {
    if (dataCommandSessions.get(this)?.get(datasetId) === identity && this.hasUnclassifiedData()) throw new Error('Unclassified data batch requires an explicit commit contract')
    const retained = this.commands.map(command => removeCommittedRows(command, datasetId, identity, view)).filter((command): command is EditCommand => !!command)
    if (retained.length === this.commands.length && retained.every((command, index) => command === this.commands[index])) return this
    return retained.length > 1 ? new EditBatch(retained) : retained[0]
  }
  retains(key: object): boolean {
    return this.commands.some(command => retainsResource(command, key))
  }
  get targets(): EditTargets {
    return mergeEditTargets(...this.commands.map(command => mergeEditTargets(command.targets, { layerIds: command.guardedLayerIds })))
  }
  readonly id = createId('cmd')
  readonly label: string
  readonly scope: 'configuration' | 'data'
  constructor(private readonly commands: readonly EditCommand[]) {
    this.commands = [...commands]
    this.label = commands[0].label
    this.scope = commands[0].scope ?? 'data'
    if (commands.some(command => (command.scope ?? 'data') !== this.scope)) throw new Error('配置与数据命令不能合并为同一批次')
  }
  execute(context: ProjectEditContext): void { for (const command of this.commands) recordCommandFields(command, context, () => command.execute(context)) }
  undo(context: ProjectEditContext): void { for (const command of [...this.commands].reverse()) command.undo(context) }
}

function hasFieldChanges(command: EditCommand, datasetId: string): boolean {
  if (command instanceof EditBatch) return command.hasFieldChanges(datasetId)
  const references = committedFieldReferences(command, datasetId)?.references
  return !!references && (references.before.size > 0 || references.after.size > 0)
}

function removeCommittedRows(command: EditCommand, datasetId: string, identity: object, view?: DataCommitView): EditCommand | undefined {
  if (command instanceof EditBatch) return command.withoutCommittedRows(datasetId, identity, view)
  const binding = committedFieldReferences(command, datasetId, view), references = binding?.references
  const rows = view?.rows ?? featureData.getAll(datasetId), schema = view ? view.fields : featureData.getEffectiveFields(datasetId)
  const changed = references && (references.before.size > 0 || references.after.size > 0)
  if (command.scope === 'configuration' && changed) {
    if (!command.rebaseFieldReferences) throw new Error('Configuration history requires a schema-aware reference rebase')
    const next = command.rebaseFieldReferences(references)
    if (next && next !== command) retainCommandBindings(command, next, datasetId, false)
    return next
  }
  if (command.scope !== 'configuration' && references && dataCommandSessions.get(command)?.get(datasetId) !== identity && command.rebaseDatasetLifecycleCommit) {
    const next = command.rebaseDatasetLifecycleCommit(datasetId, rows, schema, references)
    if (next !== command) retainCommandBindings(command, next, datasetId, true)
    return next
  }
  if (command.scope !== 'configuration' && changed && dataCommandSessions.get(command)?.get(datasetId) !== identity) {
    throw new Error('Dataset lifecycle history requires a schema-aware reference rebase')
  }
  if (dataCommandSessions.get(command)?.get(datasetId) !== identity) return command
  if (command.rebaseDataCommit) {
    const next = command.rebaseDataCommit(datasetId, rows, schema, binding?.complete ? references : undefined)
    if (next && next !== command) retainCommandBindings(command, next, datasetId, true)
    return next
  }
  if (!command.dataOnly) throw new Error('Mixed schema/data command requires a schema-aware data commit')
  if (command.dataOnly && dataCommandSessions.get(command)?.get(datasetId) === identity && dataCommandSessions.get(command)!.size > 1) throw new Error('A cross-dataset command requires a shared commit barrier')
  return command.dataOnly && dataCommandSessions.get(command)?.get(datasetId) === identity ? undefined : command
}

function restoreDiscardedSchema(datasetId: string, pending: { identity: object; fields: ReadonlyMap<string, string> } | undefined): void {
  const current = featureData.getFieldNamespace(datasetId), fields = featureData.getEffectiveFields(datasetId)
  const names = pending && current ? getFieldNameChanges(pending.fields, current.fields) : new Map()
  const project = useProjectStore.getState().project
  if (project.content.kind !== 'map2d') return
  const dataset = project.content.datasets.find(item => item.id === datasetId)
  if (!dataset || sameValue(dataset.fields, fields) && !names.size) return
  let next: Project = { ...project, content: { ...project.content,
    datasets: project.content.datasets.map(item => item.id === datasetId ? { ...item, fields: cloneDatasetFields(fields) } : item),
    layers: project.content.layers.map(layer => layer.datasetId === datasetId ? remapLayerFieldReferences(layer, names) : layer) } }
  for (const layer of project.content.layers) if (layer.datasetId === datasetId) {
    const fragment = getLayerCartography(next, layer.id)
    if (fragment) next = setLayerCartographyFragment(next, remapLayerCartographyReferences(layer, fragment, names))
  }
  commitProjectConfiguration(next)
}

function replayHistory(direction: 'undo' | 'redo'): boolean {
  if (schemaCommitInProgress) return false
  const command = direction === 'undo' ? history.peekUndo() : history.peekRedo()
  if (!command || commandBlockReason(command)) return false
  try {
    const applied = runEdit(command.scope ?? 'data', context => direction === 'undo' ? history.undo(context) : history.redo(context), command)
    if (applied) { blockedReplay = null; publishHistory() }
    return applied
  } catch (error) {
    if (!(error instanceof EditBlockedError)) throw error
    blockedReplay = error.transient ? null : { command, direction, project: useProjectStore.getState().project, dataRevision: featureData.revision, reason: error.message }
    if (error.transient) emitCommandStatus(error.message)
    return false
  }
}

export const projectEdits = {
  execute(command: EditCommand): boolean {
    if (schemaCommitInProgress) throw new Error(schemaCommitReason)
    const reason = commandBlockReason(command)
    if (reason) throw new Error(reason)
    bindDataSessions(command)
    const applied = runEdit(command.scope ?? 'data', context => {
      const before = context.getProject()
      const changed = command.scope === 'configuration' ? () => context.getProject() !== before : undefined
      return recordCommandFields(command, context, () => history.execute(command, context, changed)) ? command : undefined
    }, command)
    if (applied) { blockedReplay = null; publishHistory() }
    return applied
  },
  executeMany(commands: EditCommand[]): boolean {
    return commands.length > 0 && projectEdits.execute(commands.length === 1 ? commands[0] : new EditBatch(commands))
  },
  undo(): boolean { return replayHistory('undo') },
  redo(): boolean { return replayHistory('redo') },
  /** Must run before persistence, while unsupported mixed commands can still reject safely. */
  prepareDataCommit(datasetId: string): void {
    const identity = featureData.getSessionIdentity(datasetId)
    if (!identity) throw new Error('Dataset session not initialized')
    for (const command of history.getCommands()) removeCommittedRows(command, datasetId, identity)
  },
  /** Freeze history only while a schema rename/removal is being acknowledged, so preflight remains valid. */
  beginDataCommit(datasetId: string): () => void {
    if (schemaCommitInProgress) throw new Error(schemaCommitReason)
    projectEdits.prepareDataCommit(datasetId)
    const schema = history.getCommands().some(command => hasFieldChanges(command, datasetId))
    if (schema) { schemaCommitInProgress = true; publishHistory() }
    let released = false
    return () => { if (!released && schema) { schemaCommitInProgress = false; publishHistory() }; released = true }
  },
  /** Commit barrier for supported rows, schema and configuration-reference mementos. */
  clearCommittedRows(receipt: DatasetCommitReceipt): void {
    featureData.validateCommit(receipt)
    history.rewrite(command => removeCommittedRows(command, receipt.datasetId, receipt.identity))
    featureData.consumeCommit(receipt)
    blockedReplay = null; publishHistory()
  },
  /** Drop one source's pending overlay and its data-only history; other sources and configuration remain. */
  discardDatasetEdits(datasetId: string): void {
    if (schemaCommitInProgress) throw new Error(schemaCommitReason)
    featureData.assertIdle()
    const identity = featureData.getSessionIdentity(datasetId)
    if (!identity) throw new Error('Dataset session not initialized')
    if (!featureData.pendingCount(datasetId)) return
    const pending = featureData.getFieldNamespace(datasetId), view = featureData.discardPreview(datasetId)
    for (const command of history.getCommands()) removeCommittedRows(command, datasetId, identity, view)
    featureData.discardDataset(datasetId)
    restoreDiscardedSchema(datasetId, pending)
    history.rewrite(command => removeCommittedRows(command, datasetId, identity))
    blockedReplay = null; publishHistory()
  },
  canUndo(): boolean { return history.canUndo },
  canRedo(): boolean { return history.canRedo },
  getBlockReason(direction: 'undo' | 'redo'): string | null {
    if (schemaCommitInProgress) return schemaCommitReason
    const command = direction === 'undo' ? history.peekUndo() : history.peekRedo()
    const reason = commandBlockReason(command), cached = blockedReplay
    if (reason) return reason
    return cached && cached.command === command && cached.direction === direction &&
      cached.project === useProjectStore.getState().project && cached.dataRevision === featureData.revision ? cached.reason : null
  },
  clear(): void { if (schemaCommitInProgress) throw new Error(schemaCommitReason); blockedReplay = null; featureData.releaseHistory(); if (history.canUndo || history.canRedo) { history.clear(); publishHistory() } },
  getState: () => historyState,
  subscribe(listener: () => void): () => void { historyListeners.add(listener); return () => { historyListeners.delete(listener) } }
}

export function useEditHistory() {
  useFeatureEditState()
  return useSyncExternalStore(projectEdits.subscribe, projectEdits.getState, projectEdits.getState)
}
