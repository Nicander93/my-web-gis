import type { FeatureStore } from './featureStore'
import type { GisFeature, Geometry } from './types'
import { cloneValue } from './clone'

export interface EditContext {
  featureStore: FeatureStore
}

export interface EditCommand {
  readonly id: string
  readonly label: string
  execute(context: EditContext): void
  undo(context: EditContext): void
}

export class AddFeatureCommand implements EditCommand {
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

export class UpdatePropertiesCommand implements EditCommand {
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

  execute(command: EditCommand, context: EditContext): void {
    command.execute(context)
    this.undoStack.push(command)
    this.redoStack = []
  }

  undo(context: EditContext): EditCommand | undefined {
    const command = this.undoStack.pop()
    if (!command) return undefined
    command.undo(context)
    this.redoStack.push(command)
    return command
  }

  redo(context: EditContext): EditCommand | undefined {
    const command = this.redoStack.pop()
    if (!command) return undefined
    command.execute(context)
    this.undoStack.push(command)
    return command
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
