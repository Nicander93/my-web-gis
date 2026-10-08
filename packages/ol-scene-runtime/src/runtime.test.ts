import { describe, expect, it, vi } from 'vitest'
import Collection from 'ol/Collection.js'
import type BaseLayer from 'ol/layer/Base.js'
import type View from 'ol/View.js'
import type { SceneManifest } from '@desktop-webgis/scene-schema'

vi.mock('ol/Map.js', () => ({ default: class {
  layers = new Collection<BaseLayer>()
  controls = new Collection()
  view: View
  constructor(options: { view: View }) { this.view = options.view }
  on() {}
  getLayers() { return this.layers }
  getControls() { return this.controls }
  getView() { return this.view }
  setView(view: View) { this.view = view }
  addLayer(layer: BaseLayer) { this.layers.push(layer) }
  addControl(control: unknown) { this.controls.push(control) }
  addInteraction() {}
  removeInteraction() {}
  updateSize() {}
  getSize() { return undefined }
  setTarget() {}
  dispose() {}
} }))
vi.mock('ol/control.js', () => ({ defaults: () => new Collection(), FullScreen: class {}, MousePosition: class {}, ScaleLine: class {} }))

import { OlSceneRuntime } from './runtime.js'

function scene(id: string): SceneManifest {
  return { version: 2, id, title: id, view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }, sources: { base: { type: 'xyz', url: 'https://example.test/{z}/{x}/{y}.png' } }, layers: [{ type: 'tile', id, name: id, source: 'base' }] }
}

describe('scene replacement lifecycle', () => {
  it('discards a late provider creation after a newer scene has committed', async () => {
    let finish!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    const runtime = new OlSceneRuntime({ target: 'unused', credentials: { token: 'test' }, fetch: fetcher })
    const ready = vi.fn(); runtime.on('scene:ready', ready)
    const a = scene('A')
    a.credentials = { token: { type: 'runtime-reference', key: 'token' } }
    a.sources.base = { type: 'provider', provider: 'google-map-tiles', mapType: 'roadmap', language: 'en-US', region: 'US', credential: 'token' }
    const pending = runtime.loadScene(a).catch(error => error)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await runtime.loadScene(scene('B'))
    finish(new Response(JSON.stringify({ session: 'late', tileWidth: 256, tileHeight: 256 })))
    expect(await pending).toMatchObject({ name: 'AbortError' })
    expect(ready).toHaveBeenCalledTimes(1)
    expect(ready.mock.calls[0][0].scene.id).toBe('B')
    expect((runtime.getNativeMap() as { getLayers(): Collection<BaseLayer> }).getLayers().getLength()).toBe(1)
    runtime.setLayerVisible('B', false)
    runtime.destroy(); runtime.destroy()
    await expect(runtime.loadScene(scene('C'))).rejects.toThrow('destroyed')
  })

  it('keeps the current scene when preparing a replacement fails', async () => {
    const runtime = new OlSceneRuntime({ target: 'unused' })
    await runtime.loadScene(scene('current'))
    const replacement = scene('broken')
    replacement.sources.base = { type: 'provider', provider: 'tianditu', mapType: 'vector', credential: 'missing' }
    await expect(runtime.loadScene(replacement)).rejects.toThrow('Credential')
    runtime.setLayerOpacity('current', 0.5)
    expect((runtime.getNativeMap() as { getLayers(): Collection<BaseLayer> }).getLayers().item(0).getOpacity()).toBe(0.5)
    runtime.destroy()
  })
})
