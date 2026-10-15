import { Cartesian3, Color, GeometryInstance, Material, MaterialAppearance, PolygonGeometry, PolygonHierarchy, Primitive, buildModuleUrl } from 'cesium'
import type { Viewer } from 'cesium'
import { BaseLayer } from '@desktop-webgis/cesium-layer'
import type { LayerOptions } from '@desktop-webgis/cesium-layer'
import type { GeoPosition } from '@desktop-webgis/cesium-scene-schema'

export interface WaterLayerOptions extends LayerOptions {
  boundary: GeoPosition[]
  height: number
  color?: string
  amplitude?: number
  frequency?: number
  speed?: number
}

/** Polygon water built solely with Cesium's public geometry and material APIs. */
export class WaterLayer extends BaseLayer {
  primitive?: Primitive
  private material?: Material
  private removeTick?: () => void
  constructor(private options: WaterLayerOptions) { super(options) }
  /** Detached live parameters for inspectors and diagnostics. */
  getParameters(): { height: number; amplitude: number; frequency: number; speed: number } {
    return { height: this.options.height, amplitude: this.material?.uniforms.amplitude ?? this.options.amplitude ?? 4, frequency: this.material?.uniforms.frequency ?? this.options.frequency ?? 1000, speed: this.material?.uniforms.animationSpeed ?? this.options.speed ?? .02 }
  }
  /** Update uniforms in place; rebuild only geometry when the boundary or height changes. */
  setOptions(patch: Partial<Pick<WaterLayerOptions, 'boundary' | 'height' | 'color' | 'amplitude' | 'frequency' | 'speed'>>): void {
    const next = { ...this.options, ...patch }
    const color = Color.fromCssColorString(next.color ?? '#238bafcc')
    if (!color || !Number.isFinite(next.height) || !Number.isFinite(next.amplitude ?? 4) || (next.amplitude ?? 4) < 0 || !Number.isFinite(next.frequency ?? 1000) || (next.frequency ?? 1000) <= 0 || !Number.isFinite(next.speed ?? .02) || (next.speed ?? .02) < 0 || next.boundary.length < 3 || !next.boundary.every(point => point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) throw new Error('水面参数无效')
    const geometryChanged = JSON.stringify([next.boundary, next.height]) !== JSON.stringify([this.options.boundary, this.options.height])
    if (this.viewer && this.material && geometryChanged) {
      const replacement = this.createPrimitive(this.material, next)
      this.viewer.scene.primitives.add(replacement)
      if (this.primitive && !this.primitive.isDestroyed()) this.viewer.scene.primitives.remove(this.primitive)
      this.primitive = replacement
    }
    this.options = { ...next, boundary: next.boundary.map(point => [...point] as GeoPosition) }
    if (this.material) Object.assign(this.material.uniforms, { baseWaterColor: color, frequency: next.frequency ?? 1000, animationSpeed: next.speed ?? .02, amplitude: next.amplitude ?? 4 })
    this.setNativeVisible(this.show)
    this.viewer?.scene.requestRender()
  }
  contains(picked: unknown): boolean { return Boolean(picked && typeof picked === 'object' && 'primitive' in picked && picked.primitive === this.primitive) }
  async flyTo(): Promise<void> { if (this.viewer) this.viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(this.options.boundary[0][0], this.options.boundary[0][1], this.options.height + 600) }) }
  protected setNativeVisible(value: boolean): void {
    if (this.primitive) this.primitive.show = value
    this.removeTick?.(); this.removeTick = undefined
    if (value && this.viewer && (this.options.speed ?? .02) > 0) this.removeTick = this.viewer.clock.onTick.addEventListener(() => this.viewer?.scene.requestRender())
  }
  protected async createNative(viewer: Viewer): Promise<() => void> {
    const material = Material.fromType('Water', {
      baseWaterColor: Color.fromCssColorString(this.options.color ?? '#238bafcc'),
      normalMap: buildModuleUrl('Assets/Textures/waterNormals.jpg'),
      frequency: this.options.frequency ?? 1000,
      animationSpeed: this.options.speed ?? .02,
      amplitude: this.options.amplitude ?? 4,
      specularIntensity: .5
    })
    const primitive = this.createPrimitive(material, this.options)
    this.material = material; this.primitive = primitive
    viewer.scene.primitives.add(primitive)
    return () => {
      const ownsCurrent = this.material === material
      if (ownsCurrent) { this.removeTick?.(); this.removeTick = undefined }
      const owned = ownsCurrent ? this.primitive : primitive
      if (owned && !owned.isDestroyed()) { if (!viewer.isDestroyed()) viewer.scene.primitives.remove(owned); else owned.destroy() }
      if (!material.isDestroyed()) material.destroy()
      if (ownsCurrent) { this.primitive = undefined; this.material = undefined }
    }
  }
  private createPrimitive(material: Material, options: WaterLayerOptions): Primitive {
    return new Primitive({
      geometryInstances: new GeometryInstance({ id: this.id, geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(options.boundary.map(p => Cartesian3.fromDegrees(p[0], p[1], options.height))), height: options.height, vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }) }),
      appearance: new MaterialAppearance({ material, faceForward: true, translucent: true }), asynchronous: false, show: this.show
    })
  }
}

/** Restore host settings on disposal instead of overwriting another application's defaults. */
export class SceneEffects {
  private readonly original: { density: number; enabled: boolean; bloom: boolean }
  private destroyed = false
  constructor(private readonly viewer: Viewer) {
    this.original = { density: viewer.scene.fog.density, enabled: viewer.scene.fog.enabled, bloom: viewer.scene.postProcessStages.bloom.enabled }
  }
  update(effects: { fog: number; bloom: boolean }): void {
    if (this.destroyed) throw new Error('SceneEffects 已销毁')
    this.viewer.scene.fog.enabled = effects.fog > 0
    this.viewer.scene.fog.density = effects.fog * .002
    this.viewer.scene.postProcessStages.bloom.enabled = effects.bloom
    this.viewer.scene.requestRender()
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.viewer.isDestroyed()) return
    this.viewer.scene.fog.enabled = this.original.enabled
    this.viewer.scene.fog.density = this.original.density
    this.viewer.scene.postProcessStages.bloom.enabled = this.original.bloom
  }
}

export * from './compat-city.js'
