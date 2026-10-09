import type { Cartesian3, Viewer } from 'cesium'
import { Popup } from '@desktop-webgis/cesium-popup'
import type { PopupContent } from '@desktop-webgis/cesium-popup'
import type { LayerCollection } from './index.js'

export interface LayerOptions { id: string; name?: string; show?: boolean }
export interface LayerClickEvent { layer: BaseLayer; position: Cartesian3; properties: Record<string, unknown>; picked: unknown; selection?: 'toggle' | 'range' }
export interface LayerEvents { click: LayerClickEvent; load: BaseLayer; error: Error }

/** An explicit lifecycle for framework-independent Cesium layers. */
export abstract class BaseLayer {
  readonly id: string
  name: string
  protected viewer?: Viewer
  private visible: boolean
  private popupContent?: PopupContent
  private popup?: Popup
  private revision = 0
  private abort?: AbortController
  private destroyed = false
  private listeners: { [K in keyof LayerEvents]?: Set<(event: LayerEvents[K]) => void> } = {}
  state: 'idle' | 'loading' | 'ready' | 'error' = 'idle'

  constructor(options: LayerOptions) {
    this.id = options.id
    this.name = options.name ?? options.id
    this.visible = options.show ?? true
  }
  get show(): boolean { return this.visible }
  /** Used when a prepared layer is adopted without mounting/loading it a second time. */
  isMountedOn(viewer: Viewer): boolean { return !this.destroyed && this.viewer === viewer && this.state === 'ready' }
  set show(value: boolean) { this.visible = value; this.setNativeVisible(value); if (!value) this.popup?.close(); this.viewer?.scene.requestRender() }
  bindPopup(content: PopupContent): this { this.popupContent = content; return this }
  unbindPopup(): this { this.popupContent = undefined; this.popup?.destroy(); this.popup = undefined; return this }
  closePopup(): void { this.popup?.close() }
  on<K extends keyof LayerEvents>(type: K, listener: (event: LayerEvents[K]) => void): () => void {
    const set = this.listeners[type] as Set<(event: LayerEvents[K]) => void> | undefined
    const listeners = set ?? new Set<(event: LayerEvents[K]) => void>()
    if (!set) Object.assign(this.listeners, { [type]: listeners })
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  protected emit<K extends keyof LayerEvents>(type: K, event: LayerEvents[K]): void {
    const listeners = this.listeners[type] as Set<(event: LayerEvents[K]) => void> | undefined
    listeners?.forEach(listener => listener(event))
  }
  async addTo(collection: LayerCollection): Promise<this> { await collection.addLayer(this); return this }
  async mount(viewer: Viewer): Promise<void> {
    if (this.destroyed) throw new Error(`图层 ${this.id} 已销毁`)
    if (this.viewer) throw new Error(`图层 ${this.id} 已挂载`)
    this.viewer = viewer
    const revision = ++this.revision
    this.abort = new AbortController()
    this.state = 'loading'
    try {
      const release = await this.createNative(viewer, this.abort.signal)
      if (revision !== this.revision) { release(); return }
      this.releaseNative = release
      this.state = 'ready'
      this.setNativeVisible(this.visible)
      this.emit('load', this)
      viewer.scene.requestRender()
    } catch (cause) {
      if (revision !== this.revision) return
      this.viewer = undefined
      this.state = 'error'
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.emit('error', error)
      throw error
    }
  }
  private releaseNative?: () => void
  unmount(): void {
    this.revision++
    this.abort?.abort(); this.abort = undefined
    this.popup?.destroy(); this.popup = undefined
    this.releaseNative?.(); this.releaseNative = undefined
    this.viewer = undefined
    this.state = 'idle'
  }
  destroy(): void { if (this.destroyed) return; this.unmount(); this.destroyed = true; this.listeners = {} }
  async handleClick(event: LayerClickEvent, openPopup = true): Promise<void> {
    this.emit('click', event)
    const content = this.getPopupContent(event)
    if (!openPopup || !content || !this.viewer || !this.show) return
    this.popup ??= new Popup(this.viewer)
    try { await this.popup.open({ position: event.position, properties: event.properties, title: this.name }, content) }
    catch (cause) { this.emit('error', cause instanceof Error ? cause : new Error(String(cause))) }
  }
  protected getPopupContent(_event: LayerClickEvent): PopupContent | undefined { return this.popupContent }
  abstract contains(picked: unknown): boolean
  abstract flyTo(): Promise<void>
  protected abstract createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void>
  protected abstract setNativeVisible(value: boolean): void
}
