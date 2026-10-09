import type { SceneDocument } from '@desktop-webgis/scene-schema'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import { createOlDocumentLayers, type OlDocumentLayers } from './document.js'
import type { CreateOlSceneLayerOptions } from './layer.js'

export interface OlDocumentRuntimeOptions extends Omit<CreateOlSceneLayerOptions, 'vectorSource' | 'signal'> {
  map?: Map
  target?: HTMLElement | string
  viewId?: string
}

/** Mounts prepared v3 content while retaining caller-owned map objects. */
export class OlDocumentRuntime {
  private readonly map: Map
  private readonly ownsMap: boolean
  private readonly initialView: View
  private content: OlDocumentLayers | null = null
  private preparation: AbortController | null = null
  private destroyed = false

  constructor(private readonly options: OlDocumentRuntimeOptions) {
    if (!options.map && !options.target) throw new Error('Provide a map or target')
    this.ownsMap = !options.map
    this.map = options.map ?? new Map({ target: options.target, layers: [], controls: [], view: new View() })
    this.initialView = this.map.getView()
  }

  async loadDocument(input: SceneDocument, signal?: AbortSignal): Promise<void> {
    if (this.destroyed) throw new Error('Scene runtime has been destroyed')
    this.cancelPreparation()
    const operation = new AbortController()
    this.preparation = operation
    const abort = (): void => operation.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    let prepared: OlDocumentLayers | null = null
    try {
      operation.signal.throwIfAborted()
      prepared = await createOlDocumentLayers(input, { ...this.options, signal: operation.signal })
      operation.signal.throwIfAborted()
      const previous = this.content, previousView = this.map.getView()
      try {
        prepared.rootLayers.forEach(layer => this.map.addLayer(layer))
        this.map.setView(prepared.view)
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
      prepared = null
      previous?.dispose()
    } finally {
      prepared?.dispose()
      signal?.removeEventListener('abort', abort)
      if (this.preparation === operation) this.preparation = null
    }
  }

  getDocument(): SceneDocument | null { return this.content?.getDocument() ?? null }
  getLayer(id: string): ReturnType<OlDocumentLayers['getLayer']> { return this.content?.getLayer(id) }
  getFilteredFeatures(id: string): ReturnType<OlDocumentLayers['getFilteredFeatures']> { return this.content?.getFilteredFeatures(id) ?? [] }
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
    if (!this.ownsMap && content && this.map.getView() === content.view) this.map.setView(this.initialView)
    content?.dispose()
    this.content = null
    if (this.ownsMap) { this.map.setTarget(undefined); this.map.dispose() }
  }
}
