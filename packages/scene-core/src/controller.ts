import { parseSceneDocument, type SceneDocument, type SceneDocumentView, type SceneNode, type SceneResource } from '@desktop-webgis/scene-schema'
import { addSceneNode, addSceneResource, moveSceneNode, removeSceneNode, removeSceneResource, replaceSceneNode, replaceSceneResource, serializeSceneDocument, setSceneDocumentView, setSceneEnvironment } from './document.js'

export interface SceneChange {
  label: string
  before: SceneDocument
  after: SceneDocument
}
export interface SceneCommitResult {
  document: SceneDocument
  /** Content is committed even when a host observer fails; observers cannot roll back the document. */
  observerErrors: unknown[]
}
/** Host remains the content owner; commits are synchronous and atomic, including validation/history. */
export interface SceneDocumentHost {
  read(): unknown
  commit(document: SceneDocument, label: string): void
  /** Emits every completed host content change, including undo/redo; excludes UI-only changes. */
  subscribe(observer: (change: SceneChange) => void): () => void
}
export interface AddTilesetOptions {
  id: string
  name: string
  resourceId?: string
  url: string
  parentId?: string
  transform?: Extract<SceneNode, { type: '3dtiles' }>['transform']
  maximumScreenSpaceError?: number
  cacheBytes?: number
}

export interface PrepareSceneReplacementOptions {
  prepare(document: SceneDocument, signal: AbortSignal): Promise<SceneDocument>
  signal?: AbortSignal
  label?: string
}

/** Controls one document, either owned here or read directly from an authoritative host. */
export class SceneController {
  private document?: SceneDocument
  private readonly observers = new Set<(change: SceneChange) => void>()
  private notifying = false
  private mutating = false
  private disposed = false
  private preparation: AbortController | null = null
  private publishing = false
  private readonly hostChanges: SceneChange[] = []
  private readonly unsubscribeHost?: () => void

  constructor(input: unknown, private readonly host?: SceneDocumentHost) {
    const initial = parseSceneDocument(input)
    if (!host) this.document = initial
    else this.unsubscribeHost = host.subscribe(change => {
      if (this.disposed || this.publishing) return
      const validated = { label: change.label, before: parseSceneDocument(change.before), after: parseSceneDocument(change.after) }
      if (JSON.stringify(validated.before) === JSON.stringify(validated.after)) return
      this.cancelPreparation()
      if (this.notifying) this.hostChanges.push(validated)
      else this.notify(validated)
    })
  }

  getDocument(): SceneDocument { return this.host ? parseSceneDocument(this.host.read()) : structuredClone(this.document!) }
  exportJson(space = 2): string { return serializeSceneDocument(this.getDocument(), space) }
  subscribe(observer: (change: SceneChange) => void): () => void {
    this.requireActive()
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }
  /** A batch validates once, publishes once and never exposes its draft before commit. */
  transaction(label: string, change: (draft: SceneDocument) => void): SceneCommitResult {
    this.requireActive()
    const before = this.getDocument(), draft = structuredClone(before)
    this.mutating = true
    try {
      const result: unknown = change(draft)
      if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
        void Promise.resolve(result).catch(() => {})
        throw new Error('Scene transactions must be synchronous; prepare asynchronous resources before committing')
      }
    } finally { this.mutating = false }
    if (JSON.stringify(before) !== JSON.stringify(this.getDocument())) throw new Error('Host content changed during the scene transaction')
    return this.commit(label, parseSceneDocument(draft))
  }
  replaceDocument(input: unknown, label = 'Replace scene'): SceneCommitResult {
    this.requireActive()
    return this.commit(label, parseSceneDocument(input))
  }
  /** Prepare off-state, then publish once; newer loads or content edits invalidate late results. */
  async prepareAndReplaceDocument(input: unknown, options: PrepareSceneReplacementOptions): Promise<SceneCommitResult> {
    this.requireActive()
    const candidate = parseSceneDocument(input)
    this.preparation?.abort()
    const operation = new AbortController()
    this.preparation = operation
    const abort = (): void => operation.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    try {
      operation.signal.throwIfAborted()
      const prepared = await options.prepare(candidate, operation.signal)
      operation.signal.throwIfAborted()
      this.requireActive()
      const next = parseSceneDocument(prepared)
      this.preparation = null
      return this.commit(options.label ?? 'Load scene', next)
    } finally {
      options.signal?.removeEventListener('abort', abort)
      if (this.preparation === operation) this.preparation = null
    }
  }
  cancelPreparation(): void { this.preparation?.abort(); this.preparation = null }
  addResource(id: string, resource: SceneResource): SceneCommitResult { return this.update('Add resource', document => addSceneResource(document, id, resource)) }
  replaceResource(id: string, resource: SceneResource): SceneCommitResult { return this.update('Replace resource', document => replaceSceneResource(document, id, resource)) }
  removeResource(id: string, cascade = false): SceneCommitResult { return this.update('Remove resource', document => removeSceneResource(document, id, cascade)) }
  addNode(node: SceneNode, index?: number): SceneCommitResult { return this.update('Add node', document => addSceneNode(document, node, index)) }
  /** Adds a resource and object together, or explicitly reuses a matching existing resource. */
  addTileset(options: AddTilesetOptions): SceneCommitResult {
    return this.transaction('Add tileset', draft => {
      const resourceId = options.resourceId ?? `${options.id}:resource`
      const existing = Object.hasOwn(draft.resources, resourceId) ? draft.resources[resourceId] : undefined
      if (existing && (existing.type !== '3dtiles' || existing.url !== options.url)) throw new Error(`Resource ${resourceId} already has a different definition`)
      if (!existing) Object.defineProperty(draft.resources, resourceId, { value: { type: '3dtiles', url: options.url }, enumerable: true, configurable: true, writable: true })
      draft.nodes.push({ type: '3dtiles', id: options.id, name: options.name, resource: resourceId, visible: true,
        transform: options.transform ?? { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
        ...(options.parentId ? { parentId: options.parentId } : {}),
        ...(options.maximumScreenSpaceError === undefined ? {} : { maximumScreenSpaceError: options.maximumScreenSpaceError }),
        ...(options.cacheBytes === undefined ? {} : { cacheBytes: options.cacheBytes }) })
    })
  }
  replaceNode(id: string, node: SceneNode): SceneCommitResult { return this.update('Replace node', document => replaceSceneNode(document, id, node)) }
  removeNode(id: string, cascade = false): SceneCommitResult { return this.update('Remove node', document => removeSceneNode(document, id, cascade)) }
  moveNode(id: string, index: number, parentId?: string): SceneCommitResult { return this.update('Move node', document => moveSceneNode(document, id, index, parentId)) }
  setNodeVisible(id: string, visible: boolean): SceneCommitResult {
    return this.update('Set visibility', document => replaceSceneNode(document, id, { ...this.requireNode(document, id), visible }))
  }
  setNodeLocked(id: string, locked: boolean): SceneCommitResult {
    return this.update('Set locking', document => replaceSceneNode(document, id, { ...this.requireNode(document, id), locked }))
  }
  setNodeOpacity(id: string, opacity: number): SceneCommitResult {
    return this.update('Set opacity', document => {
      const node = this.requireNode(document, id)
      if (node.type !== 'tile' && node.type !== 'vector') throw new Error('Opacity is supported only by map nodes')
      return replaceSceneNode(document, id, { ...node, opacity })
    })
  }
  setTransform(id: string, transform: Extract<SceneNode, { type: '3dtiles' }>['transform']): SceneCommitResult {
    return this.update('Set transform', document => {
      const node = this.requireNode(document, id)
      if (node.type !== '3dtiles' && node.type !== 'model') throw new Error('Transform requires a model or tileset node')
      return replaceSceneNode(document, id, { ...node, transform })
    })
  }
  setView(id: string, view: SceneDocumentView, activate = false): SceneCommitResult { return this.update('Set view', document => setSceneDocumentView(document, id, view, activate)) }
  setEnvironment(environment: NonNullable<SceneDocument['environment']>): SceneCommitResult { return this.update('Set environment', document => setSceneEnvironment(document, environment)) }
  dispose(): void {
    if (this.disposed) return
    this.cancelPreparation(); this.disposed = true; this.unsubscribeHost?.(); this.observers.clear(); this.hostChanges.length = 0
  }

  private requireActive(): void {
    if (this.disposed) throw new Error('Scene controller has been disposed')
    if (this.notifying) throw new Error('Scene observers cannot synchronously mutate the document')
    if (this.mutating) throw new Error('Scene transactions cannot perform nested controller writes')
    if (this.publishing) throw new Error('Host commits cannot perform nested controller writes')
  }
  private requireNode(document: SceneDocument, id: string): SceneNode {
    const node = document.nodes.find(entry => entry.id === id)
    if (!node) throw new Error(`Node ${id} does not exist`)
    return node
  }
  private update(label: string, operation: (document: SceneDocument) => SceneDocument): SceneCommitResult {
    this.requireActive()
    return this.commit(label, operation(this.getDocument()))
  }
  private commit(label: string, next: SceneDocument): SceneCommitResult {
    const before = this.getDocument()
    if (JSON.stringify(before) === JSON.stringify(next)) return { document: this.getDocument(), observerErrors: [] }
    this.cancelPreparation()
    if (this.host) {
      this.publishing = true
      try { this.host.commit(structuredClone(next), label) }
      finally { this.publishing = false }
    } else this.document = next
    const after = this.getDocument()
    const observerErrors = JSON.stringify(before) === JSON.stringify(after) ? [] : this.notify({ label, before, after })
    return { document: this.getDocument(), observerErrors }
  }
  private notify(change: SceneChange): unknown[] {
    const observerErrors: unknown[] = []
    this.notifying = true
    try {
      for (const observer of [...this.observers]) {
        try { observer(structuredClone(change)) }
        catch (error) { observerErrors.push(error) }
      }
    } finally { this.notifying = false }
    while (this.hostChanges.length && !this.disposed) observerErrors.push(...this.notify(this.hostChanges.shift()!))
    return observerErrors
  }
}

/** Attaches without keeping a second writable document; the host owns content and history. */
export function createHostedSceneController(host: SceneDocumentHost): SceneController {
  return new SceneController(host.read(), host)
}
