import { describe, expect, it, vi } from 'vitest'
import type { Viewer } from 'cesium'
import { BaseLayer } from './index'

class DeferredLayer extends BaseLayer {
  resolve?: (cleanup: () => void) => void
  contains(): boolean { return false }
  async flyTo(): Promise<void> {}
  protected setNativeVisible(): void {}
  protected createNative(): Promise<() => void> { return new Promise(resolve => { this.resolve = resolve }) }
}
describe('layer loading lifecycle', () => {
  it('releases late resources after removal instead of resurrecting the layer', async () => {
    const viewer = { scene:{ requestRender:vi.fn() } } as unknown as Viewer
    const layer = new DeferredLayer({ id:'city' }), release = vi.fn(), load = vi.fn()
    layer.on('load',load)
    const pending = layer.mount(viewer)
    layer.unmount()
    layer.resolve?.(release)
    await pending
    expect(release).toHaveBeenCalledOnce()
    expect(load).not.toHaveBeenCalled()
    expect(layer.state).toBe('idle')
  })
  it('disposes exactly once and does not allow mounting a destroyed layer', async () => {
    const viewer = { scene:{ requestRender:vi.fn() } } as unknown as Viewer
    const layer = new DeferredLayer({ id:'city' }), release = vi.fn()
    const pending = layer.mount(viewer); layer.resolve?.(release); await pending
    layer.destroy(); layer.destroy()
    expect(release).toHaveBeenCalledOnce()
    await expect(layer.mount(viewer)).rejects.toThrow('已销毁')
  })
})
