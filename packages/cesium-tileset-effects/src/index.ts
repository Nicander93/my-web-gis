import { Cartesian3, Cartesian4, ClippingPolygon, ClippingPolygonCollection, ContextLimits, CustomShader, Matrix4, PixelFormat, TextureMagnificationFilter, TextureMinificationFilter, TextureUniform, Transforms, UniformType } from 'cesium'
import type { Cesium3DTileset, Scene } from 'cesium'
import type { TilesetClipEffect, TilesetEffect, TilesetFlattenEffect } from '@desktop-webgis/cesium-scene-schema'

type EffectErrorCode = 'unsupported' | 'mixed-clip-mode' | 'custom-shader-conflict' | 'flatten-extent' | 'texture-limit' | 'destroyed'

export class TilesetEffectError extends Error {
  constructor(readonly code: EffectErrorCode, message: string) {
    super(message)
    this.name = 'TilesetEffectError'
  }
}

interface InstalledEffect {
  target: Cesium3DTileset
  previousClipping: ClippingPolygonCollection | undefined
  previousShader: CustomShader | undefined
  clipping?: ClippingPolygonCollection
  shader?: CustomShader
  signature: string
  requestRender(): void
}

export interface FlattenMask {
  data: Uint8Array
  width: number
  height: number
  worldToLocal: Matrix4
  localToWorld: Matrix4
  bounds: Cartesian4
  minimumHeight: number
  heightRange: number
}
interface PreparedFlatten extends Omit<FlattenMask, 'data' | 'minimumHeight' | 'heightRange'> {
  localEffects: Array<{ effect: TilesetFlattenEffect; points: Cartesian3[] }>
  widthMetres: number
  heightMetres: number
}

const MAX_FLATTEN_EXTENT_METRES = 5_000
const INTERNAL_MAX_TEXTURE_SIZE = 2_048

export function assertTilesetEffectsSupported(effects: readonly TilesetEffect[], scene: Scene): void {
  const clipping = effects.filter((effect): effect is TilesetClipEffect => effect.enabled && effect.kind === 'clip-polygon')
  if (clipping.length && !ClippingPolygonCollection.isSupported(scene)) throw new TilesetEffectError('unsupported', '当前 WebGL 环境不支持 3D Tiles 多边形裁剪')
  if (new Set(clipping.map(effect => effect.mode)).size > 1) {
    throw new TilesetEffectError('mixed-clip-mode', '同一 Tileset 暂不支持混合保留内部与保留外部的裁剪范围')
  }
  const flattening = effects.filter((effect): effect is TilesetFlattenEffect => effect.enabled && effect.kind === 'flatten-polygon')
  if (flattening.length) prepareFlattenMask(flattening, maximumTextureSize(scene))
}

/** Builds a bounded RGBA height mask. Alpha marks coverage and RGB stores a 24-bit target height. */
export function buildFlattenMask(effects: readonly TilesetFlattenEffect[], gpuMaximumTextureSize: number): FlattenMask {
  const prepared = prepareFlattenMask(effects, gpuMaximumTextureSize)
  const { width, height, widthMetres, heightMetres, localEffects, bounds, worldToLocal, localToWorld } = prepared
  const data = new Uint8Array(width * height * 4), heights = effects.map(effect => effect.height), minimumHeight = Math.min(...heights)
  const heightRange = Math.max(1, Math.max(...heights) - minimumHeight)
  for (const { effect, points } of localEffects) {
    const pixels = points.map(point => ({ x: (point.x - bounds.x) / widthMetres * width, y: (point.y - bounds.y) / heightMetres * height }))
    const startX = Math.max(0, Math.floor(Math.min(...pixels.map(point => point.x)))), endX = Math.min(width - 1, Math.ceil(Math.max(...pixels.map(point => point.x))))
    const startY = Math.max(0, Math.floor(Math.min(...pixels.map(point => point.y)))), endY = Math.min(height - 1, Math.ceil(Math.max(...pixels.map(point => point.y))))
    const encoded = Math.round((effect.height - minimumHeight) / heightRange * 0xffffff)
    for (let y = startY; y <= endY; y++) for (let x = startX; x <= endX; x++) {
      if (!containsPoint(pixels, x + .5, y + .5)) continue
      const index = (y * width + x) * 4
      data[index] = encoded >> 16; data[index + 1] = encoded >> 8 & 0xff; data[index + 2] = encoded & 0xff; data[index + 3] = 0xff
    }
  }
  return { data, width, height, worldToLocal, localToWorld, bounds, minimumHeight, heightRange }
}

function prepareFlattenMask(effects: readonly TilesetFlattenEffect[], gpuMaximumTextureSize: number): PreparedFlatten {
  if (!effects.length) throw new TilesetEffectError('flatten-extent', '至少需要一个启用的压平范围')
  const textureLimit = Math.min(INTERNAL_MAX_TEXTURE_SIZE, Math.floor(gpuMaximumTextureSize))
  if (!Number.isFinite(textureLimit) || textureLimit < 64) throw new TilesetEffectError('texture-limit', '当前 GPU 的纹理尺寸不足以创建压平遮罩')
  const positions = effects.flatMap(effect => effect.positions)
  const longitudes = positions.map(position => position[0]), latitudes = positions.map(position => position[1])
  if (Math.max(...longitudes) - Math.min(...longitudes) > 1) throw new TilesetEffectError('flatten-extent', '压平范围跨越经度边界或距离过大，请拆分为局部范围')
  const origin = Cartesian3.fromDegrees((Math.min(...longitudes) + Math.max(...longitudes)) / 2, (Math.min(...latitudes) + Math.max(...latitudes)) / 2, 0)
  const localToWorld = Transforms.eastNorthUpToFixedFrame(origin), worldToLocal = Matrix4.inverse(localToWorld, new Matrix4())
  const localEffects = effects.map(effect => ({ effect, points: effect.positions.map(position => Matrix4.multiplyByPoint(worldToLocal, Cartesian3.fromDegrees(position[0], position[1], 0), new Cartesian3())) }))
  const xs = localEffects.flatMap(item => item.points.map(point => point.x)), ys = localEffects.flatMap(item => item.points.map(point => point.y))
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const rawWidth = maxX - minX, rawHeight = maxY - minY
  if (!(rawWidth > 0 && rawHeight > 0) || Math.max(rawWidth, rawHeight) > MAX_FLATTEN_EXTENT_METRES) throw new TilesetEffectError('flatten-extent', `局部压平范围须为有效多边形，且最大跨度不能超过 ${MAX_FLATTEN_EXTENT_METRES} 米`)
  const padding = Math.max(1, Math.max(rawWidth, rawHeight) * .005)
  minX -= padding; maxX += padding; minY -= padding; maxY += padding
  const widthMetres = maxX - minX, heightMetres = maxY - minY, scale = Math.min(1, textureLimit / Math.max(widthMetres, heightMetres))
  const width = Math.min(textureLimit, Math.max(64, Math.ceil(widthMetres * scale))), height = Math.min(textureLimit, Math.max(64, Math.ceil(heightMetres * scale)))
  return { width, height, widthMetres, heightMetres, worldToLocal, localToWorld, bounds: new Cartesian4(minX, minY, maxX, maxY), localEffects }
}

function containsPoint(polygon: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index], b = polygon[previous]
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function createFlattenShader(effects: readonly TilesetFlattenEffect[], scene: Scene): CustomShader {
  const mask = buildFlattenMask(effects, maximumTextureSize(scene))
  return new CustomShader({
    uniforms: {
      u_flattenMask: { type: UniformType.SAMPLER_2D, value: new TextureUniform({ typedArray: mask.data, width: mask.width, height: mask.height, repeat: false, pixelFormat: PixelFormat.RGBA, minificationFilter: TextureMinificationFilter.NEAREST, magnificationFilter: TextureMagnificationFilter.NEAREST }) },
      u_worldToFlatten: { type: UniformType.MAT4, value: mask.worldToLocal },
      u_flattenToWorld: { type: UniformType.MAT4, value: mask.localToWorld },
      u_flattenBounds: { type: UniformType.VEC4, value: mask.bounds },
      u_minimumHeight: { type: UniformType.FLOAT, value: mask.minimumHeight },
      u_heightRange: { type: UniformType.FLOAT, value: mask.heightRange }
    },
    vertexShaderText: `
      void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
        vec4 worldPosition = czm_model * vec4(vsOutput.positionMC, 1.0);
        vec4 localPosition = u_worldToFlatten * worldPosition;
        if (localPosition.x < u_flattenBounds.x || localPosition.x > u_flattenBounds.z || localPosition.y < u_flattenBounds.y || localPosition.y > u_flattenBounds.w) return;
        vec2 uv = (localPosition.xy - u_flattenBounds.xy) / (u_flattenBounds.zw - u_flattenBounds.xy);
        vec4 encoded = texture(u_flattenMask, uv);
        if (encoded.a < 0.5) return;
        vec3 bytes = floor(encoded.rgb * 255.0 + 0.5);
        float normalizedHeight = dot(bytes, vec3(65536.0, 256.0, 1.0)) / 16777215.0;
        localPosition.z = u_minimumHeight + normalizedHeight * u_heightRange;
        vsOutput.positionMC = (czm_inverseModel * u_flattenToWorld * localPosition).xyz;
      }`
  })
}

function maximumTextureSize(scene: Scene): number {
  const injected = (scene as unknown as { context?: { maximumTextureSize?: number } }).context?.maximumTextureSize
  const size = ContextLimits.maximumTextureSize || injected
  if (!Number.isFinite(size)) throw new TilesetEffectError('texture-limit', '无法读取当前 GPU 的最大纹理尺寸')
  return size!
}

/** Owns only collections and shaders it installs and restores prior target state on removal. */
export class TilesetEffectManager {
  private readonly installed = new Map<string, InstalledEffect>()
  private destroyed = false

  setEffects(tilesetId: string, target: Cesium3DTileset, effects: readonly TilesetEffect[], scene: Scene): void {
    if (this.destroyed) throw new TilesetEffectError('destroyed', 'TilesetEffectManager 已销毁')
    const enabled = effects.filter(effect => effect.enabled)
    if (!enabled.length) { this.removeEffects(tilesetId); return }
    assertTilesetEffectsSupported(enabled, scene)
    const signature = JSON.stringify(enabled), installed = this.installed.get(tilesetId)
    if (installed?.target === target && installed.signature === signature && (!installed.clipping || target.clippingPolygons === installed.clipping) && (!installed.shader || target.customShader === installed.shader)) return
    const sameTarget = installed?.target === target
    const previousClipping = sameTarget && target.clippingPolygons === installed.clipping ? installed.previousClipping : target.clippingPolygons
    const previousShader = sameTarget && target.customShader === installed.shader ? installed.previousShader : target.customShader
    const clipping = enabled.filter((effect): effect is TilesetClipEffect => effect.kind === 'clip-polygon')
    const flattening = enabled.filter((effect): effect is TilesetFlattenEffect => effect.kind === 'flatten-polygon')
    if (flattening.length && previousShader) throw new TilesetEffectError('custom-shader-conflict', '目标 Tileset 已使用其他 CustomShader，无法安全叠加局部压平')
    const collection = clipping.length ? new ClippingPolygonCollection({ inverse: clipping[0].mode === 'keep-inside', polygons: clipping.map(effect => new ClippingPolygon({ positions: effect.positions.map(position => Cartesian3.fromDegrees(...position)) })) }) : undefined
    const shader = flattening.length ? createFlattenShader(flattening, scene) : undefined
    this.removeEffects(tilesetId)
    if (collection) target.clippingPolygons = collection
    if (shader) target.customShader = shader
    this.installed.set(tilesetId, { target, previousClipping, previousShader, clipping: collection, shader, signature, requestRender: () => scene.requestRender() })
    scene.requestRender()
  }

  removeEffects(tilesetId: string): void {
    const current = this.installed.get(tilesetId)
    if (!current) return
    this.installed.delete(tilesetId)
    if (!current.target.isDestroyed()) {
      if (current.clipping && current.target.clippingPolygons === current.clipping) (current.target as unknown as { clippingPolygons: ClippingPolygonCollection | undefined }).clippingPolygons = current.previousClipping
      if (current.shader && current.target.customShader === current.shader) current.target.customShader = current.previousShader
      current.requestRender()
    }
    if (current.shader && !current.shader.isDestroyed()) current.shader.destroy()
  }

  destroy(): void {
    if (this.destroyed) return
    for (const id of [...this.installed.keys()]) this.removeEffects(id)
    this.destroyed = true
  }
}
