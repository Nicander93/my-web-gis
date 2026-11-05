import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { createStyleAsset, sanitizeStyleSvg, validateStyleAssets, verifyStyleAssets } from './style-assets.js'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#336699" d="M0 0h24v24H0z"/></svg>'
const input = { name: 'Square', mimeType: 'image/svg+xml' as const, bytes: new TextEncoder().encode(svg), attribution: { source: 'Original', license: 'CC0-1.0' } }

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type), result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
  view.setUint32(0, data.length); result.set(typeBytes, 4); result.set(data, 8)
  view.setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)))
  return result
}

function pngFixture(corruptData = false): Uint8Array {
  const signature = new Uint8Array([137,80,78,71,13,10,26,10])
  const ihdr = new Uint8Array(13), header = new DataView(ihdr.buffer)
  header.setUint32(0, 1); header.setUint32(4, 1); ihdr.set([8, 6, 0, 0, 0], 8)
  const compressed = new Uint8Array(deflateSync(new Uint8Array([0, 255, 0, 0, 255])))
  if (corruptData) compressed[compressed.length - 1] ^= 0xff
  const chunks = [pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())]
  const result = new Uint8Array(signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  result.set(signature, offset); offset += signature.length
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

function woff2Header(options: { length?: number; declaredLength?: number; tableCount?: number; reserved?: number; compressedSize?: number } = {}): Uint8Array {
  const bytes = new Uint8Array(options.length ?? 49), view = new DataView(bytes.buffer)
  view.setUint32(0, 0x774f4632); view.setUint32(4, 0x00010000); view.setUint32(8, options.declaredLength ?? bytes.length)
  view.setUint16(12, options.tableCount ?? 1); view.setUint16(14, options.reserved ?? 0)
  view.setUint32(16, 1024); view.setUint32(20, options.compressedSize ?? 1)
  if (bytes.length > 48) bytes[48] = 1
  return bytes
}

describe('portable style assets', () => {
  it('canonicalizes, embeds and verifies deterministic content identities', async () => {
    const asset = await createStyleAsset(input)
    expect(asset.width).toBe(24)
    expect(asset.id).toBe(`asset-${asset.contentHash}`)
    expect(await createStyleAsset({ ...input, name: 'Another label' })).toMatchObject({ id: asset.id })
    expect(validateStyleAssets([asset])).toEqual([])
    await expect(verifyStyleAssets([asset])).resolves.toBeUndefined()
    const altered = { ...asset, dataUrl: asset.dataUrl.replace(/base64,.*/, `base64,${btoa(svg.replace('336699', 'ff0000'))}`) }
    await expect(verifyStyleAssets([altered])).rejects.toThrow('哈希')
    expect(validateStyleAssets([asset, asset]).join()).toContain('重复')
  })

  it.each([
    '<script>alert(1)</script>', '<foreignObject/>', '<image href="https://evil.test/x"/>',
    '<path onclick="evil()"/>', '<path style="fill:red"/>', '<use href="https://evil.test/x"/>',
    '<path fill="url(https://evil.test/x)"/>', '<path fill="url(&#104;ttps://evil.test/x)"/>',
    '<use href="#absent"/>', '<g id="same"/><g id="same"/>',
  ])('rejects active, remote or ambiguous SVG: %s', fragment => {
    expect(() => sanitizeStyleSvg(svg.replace(/<path.*\/>/, fragment))).toThrow()
  })

  it('rejects entities, oversized images, malformed XML and fonts', async () => {
    expect(() => sanitizeStyleSvg('<!DOCTYPE svg [<!ENTITY x "x">]>' + svg)).toThrow()
    expect(() => sanitizeStyleSvg(svg.replace('24 24', '9000 9000'))).toThrow()
    expect(() => sanitizeStyleSvg(svg.replace('</svg>', ''))).toThrow()
    await expect(createStyleAsset({ ...input, mimeType: 'font/woff2' })).rejects.toThrow('WOFF2')
  })

  it('accepts local gradients without external fetches', () => {
    expect(sanitizeStyleSvg(svg.replace('<path', '<defs><linearGradient id="road"><stop offset="0" stop-color="red"/></linearGradient></defs><path').replace('fill="#336699"', 'fill="url(#road)"')).width).toBe(24)
  })

  it('rejects cyclic and exponentially expanding local SVG use references', () => {
    const cycle = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/></svg>'
    expect(() => sanitizeStyleSvg(cycle)).toThrow('循环')

    const definitions = ['<g id="n0"><path d="M0 0h1v1z"/></g>']
    for (let index = 1; index <= 16; index++) definitions.push(`<g id="n${index}"><use href="#n${index - 1}"/><use href="#n${index - 1}"/></g>`)
    const bomb = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><defs>${definitions.join('')}</defs><use href="#n16"/></svg>`
    expect(() => sanitizeStyleSvg(bomb)).toThrow('展开超过安全限制')

    const chain = ['<g id="deep0"><path d="M0 0h1v1z"/></g>']
    for (let index = 1; index <= 140; index++) chain.push(`<g id="deep${index}"><use href="#deep${index - 1}"/></g>`)
    const nested = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><defs>${chain.join('')}</defs><use href="#deep140"/></svg>`
    expect(() => sanitizeStyleSvg(nested)).toThrow('嵌套超过安全限制')
  })

  it('checks PNG chunk checksums and fully inflates declared pixel data', async () => {
    const good = await createStyleAsset({ name: 'pixel.png', mimeType: 'image/png', bytes: pngFixture(), attribution: input.attribution })
    await expect(verifyStyleAssets([good])).resolves.toBeUndefined()

    const bad = await createStyleAsset({ name: 'bad.png', mimeType: 'image/png', bytes: pngFixture(true), attribution: input.attribution })
    await expect(verifyStyleAssets([bad])).rejects.toThrow('压缩图像数据损坏')

    const invalidCrc = pngFixture()
    invalidCrc[invalidCrc.length - 1] ^= 0xff
    await expect(createStyleAsset({ name: 'crc.png', mimeType: 'image/png', bytes: invalidCrc, attribution: input.attribution })).rejects.toThrow('校验失败')
  })

  it('rejects malformed WOFF2 declarations before storing them', async () => {
    const cases = [woff2Header({ declaredLength: 50 }), woff2Header({ tableCount: 0 }), woff2Header({ reserved: 1 }), woff2Header({ compressedSize: 0 })]
    for (const bytes of cases) await expect(createStyleAsset({ name: 'bad.woff2', mimeType: 'font/woff2', bytes, attribution: input.attribution, fontFamily: 'Fixture' })).rejects.toThrow('WOFF2')
  })
})
