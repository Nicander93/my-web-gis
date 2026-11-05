import type { FeatureStore } from '../data/featureStore'
import type { DatasetField, GisFeature, Geometry } from '../config/types'
import { cloneValue } from '../clone'
import type { FieldReferenceRebase } from '../config/field-references'

export interface EditContext {
  featureStore: FeatureStore
}

/** 稳定的身份让宿主可以检查当前的锁定和能力，而不必重放一次编辑。 */
export interface EditTargets {
  readonly datasetIds?: readonly string[]
  readonly layerIds?: readonly string[]
  readonly groupIds?: readonly string[]
  readonly sceneNodeIds?: readonly string[]
  readonly sceneGroupIds?: readonly string[]
}

export interface EditCommand {
  readonly id: string
  readonly label: string
  /** 这条命令在历史重算之后仍然保留的不透明资源帧。 */
  readonly runtimeResourceKeys?: readonly object[]
  /** 没有打标记的旧命令仍然走数据路径，直到被显式迁移。 */
  readonly scope?: 'configuration' | 'data'
  /** 只有效果完全等同于编辑要素行的命令，才为 true。 */
  readonly dataOnly?: boolean
  readonly dataDatasetIds?: readonly string[]
  /** 重算混合命令，同时保留它自身独立的配置差异。 */
  rebaseDataCommit?(datasetId: string, committedRows: GisFeature[], committedFields?: DatasetField[], references?: FieldReferenceRebase): EditCommand | undefined
  /** 准备脱离的配置快照；不回放，也不修改原始命令。 */
  rebaseFieldReferences?(references: FieldReferenceRebase): EditCommand | undefined
  /** 创建和移除保留它自身的生命周期效果，同时恢复已确认过的数据源内容。 */
  rebaseDatasetLifecycleCommit?(datasetId: string, committedRows: GisFeature[], committedFields: DatasetField[] | undefined, references: FieldReferenceRebase): EditCommand
  readonly targets?: EditTargets
  /** 旧的快照和字段命令保留这个别名，但仍然使用同一套宿主预检。 */
  readonly guardedLayerIds?: readonly string[]
  /** 为 true 时，mergeKey 相同的连续命令会合并成一步撤销。 */
  readonly mergeable?: boolean
  readonly mergeKey?: string
  execute(context: EditContext): void
  undo(context: EditContext): void
  /** 可选：吸收一条更新的、可合并的命令，例如不透明度滑块。 */
  absorb?(next: EditCommand): void
}

export class AddFeatureCommand implements EditCommand {
  readonly dataOnly = true
  get targets(): EditTargets { return { datasetIds: [this.datasetId] } }
  readonly label = 'Add feature'

  constructor(
    readonly id: string,
    private readonly datasetId: string,
    private readonly feature: GisFeature
  ) {}

  execute(context: EditContext): void {
    context.featureStore.add(this.datasetId, this.feature)
  }

  undo(context: EditContext): void {
    context.featureStore.remove(this.datasetId, this.feature.id)
  }
}

export class DeleteFeatureCommand implements EditCommand {
  readonly dataOnly = true
  get targets(): EditTargets { return { datasetIds: [this.datasetId] } }
  readonly label = 'Delete feature'

  constructor(
    readonly id: string,
    private readonly datasetId: string,
    private readonly feature: GisFeature
  ) {}

  execute(context: EditContext): void {
    context.featureStore.remove(this.datasetId, this.feature.id)
  }

  undo(context: EditContext): void {
    context.featureStore.add(this.datasetId, this.feature)
  }
}

export class UpdateGeometryCommand implements EditCommand {
  readonly dataOnly = true
  get targets(): EditTargets { return { datasetIds: [this.datasetId] } }
  readonly label = 'Update geometry'

  constructor(
    readonly id: string,
    private readonly datasetId: string,
    private readonly featureId: string,
    private readonly before: Geometry,
    private readonly after: Geometry
  ) {}

  execute(context: EditContext): void {
    this.replaceGeometry(context, this.after)
  }

  undo(context: EditContext): void {
    this.replaceGeometry(context, this.before)
  }

  private replaceGeometry(context: EditContext, geometry: Geometry): void {
    const feature = context.featureStore.getById(this.datasetId, this.featureId)
    if (!feature) return
    context.featureStore.update(this.datasetId, { ...feature, geometry: cloneValue(geometry) })
  }
}

export interface GeometryChange {
  featureId: string
  before: Geometry
  after: Geometry
}

/** 一次共享顶点的手势就是一个事务，包含对每个目标的预检。 */
export class UpdateGeometriesCommand implements EditCommand {
  readonly dataOnly = true
  get targets(): EditTargets { return { datasetIds: [this.datasetId] } }
  readonly label = 'Update geometries'
  private readonly changes: GeometryChange[]

  constructor(readonly id: string, private readonly datasetId: string, changes: GeometryChange[]) {
    if (!changes.length || new Set(changes.map(change => change.featureId)).size !== changes.length) throw new Error('Geometry changes require unique targets.')
    this.changes = cloneValue(changes)
  }

  execute(context: EditContext): void { this.replace(context, 'after', 'before') }
  undo(context: EditContext): void { this.replace(context, 'before', 'after') }

  private replace(context: EditContext, next: 'before' | 'after', expected: 'before' | 'after'): void {
    const features = context.featureStore.getAll(this.datasetId)
    const byId = new Map(features.map(feature => [feature.id, feature]))
    for (const change of this.changes) {
      const feature = byId.get(change.featureId)
      if (!feature || JSON.stringify(feature.geometry) !== JSON.stringify(change[expected])) throw new Error('Geometry target changed; reload before editing.')
      byId.set(feature.id, { ...feature, geometry: cloneValue(change[next]) })
    }
    context.featureStore.setAll(this.datasetId, features.map(feature => byId.get(feature.id)!))
  }
}

export class UpdatePropertiesCommand implements EditCommand {
  readonly dataOnly = true
  get targets(): EditTargets { return { datasetIds: [this.datasetId] } }
  readonly label = 'Update properties'

  constructor(
    readonly id: string,
    private readonly datasetId: string,
    private readonly featureId: string,
    private readonly before: Record<string, unknown>,
    private readonly after: Record<string, unknown>
  ) {}

  execute(context: EditContext): void {
    this.replaceProperties(context, this.after)
  }

  undo(context: EditContext): void {
    this.replaceProperties(context, this.before)
  }

  private replaceProperties(context: EditContext, properties: Record<string, unknown>): void {
    const feature = context.featureStore.getById(this.datasetId, this.featureId)
    if (!feature) return
    context.featureStore.update(this.datasetId, { ...feature, properties: cloneValue(properties) })
  }
}

export class EditHistory {
  private undoStack: EditCommand[] = []
  private redoStack: EditCommand[] = []

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get undoCount(): number {
    return this.undoStack.length
  }

  get redoCount(): number {
    return this.redoStack.length
  }

  /** 查看下一条命令供宿主预检，但不消耗历史。 */
  peekUndo(): EditCommand | undefined { return this.undoStack.at(-1) }
  peekRedo(): EditCommand | undefined { return this.redoStack.at(-1) }
  /** 脱离的命令引用让宿主可以释放被丢弃的历史分支所占用的资源。 */
  getCommands(): readonly EditCommand[] { return [...this.undoStack, ...this.redoStack] }

  execute(command: EditCommand, context: EditContext, changed?: () => boolean): boolean {
    const top = this.undoStack[this.undoStack.length - 1]
    command.execute(context)
    if (changed && !changed()) return false
    if (
      command.mergeable &&
      command.mergeKey &&
      top?.mergeable &&
      top.scope === command.scope &&
      top.mergeKey === command.mergeKey &&
      typeof top.absorb === 'function'
    ) {
      // 合并：保留最初的 `before`，取最新的 `after`，只应用一次。
      top.absorb(command)
      this.redoStack = []
      return true
    }

    this.undoStack.push(command)
    this.redoStack = []
    return true
  }

  undo(context: EditContext): EditCommand | undefined {
    const command = this.peekUndo()
    if (!command) return undefined
    command.undo(context)
    this.undoStack.pop()
    this.redoStack.push(command)
    return command
  }

  redo(context: EditContext): EditCommand | undefined {
    const command = this.peekRedo()
    if (!command) return undefined
    command.execute(context)
    this.redoStack.pop()
    this.undoStack.push(command)
    return command
  }

  /** 在替换任何一个分支之前，先把两个分支都准备好；映射器永远不执行命令。 */
  rewrite(mapper: (command: EditCommand) => EditCommand | undefined): void {
    const map = (commands: EditCommand[]) => commands.flatMap(command => { const next = mapper(command); return next ? [next] : [] })
    const undo = map(this.undoStack), redo = map(this.redoStack)
    this.undoStack = undo; this.redoStack = redo
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
