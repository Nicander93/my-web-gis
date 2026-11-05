import { cloneValue } from '../clone'
import { createFieldIdentities, sameFieldIdentities, type SchemaIdentityEdit } from './field-identities'
import { cloneDatasetFields as copyFields, validateDatasetRows } from './dataset-schema'
import { applyFieldFilter, type FieldFilterCondition } from './filter'
import type { DatasetField, GisFeature } from './types'

export interface FeatureQuery {
  /** 在数据集的规范坐标系里做包围盒求交。 */
  extent?: [number, number, number, number]
  filter?: FieldFilterCondition[]
  offset?: number
  limit?: number
  signal?: AbortSignal
}
export interface FeatureEditBatch { inserts: GisFeature[]; updates: GisFeature[]; deletes: string[]; schema?: { fields?: DatasetField[] }; fieldIdentities?: Record<string, string> }
export interface FeatureProvider {
  readonly datasetId: string
  readonly revision: number
  readonly capabilities: { readonly read: boolean; readonly write: boolean; readonly transactions: boolean }
  getFields(signal?: AbortSignal): Promise<DatasetField[] | undefined>
  getById(id: string, signal?: AbortSignal): Promise<GisFeature | null>
  query(query?: FeatureQuery): Promise<{ features: GisFeature[]; hasMore: boolean }>
  commit(batch: FeatureEditBatch, options: { expectedRevision: number; signal?: AbortSignal }): Promise<number>
  dispose(): void
}

/** 只有完全加载的数据源才能参与应用层的同步编辑事务。 */
export interface LoadedFeatureProvider extends FeatureProvider {
  getLoadedById(id: string): GisFeature | null
  getLoadedRows(): GisFeature[]
  getLoadedFields(): DatasetField[] | undefined
  getLoadedFieldIdentities(): ReadonlyMap<string, string>
}
/** 只有在持久化发布之后才完成；失败时必须让原有内容保持完整。 */
export type PersistFeatureRows = (features: GisFeature[], signal?: AbortSignal, fields?: DatasetField[]) => Promise<void>


function select(features: GisFeature[], query: FeatureQuery): { features: GisFeature[]; hasMore: boolean } {
  const offset = query.offset ?? 0, limit = query.limit ?? features.length
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid query page')
  if (query.extent && (query.extent.some(value => !Number.isFinite(value)) || query.extent[0] > query.extent[2] || query.extent[1] > query.extent[3])) throw new Error('Invalid query extent')
  const filtered = applyFieldFilter(features, query.filter ?? []).filter(feature => {
    if (!query.extent) return true
    const bounds = [Infinity, Infinity, -Infinity, -Infinity]
    function visit(value: unknown): void {
      if (!Array.isArray(value)) return
      if (typeof value[0] === 'number' && typeof value[1] === 'number') {
        bounds[0] = Math.min(bounds[0], value[0]); bounds[1] = Math.min(bounds[1], value[1])
        bounds[2] = Math.max(bounds[2], value[0]); bounds[3] = Math.max(bounds[3], value[1])
      } else value.forEach(visit)
    }
    visit(feature.geometry.coordinates)
    const [left, bottom, right, top] = query.extent
    return bounds[0] <= right && bounds[2] >= left && bounds[1] <= top && bounds[3] >= bottom
  })
  return { features: cloneValue(filtered.slice(offset, offset + limit)), hasMore: offset + limit < filtered.length }
}

/** 带事务的内存数据源。不承诺把数据持久化到外部文件。 */
export class MemoryFeatureProvider implements LoadedFeatureProvider {
  readonly capabilities = Object.freeze({ read: true, write: true, transactions: true })
  private rows = new Map<string, GisFeature>()
  private version = 0
  private disposed = false
  private committing = false
  private fields: DatasetField[] | undefined
  private identities: Map<string, string>
  get revision(): number { this.check(); return this.version }
  constructor(readonly datasetId: string, features: GisFeature[], private readonly persist?: PersistFeatureRows, fields?: DatasetField[], identities?: ReadonlyMap<string, string>) {
    this.fields = copyFields(fields)
    const names = new Set(fields?.map(field => field.name))
    features.forEach(feature => Object.keys(feature.properties).forEach(name => names.add(name)))
    this.identities = createFieldIdentities(names, identities)
    for (const feature of features) {
      if (!feature.id || this.rows.has(feature.id)) throw new Error('Duplicate or empty feature ID')
      this.rows.set(feature.id, cloneValue(feature))
    }
  }
  private check(signal?: AbortSignal): void {
    signal?.throwIfAborted()
    if (this.disposed) throw new Error('Provider disposed')
  }
  getLoadedFieldIdentities(): ReadonlyMap<string, string> { this.check(); return new Map(this.identities) }
  async getFields(signal?: AbortSignal): Promise<DatasetField[] | undefined> {
    this.check(signal); return cloneValue(this.fields)
  }
  getLoadedFields(): DatasetField[] | undefined { this.check(); return cloneValue(this.fields) }
  async getById(id: string, signal?: AbortSignal): Promise<GisFeature | null> {
    this.check(signal); return cloneValue(this.rows.get(id) ?? null)
  }
  getLoadedById(id: string): GisFeature | null {
    this.check(); return cloneValue(this.rows.get(id) ?? null)
  }
  getLoadedRows(): GisFeature[] { this.check(); return cloneValue([...this.rows.values()]) }
  async query(query: FeatureQuery = {}) {
    this.check(query.signal); return select([...this.rows.values()], query)
  }
  async commit(batch: FeatureEditBatch, options: { expectedRevision: number; signal?: AbortSignal }): Promise<number> {
    this.check(options.signal)
    if (this.committing) throw new Error('Provider commit in progress')
    if (options.expectedRevision !== this.version) throw new Error('Dataset version conflict')
    const captured = cloneValue(batch), ids = [...captured.inserts.map(row => row.id), ...captured.updates.map(row => row.id), ...captured.deletes]
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Duplicate or empty edit ID')
    if (captured.inserts.some(row => this.rows.has(row.id)) || [...captured.updates.map(row => row.id), ...captured.deletes].some(id => !this.rows.has(id))) throw new Error('Feature existence conflict')
    const fields = captured.schema ? copyFields(captured.schema.fields) : this.fields
    if (!ids.length && !captured.schema && !captured.fieldIdentities) return this.version
    const next = new Map(this.rows)
    captured.inserts.forEach(row => next.set(row.id, row)); captured.updates.forEach(row => next.set(row.id, row)); captured.deletes.forEach(id => next.delete(id))
    const names = new Set(fields?.map(field => field.name))
    next.forEach(feature => Object.keys(feature.properties).forEach(name => names.add(name)))
    const identities = captured.fieldIdentities ? new Map(Object.entries(captured.fieldIdentities)) : new Map(this.identities)
    if ([...identities.values()].some(id => typeof id !== 'string' || !id) || new Set(identities.values()).size !== identities.size) throw new Error('Invalid field identities')
    for (const [name, id] of createFieldIdentities(names, identities)) identities.set(name, id)
    validateDatasetRows(next.values(), fields)
    this.check(options.signal)
    if (this.persist) {
      this.committing = true
      try { await this.persist(cloneValue([...next.values()]), options.signal, cloneValue(fields)) }
      finally { this.committing = false }
      // 持久化发布被确认之后就是提交点，之后再取消也无法撤销。
    }
    this.rows = next; this.fields = fields; this.identities = identities; return ++this.version
  }
  dispose(): void {
    if (this.committing) throw new Error('Provider commit in progress')
    this.disposed = true; this.rows.clear()
  }
}

/** 单个数据集的增量。撤销仍然走调用方已有的命令历史。 */
export class FeatureEditBuffer {
  private readonly changes = new Map<string, { before: GisFeature | null; after: GisFeature | null; order: number }>()
  private nextOrder = 0
  private identities?: Map<string, string>
  private readonly identityFrames = new WeakMap<object, { before: Map<string, string>; after: Map<string, string>; beforeChanged: boolean; afterChanged: boolean }>()
  private identityEditChanged = false
  private schemaChanged = false
  private schemaAfter: DatasetField[] | undefined
  private expectedRevision: number
  private busy = false
  private transactionDepth = 0
  private readonly rollback: Array<() => void> = []
  constructor(private readonly provider: FeatureProvider) { this.expectedRevision = provider.revision }
  get datasetId(): string { return this.provider.datasetId }
  get pendingCount(): number { return this.changes.size + (this.schemaChanged || this.identityEditChanged ? 1 : 0) }
  getLoadedFieldIdentities(): ReadonlyMap<string, string> {
    this.check(true)
    this.identities ??= new Map(this.loadedProvider().getLoadedFieldIdentities())
    return new Map(this.identities)
  }
  private ensureFieldNames(names: Iterable<string>): void {
    this.identities ??= new Map(this.loadedProvider().getLoadedFieldIdentities())
    let next = this.identities
    for (const name of names) if (!next.has(name)) {
      if (next === this.identities) next = new Map(next)
      next.set(name, createFieldIdentities([name]).get(name)!)
    }
    this.identities = next
  }
  getLoadedFields(): DatasetField[] | undefined {
    this.check(true); return cloneValue(this.schemaChanged ? this.schemaAfter : this.loadedProvider().getLoadedFields())
  }
  captureLoadedFields(edit?: SchemaIdentityEdit): () => void {
    this.check()
    const changed = this.schemaChanged, fields = this.schemaAfter, identities = this.identities, identityChanged = this.identityEditChanged
    const frame = edit && this.identityFrames.get(edit.key)
    return () => {
      this.schemaChanged = changed; this.schemaAfter = fields; this.identities = identities; this.identityEditChanged = identityChanged
      if (edit) {
        if (frame) this.identityFrames.set(edit.key, frame)
        else this.identityFrames.delete(edit.key)
      }
    }
  }
  setLoadedFields(fields: DatasetField[] | undefined, edit?: SchemaIdentityEdit): void {
    this.check()
    if (!this.provider.capabilities.write) throw new Error('Dataset is not writable')
    const candidate = copyFields(fields), before = this.loadedProvider().getLoadedFields()
    if (this.transactionDepth) this.rollback.push(this.captureLoadedFields(edit))
    let identities = new Map(this.getLoadedFieldIdentities())
    if (edit) {
      let frame = this.identityFrames.get(edit.key)
      if (!frame) {
        if (!edit.forward) throw new Error('Schema identity edit has not been executed')
        const previous = new Map(identities)
        if (edit.before && edit.before !== edit.after) {
          const identity = identities.get(edit.before)
          if (!identity) throw new Error('Schema identity target missing')
          identities.delete(edit.before)
          if (edit.after) identities.set(edit.after, identity)
        } else if (!edit.before && edit.after) identities.set(edit.after, createFieldIdentities([edit.after]).get(edit.after)!)
        for (const [name, id] of createFieldIdentities(candidate?.map(field => field.name) ?? [], identities)) identities.set(name, id)
        frame = { before: previous, after: new Map(identities), beforeChanged: this.identityEditChanged, afterChanged: edit.before !== edit.after ? !sameFieldIdentities(identities, this.loadedProvider().getLoadedFieldIdentities()) : this.identityEditChanged }; this.identityFrames.set(edit.key, frame)
      }
      identities = new Map(edit.forward ? frame.after : frame.before)
      this.identityEditChanged = edit.forward ? frame.afterChanged : frame.beforeChanged
    } else {
      for (const [name, id] of createFieldIdentities(candidate?.map(field => field.name) ?? [], identities)) identities.set(name, id)
    }
    this.identities = identities
    this.schemaChanged = JSON.stringify(before) !== JSON.stringify(candidate)
    this.schemaAfter = candidate
  }
  finishSchemaIdentity(edit: SchemaIdentityEdit, names?: Iterable<string>): void {
    this.check()
    const frame = this.identityFrames.get(edit.key)
    if (!frame) throw new Error('Schema identity edit has not been executed')
    if (edit.forward) {
      if (this.transactionDepth) this.rollback.push(this.captureLoadedFields(edit))
      if (names) this.identities = createFieldIdentities(names, this.getLoadedFieldIdentities())
      this.identityFrames.set(edit.key, { ...frame, after: new Map(this.getLoadedFieldIdentities()) })
    }
  }
  /** 一次增量的应用事务回滚令牌；发布之前要按相反顺序消费。 */
  captureLoadedDelta(id: string): () => void {
    this.check()
    const previous = this.changes.get(id), order = this.nextOrder, identities = this.identities
    return () => {
      if (previous) this.changes.set(id, previous)
      else this.changes.delete(id)
      this.nextOrder = order; this.identities = identities
    }
  }
  /** 只记录被改动的增量；这是回滚用的日志，不是第二套给用户看的撤销历史。 */
  transaction<T>(action: () => T): T {
    this.check()
    if (action.constructor.name === 'AsyncFunction') throw new Error('Buffer transactions must be synchronous')
    const start = this.rollback.length
    this.transactionDepth++
    try {
      const result = action()
      if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
        void Promise.resolve(result).catch(() => {})
        throw new Error('Buffer transactions must be synchronous')
      }
      return result
    } catch (error) {
      for (let index = this.rollback.length - 1; index >= start; index--) this.rollback[index]()
      this.rollback.length = start
      throw error
    } finally {
      this.transactionDepth--
      if (!this.transactionDepth) this.rollback.length = 0
    }
  }
  getLoadedById(id: string): GisFeature | null {
    this.check(true)
    const change = this.changes.get(id)
    return change ? cloneValue(change.after) : this.loadedProvider().getLoadedById(id)
  }
  /** 为了恢复已加载数据源的生命周期，同步地把完整的有效数据全部取出。 */
  getLoadedRows(): GisFeature[] {
    this.check(true)
    const rows = new Map(this.loadedProvider().getLoadedRows().map(row => [row.id, row]))
    for (const [id, change] of [...this.changes].sort((a, b) => a[1].order - b[1].order)) {
      if (change.after) rows.set(id, change.after)
      else rows.delete(id)
    }
    return cloneValue([...rows.values()])
  }
  putLoaded(feature: GisFeature): void { this.changeLoaded(feature.id, cloneValue(feature)) }
  removeLoaded(id: string): void { this.changeLoaded(id, null) }
  private loadedProvider(): LoadedFeatureProvider {
    if (!('getLoadedById' in this.provider) || typeof this.provider.getLoadedById !== 'function' || !('getLoadedRows' in this.provider) || typeof this.provider.getLoadedRows !== 'function' || !('getLoadedFields' in this.provider) || typeof this.provider.getLoadedFields !== 'function' || !('getLoadedFieldIdentities' in this.provider) || typeof this.provider.getLoadedFieldIdentities !== 'function') throw new Error('Source must be loaded before synchronous editing')
    return this.provider as LoadedFeatureProvider
  }
  private changeLoaded(id: string, after: GisFeature | null): void {
    this.check()
    if (!id || !this.provider.capabilities.write) throw new Error('Dataset is not writable or ID is empty')
    const provider = this.loadedProvider(), existing = this.changes.get(id)
    this.record(id, existing ? existing.before : provider.getLoadedById(id), after)
  }
  private record(id: string, before: GisFeature | null, after: GisFeature | null): void {
    const previous = this.changes.get(id), nextOrder = this.nextOrder, identities = this.identities
    if (this.transactionDepth) this.rollback.push(() => { if (previous) this.changes.set(id, previous); else this.changes.delete(id); this.nextOrder = nextOrder; this.identities = identities })
    if (after) this.ensureFieldNames(Object.keys(after.properties))
    if (JSON.stringify(before) === JSON.stringify(after)) this.changes.delete(id)
    else this.changes.set(id, { before, after, order: previous?.order ?? this.nextOrder++ })
  }
  private check(read = false): void {
    if (this.busy && !read) throw new Error('Buffer operation in progress')
    if (this.provider.revision !== this.expectedRevision) throw new Error('Dataset version conflict')
  }
  async getById(id: string, signal?: AbortSignal): Promise<GisFeature | null> {
    signal?.throwIfAborted(); this.check(true)
    const change = this.changes.get(id)
    return change ? cloneValue(change.after) : this.provider.getById(id, signal)
  }
  /** 先对齐再过滤和翻页，包括那些从查询范围之外进入查询的编辑。 */
  async query(query: FeatureQuery = {}) {
    this.check(true); query.signal?.throwIfAborted()
    const changes = cloneValue([...this.changes].sort((a, b) => a[1].order - b[1].order)), revision = this.provider.revision
    const rows = new Map<string, GisFeature>()
    let offset = 0
    for (;;) {
      const result = await this.provider.query({ offset, limit: 1024, signal: query.signal })
      if (this.provider.revision !== revision) throw new Error('Dataset changed during query')
      for (const row of result.features) {
        if (rows.has(row.id)) throw new Error('Provider returned duplicate IDs across pages')
        rows.set(row.id, row)
      }
      if (!result.hasMore) break
      if (!result.features.length) throw new Error('Provider pagination made no progress')
      offset += result.features.length
    }
    for (const [id, change] of changes) { if (change.after) rows.set(id, change.after); else rows.delete(id) }
    query.signal?.throwIfAborted(); return select([...rows.values()], query)
  }
  /** 写入和移除只影响发生变化的 ID；改回原始行时，待提交的增量会被去掉。 */
  async put(feature: GisFeature, signal?: AbortSignal): Promise<void> { await this.change(feature.id, cloneValue(feature), signal) }
  async remove(id: string, signal?: AbortSignal): Promise<void> { await this.change(id, null, signal) }
  private async change(id: string, after: GisFeature | null, signal?: AbortSignal): Promise<void> {
    if (this.transactionDepth) throw new Error('Use loaded edits inside synchronous transactions')
    this.check(); signal?.throwIfAborted()
    if (!id || !this.provider.capabilities.write) throw new Error('Dataset is not writable or ID is empty')
    this.busy = true
    try {
      const existing = this.changes.get(id), before = existing ? existing.before : await this.provider.getById(id, signal)
      signal?.throwIfAborted()
      if (this.provider.revision !== this.expectedRevision) throw new Error('Dataset version conflict')
      this.record(id, before, after)
    } finally { this.busy = false }
  }
  pendingBatch(): FeatureEditBatch {
    const batch: FeatureEditBatch = { inserts: [], updates: [], deletes: [] }
    for (const [id, { before, after }] of [...this.changes].sort((a, b) => a[1].order - b[1].order)) {
      if (!after) batch.deletes.push(id)
      else if (!before) batch.inserts.push(after)
      else batch.updates.push(after)
    }
    if (this.schemaChanged) batch.schema = { fields: cloneValue(this.schemaAfter) }
    const identities = this.getLoadedFieldIdentities()
    if (!sameFieldIdentities(identities, this.loadedProvider().getLoadedFieldIdentities())) batch.fieldIdentities = Object.fromEntries(identities)
    return cloneValue(batch)
  }
  /** 把捕获的批次回放到当前的 Provider 基线上。用于崩溃恢复，不用于实时编辑。 */
  restorePending(batch: FeatureEditBatch): void {
    if (this.transactionDepth) throw new Error('Cannot restore pending inside an edit transaction')
    if (this.busy) throw new Error('Buffer operation in progress')
    this.check()
    if (this.pendingCount) throw new Error('Buffer already has pending edits')
    const provider = this.loadedProvider()
    for (const id of batch.deletes) {
      if (!provider.getLoadedById(id)) throw new Error('Pending delete does not match source')
      this.changeLoaded(id, null)
    }
    for (const row of batch.updates) {
      if (!provider.getLoadedById(row.id)) throw new Error('Pending update does not match source')
      this.changeLoaded(row.id, cloneValue(row))
    }
    for (const row of batch.inserts) {
      if (provider.getLoadedById(row.id)) throw new Error('Pending insert already exists in source')
      this.changeLoaded(row.id, cloneValue(row))
    }
    if (batch.schema) this.setLoadedFields(batch.schema.fields)
    if (batch.fieldIdentities) {
      this.identities = new Map(Object.entries(batch.fieldIdentities))
      this.identityEditChanged = !sameFieldIdentities(this.identities, provider.getLoadedFieldIdentities())
    }
  }
  async save(signal?: AbortSignal): Promise<void> {
    if (this.transactionDepth) throw new Error('Cannot save inside an edit transaction')
    this.check(); signal?.throwIfAborted()
    if (!this.pendingCount) return
    if (!this.provider.capabilities.write || !this.provider.capabilities.transactions) throw new Error('Provider cannot commit atomically')
    this.busy = true
    try {
      const revision = await this.provider.commit(this.pendingBatch(), { expectedRevision: this.expectedRevision, signal })
      this.expectedRevision = revision; this.changes.clear(); this.schemaChanged = false; this.schemaAfter = undefined; this.identities = undefined; this.identityEditChanged = false
    } finally { this.busy = false }
  }
  discard(): void {
    if (this.transactionDepth) throw new Error('Cannot discard inside an edit transaction')
    if (this.busy) throw new Error('Buffer operation in progress')
    this.changes.clear(); this.schemaChanged = false; this.schemaAfter = undefined; this.identities = undefined; this.identityEditChanged = false; this.expectedRevision = this.provider.revision
  }
}
