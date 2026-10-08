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

/** Owns one declarative document; hosts retain selection, undo history, file IO and native engines. */
export class SceneController {
  private document: SceneDocument
  private readonly observers = new Set<(change: SceneChange) => void>()
  private notifying = false
  private mutating = false
  private disposed = false

  constructor(input: unknown) { this.document = parseSceneDocument(input) }

  getDocument(): SceneDocument { return structuredClone(this.document) }
  exportJson(space = 2): string { return serializeSceneDocument(this.document, space) }
  subscribe(observer: (change: SceneChange) => void): () => void {
    this.requireActive()
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }
  /** A batch validates once, publishes once and never exposes its draft before commit. */
  transaction(label: string, change: (draft: SceneDocument) => void): SceneCommitResult {
    this.requireActive()
    const draft = this.getDocument()
    this.mutating = true
    try {
      const result: unknown = change(draft)
      if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
        void Promise.resolve(result).catch(() => {})
        throw new Error('Scene transactions must be synchronous; prepare asynchronous resources before committing')
      }
    } finally { this.mutating = false }
    return this.commit(label, parseSceneDocument(draft))
  }
  replaceDocument(input: unknown, label = 'Replace scene'): SceneCommitResult {
    this.requireActive()
    return this.commit(label, parseSceneDocument(input))
  }
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
  dispose(): void { this.disposed = true; this.observers.clear() }

  private requireActive(): void {
    if (this.disposed) throw new Error('Scene controller has been disposed')
    if (this.notifying) throw new Error('Scene observers cannot synchronously mutate the document')
    if (this.mutating) throw new Error('Scene transactions cannot perform nested controller writes')
  }
  private requireNode(document: SceneDocument, id: string): SceneNode {
    const node = document.nodes.find(entry => entry.id === id)
    if (!node) throw new Error(`Node ${id} does not exist`)
    return node
  }
  private update(label: string, operation: (document: SceneDocument) => SceneDocument): SceneCommitResult {
    this.requireActive()
    return this.commit(label, operation(this.document))
  }
  private commit(label: string, next: SceneDocument): SceneCommitResult {
    const before = this.document
    if (JSON.stringify(before) === JSON.stringify(next)) return { document: this.getDocument(), observerErrors: [] }
    this.document = next
    const observerErrors: unknown[] = []
    this.notifying = true
    try {
      for (const observer of [...this.observers]) {
        try { observer({ label, before: structuredClone(before), after: this.getDocument() }) }
        catch (error) { observerErrors.push(error) }
      }
    } finally { this.notifying = false }
    return { document: this.getDocument(), observerErrors }
  }
}
