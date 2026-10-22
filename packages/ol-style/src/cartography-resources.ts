import { verifyStyleAssets, type ProjectStyleAsset } from './style-assets.js'

export interface CartographyResources {
  sprite?: string
  transformRequest?: (url: string, type: string) => Promise<Response> | undefined
  dispose(): void
}

async function loadProjectFonts(assets: readonly ProjectStyleAsset[]): Promise<() => void> {
  const owned: FontFace[] = []
  const dispose = () => { owned.forEach(font => document.fonts.delete(font)); owned.length = 0 }
  try {
    for (const asset of assets.filter(asset => asset.mimeType === 'font/woff2')) {
      const font = await new FontFace(asset.fontFamily!, `url(${asset.dataUrl})`).load()
      document.fonts.add(font); owned.push(font)
    }
    return dispose
  } catch (error) { dispose(); throw error }
}

/** Builds an owned sprite atlas from verified project bytes, with no public HTTP dependency. */
export async function prepareCartographyResources(assets: readonly ProjectStyleAsset[]): Promise<CartographyResources> {
  await verifyStyleAssets(assets)
  const images = assets.filter(asset => asset.mimeType !== 'font/woff2')
  if (!images.length) return { dispose: await loadProjectFonts(assets) }
  const atlas = document.createElement('canvas')
  const entries: Record<string, { x: number; y: number; width: number; height: number; pixelRatio: number }> = Object.create(null)
  let x = 0, y = 0, rowHeight = 0, width = 0
  for (const asset of images) {
    const w = Math.ceil(asset.width!), h = Math.ceil(asset.height!)
    if (x + w > 4096) { y += rowHeight; x = 0; rowHeight = 0 }
    if (y + h > 4096) throw new Error('项目符号图集超过 4096 × 4096')
    entries[asset.id] = { x, y, width: w, height: h, pixelRatio: 1 }
    x += w; width = Math.max(width, x); rowHeight = Math.max(rowHeight, h)
  }
  atlas.width = width; atlas.height = y + rowHeight
  const context = atlas.getContext('2d')
  if (!context) throw new Error('无法创建符号图集 Canvas')
  for (const asset of images) {
    const image = new Image()
    image.src = asset.dataUrl
    await image.decode()
    const entry = entries[asset.id]
    context.drawImage(image, entry.x, entry.y, entry.width, entry.height)
  }
  const png = await new Promise<Blob>((resolve, reject) => atlas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图集编码失败')), 'image/png'))
  // Unique URLs avoid the renderer's URL cache reusing another project's atlas.
  const sprite = `https://project-cartography.invalid/${crypto.randomUUID()}/sprite`
  return { sprite, dispose: await loadProjectFonts(assets), transformRequest: (url, type) => {
    if (!url.startsWith(sprite)) return undefined
    if (type === 'Sprite') return Promise.resolve(new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json' } }))
    if (type === 'SpriteImage') return Promise.resolve(new Response(png, { headers: { 'Content-Type': 'image/png' } }))
    return undefined
  } }
}
