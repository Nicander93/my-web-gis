import {
  ImageryLayer,
  UrlTemplateImageryProvider,
  type Resource,
  type Viewer
} from 'cesium'
import { BaseLayer } from './base-layer.js'
import type { LayerOptions } from './base-layer.js'

export interface ImageryTemplateLayerOptions extends LayerOptions {
  url: string | Resource
  attribution?: string
  maximumLevel?: number
  opacity?: number
}

/** XYZ / URL-template imagery drawn through viewer.imageryLayers. */
export class ImageryTemplateLayer extends BaseLayer {
  private layer?: ImageryLayer

  constructor(private readonly options: ImageryTemplateLayerOptions) {
    super(options)
  }

  contains(_picked: unknown): boolean {
    return false
  }

  async flyTo(): Promise<void> {
    // Template imagery covers the globe; callers frame the camera themselves.
  }

  setOpacity(value: number): void {
    if (this.layer) this.layer.alpha = value
    this.viewer?.scene.requestRender()
  }

  protected setNativeVisible(value: boolean): void {
    if (this.layer) this.layer.show = value
    this.viewer?.scene.requestRender()
  }

  protected async createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void> {
    const provider = new UrlTemplateImageryProvider({
      url: this.options.url,
      credit: this.options.attribution,
      maximumLevel: this.options.maximumLevel
    })
    if (signal.aborted || viewer.isDestroyed()) return () => {}
    const layer = viewer.imageryLayers.addImageryProvider(provider)
    layer.show = this.show
    if (this.options.opacity !== undefined) layer.alpha = this.options.opacity
    this.layer = layer
    return () => {
      if (!viewer.isDestroyed()) viewer.imageryLayers.remove(layer, true)
      if (this.layer === layer) this.layer = undefined
    }
  }
}
