import { assertProjectSnapshotWorkspace, requireMapContent } from '../config/project-content'
/**
 * 项目配置类的编辑命令：样式、过滤、不透明度和图层树。
 * Share the same EditHistory as feature edits — no second global history.
 */
import type { LayerStyle } from '@desktop-webgis/ol-style'
import type { SchemaIdentityEdit } from '../data/field-identities'
import { cloneValue } from '../clone'
import { rebaseCartographyFieldReferences, remapFieldFilterReferences, remapLayerFieldReferences, type FieldNameMap, type FieldReferenceRebase } from '../config/field-references'
import type { EditCommand, EditContext, EditTargets } from './editHistory'
import { getConfigurationEditTargets, getLayerTreeEditTargets, mergeEditTargets, sameValue } from './edit-targets'
import type { FieldFilterCondition } from '../data/filter'
import type { Dataset, DatasetField, GisFeature, Layer, LayerGroup, LayerTreeEntry, MapState, Project, ProjectSnapshot } from '../config/types'
import { getLayerCartography, reconcileProjectCartography, remapCartographyField, remapLayerCartographyReferences, setLegacyLayerStyle, setLayerCartographyFragment } from '../config/cartography'
import { getEffectiveLocked, getLayerGroupState } from '../config/layer-tree'

export interface ProjectEditContext extends EditContext {
  /** 只有在命令的配置和数据提交都成功之后，才执行应用界面的后续动作。 */
  afterCommit?(effect: () => void): void
  getProject(): Project
  replaceProject(project: Project): void
  /** 原子宿主持有项目和要素的整体替换，包括发布之前的校验。 */
  replaceSnapshot?(snapshot: ProjectSnapshot, runtime?: { key: object; side: 'before' | 'after' }): void
  /** 宿主同时写入配置和行数据，未受影响的界面会话保持不变。 */
  applySnapshotEdit?(snapshot: ProjectSnapshot, edit?: SchemaIdentityEdit): void
  setDatasetContent?(datasetId: string, content: Pick<DatasetContent, 'fields' | 'features'>, edit: SchemaIdentityEdit): void
  /** 宿主专有的表格引用会跟随字段的重命名或删除，但不清空会话。 */
  onDatasetFieldChange?(datasetId: string, from: string | undefined, to: string | undefined): void
  /** 宿主在发布被移除的图层之前，先取消请求并清理会话。 */
  onLayersRemoved?(layerIds: readonly string[]): void
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
  return { ...project, content: { ...requireMapContent(project), layers: requireMapContent(project).layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)) } }
}

function remapProjectReferences(project: Project, references: FieldReferenceRebase, fields: FieldNameMap): Project {
  if (project.content.kind !== 'map2d' || !fields.size) return project
  let next = { ...project, content: { ...project.content, layers: project.content.layers.map(layer =>
    layer.datasetId === references.datasetId ? remapLayerFieldReferences(layer, fields) : layer) } } as Project
  for (const layer of project.content.layers) if (layer.datasetId === references.datasetId) {
    const fragment = getLayerCartography(project, layer.id)
    if (fragment) next = setLayerCartographyFragment(next, remapLayerCartographyReferences(layer, fragment, fields))
  }
  return next
}

export interface DatasetContent {
  fields?: DatasetField[]
  features: GisFeature[]
  layers?: Array<Pick<Layer, 'id' | 'filter' | 'style' | 'interaction'>>
}

/** 把校验过的字段和行一起写入，保留表格会话和稳定的 ID。 */
export class SetDatasetContentCommand implements EditCommand {
  get targets(): EditTargets { return { datasetIds: [this.datasetId], layerIds: this.guardedLayerIds } }
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
  rebaseDataCommit(datasetId: string, _rows?: GisFeature[], _fields?: DatasetField[], references?: FieldReferenceRebase): EditCommand | undefined {
    if (datasetId !== this.datasetId) return this
    if (references && this.fieldChange) {
      const before = this.before.layers?.map(layer => remapLayerFieldReferences(layer, references.before))
      const after = this.after.layers?.map(layer => remapLayerFieldReferences(layer, references.after))
      if (!sameValue(before, after)) throw new Error('Mixed layer/data edits require a schema-aware reference rebase')
      const fragments = (values: typeof this.beforeCartography, configs: typeof this.before.layers, fields: FieldNameMap) => values?.map(fragment => {
        const layer = configs?.find(layer => layer.id === fragment.binding.gisLayerId)
        if (!layer) throw new Error('Missing historical layer configuration')
        return remapLayerCartographyReferences({ ...layer, datasetId }, fragment, fields)
      })
      if (!sameValue(fragments(this.beforeCartography, this.before.layers, references.before),
        fragments(this.afterCartography, this.after.layers, references.after))) throw new Error('Mixed cartography/data edits require a schema-aware reference rebase')
      return undefined
    }
    const oldNames = new Set(this.before.fields?.map(field => field.name) ?? this.before.features.flatMap(feature => Object.keys(feature.properties)))
    const nextNames = this.after.fields ? new Set(this.after.fields.map(field => field.name)) :
      this.before.fields ? new Set(this.after.features.flatMap(feature => Object.keys(feature.properties))) : undefined
    if (this.fieldChange?.before && this.fieldChange.before !== this.fieldChange.after ||
      nextNames && [...oldNames].some(name => !nextNames.has(name))) {
      throw new Error('Field removal/rename requires a schema-aware reference rebase')
    }
    if (JSON.stringify(this.before.layers) !== JSON.stringify(this.after.layers)) throw new Error('Mixed layer/data edits require a schema-aware reference rebase')
    // 新增字段，以及对同名字段改值或改类型，都会保留之前所有的引用名称。
    return undefined
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
    if (!requireMapContent(project).datasets.some((dataset) => dataset.id === this.datasetId)) {
      throw new Error('字段编辑的目标数据集已不存在')
    }
    const configs = new Map(content.layers?.map((layer) => [layer.id, layer]) ?? [])
    for (const id of configs.keys()) {
      if (requireMapContent(project).layers.find((layer) => layer.id === id)?.datasetId !== this.datasetId) {
        throw new Error('字段编辑的图层已不存在或已绑定其他数据集')
      }
    }
    let next: Project = { ...project, content: { ...requireMapContent(project), layers: requireMapContent(project).layers.map((layer) => {
      const config = configs.get(layer.id)
      return config ? { ...layer, ...cloneValue(config) } : layer
    }), datasets: requireMapContent(project).datasets.map((dataset) =>
      dataset.id === this.datasetId ? { ...dataset, fields: cloneValue(content.fields) } : dataset) } }
    if (this.fieldChange?.before) {
      const fragments = (source: Project) => requireMapContent(source).layers.filter(layer => layer.datasetId === this.datasetId)
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
    // 在写入行之前校验完整内容，保证被拒绝的表达式编辑是原子的。
    ctx.replaceProject(next)
    if (ctx.setDatasetContent) ctx.setDatasetContent(this.datasetId, cloneValue({ fields: content.fields, features: content.features }), {
      key: this, forward, before: this.fieldChange?.before, after: this.fieldChange?.after
    })
    else ctx.featureStore.setAll(this.datasetId, cloneValue(content.features))
  }
}

/** 把项目内容和全部要素数据集作为一次操作替换，记录在已有的历史里。 */
export class ReplaceProjectSnapshotCommand implements EditCommand {
  readonly runtimeResourceKeys: readonly object[]
  get targets(): EditTargets { return getConfigurationEditTargets(this.before.project, this.after.project) }
  protected readonly before: ProjectSnapshot
  protected readonly after: ProjectSnapshot
  constructor(readonly id: string, readonly label: string, before: ProjectSnapshot, after: ProjectSnapshot,
    protected readonly resourceKey: object = Object.freeze({})) {
    assertProjectSnapshotWorkspace(before)
    assertProjectSnapshotWorkspace(after)
    if (before.project.content.kind !== after.project.content.kind) throw new Error('内容编辑不能切换工作区，请先新建对应类型的工程')
    this.before = cloneValue(before); this.after = cloneValue(after)
    this.runtimeResourceKeys = Object.freeze([resourceKey])
  }
  protected recreateResourceSnapshot(before: ProjectSnapshot, after: ProjectSnapshot): ReplaceProjectSnapshotCommand {
    return new ReplaceProjectSnapshotCommand(this.id, this.label, before, after, this.resourceKey)
  }
  rebaseDatasetLifecycleCommit(datasetId: string, rows: GisFeature[], fields: DatasetField[] | undefined, references: FieldReferenceRebase): EditCommand {
    const update = (snapshot: ProjectSnapshot, side: 'before' | 'after'): ProjectSnapshot => {
      if (!references.matchingSides.includes(side)) return cloneValue(snapshot)
      const project = remapProjectReferences(snapshot.project, references, references[side])
      if (project.content.kind !== 'map2d' || !project.content.datasets.some(dataset => dataset.id === datasetId)) throw new Error('Matched snapshot dataset is missing')
      return { project: { ...project, content: { ...project.content, datasets: project.content.datasets.map(dataset =>
        dataset.id === datasetId ? { ...dataset, fields: cloneValue(fields) } : dataset) } },
      featuresByDataset: { ...cloneValue(snapshot.featuresByDataset), [datasetId]: cloneValue(rows) } }
    }
    return this.recreateResourceSnapshot(update(this.before, 'before'), update(this.after, 'after'))
  }
  execute(context: EditContext): void { this.apply(context, this.after) }
  undo(context: EditContext): void { this.apply(context, this.before) }
  protected apply(context: EditContext, snapshot: ProjectSnapshot): void {
    const ctx = requireProjectContext(context)
    if (ctx.replaceSnapshot) { ctx.replaceSnapshot(cloneValue(snapshot), { key: this.resourceKey, side: snapshot === this.before ? 'before' : 'after' }); return }
    const retained = new Set(snapshot.project.content.kind === 'map2d' ? snapshot.project.content.datasets.map(dataset => dataset.id) : [])
    for (const id of Object.keys(ctx.featureStore.snapshot())) if (!retained.has(id)) ctx.featureStore.clear(id)
    for (const id of retained) ctx.featureStore.setAll(id, cloneValue(snapshot.featuresByDataset[id] ?? []))
    ctx.replaceProject(cloneValue(snapshot.project))
  }
}

/** 描述在同一个项目内编辑之后，哪些已有的图层会话会失效。 */
export function getProjectSnapshotChanges(before: ProjectSnapshot, after: ProjectSnapshot): {
  removedLayers: string[]; dataChangedLayers: string[]; styleChangedLayers: string[]
} {
  const removedLayers: string[] = [], changedDatasets: string[] = [], changedStyles: string[] = []
  if (before.project.content.kind !== after.project.content.kind) throw new Error('内容编辑不能切换工作区')
  if (before.project.content.kind === 'scene3d') return { removedLayers, dataChangedLayers: changedDatasets, styleChangedLayers: changedStyles }
  const nextLayers = new Map(requireMapContent(after.project).layers.map(layer => [layer.id, layer]))
  const previousDatasets = new Map(requireMapContent(before.project).datasets.map(dataset => [dataset.id, dataset]))
  const nextDatasets = new Map(requireMapContent(after.project).datasets.map(dataset => [dataset.id, dataset]))
  for (const layer of requireMapContent(before.project).layers) {
    const next = nextLayers.get(layer.id)
    if (!next) { removedLayers.push(layer.id); continue }
    if (layer.datasetId !== next.datasetId || JSON.stringify(previousDatasets.get(layer.datasetId)) !== JSON.stringify(nextDatasets.get(next.datasetId)) ||
        JSON.stringify(before.featuresByDataset[layer.datasetId] ?? []) !== JSON.stringify(after.featuresByDataset[next.datasetId] ?? [])) changedDatasets.push(layer.id)
    if (JSON.stringify(layer.style) !== JSON.stringify(next.style) ||
        JSON.stringify(getLayerCartography(before.project, layer.id)) !== JSON.stringify(getLayerCartography(after.project, layer.id))) changedStyles.push(layer.id)
  }
  return { removedLayers, dataChangedLayers: changedDatasets, styleChangedLayers: changedStyles }
}

/** 只应用发生变化的字段和稳定 ID 的条目，保留之后宿主对无关内容的更新。 */
function patchSnapshotContent(current: unknown, before: unknown, after: unknown): unknown {
  if (JSON.stringify(before) === JSON.stringify(after)) return current
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
        ? patchSnapshotContent(item, previous.get(key(item)), next.get(key(item))) : item)
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
    const result = { ...current } as Record<string, unknown>, old = before as Record<string, unknown>, next = after as Record<string, unknown>
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (!Object.hasOwn(next, key)) { delete result[key]; continue }
      const value = Object.hasOwn(old, key) ? patchSnapshotContent(result[key], old[key], next[key]) : cloneValue(next[key])
      Object.defineProperty(result, key, { value, configurable: true, writable: true, enumerable: true })
    }
    return result
  }
  return cloneValue(after)
}

/** 配置草稿走同一条历史，但不捕获要素行，也不授予访问要素行的能力。 */
export class ApplyProjectConfigurationCommand implements EditCommand {
  rebaseFieldReferences(references: FieldReferenceRebase): EditCommand {
    return new ApplyProjectConfigurationCommand(this.id, this.label,
      remapProjectReferences(this.before, references, references.before), remapProjectReferences(this.after, references, references.after), this.targets)
  }
  readonly targets: EditTargets
  readonly scope = 'configuration' as const
  private readonly before: Project
  private readonly after: Project
  constructor(readonly id: string, readonly label: string, before: Project, after: Project, targets?: EditTargets) {
    if (before.metadata.id !== after.metadata.id || before.content.kind !== after.content.kind) throw new Error('配置编辑不能切换工程或工作区')
    if (before.content.kind === 'map2d' && after.content.kind === 'map2d') {
      const identities = (project: Project) => {
        const content = requireMapContent(project)
        return { datasets: content.datasets.map(item => [item.id, item.kind]).sort(), layers: content.layers.map(item => [item.id, item.datasetId]).sort() }
      }
      if (JSON.stringify(identities(before)) !== JSON.stringify(identities(after))) throw new Error('配置编辑不能创建、删除或重新绑定图层与数据集')
    }
    this.before = cloneValue(before); this.after = cloneValue(after)
    this.targets = mergeEditTargets(getConfigurationEditTargets(this.before, this.after), targets)
  }
  execute(context: EditContext): void { this.apply(context, this.before, this.after) }
  undo(context: EditContext): void { this.apply(context, this.after, this.before) }
  private apply(context: EditContext, before: Project, after: Project): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(patchSnapshotContent(ctx.getProject(), before, after) as Project)
  }
}

/** 一次可逆的内容编辑；已有的选择集和会话由宿主的增量路径管理。 */
export class ApplyProjectSnapshotEditCommand extends ReplaceProjectSnapshotCommand {
  protected readonly schemaKey: object
  readonly guardedLayerIds: readonly string[]
  readonly dataDatasetIds: readonly string[]
  constructor(id: string, label: string, before: ProjectSnapshot, after: ProjectSnapshot, schemaKey?: object) {
    if (before.project.metadata.id !== after.project.metadata.id) throw new Error('内容编辑不能切换项目标识')
    super(id, label, before, after)
    this.schemaKey = schemaKey ?? Object.freeze({})
    this.dataDatasetIds = Object.freeze([...new Set([...Object.keys(before.featuresByDataset), ...Object.keys(after.featuresByDataset),
      ...(before.project.content.kind === 'map2d' ? before.project.content.datasets.map(dataset => dataset.id) : []),
      ...(after.project.content.kind === 'map2d' ? after.project.content.datasets.map(dataset => dataset.id) : [])])].filter(datasetId =>
      before.project.content.kind === 'map2d' && after.project.content.kind === 'map2d' &&
      before.project.content.datasets.some(dataset => dataset.id === datasetId) && after.project.content.datasets.some(dataset => dataset.id === datasetId) &&
      (JSON.stringify(before.featuresByDataset[datasetId] ?? []) !== JSON.stringify(after.featuresByDataset[datasetId] ?? []) ||
        JSON.stringify(before.project.content.datasets.find(dataset => dataset.id === datasetId)?.fields) !== JSON.stringify(after.project.content.datasets.find(dataset => dataset.id === datasetId)?.fields))))
    const forward = getProjectSnapshotChanges(before, after), backward = getProjectSnapshotChanges(after, before)
    this.guardedLayerIds = Object.freeze([...new Set([...Object.values(forward).flat(), ...Object.values(backward).flat()])])
  }
  /** 子类保留各自的宿主后续行为，以及原有的字段结构回滚帧。 */
  protected recreate(before: ProjectSnapshot, after: ProjectSnapshot): ApplyProjectSnapshotEditCommand {
    return new ApplyProjectSnapshotEditCommand(this.id, this.label, before, after, this.schemaKey)
  }
  rebaseDatasetLifecycleCommit(datasetId: string, rows: GisFeature[], fields: DatasetField[] | undefined, references: FieldReferenceRebase): EditCommand {
    if (this.dataDatasetIds.includes(datasetId)) throw new Error('Stale data history cannot be rebased as dataset lifecycle')
    const update = (snapshot: ProjectSnapshot, names: FieldNameMap): ProjectSnapshot => {
      let project = remapProjectReferences(snapshot.project, references, names)
      if (project.content.kind !== 'map2d' || !project.content.datasets.some(dataset => dataset.id === datasetId)) return cloneValue(snapshot)
      project = { ...project, content: { ...project.content, datasets: project.content.datasets.map(dataset =>
        dataset.id === datasetId ? { ...dataset, fields: cloneValue(fields) } : dataset) } }
      return { project, featuresByDataset: { ...cloneValue(snapshot.featuresByDataset), [datasetId]: cloneValue(rows) } }
    }
    return this.recreate(update(this.before, references.before), update(this.after, references.after))
  }
  rebaseDataCommit(datasetId: string, committedRows: GisFeature[], committedFields?: DatasetField[], references?: FieldReferenceRebase): EditCommand | undefined {
    if (!this.dataDatasetIds.includes(datasetId)) return this
    const before = cloneValue(this.before), after = cloneValue(this.after)
    if (before.project.content.kind !== 'map2d' || after.project.content.kind !== 'map2d') return this
    if (references) {
      before.project = remapProjectReferences(before.project, references, references.before)
      after.project = remapProjectReferences(after.project, references, references.after)
    }
    if (before.project.content.kind !== 'map2d' || after.project.content.kind !== 'map2d') return this
    const oldDataset = before.project.content.datasets.find(dataset => dataset.id === datasetId)
    const newDataset = after.project.content.datasets.find(dataset => dataset.id === datasetId)
    const oldNames = new Set(oldDataset?.fields?.map(field => field.name) ?? before.featuresByDataset[datasetId]?.flatMap(feature => Object.keys(feature.properties)) ?? [])
    const nextNames = new Set(newDataset?.fields?.map(field => field.name) ?? after.featuresByDataset[datasetId]?.flatMap(feature => Object.keys(feature.properties)) ?? [])
    if (!references && JSON.stringify(oldDataset?.fields) !== JSON.stringify(newDataset?.fields) && [...oldNames].some(name => !nextNames.has(name))) throw new Error('Field removal/rename requires a schema-aware data commit')
    if (oldDataset) oldDataset.fields = cloneValue(committedFields)
    if (newDataset) newDataset.fields = cloneValue(committedFields)
    before.featuresByDataset[datasetId] = cloneValue(committedRows)
    after.featuresByDataset[datasetId] = cloneValue(committedRows)
    if (sameValue(before, after)) return undefined
    if (sameValue(before.featuresByDataset, after.featuresByDataset)) {
      const identities = (snapshot: ProjectSnapshot) => snapshot.project.content.kind === 'map2d' ? {
        datasets: snapshot.project.content.datasets.map(dataset => [dataset.id, dataset.kind]).sort(),
        layers: snapshot.project.content.layers.map(layer => [layer.id, layer.datasetId]).sort()
      } : null
      if (JSON.stringify(identities(before)) === JSON.stringify(identities(after))) return new ApplyProjectConfigurationCommand(this.id, this.label, before.project, after.project)
    }
    return this.recreate(before, after)
  }
  protected override apply(context: EditContext, snapshot: ProjectSnapshot): void {
    const ctx = requireProjectContext(context)
    if (!ctx.applySnapshotEdit) throw new Error('内容编辑需要宿主原子快照编辑接口')
    const current: ProjectSnapshot = { project: ctx.getProject(), featuresByDataset: ctx.featureStore.snapshot() }
    const source = snapshot === this.after ? this.before : this.after
    const applied = patchSnapshotContent(current, source, snapshot) as ProjectSnapshot
    // 宿主的校验和守卫在触碰要素存储之前执行。
    ctx.applySnapshotEdit(cloneValue(applied), { key: this.schemaKey, forward: snapshot === this.after, datasetIds: this.dataDatasetIds })
  }
}

/** 只删除配置和因此孤立的数据集行；不相关的行不会被带进这条命令。 */
export class RemoveLayerContentCommand implements EditCommand {
  rebaseDatasetLifecycleCommit(datasetId: string, rows: GisFeature[], fields: DatasetField[] | undefined, references: FieldReferenceRebase): EditCommand {
    const update = (project: Project, names: FieldNameMap): Project => {
      const next = remapProjectReferences(project, references, names)
      return next.content.kind !== 'map2d' ? next : { ...next, content: { ...next.content, datasets: next.content.datasets.map(dataset =>
        dataset.id === datasetId ? { ...dataset, fields: cloneValue(fields) } : dataset) } }
    }
    return new RemoveLayerContentCommand(this.id, this.label, update(this.before, references.before), update(this.after, references.after),
      Object.hasOwn(this.rows, datasetId) ? { ...this.rows, [datasetId]: rows } : this.rows)
  }
  get targets(): EditTargets { return getConfigurationEditTargets(this.before, this.after) }
  private readonly before: Project
  private readonly after: Project
  private readonly rows: Record<string, GisFeature[]>
  readonly guardedLayerIds: readonly string[]
  private readonly removedGroupIds: string[]

  constructor(readonly id: string, readonly label: string, before: Project, after: Project, rows: Record<string, GisFeature[]>) {
    if (before.metadata.id !== after.metadata.id) throw new Error('删除内容不能切换工程')
    this.before = cloneValue(before)
    this.after = cloneValue(after)
    this.rows = cloneValue(rows)
    const retainedLayers = new Set(requireMapContent(after).layers.map(layer => layer.id))
    const retainedGroups = new Set(requireMapContent(after).groups.map(group => group.id))
    const retainedDatasets = new Set(requireMapContent(after).datasets.map(dataset => dataset.id))
    this.guardedLayerIds = Object.freeze(requireMapContent(before).layers.filter(layer => !retainedLayers.has(layer.id)).map(layer => layer.id))
    this.removedGroupIds = requireMapContent(before).groups.filter(group => !retainedGroups.has(group.id)).map(group => group.id)
    if (Object.keys(rows).some(id => retainedDatasets.has(id) || !requireMapContent(before).datasets.some(dataset => dataset.id === id))) {
      throw new Error('删除命令只能保存已移除的数据集数据')
    }
  }

  execute(context: EditContext): void {
    const ctx = requireProjectContext(context), project = ctx.getProject()
    if (this.guardedLayerIds.some(id => getEffectiveLocked(project, id)) || this.removedGroupIds.some(id => getLayerGroupState(project, id).locked)) {
      throw new Error('请先解锁图层、文件夹及其后代')
    }
    ctx.replaceProject(patchSnapshotContent(project, this.before, this.after) as Project)
    for (const id of Object.keys(this.rows)) ctx.featureStore.clear(id)
    ctx.onLayersRemoved?.(this.guardedLayerIds)
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(patchSnapshotContent(ctx.getProject(), this.after, this.before) as Project)
    for (const [id, rows] of Object.entries(this.rows)) ctx.featureStore.setAll(id, cloneValue(rows))
  }
}

/** 新增一个独立归属的数据集和图层，可以带初始的本地行。 */
export class AddDatasetLayerCommand implements EditCommand {
  rebaseDatasetLifecycleCommit(datasetId: string, rows: GisFeature[], fields: DatasetField[] | undefined, references: FieldReferenceRebase): AddDatasetLayerCommand {
    return datasetId !== this.dataset.id ? this : new AddDatasetLayerCommand(this.id, { ...this.dataset, fields: cloneValue(fields) },
      remapLayerFieldReferences(this.layer, references.after), rows, this.label)
  }
  get targets(): EditTargets { return { layerIds: [this.layer.id] } }
  private readonly dataset: Dataset
  private readonly layer: Layer
  private readonly features?: GisFeature[]

  constructor(readonly id: string, dataset: Dataset, layer: Layer, features?: GisFeature[], readonly label = '添加图层') {
    if (layer.datasetId !== dataset.id) throw new Error('图层与数据集标识不一致。')
    this.dataset = cloneValue(dataset); this.layer = cloneValue(layer); this.features = cloneValue(features)
  }

  execute(context: EditContext): void {
    const ctx = requireProjectContext(context), project = ctx.getProject()
    if (requireMapContent(project).layers.some(layer => layer.id === this.layer.id) || requireMapContent(project).datasets.some(dataset => dataset.id === this.dataset.id)) throw new Error('结果图层或数据集已存在。')
    // 在初始化行存储之前，先在暂存的项目里声明归属。
    ctx.replaceProject({ ...project, content: { ...requireMapContent(project), datasets: [...requireMapContent(project).datasets, cloneValue(this.dataset)], layers: [...requireMapContent(project).layers, cloneValue(this.layer)], rootOrder: [...(requireMapContent(project).rootOrder ?? []), { type: 'layer', id: this.layer.id }] } })
    if (this.features !== undefined) ctx.featureStore.setAll(this.dataset.id, cloneValue(this.features))
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context), project = ctx.getProject()
    ctx.replaceProject({ ...project, content: { ...requireMapContent(project), datasets: requireMapContent(project).datasets.filter(dataset => dataset.id !== this.dataset.id), layers: requireMapContent(project).layers.filter(layer => layer.id !== this.layer.id), rootOrder: (requireMapContent(project).rootOrder ?? []).filter(entry => entry.type !== 'layer' || entry.id !== this.layer.id), groups: (requireMapContent(project).groups ?? []).map(group => ({ ...group, layerIds: group.layerIds.filter(id => id !== this.layer.id) })) } })
    ctx.featureStore.clear(this.dataset.id)
    ctx.onLayersRemoved?.([this.layer.id])
  }
}

/** 本地处理和复制的结果，保留原有的公开命令和历史标签。 */
export class AddLocalLayerCommand extends AddDatasetLayerCommand {
  constructor(id: string, dataset: Extract<Dataset, { kind: 'vector' }>, layer: Layer, features: GisFeature[]) {
    super(id, dataset, layer, features, '添加结果图层')
  }
}

/** 连续即时生效的样式编辑，只在同一个明确的手势内合并成一条撤销记录。 */
export class SetLayerStyleCommand implements EditCommand {
  rebaseFieldReferences(references: FieldReferenceRebase): EditCommand {
    if (!references.layerIds.includes(this.layerId)) return this
    const before = remapLayerFieldReferences({ style: this.before }, references.before).style
    const after = remapLayerFieldReferences({ style: this.after }, references.after).style
    const next = new SetLayerStyleCommand(this.id, this.layerId, before, after)
    next.captured = this.captured
    if (this.beforeCartography) next.beforeCartography = remapLayerCartographyReferences({ id: this.layerId,
      datasetId: references.datasetId, style: this.before }, this.beforeCartography, references.before)
    return next
  }
  get targets(): EditTargets { return { layerIds: [this.layerId] } }
  readonly scope = 'configuration' as const
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

/** 存储一个标准的 Style Layer 片段，不替换其它 GIS 图层。 */
export class SetLayerCartographyCommand implements EditCommand {
  rebaseFieldReferences(references: FieldReferenceRebase): EditCommand {
    return !references.layerIds.includes(this.layerId) ? this : new SetLayerCartographyCommand(this.id, this.layerId,
      rebaseCartographyFieldReferences(this.before, references.before), rebaseCartographyFieldReferences(this.after, references.after))
  }
  get targets(): EditTargets { return { layerIds: [this.layerId] } }
  readonly scope = 'configuration' as const
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

/** 持久化字段过滤条件 F。 */
export class SetLayerFilterCommand implements EditCommand {
  rebaseFieldReferences(references: FieldReferenceRebase): EditCommand | undefined {
    if (!references.layerIds.includes(this.layerId)) return this
    const before = remapFieldFilterReferences(this.before, references.before), after = remapFieldFilterReferences(this.after, references.after)
    return JSON.stringify(before) === JSON.stringify(after) ? undefined : new SetLayerFilterCommand(this.id, this.layerId, before, after)
  }
  get targets(): EditTargets { return { layerIds: [this.layerId] } }
  readonly scope = 'configuration' as const
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
 * 不透明度变更。带有相同 mergeKey 的连续命令会合并，这样
 * 拖动滑块会合并成一步撤销。
 */
export class SetLayerOpacityCommand implements EditCommand {
  rebaseFieldReferences(): EditCommand { return this }
  get targets(): EditTargets { return { layerIds: [this.layerId] } }
  readonly scope = 'configuration' as const
  readonly label = '调整透明度'
  readonly mergeable: boolean
  readonly mergeKey?: string

  constructor(
    readonly id: string,
    private readonly layerId: string,
    private before: number,
    private after: number,
    transactionId?: string
  ) {
    this.mergeable = transactionId !== undefined
    if (transactionId !== undefined) this.mergeKey = `opacity:${layerId}:${transactionId}`
  }

  /** EditHistory 在合并滑块更新时使用。 */
  absorb(next: SetLayerOpacityCommand): void {
    this.after = next.after
  }

  execute(context: EditContext): void {
    if (!Number.isFinite(this.after)) throw new Error('不透明度必须是有限数值')
    if (this.before === this.after) return
    const ctx = requireProjectContext(context)
    ctx.replaceProject(replaceLayer(ctx.getProject(), this.layerId, { opacity: this.after }))
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(replaceLayer(ctx.getProject(), this.layerId, { opacity: this.before }))
  }
}

/** 只有显式地编辑预设，才会改变打开地图时使用的视口。 */
export class SetMapInitialViewCommand implements EditCommand {
  rebaseFieldReferences(): EditCommand { return this }
  readonly scope = 'configuration' as const
  readonly label = '设置二维初始视角'
  private readonly before: MapState
  private readonly after: MapState

  constructor(readonly id: string, before: MapState, after: MapState) {
    if (!Array.isArray(after.center) || after.center.length !== 2 || !after.center.every(Number.isFinite) ||
      !Number.isFinite(after.zoom) || !Number.isFinite(after.rotation)) throw new Error('初始视角参数必须是有限数值')
    this.before = cloneValue(before)
    this.after = { center: [...after.center], zoom: after.zoom, rotation: after.rotation }
  }

  execute(context: EditContext): void { this.apply(context, this.after) }
  undo(context: EditContext): void { this.apply(context, this.before) }
  private apply(context: EditContext, view: MapState): void {
    const ctx = requireProjectContext(context), project = ctx.getProject(), content = requireMapContent(project)
    if (JSON.stringify(content.initialView) === JSON.stringify(view)) return
    ctx.replaceProject({ ...project, content: { ...content, initialView: cloneValue(view) } })
  }
}

export interface LayerTreeSnapshot {
  layers: Layer[]
  groups: LayerGroup[]
  rootOrder: LayerTreeEntry[]
}

/** 图层树历史只改配置；稳定 ID 没变的那些对象仍然沿用原来的引用。 */
function applyLayerTreeSnapshot(project: Project, snapshot: LayerTreeSnapshot): Project {
  const content = requireMapContent(project)
  function reuse<T extends { id: string }>(current: T[], next: T[]): T[] {
    const existing = new Map(current.map(item => [item.id, item]))
    const items = next.map(item => {
      const before = existing.get(item.id)
      if (!before) return cloneValue(item)
      if (JSON.stringify(before) === JSON.stringify(item)) return before
      const changed = { ...item }
      for (const key of Object.keys(item) as Array<keyof T>) changed[key] = JSON.stringify(before[key]) === JSON.stringify(item[key]) ? before[key] : cloneValue(item[key])
      return changed
    })
    return items.length === current.length && items.every((item, index) => item === current[index]) ? current : items
  }
  const layers = reuse(content.layers, snapshot.layers), groups = reuse(content.groups, snapshot.groups)
  const rootOrder = JSON.stringify(content.rootOrder) === JSON.stringify(snapshot.rootOrder) ? content.rootOrder : cloneValue(snapshot.rootOrder)
  return layers === content.layers && groups === content.groups && rootOrder === content.rootOrder ? project
    : { ...project, content: { ...content, layers, groups, rootOrder } }
}

/** Group / sort / relocate — restore full tree snapshot on undo. */
export class SetLayerTreeCommand implements EditCommand {
  rebaseFieldReferences(references: FieldReferenceRebase): EditCommand {
    const map = (snapshot: LayerTreeSnapshot, fields: FieldNameMap) => ({ ...snapshot,
      layers: snapshot.layers.map(layer => layer.datasetId === references.datasetId ? remapLayerFieldReferences(layer, fields) : layer) })
    return new SetLayerTreeCommand(this.id, this.label, map(this.before, references.before), map(this.after, references.after), this.targets)
  }
  readonly targets: EditTargets
  readonly scope = 'configuration' as const
  readonly label: string
  readonly mergeable = false

  constructor(
    readonly id: string,
    label: string,
    private readonly before: LayerTreeSnapshot,
    private readonly after: LayerTreeSnapshot,
    targets?: EditTargets
  ) {
    this.label = label
    this.before = cloneValue(before); this.after = cloneValue(after)
    this.targets = mergeEditTargets(getLayerTreeEditTargets(before, after), targets)
  }

  execute(context: EditContext): void {
    if (JSON.stringify(this.before) === JSON.stringify(this.after)) return
    const ctx = requireProjectContext(context)
    const project = ctx.getProject()
    ctx.replaceProject(applyLayerTreeSnapshot(project, this.after))
  }

  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    const project = ctx.getProject()
    ctx.replaceProject(applyLayerTreeSnapshot(project, this.before))
  }
}

export function snapshotLayerTree(project: Project): LayerTreeSnapshot {
  return {
    layers: cloneValue(requireMapContent(project).layers),
    groups: cloneValue(requireMapContent(project).groups ?? []),
    rootOrder: cloneValue(requireMapContent(project).rootOrder ?? [])
  }
}

/** 可见性属于项目配置，会进入已有的历史。 */
export class SetLayerVisibleCommand implements EditCommand {
  rebaseFieldReferences(): EditCommand { return this }
  readonly scope = 'configuration' as const
  readonly label = '设置图层显隐'
  constructor(readonly id: string, private readonly layerId: string, private readonly before: boolean, private readonly after: boolean) {}
  execute(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(replaceLayer(ctx.getProject(), this.layerId, { visible: this.after }))
  }
  undo(context: EditContext): void {
    const ctx = requireProjectContext(context)
    ctx.replaceProject(replaceLayer(ctx.getProject(), this.layerId, { visible: this.before }))
  }
}
