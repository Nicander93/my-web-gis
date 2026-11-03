import { cloneDatasetFields, FeatureEditBuffer, MemoryFeatureProvider, MemoryFeatureStore, type FeatureEditBatch, type GisFeature, type DatasetField, type Project, type SchemaIdentityEdit, type PersistFeatureRows } from '@desktop-webgis/project'

export function datasetSchemas(project: Project): Record<string, DatasetField[] | undefined> {
  return project.content.kind === 'map2d' ? Object.fromEntries(project.content.datasets.map(dataset => [dataset.id, cloneDatasetFields('fields' in dataset ? dataset.fields : undefined)])) : {}
}

/** Durable capture of an active Provider baseline plus optional Buffer overlay. */
export interface DatasetRecoverySession {
  source: GisFeature[]
  fields?: DatasetField[]
  pending?: FeatureEditBatch
}

interface DatasetSession {
  identity: object
  schemaIdentity: object
  provider: MemoryFeatureProvider
  buffer: FeatureEditBuffer
  removedRows?: GisFeature[]
  persistence: { write?: PersistFeatureRows }
}
export interface DatasetCommitReceipt {
  readonly datasetId: string
  readonly identity: object
  readonly sourceRevision: number
  readonly dataRevision: number
}

export interface FeatureEditState {
  readonly revision: number
  /** Pending items on the active sources. Layer state reads this, not retained history. */
  readonly pendingCount: number
  /** Active pending plus retained sources. Zero means no unsaved feature data remains. */
  readonly unsavedCount: number
  readonly saving: boolean
  readonly datasets: readonly Readonly<{ datasetId: string; sourceIdentity: object; sourceRevision: number; pendingCount: number; saving: boolean }>[]
  /** Read-only pending metadata for history frames and delete tombstones, deduped by source identity. */
  readonly retained: readonly Readonly<{ datasetId: string; sourceIdentity: object; sourceRevision: number; pendingCount: number }>[]
}

/** Provider/overlay owner with a transitional immutable full-row cache for synchronous consumers. */
export class RuntimeFeatureData extends MemoryFeatureStore {
  private owners = new Map<string, DatasetSession>()
  private readonly historyFrames = new Map<object, { before?: Map<string, DatasetSession>; after?: Map<string, DatasetSession> }>()
  private nesting = 0
  private readonly inverses: Array<() => void> = []
  private readonly retired: MemoryFeatureProvider[] = []
  private readonly receipts = new WeakSet<object>()
  private readonly editListeners = new Set<() => void>()
  private editState: FeatureEditState = Object.freeze({
    revision: 0, pendingCount: 0, unsavedCount: 0, saving: false, datasets: Object.freeze([]), retained: Object.freeze([]),
  })
  private readonly commitSessions = new Map<object, { datasetId: string; owner: DatasetSession }>()

  getEditState = (): FeatureEditState => this.editState
  subscribeEdits = (listener: () => void): (() => void) => { this.editListeners.add(listener); return () => { this.editListeners.delete(listener) } }

  /** Metadata only: row publication and edit lifecycle have independent subscribers. */
  private publishEdits(force = false): void {
    const previous = this.editState
    const existing = new Map(previous.datasets.map(dataset => [dataset.datasetId, dataset]))
    const datasets = [...this.owners].filter(([, owner]) => !owner.removedRows).map(([datasetId, owner]) => {
      const before = existing.get(datasetId), pendingCount = owner.buffer.pendingCount, saving = this.isSaving(datasetId), sourceRevision = owner.provider.revision
      return before && before.sourceIdentity === owner.identity && before.sourceRevision === sourceRevision && before.pendingCount === pendingCount && before.saving === saving ? before
        : Object.freeze({ datasetId, sourceIdentity: owner.identity, sourceRevision, pendingCount, saving })
    })
    const retained = this.retainedPending(previous.retained)
    const datasetsUnchanged = datasets.length === previous.datasets.length && datasets.every((item, index) => item === previous.datasets[index])
    const retainedUnchanged = retained.length === previous.retained.length && retained.every((item, index) => item === previous.retained[index])
    if (!force && datasetsUnchanged && retainedUnchanged) return
    const pendingCount = datasets.reduce((sum, dataset) => sum + dataset.pendingCount, 0)
    this.editState = Object.freeze({
      revision: previous.revision + 1,
      datasets: datasetsUnchanged ? previous.datasets : Object.freeze(datasets),
      retained: retainedUnchanged ? previous.retained : Object.freeze(retained),
      pendingCount, unsavedCount: pendingCount + retained.reduce((sum, source) => sum + source.pendingCount, 0),
      saving: datasets.some(dataset => dataset.saving),
    })
    for (const listener of this.editListeners) {
      try { listener() } catch (error) { console.error('Edit lifecycle subscriber failed after publication', error) }
    }
  }

  /** History prune drops retained pending outside a data transaction. An open commit session still publishes completion. */
  private publishIdleEdits(): void {
    if (this.commitSessions.size || [...this.owners.values()].some(owner => owner.persistence.write)) return
    this.publishEdits()
  }

  private retainedPending(previous: FeatureEditState['retained']) {
    const existing = new Map(previous.map(source => [source.sourceIdentity, source]))
    const seen = new Set<object>()
    for (const owner of this.owners.values()) if (!owner.removedRows) seen.add(owner.identity)
    const retained: Array<FeatureEditState['retained'][number]> = []
    const consider = (datasetId: string, owner: DatasetSession) => {
      if (seen.has(owner.identity)) return
      seen.add(owner.identity)
      const pendingCount = owner.buffer.pendingCount
      if (!pendingCount) return
      const sourceRevision = owner.provider.revision
      const before = existing.get(owner.identity)
      retained.push(before && before.datasetId === datasetId && before.sourceRevision === sourceRevision && before.pendingCount === pendingCount
        ? before
        : Object.freeze({ datasetId, sourceIdentity: owner.identity, sourceRevision, pendingCount }))
    }
    for (const [datasetId, owner] of this.owners) if (owner.removedRows) consider(datasetId, owner)
    for (const frame of this.historyFrames.values()) for (const owners of [frame.before, frame.after]) {
      if (!owners) continue
      for (const [datasetId, owner] of owners) consider(datasetId, owner)
    }
    return retained
  }

  /** Keep mutation/source replacement blocked until the Application finishes its history barrier. */
  beginCommitSession(datasetId: string): object {
    if (this.nesting) throw new Error('Cannot save inside a data transaction')
    this.assertIdle()
    const owner = this.owners.get(datasetId)
    if (!owner || owner.removedRows) throw new Error('Dataset session not initialized')
    const token = Object.freeze({})
    this.commitSessions.set(token, { datasetId, owner }); this.publishEdits()
    return token
  }
  endCommitSession(token: object): void {
    if (!this.commitSessions.delete(token)) throw new Error('Unknown dataset commit session')
    this.publishEdits()
  }

  override transaction<T>(action: () => T): T {
    if (!this.nesting) this.assertIdle()
    const start = this.inverses.length, retiredStart = this.retired.length
    let completed = false
    this.nesting++
    try { return super.transaction(() => { const result = action(); completed = true; return result }) }
    catch (error) {
      // A listener error occurs after the cache commit; it cannot roll the overlay back alone.
      if (completed) throw error
      for (let index = this.inverses.length - 1; index >= start; index--) this.inverses[index]()
      this.inverses.length = start; this.retired.length = retiredStart
      throw error
    } finally {
      this.nesting--
      if (!this.nesting) {
        const changed = this.inverses.length > 0
        this.inverses.length = 0
        const live = new Set([...this.owners.values()].map(owner => owner.provider))
        for (const frame of this.historyFrames.values()) for (const owners of [frame.before, frame.after]) {
          for (const owner of owners?.values() ?? []) live.add(owner.provider)
        }
        for (const provider of this.retired.splice(0)) if (!live.has(provider)) provider.dispose()
        if (completed && changed) this.publishEdits(true)
      }
    }
  }

  pendingCount(datasetId?: string): number {
    return [...this.owners].reduce((sum, [id, owner]) => sum + (!owner.removedRows && (!datasetId || datasetId === id) ? owner.buffer.pendingCount : 0), 0)
  }
  /** Source rows and field identities as they will be after overlay discard. */
  discardPreview(datasetId: string): { rows: GisFeature[]; fields?: DatasetField[]; namespace: { identity: object; fields: ReadonlyMap<string, string> } } {
    const owner = this.owners.get(datasetId)
    if (!owner || owner.removedRows) throw new Error('Dataset session not initialized')
    return { rows: owner.provider.getLoadedRows(), fields: owner.provider.getLoadedFields(), namespace: { identity: owner.schemaIdentity, fields: owner.provider.getLoadedFieldIdentities() } }
  }
  /** Drop the active overlay and restore the effective cache from the Provider baseline. */
  discardDataset(datasetId: string): void {
    this.assertIdle()
    if (this.nesting) throw new Error('Cannot discard inside a data transaction')
    const owner = this.owners.get(datasetId)
    if (!owner || owner.removedRows) throw new Error('Dataset session not initialized')
    if (!owner.buffer.pendingCount) return
    owner.buffer.discard()
    super.setAll(datasetId, owner.buffer.getLoadedRows())
    this.publishEdits()
  }
  /** Active sources only. History frames stay in the live Application history, not recovery drafts. */
  captureActiveSessions(): Record<string, DatasetRecoverySession> {
    const sessions: Record<string, DatasetRecoverySession> = {}
    for (const [datasetId, owner] of this.owners) {
      if (owner.removedRows) continue
      // Read-only capture may run while a commit session is open; Buffer.save still owns write exclusion.
      sessions[datasetId] = {
        source: owner.provider.getLoadedRows(),
        fields: owner.provider.getLoadedFields(),
        ...(owner.buffer.pendingCount ? { pending: owner.buffer.pendingBatch() } : {}),
      }
    }
    return sessions
  }
  /** Install Provider baselines first, then replay pending overlays. Failure rolls the whole transaction. */
  installActiveSessions(sessions: Record<string, DatasetRecoverySession>): void {
    this.transaction(() => {
      const snapshot = Object.fromEntries(Object.entries(sessions).map(([id, session]) => [id, session.source]))
      const schemas = Object.fromEntries(Object.entries(sessions).map(([id, session]) => [id, session.fields]))
      this.replaceAll(snapshot, schemas)
      for (const [datasetId, session] of Object.entries(sessions)) {
        if (!session.pending) continue
        const owner = this.owners.get(datasetId)
        if (!owner || owner.removedRows) throw new Error('Dataset session not initialized')
        owner.buffer.restorePending(session.pending)
        super.setAll(datasetId, owner.buffer.getLoadedRows())
      }
    })
  }
  getFieldNamespace(datasetId: string): { identity: object; fields: ReadonlyMap<string, string> } | undefined {
    const owner = this.owners.get(datasetId)
    return owner && !owner.removedRows ? { identity: owner.schemaIdentity, fields: owner.buffer.getLoadedFieldIdentities() } : undefined
  }
  getSessionIdentity(datasetId: string): object | undefined {
    const owner = this.owners.get(datasetId)
    return owner && !owner.removedRows ? owner.identity : undefined
  }
  getSourceRevision(datasetId: string): number | undefined {
    const owner = this.owners.get(datasetId)
    return owner && !owner.removedRows ? owner.provider.revision : undefined
  }
  isSaving(datasetId: string): boolean {
    return !!this.owners.get(datasetId)?.persistence.write || [...this.commitSessions.values()].some(session => session.datasetId === datasetId)
  }
  /** Deleted owners remain available to Undo until the single Application history is cleared. */
  releaseInactive(): void {
    if (this.nesting) throw new Error('Cannot release dataset owners during a data transaction')
    let released = false
    for (const [id, owner] of this.owners) if (owner.removedRows) {
      owner.provider.dispose(); this.owners.delete(id); released = true
    }
    if (released) this.publishIdleEdits()
  }
  /** Runtime resources follow the existing command lifetime; no second operation stack is created. */
  releaseHistory(): void {
    this.assertIdle()
    if (this.nesting) throw new Error('Cannot release history during a data transaction')
    this.pruneHistory(() => false); this.releaseInactive()
  }
  pruneHistory(retain: (key: object) => boolean): void {
    if (this.nesting) throw new Error('Cannot release history during a data transaction')
    const retired: MemoryFeatureProvider[] = []
    let removed = false
    for (const [key, frame] of this.historyFrames) if (!retain(key)) {
      for (const owners of [frame.before, frame.after]) for (const owner of owners?.values() ?? []) retired.push(owner.provider)
      this.historyFrames.delete(key); removed = true
    }
    const live = new Set([...this.owners.values()].map(owner => owner.provider))
    for (const frame of this.historyFrames.values()) for (const owners of [frame.before, frame.after]) {
      for (const owner of owners?.values() ?? []) live.add(owner.provider)
    }
    for (const provider of new Set(retired)) if (!live.has(provider)) provider.dispose()
    if (removed) this.publishIdleEdits()
  }
  replaceHistorySnapshot(snapshot: Record<string, GisFeature[]>, key: object, side: 'before' | 'after', schemas: Record<string, DatasetField[] | undefined> = {}): void {
    this.transaction(() => {
      const previous = this.historyFrames.get(key), frame = { ...previous }
      this.inverses.push(() => { if (previous) this.historyFrames.set(key, previous); else this.historyFrames.delete(key) })
      frame[side === 'before' ? 'after' : 'before'] = this.owners
      this.historyFrames.set(key, frame)
      const target = frame[side]
      if (!target) {
        this.replaceAll(snapshot, schemas)
        frame[side] = this.owners
      } else {
        const current = this.owners
        this.inverses.push(() => { this.owners = current })
        this.owners = target
        for (const id of this.getDatasetIds()) super.clear(id)
        for (const [id, rows] of Object.entries(snapshot)) {
          const owner = target.get(id)
          super.setAll(id, owner && !owner.removedRows ? owner.buffer.getLoadedRows() : rows)
        }
      }
    })
  }
  async readSource(datasetId: string): Promise<GisFeature[]> {
    const owner = this.owners.get(datasetId)
    return owner && !owner.removedRows ? (await owner.provider.query()).features : []
  }
  /** Durable adapter publishes first; neither configuration nor the effective row cache is replaced. */
  async saveDataset(datasetId: string, persist: PersistFeatureRows, signal?: AbortSignal, commitToken?: object): Promise<DatasetCommitReceipt | undefined> {
    if (this.nesting) throw new Error('Cannot save inside a data transaction')
    const owner = this.owners.get(datasetId)
    if (!owner || owner.removedRows) throw new Error('Dataset session not initialized')
    const session = commitToken && this.commitSessions.get(commitToken)
    if (commitToken && (!session || session.datasetId !== datasetId || session.owner !== owner)) throw new Error('Unknown dataset commit session')
    if (this.commitSessions.size && !session) throw new Error('Dataset save in progress')
    if (owner.persistence.write) throw new Error('Dataset save in progress')
    const pending = owner.buffer.pendingCount
    owner.persistence.write = persist
    this.publishEdits()
    try {
      await owner.buffer.save(signal)
      if (!pending) return undefined
      const receipt = Object.freeze({ datasetId, identity: owner.identity, sourceRevision: owner.provider.revision, dataRevision: this.revision })
      this.receipts.add(receipt)
      return receipt
    }
    finally { owner.persistence.write = undefined; if (!session) this.publishEdits() }
  }
  validateCommit(receipt: DatasetCommitReceipt): void {
    const owner = this.owners.get(receipt.datasetId)
    if (!this.receipts.has(receipt) || !owner || owner.removedRows || owner.identity !== receipt.identity || owner.provider.revision !== receipt.sourceRevision || this.revision !== receipt.dataRevision || owner.buffer.pendingCount) throw new Error('Dataset commit was not acknowledged')
  }
  consumeCommit(receipt: DatasetCommitReceipt): void { this.validateCommit(receipt); this.receipts.delete(receipt) }
  assertIdle(): void {
    if (this.commitSessions.size || [...this.owners.values()].some(owner => owner.persistence.write)) throw new Error('Dataset save in progress')
  }
  getEffectiveFields(datasetId: string): DatasetField[] | undefined {
    return this.owners.get(datasetId)?.buffer.getLoadedFields()
  }
  async readSourceFields(datasetId: string): Promise<DatasetField[] | undefined> {
    return this.owners.get(datasetId)?.provider.getFields()
  }
  private edit(datasetId: string, id: string, row: GisFeature | null): void {
    const owner = this.owners.get(datasetId)
    if (!owner || owner.removedRows) throw new Error('Dataset session not initialized')
    this.inverses.push(owner.buffer.captureLoadedDelta(id))
    if (row) owner.buffer.putLoaded(row)
    else owner.buffer.removeLoaded(id)
  }
  override add(datasetId: string, row: GisFeature): void {
    this.transaction(() => { this.edit(datasetId, row.id, row); super.add(datasetId, row) })
  }
  override update(datasetId: string, row: GisFeature): void {
    this.transaction(() => { this.edit(datasetId, row.id, row); super.update(datasetId, row) })
  }
  override remove(datasetId: string, id: string): void {
    this.transaction(() => { this.edit(datasetId, id, null); super.remove(datasetId, id) })
  }
  /** Source initialization/refresh. User replacements must use replaceEdited instead. */
  override setAll(datasetId: string, rows: GisFeature[], schema?: { fields?: DatasetField[] }): void {
    this.transaction(() => {
      const before = this.owners.get(datasetId)
      const restore = before?.removedRows && (JSON.stringify(before.removedRows) === JSON.stringify(rows) || before.provider.revision > 0 && !before.buffer.pendingCount)
      if (before?.buffer.pendingCount && !restore) throw new Error('Cannot refresh a dataset with pending edits')
      const persistence: DatasetSession['persistence'] = restore ? before.persistence : {}
      const provider = restore ? before.provider : new MemoryFeatureProvider(datasetId, rows, async (features, signal, fields) => {
        if (!persistence.write) throw new Error('Dataset persistence adapter not selected')
        await persistence.write(features, signal, fields)
      }, schema ? schema.fields : before?.provider.getLoadedFields(), before && !before.removedRows ? before.buffer.getLoadedFieldIdentities() : undefined)
      const owner: DatasetSession = restore ? { provider, buffer: before.buffer, persistence, identity: before.identity, schemaIdentity: before.schemaIdentity } : { provider, buffer: new FeatureEditBuffer(provider), persistence, identity: Object.freeze({}), schemaIdentity: before && !before.removedRows ? before.schemaIdentity : Object.freeze({}) }
      this.inverses.push(() => { if (before) this.owners.set(datasetId, before); else this.owners.delete(datasetId); if (!restore) provider.dispose() })
      if (before && !restore) this.retired.push(before.provider)
      this.owners.set(datasetId, owner)
      super.setAll(datasetId, restore ? before.buffer.getLoadedRows() : rows)
    })
  }
  /** Materialize a full edit result while retaining the Provider baseline and only changed deltas. */
  replaceEdited(datasetId: string, rows: GisFeature[], schema?: { fields?: DatasetField[]; edit?: SchemaIdentityEdit }): void {
    this.transaction(() => {
      const owner = this.owners.get(datasetId)
      if (!owner || owner.removedRows) { this.setAll(datasetId, rows, schema); return }
      if (schema) {
        this.inverses.push(owner.buffer.captureLoadedFields(schema.edit))
        owner.buffer.setLoadedFields(schema.fields, schema.edit)
      }
      const names = schema?.edit ? new Set(schema.fields?.map(field => field.name)) : undefined
      const next = new Map(rows.map(row => {
        if (names) Object.keys(row.properties).forEach(name => names.add(name))
        return [row.id, row] as const
      }))
      if (next.size !== rows.length) throw new Error('Duplicate feature ID')
      for (const previous of super.getAll(datasetId)) {
        const row = next.get(previous.id)
        if (!row) this.edit(datasetId, previous.id, null)
        else if (JSON.stringify(previous) !== JSON.stringify(row)) this.edit(datasetId, row.id, row)
        next.delete(previous.id)
      }
      for (const row of next.values()) this.edit(datasetId, row.id, row)
      super.setAll(datasetId, rows)
      if (schema?.edit) owner.buffer.finishSchemaIdentity(schema.edit, names)
    })
  }
  override clear(datasetId: string): void {
    this.transaction(() => {
      const owner = this.owners.get(datasetId)
      if (owner && !owner.removedRows) {
        this.inverses.push(() => this.owners.set(datasetId, owner))
        this.owners.set(datasetId, { ...owner, removedRows: super.getAll(datasetId) })
      }
      super.clear(datasetId)
    })
  }
  /** A new project epoch owns fresh providers, including when dataset IDs are reused. */
  override replaceAll(snapshot: Record<string, GisFeature[]>, schemas: Record<string, DatasetField[] | undefined> = {}): void {
    this.transaction(() => {
      const previous = this.owners
      this.inverses.push(() => { this.owners = previous })
      this.retired.push(...[...previous.values()].map(owner => owner.provider))
      this.owners = new Map()
      for (const id of this.getDatasetIds()) if (!Object.hasOwn(snapshot, id)) super.clear(id)
      for (const [id, rows] of Object.entries(snapshot)) this.setAll(id, rows, { fields: schemas[id] })
    })
  }
  replaceEffectiveSnapshot(snapshot: Record<string, GisFeature[]>, schemas?: Record<string, DatasetField[] | undefined>, edit?: SchemaIdentityEdit): void {
    this.transaction(() => {
      for (const id of this.getDatasetIds()) if (!Object.hasOwn(snapshot, id)) this.clear(id)
      for (const [id, rows] of Object.entries(snapshot)) this.replaceEdited(id, rows, schemas ? { fields: schemas[id], edit: edit && (!edit.datasetIds || edit.datasetIds.includes(id)) ? edit : undefined } : undefined)
    })
  }
}
