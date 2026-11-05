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

/** 通过 viewer.imageryLayers 绘制的 XYZ 或 URL 模板影像。 */
export class ImageryTemplateLayer extends BaseLayer {
  private layer?: ImageryLayer

  constructor(private readonly options: ImageryTemplateLayerOptions) {
    super(options)
  }

  contains(_picked: unknown): boolean {
    return false
  }

  async flyTo(): Promise<void> {
    // 模板影像覆盖整个地球；相机取景由调用方自己处理。
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
