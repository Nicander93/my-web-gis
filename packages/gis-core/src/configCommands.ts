/**
 * Project configuration EditCommands (style / filter / opacity / layer-tree).
 * Share the same EditHistory as feature edits — no second global history.
 */
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { cloneValue } from './clone'
import type { EditCommand, EditContext } from './editHistory'
import type { FieldFilterCondition } from './filter'
import type { Dataset, DatasetField, GisFeature, Layer, LayerGroup, LayerTreeEntry, Project, ProjectSnapshot } from './types'
import { getLayerCartography, reconcileProjectCartography, remapCartographyField, setLegacyLayerStyle, setLayerCartographyFragment } from './cartography'

export interface ProjectEditContext extends EditContext {
  getProject(): Project
  replaceProject(project: Project): void
  /** Optional atomic host path for whole-content replacement. */
  replaceSnapshot?(snapshot: ProjectSnapshot): void
  /** Atomic same-project content edit; host preserves unaffected UI sessions. */
  applySnapshotEdit?(snapshot: ProjectSnapshot): void
  /** Host-only table references follow a field rename/removal without clearing sessions. */
  onDatasetFieldChange?(datasetId: string, from: string | undefined, to: string | undefined): void
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

export interface DatasetContent {
  fields?: DatasetField[]
  features: GisFeature[]
  layers?: Array<Pick<Layer, 'id' | 'filter' | 'style' | 'interaction'>>
}

/** Writes validated fields and rows together, retaining table sessions and stable IDs. */
export class SetDatasetContentCommand implements EditCommand {
  readonly guardedLayerIds: string[]
  private readonly before: DatasetContent
  private readonly after: DatasetContent
  private beforeCartography?: NonNullable<ReturnType<typeof getLayerCartography>>[]
  private afterCartography?: NonNullable<ReturnType<typeof getLayerCartography>>[]
  constructor(readonly id: string, readonly label: string,
    private readonly datasetId: string, before: DatasetContent, after: DatasetContent,
    private readonly fieldChange?: { before?: string; after?: string }) {
    this.before = cloneValue(before)
    this.after = cloneValue(after)
    this.guardedLayerIds = [...new Set([...(before.layers ?? []), ...(after.layers ?? [])].map((layer) => layer.id))]
  }
  execute(context: EditContext): void {
    this.apply(context, this.after, true)
    if (this.fieldChange) requireProjectContext(context).onDatasetFieldChange?.(this.datasetId, this.fieldChange.before, this.fieldChange.after)
  }
  undo(context: EditContext): void {
    this.apply(context, this.before, false)
    if (this.fieldChange) requireProjectContext(context).onDatasetFieldChange?.(this.datasetId, this.fieldChange.after, this.fieldChange.before)
  }
  private apply(context: EditContext, content: DatasetContent, forward: boolean): void {
    const ctx = requireProjectContext(context)
    const project = ctx.getProject()
    if (!project.datasets.some((dataset) => dataset.id === this.datasetId)) {
      throw new Error('字段编辑的目标数据集已不存在')
    }
    const configs = new Map(content.layers?.map((layer) => [layer.id, layer]) ?? [])
    for (const id of configs.keys()) {
      if (project.layers.find((layer) => layer.id === id)?.datasetId !== this.datasetId) {
        throw new Error('字段编辑的图层已不存在或已绑定其他数据集')
      }
    }
    let next = { ...project, layers: project.layers.map((layer) => {
      const config = configs.get(layer.id)
      return config ? { ...layer, ...cloneValue(config) } : layer
    }), datasets: project.datasets.map((dataset) =>
      dataset.id === this.datasetId ? { ...dataset, fields: cloneValue(content.fields) } : dataset) }
    if (this.fieldChange?.before) {
      const fragments = (source: Project) => source.layers.filter(layer => layer.datasetId === this.datasetId)
        .flatMap(layer => { const fragment = getLayerCartography(source, layer.id); return fragment ? [cloneValue(fragment)] : [] })
      if (!this.beforeCartography) {
        const normalized = reconcileProjectCartography(project)
        const beforeCartography = fragments(normalized)
        next = remapCartographyField(normalized, next, this.datasetId, this.fieldChange.before, this.fieldChange.after)
        this.beforeCartography = beforeCartography
        this.afterCartography = fragments(next)
      } else {
        for (const fragment of (forward ? this.afterCartography : this.beforeCartography) ?? []) next = setLayerCartographyFragment(next, fragment)
      }
    }
    next = reconcileProjectCartography(next)
    // Validate the complete content before writing rows, so a rejected expression edit is atomic.
    ctx.replaceProject(next)
    ctx.featureStore.setAll(this.datasetId, cloneValue(content.features))
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
    if (JSON.stringify(layer.style) !== JSON.stringify(next.style) ||
        JSON.stringify(getLayerCartography(before.project, layer.id)) !== JSON.stringify(getLayerCartography(after.project, layer.id))) changedStyles.push(layer.id)
  }
  return { removedLayers, dataChangedLayers: changedDatasets, styleChangedLayers: changedStyles }
}

/** Apply only changed fields and stable-ID entries, preserving unrelated later host updates. */
function patchSnapshotContent(current: unknown, before: unknown, after: unknown): unknown {
  if (JSON.stringify(before) === JSON.stringify(after)) return cloneValue(current)
  if (Array.isArray(current) && Array.isArray(before) && Array.isArray(after)) {
    const key = (item: unknown): string | undefined => {
      if (!item || typeof item !== 'object') return undefined
      const value = 'id' in item ? item.id : 'gisLayerId' in item ? item.gisLayerId : undefined
      return typeof value === 'string' ? value : undefined
    }
    const keyed = (items: unknown[]) => items.every(item => key(item) !== undefined) && new Set(items.map(key)).size === items.length
    if (keyed(current) && keyed(before) && keyed(after)) {
      const previous = new Map(before.map(item => [key(item), item])), next = new Map(after.map(item => [key(item), item]))
      const retained = current.filter(item => !previous.has(key(item)) || next.has(key(item))).map(item => next.has(key(item)) && previous.has(key(item))
        ? patchSnapshotContent(item, previous.get(key(item)), next.get(key(item))) : cloneValue(item))
      const ids = new Set(retained.map(key))
      after.forEach(item => { if (!ids.has(key(item)) && !previous.has(key(item))) retained.push(cloneValue(item)) })
      if (JSON.stringify(before.map(key)) !== JSON.stringify(after.map(key))) {
        const rank = new Map(after.map((item, index) => [key(item), index]))
        retained.sort((a, b) => (rank.get(key(a)) ?? after.length) - (rank.get(key(b)) ?? after.length))
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

/** Immediate style edits share one undo entry only within an explicit gesture. */
export class SetLayerStyleCommand implements EditCommand {
  readonly label = '编辑样式'
  readonly mergeable: boolean
  readonly mergeKey?: string
  private captured = false
  private beforeCartography?: ReturnType<typeof getLayerCartography>
  private after: LayerStyle
  private readonly before: LayerStyle

  constructor(
    readonly id: string,
    private readonly layerId: string,
    before: LayerStyle,
    after: LayerStyle,
    transactionId?: string
  ) {
    this.before = cloneValue(before)
    this.after = cloneValue(after)
    this.mergeable = transactionId !== undefined
    if (transactionId !== undefined) this.mergeKey = `style:${layerId}:${transactionId}`
  }

  absorb(next: EditCommand): void {
    if (!(next instanceof SetLayerStyleCommand)) throw new Error('样式命令只能合并相同类型')
    this.after = cloneValue(next.after)
  }

  execute(context: EditContext): void {
    const ctx = requireProjectContext(context)
    const project = ctx.getProject()
    if (!this.captured) {
      this.beforeCartography = cloneValue(getLayerCartography(project, this.layerId))
      this.captured = true
    }
    ctx.replaceProject(setLegacyLayerStyle(project, this.layerId, this.after))
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    const project = replaceLayer(ctx.getProject(), this.layerId, { style: cloneValue(this.before) })
    ctx.replaceProject(this.beforeCartography
      ? setLayerCartographyFragment(project, this.beforeCartography)
      : setLegacyLayerStyle(project, this.layerId, this.before))
  }
}

type LayerCartographyFragment = NonNullable<ReturnType<typeof getLayerCartography>>

/** Stores one standard Style Layer fragment without replacing other GIS layers. */
export class SetLayerCartographyCommand implements EditCommand {
  readonly label = '编辑标准样式'
  readonly mergeable: boolean
  readonly mergeKey?: string
  private readonly before: LayerCartographyFragment
  private after: LayerCartographyFragment

  constructor(
    readonly id: string,
    private readonly layerId: string,
    before: LayerCartographyFragment,
    after: LayerCartographyFragment,
    transactionId?: string
  ) {
    if (before.binding.gisLayerId !== layerId || after.binding.gisLayerId !== layerId) {
      throw new Error(`标准样式fragment不属于图层 ${layerId}`)
    }
    if (
      before.binding.datasetId !== after.binding.datasetId ||
      before.binding.styleSourceId !== after.binding.styleSourceId
    ) {
      throw new Error(`标准样式编辑不能改变图层 ${layerId} 的数据绑定`)
    }
    this.before = cloneValue(before)
    this.after = cloneValue(after)
    this.mergeable = transactionId !== undefined
    if (transactionId !== undefined) this.mergeKey = `cartography:${layerId}:${transactionId}`
  }

  absorb(next: EditCommand): void {
    if (!(next instanceof SetLayerCartographyCommand)) throw new Error('标准样式命令只能合并相同类型')
    this.after = cloneValue(next.after)
  }

  execute(context: EditContext): void {
    const ctx = requireProjectContext(context)
    if (!getLayerCartography(ctx.getProject(), this.layerId)) throw new Error(`图层 ${this.layerId} 不支持二维矢量样式`)
    ctx.replaceProject(setLayerCartographyFragment(ctx.getProject(), this.after))
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(setLayerCartographyFragment(ctx.getProject(), this.before))
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
