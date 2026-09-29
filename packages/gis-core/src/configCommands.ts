/**
 * Project configuration EditCommands (style / filter / opacity / layer-tree).
 * Share the same EditHistory as feature edits — no second global history.
 */
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { cloneValue } from './clone'
import type { EditCommand, EditContext } from './editHistory'
import type { FieldFilterCondition } from './filter'
import type { Layer, LayerGroup, LayerTreeEntry, Project } from './types'

export interface ProjectEditContext extends EditContext {
  getProject(): Project
  replaceProject(project: Project): void
}

function isProjectEditContext(context: EditContext): context is ProjectEditContext {
  return (
    typeof (context as ProjectEditContext).getProject === 'function' &&
    typeof (context as ProjectEditContext).replaceProject === 'function'
  )
}

function requireProjectContext(context: EditContext): ProjectEditContext {
  if (!isProjectEditContext(context)) {
    throw new Error('配置类 EditCommand 需要 ProjectEditContext')
  }
  return context
}

function replaceLayer(project: Project, layerId: string, patch: Partial<Layer>): Project {
  return {
    ...project,
    layers: project.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer))
  }
}

/** One style/label apply = one undoable config op. */
export class SetLayerStyleCommand implements EditCommand {
  readonly label = '应用样式'
  readonly mergeable = false

  constructor(
    readonly id: string,
    private readonly layerId: string,
    private readonly before: LayerStyle,
    private readonly after: LayerStyle
  ) {}

  execute(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(replaceLayer(ctx.getProject(), this.layerId, { style: cloneValue(this.after) }))
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(replaceLayer(ctx.getProject(), this.layerId, { style: cloneValue(this.before) }))
  }
}

/** Persist field filter F. */
export class SetLayerFilterCommand implements EditCommand {
  readonly label = '设置过滤'
  readonly mergeable = false

  constructor(
    readonly id: string,
    private readonly layerId: string,
    private readonly before: FieldFilterCondition[],
    private readonly after: FieldFilterCondition[]
  ) {}

  execute(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(
      replaceLayer(ctx.getProject(), this.layerId, { filter: cloneValue(this.after) })
    )
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(
      replaceLayer(ctx.getProject(), this.layerId, { filter: cloneValue(this.before) })
    )
  }
}

/**
 * Opacity change. Consecutive commands with the same mergeKey coalesce so a
 * slider drag becomes a single undo step.
 */
export class SetLayerOpacityCommand implements EditCommand {
  readonly label = '调整透明度'
  readonly mergeable = true
  readonly mergeKey: string

  constructor(
    readonly id: string,
    private readonly layerId: string,
    private before: number,
    private after: number
  ) {
    this.mergeKey = `opacity:${layerId}`
  }

  /** Used by EditHistory when coalescing slider updates. */
  absorb(next: SetLayerOpacityCommand): void {
    this.after = next.after
  }

  execute(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(replaceLayer(ctx.getProject(), this.layerId, { opacity: this.after }))
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(replaceLayer(ctx.getProject(), this.layerId, { opacity: this.before }))
  }
}

export interface LayerTreeSnapshot {
  layers: Layer[]
  groups: LayerGroup[]
  rootOrder: LayerTreeEntry[]
}

/** Group / sort / relocate — restore full tree snapshot on undo. */
export class SetLayerTreeCommand implements EditCommand {
  readonly label: string
  readonly mergeable = false

  constructor(
    readonly id: string,
    label: string,
    private readonly before: LayerTreeSnapshot,
    private readonly after: LayerTreeSnapshot
  ) {
    this.label = label
  }

  execute(context: EditContext): void {
    const ctx = requireProjectContext(context)
    const project = ctx.getProject()
    ctx.replaceProject({
      ...project,
      layers: cloneValue(this.after.layers),
      groups: cloneValue(this.after.groups),
      rootOrder: cloneValue(this.after.rootOrder)
    })
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    const project = ctx.getProject()
    ctx.replaceProject({
      ...project,
      layers: cloneValue(this.before.layers),
      groups: cloneValue(this.before.groups),
      rootOrder: cloneValue(this.before.rootOrder)
    })
  }
}

export function snapshotLayerTree(project: Project): LayerTreeSnapshot {
  return {
    layers: cloneValue(project.layers),
    groups: cloneValue(project.groups ?? []),
    rootOrder: cloneValue(project.rootOrder ?? [])
  }
}
