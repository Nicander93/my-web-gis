import type { FeatureStore } from '../data/featureStore'
import type { DatasetField, GisFeature, Geometry } from '../config/types'
import { cloneValue } from '../clone'
import type { FieldReferenceRebase } from '../config/field-references'

export interface EditContext {
  featureStore: FeatureStore
}

/** Stable identities let the host check current locks/capabilities without replaying an edit. */
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
  /** Opaque resource frames retained by this command across detached history rebase. */
  readonly runtimeResourceKeys?: readonly object[]
  /** Untagged legacy commands stay on the data path until migrated explicitly. */
  readonly scope?: 'configuration' | 'data'
  /** True only for commands whose entire effect is feature-row editing. */
  readonly dataOnly?: boolean
  readonly dataDatasetIds?: readonly string[]
  /** Rebase a mixed command while retaining its independent configuration differences. */
  rebaseDataCommit?(datasetId: string, committedRows: GisFeature[], committedFields?: DatasetField[], references?: FieldReferenceRebase): EditCommand | undefined
  /** Prepare detached configuration mementos; never replay or mutate the original command. */
  rebaseFieldReferences?(references: FieldReferenceRebase): EditCommand | undefined
  /** Creation/removal retains its lifecycle effect while restoring the acknowledged source content. */
  rebaseDatasetLifecycleCommit?(datasetId: string, committedRows: GisFeature[], committedFields: DatasetField[] | undefined, references: FieldReferenceRebase): EditCommand
  readonly targets?: EditTargets
  /** Legacy snapshot/field commands retain this alias while using the same host preflight. */
  readonly guardedLayerIds?: readonly string[]
  /** When true, consecutive commands with the same mergeKey coalesce into one undo step. */
  readonly mergeable?: boolean
  readonly mergeKey?: string
  execute(context: EditContext): void
  undo(context: EditContext): void
  /** Optional: absorb a newer mergeable command (e.g. opacity slider). */
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

/** A shared-vertex gesture is one transaction, including preflight of every target. */
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

  /** Inspect the next command for host preflight without consuming history. */
  peekUndo(): EditCommand | undefined { return this.undoStack.at(-1) }
  peekRedo(): EditCommand | undefined { return this.redoStack.at(-1) }
  /** Detached command references let the host release resources for discarded history branches. */
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
      // Coalesce: keep original `before`, take newest `after`, apply once.
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

  /** Prepare both branches before replacing either; the mapper never executes commands. */
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
