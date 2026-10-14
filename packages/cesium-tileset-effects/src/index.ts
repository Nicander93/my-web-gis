import { Cartesian3, ClippingPolygon, ClippingPolygonCollection } from 'cesium'
import type { Cesium3DTileset, Scene } from 'cesium'
import type { TilesetClipEffect } from '@desktop-webgis/cesium-scene-schema'

export class TilesetEffectError extends Error {
  constructor(readonly code: 'unsupported' | 'mixed-clip-mode' | 'destroyed', message: string) {
    super(message)
    this.name = 'TilesetEffectError'
  }
}

interface InstalledEffect {
  target: Cesium3DTileset
  previous: ClippingPolygonCollection | undefined
  collection: ClippingPolygonCollection
  signature: string
  requestRender(): void
}

export function assertTilesetEffectsSupported(effects: readonly TilesetClipEffect[], scene: Scene): void {
  const enabled = effects.filter(effect => effect.enabled)
  if (!enabled.length) return
  if (!ClippingPolygonCollection.isSupported(scene)) throw new TilesetEffectError('unsupported', '当前 WebGL 环境不支持 3D Tiles 多边形裁剪')
  if (new Set(enabled.map(effect => effect.mode)).size !== 1) {
    throw new TilesetEffectError('mixed-clip-mode', '同一 Tileset 暂不支持混合保留内部与保留外部的裁剪范围')
  }
}

/** Owns only collections it installs and restores the target's previous collection on removal. */
export class TilesetEffectManager {
  private readonly installed = new Map<string, InstalledEffect>()
  private destroyed = false

  setEffects(tilesetId: string, target: Cesium3DTileset, effects: readonly TilesetClipEffect[], scene: Scene): void {
    if (this.destroyed) throw new TilesetEffectError('destroyed', 'TilesetEffectManager 已销毁')
    const enabled = effects.filter(effect => effect.enabled)
    if (!enabled.length) { this.removeEffects(tilesetId); return }
    assertTilesetEffectsSupported(enabled, scene)

    const signature = JSON.stringify(enabled)
    const installed = this.installed.get(tilesetId)
    if (installed?.target === target && installed.signature === signature && target.clippingPolygons === installed.collection) return

    const previous = installed?.target === target ? installed.previous : target.clippingPolygons
    this.removeEffects(tilesetId)
    const collection = new ClippingPolygonCollection({
      inverse: enabled[0].mode === 'keep-inside',
      polygons: enabled.map(effect => new ClippingPolygon({
        positions: effect.positions.map(position => Cartesian3.fromDegrees(...position))
      }))
    })
    target.clippingPolygons = collection
    this.installed.set(tilesetId, { target, previous, collection, signature, requestRender: () => scene.requestRender() })
    scene.requestRender()
  }

  removeEffects(tilesetId: string): ClippingPolygonCollection | undefined {
    const current = this.installed.get(tilesetId)
    if (!current) return undefined
    this.installed.delete(tilesetId)
    if (!current.target.isDestroyed() && current.target.clippingPolygons === current.collection) {
      // Cesium's runtime setter accepts undefined to clear clipping, although its declaration is narrower.
      const mutable = current.target as unknown as { clippingPolygons: ClippingPolygonCollection | undefined }
      mutable.clippingPolygons = current.previous
      current.requestRender()
    }
    return current.previous
  }

  destroy(): void {
    if (this.destroyed) return
    for (const id of [...this.installed.keys()]) this.removeEffects(id)
    this.destroyed = true
  }
}
