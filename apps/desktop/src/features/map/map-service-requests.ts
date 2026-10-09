import type { SceneResource } from '@desktop-webgis/scene-schema'
import type BaseLayer from 'ol/layer/Base'
import TileLayer from 'ol/layer/Tile'
import TileWMS from 'ol/source/TileWMS'
import WMTS from 'ol/source/WMTS'
import ImageTile from 'ol/ImageTile'
import TileState from 'ol/TileState'
import { ensureCredentialLoaded } from '@/services/credentials'

/** Credentials are resolved for each request; layer and document definitions remain shareable. */
export function configureMapServiceLayer(
  layer: BaseLayer,
  resource: Extract<SceneResource, { type: 'wms' | 'wmts' }>,
  credentialKey = resource.authentication?.credential
): (() => void) | undefined {
  if (resource.authMode !== 'runtime') return
  if (!(layer instanceof TileLayer)) throw new Error('认证服务需要瓦片图层')
  const source = layer.getSource()
  if (!(source instanceof TileWMS) && !(source instanceof WMTS)) throw new Error('认证服务需要 WMS／WMTS 数据源')
  const authentication = resource.authentication
  if (!authentication || !credentialKey) throw new Error('认证服务缺少凭据引用')
  const previous = source.getTileLoadFunction()
  const pending = new Set<AbortController>(), releases = new Set<() => void>()
  const byTile = new WeakMap<ImageTile, AbortController>()
  let disposed = false
  const load: typeof previous = (tile, src) => {
    if (!(tile instanceof ImageTile) || disposed) return
    byTile.get(tile)?.abort()
    const operation = new AbortController()
    byTile.set(tile, operation); pending.add(operation)
    void (async () => {
      try {
        const credential = await ensureCredentialLoaded(credentialKey)
        operation.signal.throwIfAborted()
        if (!credential || credential.kind !== authentication.mode) throw new Error('服务凭据不可用')
        const url = new URL(src), headers: Record<string, string> = {}
        if (authentication.mode === 'query-token') url.searchParams.set(authentication.tokenParam ?? credential.param ?? 'token', credential.value)
        else headers.Authorization = `Bearer ${credential.value}`
        const response = await fetch(url.href, { headers, signal: operation.signal })
        if (!response.ok) throw new Error('服务瓦片请求失败')
        const blob = await response.blob()
        operation.signal.throwIfAborted()
        if (disposed || byTile.get(tile) !== operation) return
        const image = tile.getImage(), objectUrl = URL.createObjectURL(blob)
        const release = () => {
          image.removeEventListener('load', release); image.removeEventListener('error', release)
          URL.revokeObjectURL(objectUrl); releases.delete(release)
        }
        releases.add(release)
        image.addEventListener('load', release, { once: true }); image.addEventListener('error', release, { once: true })
        ;(image as HTMLImageElement).src = objectUrl
      } catch {
        if (!disposed && !operation.signal.aborted && byTile.get(tile) === operation) tile.setState(TileState.ERROR)
      } finally {
        pending.delete(operation)
      }
    })()
  }
  source.setTileLoadFunction(load)
  return () => {
    if (disposed) return
    disposed = true
    pending.forEach(operation => operation.abort()); pending.clear()
    releases.forEach(release => release()); releases.clear()
    if (source.getTileLoadFunction() === load) source.setTileLoadFunction(previous)
  }
}
