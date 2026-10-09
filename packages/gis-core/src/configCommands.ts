/**
 * Project configuration EditCommands (style / filter / opacity / layer-tree).
 * Share the same EditHistory as feature edits — no second global history.
 */
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { cloneValue } from './clone'
import type { EditCommand, EditContext } from './editHistory'
import type { FieldFilterCondition } from './filter'
import type { Dataset, GisFeature, Layer, LayerGroup, LayerTreeEntry, Project, ProjectSnapshot } from './types'

export interface ProjectEditContext extends EditContext {
  getProject(): Project
  replaceProject(project: Project): void
  /** Optional atomic host path for whole-content replacement. */
  replaceSnapshot?(snapshot: ProjectSnapshot): void
  /** Atomic same-project content edit; host preserves unaffected UI sessions. */
  applySnapshotEdit?(snapshot: ProjectSnapshot): void
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

/** Replaces project content and all feature datasets as one operation in the existing history. */
export class ReplaceProjectSnapshotCommand implements EditCommand {
  protected readonly before: ProjectSnapshot
  protected readonly after: ProjectSnapshot
  constructor(readonly id: string, readonly label: string, before: ProjectSnapshot, after: ProjectSnapshot) {
    this.before = cloneValue(before); this.after = cloneValue(after)
  }
  execute(context: EditContext): void { this.apply(context, this.after) }
  undo(context: EditContext): void { this.apply(context, this.before) }
  protected apply(context: EditContext, snapshot: ProjectSnapshot): void {
    const ctx = requireProjectContext(context)
    const retained = new Set(snapshot.project.datasets.map(dataset => dataset.id))
    for (const id of Object.keys(ctx.featureStore.snapshot())) if (!retained.has(id)) ctx.featureStore.clear(id)
    for (const id of retained) ctx.featureStore.setAll(id, cloneValue(snapshot.featuresByDataset[id] ?? []))
    if (ctx.replaceSnapshot) ctx.replaceSnapshot(cloneValue(snapshot))
    else ctx.replaceProject(cloneValue(snapshot.project))
  }
}

/** Describes which existing layer sessions become stale after a same-project edit. */
export function getProjectSnapshotChanges(before: ProjectSnapshot, after: ProjectSnapshot): {
  removedLayers: string[]; dataChangedLayers: string[]; styleChangedLayers: string[]
} {
  const removedLayers: string[] = [], changedDatasets: string[] = [], changedStyles: string[] = []
  const nextLayers = new Map(after.project.layers.map(layer => [layer.id, layer]))
  const previousDatasets = new Map(before.project.datasets.map(dataset => [dataset.id, dataset]))
  const nextDatasets = new Map(after.project.datasets.map(dataset => [dataset.id, dataset]))
  for (const layer of before.project.layers) {
    const next = nextLayers.get(layer.id)
    if (!next) { removedLayers.push(layer.id); continue }
    if (layer.datasetId !== next.datasetId || JSON.stringify(previousDatasets.get(layer.datasetId)) !== JSON.stringify(nextDatasets.get(next.datasetId)) ||
        JSON.stringify(before.featuresByDataset[layer.datasetId] ?? []) !== JSON.stringify(after.featuresByDataset[next.datasetId] ?? [])) changedDatasets.push(layer.id)
    if (JSON.stringify(layer.style) !== JSON.stringify(next.style)) changedStyles.push(layer.id)
  }
  return { removedLayers, dataChangedLayers: changedDatasets, styleChangedLayers: changedStyles }
}

/** Apply only changed fields and stable-ID entries, preserving unrelated later host updates. */
function patchSnapshotContent(current: unknown, before: unknown, after: unknown): unknown {
  if (JSON.stringify(before) === JSON.stringify(after)) return cloneValue(current)
  if (Array.isArray(current) && Array.isArray(before) && Array.isArray(after)) {
    const keyed = (items: unknown[]): items is Array<Record<string, unknown> & { id: string }> => items.every(item =>
      !!item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') && new Set(items.map(item => (item as { id: string }).id)).size === items.length
    if (keyed(current) && keyed(before) && keyed(after)) {
      const previous = new Map(before.map(item => [item.id, item])), next = new Map(after.map(item => [item.id, item]))
      const retained = current.filter(item => !previous.has(item.id) || next.has(item.id)).map(item => next.has(item.id) && previous.has(item.id)
        ? patchSnapshotContent(item, previous.get(item.id), next.get(item.id)) as typeof item : cloneValue(item))
      const ids = new Set(retained.map(item => item.id))
      after.forEach(item => { if (!ids.has(item.id) && !previous.has(item.id)) retained.push(cloneValue(item)) })
      if (JSON.stringify(before.map(item => item.id)) !== JSON.stringify(after.map(item => item.id))) {
        const rank = new Map(after.map((item, index) => [item.id, index]))
        retained.sort((a, b) => (rank.get(a.id) ?? after.length) - (rank.get(b.id) ?? after.length))
      }
      return retained
    }
  }
  if (current && before && after && typeof current === 'object' && typeof before === 'object' && typeof after === 'object' &&
      !Array.isArray(current) && !Array.isArray(before) && !Array.isArray(after)) {
    const result = cloneValue(current) as Record<string, unknown>, old = before as Record<string, unknown>, next = after as Record<string, unknown>
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (!Object.hasOwn(next, key)) { delete result[key]; continue }
      const value = Object.hasOwn(old, key) ? patchSnapshotContent(result[key], old[key], next[key]) : cloneValue(next[key])
      Object.defineProperty(result, key, { value, configurable: true, writable: true, enumerable: true })
    }
    return result
  }
  return cloneValue(after)
}

/** One reversible content edit; existing selection and sessions are managed by the host delta path. */
export class ApplyProjectSnapshotEditCommand extends ReplaceProjectSnapshotCommand {
  readonly guardedLayerIds: readonly string[]
  constructor(id: string, label: string, before: ProjectSnapshot, after: ProjectSnapshot) {
    if (before.project.id !== after.project.id) throw new Error('内容编辑不能切换项目标识')
    super(id, label, before, after)
    const forward = getProjectSnapshotChanges(before, after), backward = getProjectSnapshotChanges(after, before)
    this.guardedLayerIds = Object.freeze([...new Set([...Object.values(forward).flat(), ...Object.values(backward).flat()])])
  }
  protected override apply(context: EditContext, snapshot: ProjectSnapshot): void {
    const ctx = requireProjectContext(context)
    if (!ctx.applySnapshotEdit) throw new Error('内容编辑需要宿主原子快照编辑接口')
    const current: ProjectSnapshot = { project: ctx.getProject(), featuresByDataset: ctx.featureStore.snapshot() }
    const source = snapshot === this.after ? this.before : this.after
    const applied = patchSnapshotContent(current, source, snapshot) as ProjectSnapshot
    // Host validation/guards run before touching the feature store.
    ctx.applySnapshotEdit(cloneValue(applied))
    const retained = new Set(applied.project.datasets.map(dataset => dataset.id))
    for (const id of Object.keys(ctx.featureStore.snapshot())) if (!retained.has(id)) ctx.featureStore.clear(id)
    for (const id of retained) ctx.featureStore.setAll(id, cloneValue(applied.featuresByDataset[id] ?? []))
  }
}

/** Add an independent local layer and dataset as one reversible project operation. */
export class AddLocalLayerCommand implements EditCommand {
  readonly label = '添加结果图层'
  private readonly dataset: Extract<Dataset, { kind: 'vector' }>
  private readonly layer: Layer
  private readonly features: GisFeature[]

  constructor(readonly id: string, dataset: Extract<Dataset, { kind: 'vector' }>, layer: Layer, features: GisFeature[]) {
    if (layer.datasetId !== dataset.id) throw new Error('图层与数据集标识不一致。')
    this.dataset = cloneValue(dataset); this.layer = cloneValue(layer); this.features = cloneValue(features)
  }

  execute(context: EditContext): void {
    const ctx = requireProjectContext(context), project = ctx.getProject()
    if (project.layers.some(layer => layer.id === this.layer.id) || project.datasets.some(dataset => dataset.id === this.dataset.id)) throw new Error('结果图层或数据集已存在。')
    ctx.featureStore.setAll(this.dataset.id, cloneValue(this.features))
    ctx.replaceProject({ ...project, datasets: [...project.datasets, cloneValue(this.dataset)], layers: [...project.layers, cloneValue(this.layer)], rootOrder: [...(project.rootOrder ?? []), { type: 'layer', id: this.layer.id }] })
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context), project = ctx.getProject()
    ctx.featureStore.clear(this.dataset.id)
    ctx.replaceProject({ ...project,
      datasets: project.datasets.filter(dataset => dataset.id !== this.dataset.id),
      layers: project.layers.filter(layer => layer.id !== this.layer.id),
      rootOrder: (project.rootOrder ?? []).filter(entry => entry.type !== 'layer' || entry.id !== this.layer.id),
      groups: (project.groups ?? []).map(group => ({ ...group, layerIds: group.layerIds.filter(id => id !== this.layer.id) }))
    })
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
