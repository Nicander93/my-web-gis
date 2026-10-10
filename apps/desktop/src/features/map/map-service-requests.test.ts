import { afterEach, describe, expect, it, vi } from 'vitest'
import TileLayer from 'ol/layer/Tile'
import TileWMS from 'ol/source/TileWMS'
import ImageTile from 'ol/ImageTile'
import TileState from 'ol/TileState'
import type { SceneResource } from '@desktop-webgis/scene-schema'
import { ensureCredentialLoaded } from '@/services/credentials'
import { configureMapServiceLayer } from './map-service-requests'

vi.mock('@/services/credentials', () => ({ ensureCredentialLoaded: vi.fn() }))
vi.mock('ol/ImageTile', () => ({ default: class {
  image = Object.assign(new EventTarget(), { src: '' })
  state = TileState.IDLE
  getImage() { return this.image }
  setState(state: number) { this.state = state }
  getState() { return this.state }
} }))

function setup(mode: 'bearer' | 'query-token' = 'bearer') {
  const source = new TileWMS({ url: 'https://example.test/wms', params: { LAYERS: 'roads' } })
  const layer = new TileLayer({ source })
  const resource: Extract<SceneResource, { type: 'wms' }> = { type: 'wms', url: 'https://example.test/wms', version: '1.3.0', layerNames: ['roads'], authMode: 'runtime', authentication: { mode, credential: 'ref', tokenParam: 'access' } }
  const tile = new ImageTile([0, 0, 0], TileState.IDLE, '', {}, () => undefined)
  return { source, layer, resource, tile }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(ensureCredentialLoaded).mockReset() })

describe('map service request adapter', () => {
  it.each(['bearer', 'query-token'] as const)('injects %s at request time and releases image URLs', async mode => {
    const { source, layer, resource, tile } = setup(mode), before = structuredClone(resource)
    vi.mocked(ensureCredentialLoaded).mockResolvedValue({ key: 'ref', kind: mode, value: 'secret' })
    const fetcher = vi.fn(async () => new Response(new Blob(['image'])))
    vi.stubGlobal('fetch', fetcher)
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tile'), revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const previous = source.getTileLoadFunction(), cleanup = configureMapServiceLayer(layer, resource)!
    source.getTileLoadFunction()(tile, 'https://example.test/wms?LAYERS=roads')
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce())
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    if (mode === 'bearer') { expect(url).not.toContain('secret'); expect(options.headers).toEqual({ Authorization: 'Bearer secret' }) }
    else { expect(new URL(url).searchParams.get('access')).toBe('secret'); expect(options.headers).toEqual({}) }
    expect(resource).toEqual(before)
    tile.getImage().dispatchEvent(new Event('load'))
    expect(revoked).toHaveBeenCalledOnce()
    cleanup(); cleanup()
    expect(revoked).toHaveBeenCalledOnce(); expect(source.getTileLoadFunction()).toBe(previous)
  })

  it('aborts pending requests and ignores successful responses after teardown', async () => {
    const { source, layer, resource, tile } = setup()
    vi.mocked(ensureCredentialLoaded).mockResolvedValue({ key: 'ref', kind: 'bearer', value: 'secret' })
    let resolve!: (response: Response) => void
    const response = new Promise<Response>(done => { resolve = done }), fetcher = vi.fn(() => response)
    vi.stubGlobal('fetch', fetcher)
    const created = vi.spyOn(URL, 'createObjectURL')
    const cleanup = configureMapServiceLayer(layer, resource)!
    source.getTileLoadFunction()(tile, 'https://example.test/wms')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    const options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
    cleanup()
    expect(options.signal?.aborted).toBe(true)
    resolve(new Response(new Blob(['late image'])))
    await new Promise(done => setTimeout(done, 0))
    expect(created).not.toHaveBeenCalled(); expect(tile.getState()).toBe(TileState.IDLE)
  })

  it('fails a missing credential without requesting an unauthenticated tile', async () => {
    const { source, layer, resource, tile } = setup(), fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    vi.mocked(ensureCredentialLoaded).mockResolvedValue(undefined)
    const cleanup = configureMapServiceLayer(layer, resource)!
    source.getTileLoadFunction()(tile, 'https://example.test/wms')
    await vi.waitFor(() => expect(tile.getState()).toBe(TileState.ERROR))
    expect(fetcher).not.toHaveBeenCalled()
    cleanup()
  })
})
