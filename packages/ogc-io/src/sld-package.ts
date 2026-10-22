import { zip } from 'fflate'
import type { SldExportResult } from './sld-export.js'
import { createStyleAsset } from '@desktop-webgis/ol-style/style-assets'

/** Packages only a publishable SLD and its explicit embedded image dependencies. */
export async function encodeSldPackage(result: SldExportResult, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted()
  if (!result.publishable || !result.sldXml) throw new Error('包含不支持内容的 SLD 不能打包发布')
  const files: Record<string, Uint8Array> = { 'style.sld': new TextEncoder().encode(result.sldXml) }
  let total = files['style.sld'].length
  for (const asset of result.assets) {
    if (!/^[a-f0-9]{64}\.(svg|png)$/.test(asset.path) || !asset.dataUrl.startsWith(`data:${asset.mimeType};base64,`)) throw new Error('SLD 资源路径或内容无效')
    const encoded = asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1)
    if (encoded.length > 6 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('SLD 资源数据无效')
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const verified = await createStyleAsset({ name: asset.path, mimeType: asset.mimeType, bytes, attribution: asset.attribution })
    if (verified.contentHash !== asset.contentHash) throw new Error('SLD 资源哈希与安全规范化内容不一致')
    total += bytes.length
    if (total > 28 * 1024 * 1024) throw new Error('SLD 符号包超过大小限制')
    files[asset.path] = bytes
  }
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify({ version: 1, style: 'style.sld', assets: result.assets.map(({ dataUrl: _data, ...asset }) => asset), compatibility: result.issues }, null, 2))
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { terminate(); reject(signal?.reason ?? new DOMException('SLD 打包已取消', 'AbortError')) }
    const terminate = zip(files, { level: 6 }, (error, bytes) => {
      signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(bytes)
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
