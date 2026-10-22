import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type { Element } from '@xmldom/xmldom'

export interface ProjectStyleAsset {
  id: string
  name: string
  mimeType: 'image/svg+xml' | 'image/png' | 'font/woff2'
  dataUrl: string
  contentHash: string
  width?: number
  height?: number
  fontFamily?: string
  attribution: { source: string; license: string }
}

const MAX_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 24 * 1024 * 1024
const MAX_EXPANDED_SVG_NODES = 20_000
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  return crc >>> 0
})
const SVG_TAGS = new Set('svg g defs path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath mask pattern use title desc'.split(' '))
const SVG_ATTRIBUTES = new Set('xmlns id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity clip-path clip-rule mask gradientUnits gradientTransform offset stop-color stop-opacity spreadMethod patternUnits patternContentUnits patternTransform preserveAspectRatio href'.split(' '))

/** Rejects active/external SVG content; accepted bytes are canonicalized before hashing. */
export function sanitizeStyleSvg(source: string): { text: string; width: number; height: number } {
  if (source.length > MAX_BYTES || /<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(source)) throw new Error('SVG 含不允许的声明或内容过大')
  const document = new DOMParser({ onError: (_level, message) => { throw new Error(message) } }).parseFromString(source, 'image/svg+xml')
  const root = document.documentElement
  if (!root || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('需要 SVG 命名空间根元素')
  const namespace = root.namespaceURI
  const ids = new Set<string>(), references: string[] = []
  const elementsById = new Map<string, Element>()
  let nodeCount = 0
  function visit(element: Element, depth = 0): void {
    if (++nodeCount > 10000 || depth > 32) throw new Error('SVG 元素数量或嵌套超过限制')
    if (!SVG_TAGS.has(element.tagName) || element.namespaceURI !== namespace) throw new Error(`SVG 不支持元素 ${element.tagName}`)
    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes.item(index)!
      if (!SVG_ATTRIBUTES.has(attribute.name)) throw new Error(`SVG 不支持属性 ${attribute.name}`)
      const value = attribute.value
      if (/[\\@]|\/\*|expression\s*\(|var\s*\(/i.test(value)) throw new Error('SVG 属性含不安全内容')
      if (attribute.name === 'id') {
        if (!/^[A-Za-z_][\w.-]*$/.test(value) || ids.has(value)) throw new Error('SVG ID 无效或重复')
        ids.add(value)
        elementsById.set(value, element)
      }
      if (attribute.name === 'href') {
        if (!/^#[A-Za-z_][\w.-]*$/.test(value)) throw new Error('SVG 仅允许本地资源引用')
        references.push(value.slice(1))
      }
      if (/url\s*\(/i.test(value)) {
        const reference = /^url\(\s*#([A-Za-z_][\w.-]*)\s*\)$/.exec(value)
        if (!reference) throw new Error('SVG 仅允许本地 url 引用')
        references.push(reference[1])
      }
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element, depth + 1)
      else if (child.nodeType !== 3 && child.nodeType !== 8) throw new Error('SVG 包含不支持的节点')
    }
  }
  visit(root)
  if (references.some(id => !ids.has(id))) throw new Error('SVG 存在悬空引用')
  let expandedNodes = 0
  function countRenderedNodes(element: Element, useStack: Set<string>): void {
    if (++expandedNodes > MAX_EXPANDED_SVG_NODES) throw new Error('SVG 本地引用展开超过安全限制')
    if (element.tagName === 'use') {
      const targetId = element.getAttribute('href')?.slice(1)
      const target = targetId ? elementsById.get(targetId) : undefined
      if (!targetId || !target) throw new Error('SVG use 仅允许引用存在的本地元素')
      if (useStack.has(targetId)) throw new Error('SVG use 引用存在循环')
      if (useStack.size >= 128) throw new Error('SVG use 嵌套超过安全限制')
      const nextStack = new Set(useStack)
      nextStack.add(targetId)
      countRenderedNodes(target, nextStack)
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue
      const childElement = child as Element
      // Definitions are counted only when a local use expands them.
      if (childElement.tagName === 'defs') continue
      countRenderedNodes(childElement, useStack)
    }
  }
  countRenderedNodes(root, new Set())
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const dimension = (name: string, fallback: number | undefined) => {
    const raw = root.getAttribute(name)
    const result = raw && /^\d+(?:\.\d+)?(?:px)?$/.test(raw) ? Number(raw.replace(/px$/, '')) : fallback
    if (!result || !Number.isFinite(result) || result > 4096) throw new Error('SVG 需要 1–4096 的固有尺寸或 viewBox')
    return result
  }
  const width = dimension('width', viewBox?.length === 4 ? viewBox[2] : undefined)
  const height = dimension('height', viewBox?.length === 4 ? viewBox[3] : undefined)
  return { text: new XMLSerializer().serializeToString(root), width, height }
}

function decode(asset: Pick<ProjectStyleAsset, 'mimeType' | 'dataUrl'>): Uint8Array {
  const prefix = `data:${asset.mimeType};base64,`
  if (!asset.dataUrl.startsWith(prefix) || asset.dataUrl.length > MAX_BYTES * 1.4) throw new Error('资源必须为限额内的内嵌 base64')
  const encoded = asset.dataUrl.slice(prefix.length)
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('资源 base64 无效')
  return Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
}

function inspect(bytes: Uint8Array, mimeType: ProjectStyleAsset['mimeType']): { width?: number; height?: number } {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('单个资源须小于 4 MiB')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mimeType === 'image/svg+xml') {
    const svg = sanitizeStyleSvg(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return { width: svg.width, height: svg.height }
  }
  if (mimeType === 'image/png') {
    if (bytes.length < 45 || [137,80,78,71,13,10,26,10].some((value, index) => bytes[index] !== value)) throw new Error('PNG 头无效')
    let offset = 8, chunkIndex = 0, width = 0, height = 0, bitDepth = 0, colorType = -1
    let sawIdat = false, endedIdat = false, sawPalette = false, sawIend = false, idatBytes = 0
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset)
      if (length > bytes.length - offset - 12) throw new Error('PNG 数据块长度无效')
      const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!)
      if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('PNG 数据块类型无效')
      const dataStart = offset + 8, dataEnd = dataStart + length, crcOffset = dataEnd
      const expectedCrc = view.getUint32(crcOffset)
      if (pngCrc32(bytes, offset + 4, length + 4) !== expectedCrc) throw new Error(`PNG ${type} 数据块校验失败`)
      if (chunkIndex === 0 && (type !== 'IHDR' || length !== 13)) throw new Error('PNG 必须以有效 IHDR 开始')
      if (type === 'IHDR') {
        if (chunkIndex !== 0) throw new Error('PNG IHDR 位置或数量无效')
        width = view.getUint32(dataStart); height = view.getUint32(dataStart + 4)
        bitDepth = bytes[dataStart + 8]!; colorType = bytes[dataStart + 9]!
        if (bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || bytes[dataStart + 12]! > 1) throw new Error('PNG 压缩、滤镜或隔行方式无效')
        const allowedDepths: Record<number, readonly number[]> = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] }
        if (!allowedDepths[colorType]?.includes(bitDepth)) throw new Error('PNG 色彩类型或位深无效')
      } else if (type === 'PLTE') {
        if (sawPalette || sawIdat || length === 0 || length % 3 !== 0 || length > 768 || colorType === 0 || colorType === 4) throw new Error('PNG 调色板无效')
        if (colorType === 3 && length / 3 > 2 ** bitDepth) throw new Error('PNG 调色板超过索引位深')
        sawPalette = true
      } else if (type === 'IDAT') {
        if (endedIdat || colorType === 3 && !sawPalette) throw new Error('PNG IDAT 顺序无效')
        sawIdat = true; idatBytes += length
      } else if (type === 'IEND') {
        if (length !== 0 || !sawIdat || idatBytes === 0 || crcOffset + 4 !== bytes.length) throw new Error('PNG IEND 或图像数据不完整')
        sawIend = true
        offset = crcOffset + 4
        break
      } else {
        if (sawIdat) endedIdat = true
        if (type[0] === type[0]?.toUpperCase()) throw new Error(`PNG 不支持关键数据块 ${type}`)
      }
      if (type === 'IDAT') sawIdat = true
      else if (sawIdat) endedIdat = true
      offset = crcOffset + 4
      chunkIndex++
    }
    if (!sawIend || offset !== bytes.length) throw new Error('PNG 缺少完整结尾')
    if (!width || !height || width > 4096 || height > 4096 || width * height > 4194304) throw new Error('PNG 尺寸超过限制')
    return { width, height }
  }
  if (mimeType !== 'font/woff2' || bytes.length < 49 || view.getUint32(0) !== 0x774f4632 || view.getUint32(8) !== bytes.length
      || view.getUint16(12) === 0 || view.getUint16(12) > 4096 || view.getUint16(14) !== 0
      || view.getUint32(16) === 0 || view.getUint32(16) > 32 * 1024 * 1024
      || view.getUint32(20) === 0 || view.getUint32(20) > bytes.length - 48) throw new Error('WOFF2 头或解压大小无效')
  const metaOffset = view.getUint32(28), metaLength = view.getUint32(32), metaOriginalLength = view.getUint32(36)
  const privateOffset = view.getUint32(40), privateLength = view.getUint32(44)
  if ((metaOffset === 0) !== (metaLength === 0) || (metaOffset === 0) !== (metaOriginalLength === 0)
      || (privateOffset === 0) !== (privateLength === 0)) throw new Error('WOFF2 可选数据偏移不完整')
  const regions = [
    ...(metaOffset ? [{ start: metaOffset, end: metaOffset + metaLength }] : []),
    ...(privateOffset ? [{ start: privateOffset, end: privateOffset + privateLength }] : [])
  ].sort((left, right) => left.start - right.start)
  if (regions.some((region, index) => region.start < 48 || region.end > bytes.length || region.end <= region.start
      || index > 0 && regions[index - 1]!.end > region.start)) throw new Error('WOFF2 可选数据范围无效或重叠')
  return {}
}

function pngCrc32(bytes: Uint8Array, offset: number, length: number): number {
  let crc = 0xffffffff
  for (let index = offset; index < offset + length; index++) crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ bytes[index]!) & 0xff]!
  return (crc ^ 0xffffffff) >>> 0
}

async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return [...new Uint8Array(result)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function createStyleAsset(input: { name: string; mimeType: ProjectStyleAsset['mimeType']; bytes: Uint8Array; attribution: ProjectStyleAsset['attribution']; fontFamily?: string }): Promise<ProjectStyleAsset> {
  const bytes = input.mimeType === 'image/svg+xml' ? new TextEncoder().encode(sanitizeStyleSvg(new TextDecoder('utf-8', { fatal: true }).decode(input.bytes)).text) : input.bytes
  const dimensions = inspect(bytes, input.mimeType)
  const contentHash = await digest(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const asset: ProjectStyleAsset = { id: `asset-${contentHash}`, name: input.name, mimeType: input.mimeType, dataUrl: `data:${input.mimeType};base64,${btoa(binary)}`, contentHash, ...dimensions, attribution: { ...input.attribution }, ...(input.fontFamily ? { fontFamily: input.fontFamily } : {}) }
  const errors = validateStyleAssets([asset])
  if (errors.length) throw new Error(errors.join('; '))
  return asset
}

/** Synchronous import checks also run on scene/project parsing, before any rendering. */
export function validateStyleAssets(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 256) return ['资源清单必须是数组且不超过 256 项']
  const ids = new Set<string>(), errors: string[] = []
  const families = new Set<string>()
  let total = 0
  value.forEach((entry, index) => {
    try {
      if (!entry || typeof entry !== 'object') throw new Error('资源必须是对象')
      const asset = entry as ProjectStyleAsset
      if (!/^[a-f0-9]{64}$/.test(asset.contentHash) || asset.id !== `asset-${asset.contentHash}` || ids.has(asset.id)) throw new Error('资源 ID/内容哈希无效或重复')
      ids.add(asset.id)
      if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 256 || typeof asset.attribution?.source !== 'string' || !asset.attribution.source.trim() || typeof asset.attribution.license !== 'string' || !asset.attribution.license.trim()) throw new Error('资源需要名称、来源与许可')
      if (asset.mimeType === 'font/woff2' && (!asset.fontFamily || !/^[\w -]{1,80}$/.test(asset.fontFamily))) throw new Error('字体名称无效')
      if (asset.mimeType === 'font/woff2') {
        if (families.has(asset.fontFamily!)) throw new Error('项目字体名称重复')
        families.add(asset.fontFamily!)
      }
      const bytes = decode(asset)
      total += bytes.length
      const dimensions = inspect(bytes, asset.mimeType)
      if (dimensions.width !== asset.width || dimensions.height !== asset.height) throw new Error('资源尺寸与内容不一致')
    } catch (error) { errors.push(`assets[${index}]: ${error instanceof Error ? error.message : String(error)}`) }
  })
  if (total > MAX_TOTAL_BYTES) errors.push('项目符号资源总量超过 24 MiB')
  return errors
}

export async function verifyStyleAssets(assets: readonly ProjectStyleAsset[]): Promise<void> {
  const errors = validateStyleAssets(assets)
  if (errors.length) throw new Error(errors.join('; '))
  for (const asset of assets) {
    const bytes = decode(asset)
    if (await digest(bytes) !== asset.contentHash) throw new Error(`资源内容哈希不匹配：${asset.name}`)
    if (asset.mimeType === 'image/png') await verifyPngPayload(bytes, asset.name)
  }
}

async function verifyPngPayload(bytes: Uint8Array, name: string): Promise<void> {
  if (typeof DecompressionStream === 'undefined') throw new Error(`当前环境无法完整校验 PNG：${name}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16), height = view.getUint32(20)
  const bitDepth = bytes[24]!, colorType = bytes[25]!, interlace = bytes[28]!
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const bitsPerPixel = channels[colorType]! * bitDepth
  let offset = 8
  const chunks: Uint8Array[] = []
  let compressedSize = 0
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!)
    if (type === 'IDAT') {
      const chunk = bytes.slice(offset + 8, offset + 8 + length)
      chunks.push(chunk); compressedSize += chunk.length
    }
    offset += length + 12
    if (type === 'IEND') break
  }
  const compressed = new Uint8Array(compressedSize)
  let compressedOffset = 0
  for (const chunk of chunks) { compressed.set(chunk, compressedOffset); compressedOffset += chunk.length }
  const passWidth = (start: number, step: number) => Math.max(0, Math.ceil((width - start) / step))
  const passHeight = (start: number, step: number) => Math.max(0, Math.ceil((height - start) / step))
  const passes = interlace === 0
    ? [[0, 0, 1, 1]]
    : [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]
  const expectedSize = passes.reduce((total, [startX, startY, stepX, stepY]) => {
    const columns = passWidth(startX!, stepX!), rows = passHeight(startY!, stepY!)
    return total + (columns && rows ? (Math.ceil(columns * bitsPerPixel / 8) + 1) * rows : 0)
  }, 0)
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  let decodedSize = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      decodedSize += value.byteLength
      if (decodedSize > expectedSize || decodedSize > 64 * 1024 * 1024) {
        await reader.cancel()
        throw new Error(`PNG 解压数据超过声明尺寸：${name}`)
      }
    }
  } catch {
    throw new Error(`PNG 压缩图像数据损坏：${name}`)
  } finally {
    reader.releaseLock()
  }
  if (decodedSize !== expectedSize) throw new Error(`PNG 解压数据与像素尺寸不匹配：${name}`)
}
