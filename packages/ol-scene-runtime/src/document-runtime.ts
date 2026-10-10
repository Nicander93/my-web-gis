import type { SceneDocument } from '@desktop-webgis/scene-schema'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import { createOlDocumentLayers, type OlDocumentLayers, type OlDocumentOptions } from './document.js'

export interface OlDocumentRuntimeOptions extends Omit<OlDocumentOptions, 'signal'> {
  map?: Map
  target?: HTMLElement | string
  viewId?: string
}

export interface OlDocumentUpdateOptions {
  /** Synchronize host bindings in the same turn as native installation, before previous content is disposed. */
  onInstalled?: () => void
}

/** Mounts prepared v3 content while retaining caller-owned map objects. */
export class OlDocumentRuntime {
  private readonly map: Map
  private readonly ownsMap: boolean
  private readonly initialView: View
  private content: OlDocumentLayers | null = null
  private installedView: View | null = null
  private preparation: AbortController | null = null
  private destroyed = false

  constructor(private readonly options: OlDocumentRuntimeOptions) {
    if (!options.map && !options.target) throw new Error('Provide a map or target')
    this.ownsMap = !options.map
    this.map = options.map ?? new Map({ target: options.target, layers: [], controls: [], view: new View() })
    this.initialView = this.map.getView()
  }

  async loadDocument(input: SceneDocument, signal?: AbortSignal, options: OlDocumentUpdateOptions = {}): Promise<void> {
    if (this.destroyed) throw new Error('Scene runtime has been destroyed')
    this.cancelPreparation()
    const operation = new AbortController()
    this.preparation = operation
    const abort = (): void => operation.abort(signal?.reason)
    let rejectCanceled!: (reason: unknown) => void
    const canceled = new Promise<never>((_resolve, reject) => { rejectCanceled = reject })
    void canceled.catch(() => {})
    const rejectAbort = (): void => rejectCanceled(operation.signal.reason)
    operation.signal.addEventListener('abort', rejectAbort, { once: true })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    let prepared: OlDocumentLayers | null = null
    try {
      operation.signal.throwIfAborted()
      const preparing = createOlDocumentLayers(input, { ...this.options, signal: operation.signal })
      void preparing.then(candidate => { if (operation.signal.aborted) candidate.dispose() }, () => {})
      prepared = await Promise.race([preparing, canceled])
      operation.signal.throwIfAborted()
      const previous = this.content, previousView = this.map.getView()
      const previousDocument = previous?.getDocument()
      const previousViewId = this.options.viewId ?? previousDocument?.activeView
      const nextViewId = this.options.viewId ?? input.activeView
      const preserveView = previousDocument?.id === input.id && previousView === this.installedView && previousViewId === nextViewId &&
        JSON.stringify(previousDocument.views[previousViewId!]) === JSON.stringify(input.views[nextViewId])
      const nextView = preserveView ? previousView : prepared.view
      try {
        prepared.rootLayers.forEach(layer => this.map.addLayer(layer))
        this.map.setView(nextView)
        previous?.rootLayers.forEach(layer => this.map.removeLayer(layer))
      } catch (error) {
        prepared.rootLayers.forEach(layer => this.map.removeLayer(layer))
        previous?.rootLayers.forEach(layer => {
          if (!this.map.getLayers().getArray().includes(layer)) this.map.addLayer(layer)
        })
        this.map.setView(previousView)
        throw error
      }
      this.content = prepared
      this.installedView = nextView
      prepared = null
      try { options.onInstalled?.() }
      finally { previous?.dispose() }
    } finally {
      prepared?.dispose()
      signal?.removeEventListener('abort', abort)
      operation.signal.removeEventListener('abort', rejectAbort)
      if (this.preparation === operation) this.preparation = null
    }
  }

  getDocument(): SceneDocument | null { return this.content?.getDocument() ?? null }
  /** Reuses layers and full sources for presentation-only edits. */
  async updateDocument(input: SceneDocument, signal?: AbortSignal, options: OlDocumentUpdateOptions = {}): Promise<void> {
    if (this.destroyed) throw new Error('Scene runtime has been destroyed')
    signal?.throwIfAborted()
    if (this.content?.updatePresentation(input)) { this.cancelPreparation(); options.onInstalled?.(); return }
    await this.loadDocument(input, signal, options)
  }
  getLayer(id: string): ReturnType<OlDocumentLayers['getLayer']> { return this.content?.getLayer(id) }
  getFilteredFeatures(id: string): ReturnType<OlDocumentLayers['getFilteredFeatures']> { return this.content?.getFilteredFeatures(id) ?? [] }
  isFeatureIncluded(...args: Parameters<OlDocumentLayers['isFeatureIncluded']>): boolean { return this.content?.isFeatureIncluded(...args) ?? false }
  getIssues(): OlDocumentLayers['issues'] { return this.content ? structuredClone(this.content.issues) : [] }
  getNativeMap(): Map { return this.map }

  cancelPreparation(): void {
    this.preparation?.abort()
    this.preparation = null
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.cancelPreparation()
    const content = this.content
    content?.rootLayers.forEach(layer => this.map.removeLayer(layer))
    if (!this.ownsMap && content && this.map.getView() === this.installedView) this.map.setView(this.initialView)
    content?.dispose()
    this.content = null
    this.installedView = null
    if (this.ownsMap) { this.map.setTarget(undefined); this.map.dispose() }
  }
}
